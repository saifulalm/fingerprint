// Alat CLI: cocokkan roster Fingerprint In ↔ Fingerprint Out berdasarkan NAMA.
//
// TUJUAN:
//   Nomor employee bersifat LOKAL per perangkat, jadi nomor yang sama bisa
//   menunjuk orang berbeda di dua perangkat:
//
//     In (masuk)        Out (keluar)
//     5  Juanto    →   5  Adit      ← orang BERBEDA
//     6  Adit      →   6  Chika     ← orang BERBEDA
//     (tidak ada)   →   7  Juanto    ← hanya ada di Out
//
//   Tool ini mencocokkan berdasarkan NAMA, lalu:
//     - MENYARANKAN alias untuk nomor yang berbeda
//     - MENCATAT user yang hanya ada di satu perangkat
//     - OPSIONAL menerapkan alias yang disarankan
//
// PEMAKAIAN:
//   node scripts/match-device-roster.mjs check
//     → baca roster perangkat, tampilkan hasil pencocokan (tidak mengubah apa pun)
//
//   node scripts/match-device-roster.mjs suggest
//     → tampilkan alias yang perlu dibuat (dibandingkan dengan yang ada)
//
//   node scripts/match-device-roster.mjs apply [--yes]
//     → BUAT alias yang disarankan (yang belum ada)
//     → pakai --yes untuk melewati konfirmasi
//
//   node scripts/match-device-roster.mjs apply --device keluar --no 7 --to 5
//     → buat alias spesifik: nomor 7 di device keluar → nomor canonical 5
//
// CATATAN:
//   Perangkat harus bisa dijangkau. Kalau perangkat offline, tool ini
//   memberi tahu dan TIDAK mengubah apa pun.
//
// Opsi:
//   --reference <deviceKey>   perangkat acuan (default: masuk)

import { config } from '../src/config/index.js';
import { getDeviceUsers } from '../src/services/hikvisionAdmin.js';
import {
  fetchDeviceRosters,
  matchRostersByName,
  diffAgainstExistingAliases,
  loadExistingAliases,
  summarizeRosterMatch,
  detectEmployeeNumberReassignments,
} from '../src/services/deviceRosterService.js';
import { CANONICAL_DEVICE_KEY } from '../src/services/employeeIdentityService.js';
import prisma from '../src/db.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'check';

const getArg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const hasArg = (name) => args.includes(`--${name}`);

const referenceKey = getArg('reference', CANONICAL_DEVICE_KEY);
const autoYes = hasArg('yes');
const useDb = hasArg('from-db');

async function readRosters() {
  const out = {};

  // Mode --from-db: pakai roster yang tersimpan di `device_users` (cache
  // sinkronisasi terakhir). Berguna saat perangkat sedang offline atau
  // belum bisa dijangkau dari mesin ini.
  //
  // CATATAN: ini DATA CACHE — bisa saja sudah usang. Hasil dari mode ini
  // hanya jadi REFERENSI; alias yang benar tetap idealnya dibuat dari
  // data perangkat live.
  if (useDb) {
    console.log('  ⚠️  Mode --from-db: memakai roster CACHE dari device_users.');
    console.log('      Pastikan data ini sudah disinkronkan (Pusat Perangkat → Sinkron User).\n');
    const rows = await prisma.deviceUser.findMany({
      orderBy: [{ deviceKey: 'asc' }, { employeeNo: 'asc' }],
    });
    for (const u of rows) {
      if (!out[u.deviceKey]) out[u.deviceKey] = [];
      out[u.deviceKey].push({ employeeNo: String(u.employeeNo), name: String(u.name ?? '').trim() });
    }
    for (const key of Object.keys(out)) {
      console.log(`  ${key}: ${out[key].length} user (dari DB)`);
    }
    return out;
  }

  for (const [key, dev] of Object.entries(config.devices)) {
    process.stdout.write(`  Membaca roster device "${key}" (${dev.ip}) ... `);
    try {
      const users = await getDeviceUsers(dev);

      // Roster kosong dari perangkat TIDAK bisa dianggap "tidak ada user".
      //
      // Kalau perangkat menjawab tapi mengirim 0 user, itu hampir selalu
      // tanda perangkat tidak terjangkau / belum login — bukan berarti
      // semua user dihapus. Kalau ini dianggap roster kosong, tool akan
      // menyimpulkan "tidak ada konflik" dan TIDAK menulis apa pun — aman.
      //
      // Tapi kalau perangkat benar-benar kosong sungguhan, kita tetap
      // melaporkannya sebagai "perangkat tidak terbaca" supaya user
      // tidak salah yakin bahwa pencocokan sudah akurat.
      if (!users || users.length === 0) {
        out[key] = { error: 'Perangkat tidak mengembalikan user (offline atau belum login)' };
        console.log('⚠️  0 user');
      } else {
        out[key] = users
          .map((u) => ({ employeeNo: String(u.employeeNo ?? '').trim(), name: String(u.name ?? '').trim() }))
          .filter((u) => u.employeeNo && u.name);
        console.log(`✅ ${out[key].length} user`);
      }
    } catch (err) {
      out[key] = { error: err.message };
      console.log(`❌ ${err.message}`);
    }
  }
  return out;
}

function printRosters(perDevice) {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  ROSTER USER PER PERANGKAT');
  console.log('══════════════════════════════════════════════════════════');
  for (const [key, rows] of Object.entries(perDevice)) {
    console.log(`\n  ${key.toUpperCase()}`);
    if (!Array.isArray(rows)) {
      console.log(`    (GAGAL DIBACA: ${rows?.error})`);
      continue;
    }
    console.log('    No.   Nama');
    for (const u of rows.sort((a, b) => Number(a.employeeNo) - Number(b.employeeNo))) {
      console.log(`    ${String(u.employeeNo).padEnd(6)}${u.name}`);
    }
  }
}

function printMatch(match, diff) {
  const s = summarizeRosterMatch(match, diff);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  HASIL PENCOCOKAN BERDASARKAN NAMA');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Perangkat acuan      : ${referenceKey}`);
  console.log(`  Nomor beda, nama sama : ${s.matchedCount}`);
  console.log(`  Hanya ada di 1 device : ${s.missingCount}`);
  console.log(`  Sudah cocok            : ${s.conflictCount}`);
  console.log(`  Alias perlu dibuat    : ${s.toCreateCount} (dari ${s.matchedCount} kandidat)`);
  console.log(`  Alias sudah ada       : ${s.existingCount}`);
  if (s.offline.length) {
    console.log(`  ⚠️  Device offline      : ${s.offline.join(', ')}`);
  }

  if (match.matched?.length) {
    console.log('\n  ── NOMOR BEDA, NAMA SAMA (butuh alias) ──');
    for (const m of match.matched) {
      console.log(
        `    ${m.name.padEnd(18)} ref ${m.reference.deviceKey}:${m.reference.employeeNo}` +
        `  →  ${m.other.deviceKey}:${m.other.employeeNo}`,
      );
    }
  }

  if (match.missing?.length) {
    console.log('\n  ── HANYA ADA DI SATU PERANGKAT ──');
    for (const m of match.missing) {
      const where = m.reason === 'only_on_other_device'
        ? `ada di ${m.presentOn.deviceKey}:${m.presentOn.employeeNo}, tidak ada di ${m.missingOn}`
        : `ada di ${m.presentOn.deviceKey}:${m.presentOn.employeeNo}, tidak ada di ${m.missingOn}`;
      console.log(`    ${m.name.padEnd(18)} ${where}`);
    }
  }

  if (diff.toCreate?.length) {
    console.log('\n  ── ALIAS YANG AKAN DIBUAT ──');
    for (const a of diff.toCreate) {
      console.log(`    ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}   (${a.name})`);
    }
  }

  if (diff.existing?.length) {
    console.log('\n  ── ALIAS SUDAH ADA (dibiarkan) ──');
    for (const a of diff.existing) {
      console.log(`    ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}   (${a.name})`);
    }
  }

  if (diff.conflicts?.length) {
    console.log('\n  ⚠️  ALIAS BENTROK — perlu ditinjau manual ──');
    for (const a of diff.conflicts) {
      console.log(
        `    ${a.deviceKey}:${a.deviceEmployeeNo} → existing ${a.existingEmployeeNo}, ` +
        `saran ${a.employeeNo}   (${a.name})`,
      );
    }
  }
}

async function main() {
  console.log(`\nAlat pencocokan roster perangkat (acuan: ${referenceKey})\n`);

  // ── Mode manual: apply --device X --no N --to M ────────────────────────────
  if (cmd === 'apply' && getArg('device') && getArg('no') && getArg('to')) {
    const deviceKey = getArg('device');
    const deviceNo = getArg('no');
    const canonicalNo = getArg('to');
    const note = getArg('note', `Nomor ${deviceNo} di device ${deviceKey} → ${canonicalNo}`);

    const existing = await prisma.employeeIdAlias.findUnique({
      where: { deviceKey_deviceEmployeeNo: { deviceKey, deviceEmployeeNo: deviceNo } },
    });
    if (existing) {
      console.log(`\n❌ Alias sudah ada: ${deviceKey}:${deviceNo} → ${existing.employeeNo}`);
      console.log('   Hapus dulu bila ingin mengubah: node scripts/manage-id-aliases.mjs remove ' +
        `${deviceKey} ${deviceNo}`);
      await prisma.$disconnect();
      process.exit(1);
    }

    await prisma.employeeIdAlias.create({
      data: { deviceKey, deviceEmployeeNo: deviceNo, employeeNo: canonicalNo, note },
    });
    console.log(`\n✅ Alias dibuat: ${deviceKey}:${deviceNo} → ${canonicalNo}`);
    await prisma.$disconnect();
    return;
  }

  const perDevice = await readRosters();

  // Kalau ada perangkat offline → berhenti di sini. Membuat alias dari
  // roster yang tidak lengkap bisa menulis pemetaan yang SALAH.
  const offline = Object.entries(perDevice)
    .filter(([, rows]) => !Array.isArray(rows))
    .map(([k]) => k);

  if (offline.length) {
    console.log(`\n⚠️  Perangkat gagal dibaca: ${offline.join(', ')}`);
    console.log('   Alias TIDAK dibuat agar tidak menulis pemetaan yang keliru.');
    console.log('   Pastikan perangkat menyala & bisa dijangkau, lalu ulangi.');
    await prisma.$disconnect();
    process.exit(2);
  }

  printRosters(perDevice);

  const match = matchRostersByName(perDevice, referenceKey);
  const existingAliases = await loadExistingAliases();
  const diff = diffAgainstExistingAliases(match, existingAliases);

  printMatch(match, diff);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  PERALIHAN ORANG PADA NOMOR YANG SAMA (riwayat, bukan error)');
  console.log('══════════════════════════════════════════════════════════');
  const reassignments = detectEmployeeNumberReassignments(
    await prisma.attendanceRecord.findMany({
      select: { employeeNo: true, employeeName: true, deviceKey: true, time: true },
    }),
  );
  if (reassignments.size === 0) {
    console.log('  (tidak ada)');
  } else {
    for (const r of reassignments.values()) {
      console.log(`  ${r.deviceKey}:No.${r.employeeNo}`);
      for (const n of r.names) {
        console.log(`      ${n.name.padEnd(14)} ${String(n.count).padStart(4)} record  ${n.from} .. ${n.to}`);
      }
    }
    console.log('');
    console.log('  Catatan: ini riwayat perpindahan user, BUKAN data rusak.');
    console.log('  Nomor yang sama dipakai orang berbeda sebelum/sesudah perubahan.');
  }

  if (cmd === 'apply') {
    if (!diff.toCreate.length) {
      console.log('\nℹ️  Tidak ada alias baru yang perlu dibuat.');
      await prisma.$disconnect();
      return;
    }

    if (!autoYes) {
      console.log(`\nAkan membuat ${diff.toCreate.length} alias. Jalankan ulang dengan --yes untuk konfirmasi.`);
      await prisma.$disconnect();
      return;
    }

    console.log('\n── Menerapkan alias ──');
    for (const a of diff.toCreate) {
      try {
        await prisma.employeeIdAlias.create({
          data: {
            deviceKey: a.deviceKey,
            deviceEmployeeNo: a.deviceEmployeeNo,
            employeeNo: a.employeeNo,
            note: a.note,
          },
        });
        console.log(`  ✅ ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}   (${a.name})`);
      } catch (err) {
        console.log(`  ❌ ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}: ${err.message}`);
      }
    }
    console.log('\nSelesai. Alias langsung berlaku untuk laporan berikutnya.');
  } else if (cmd === 'suggest') {
    console.log('\nJalankan dengan "apply --yes" untuk membuat alias yang disarankan.');
  } else if (cmd !== 'check') {
    console.log('\nPerintah tidak dikenal. Pilihan: check | suggest | apply');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\n❌ ERROR:', err.message);
  try { await prisma.$disconnect(); } catch { /* abaikan */ }
  process.exit(1);
});
