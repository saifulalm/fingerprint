// Skrip CLI: periksa & perbaiki konflik nomor ID antar perangkat.
//
// KONFLIK = nomor employee yang sama menunjuk NAMA BERBEDA di device Masuk
// vs Keluar. Karena nomor employee adalah kunci LOKAL di tiap perangkat,
// laporan absensi bisa salah orang.
//
// Perangkat TIDAK bisa diperbaiki sendiri:
//   - UserInfo/Modify menolak perubahan employeeNo (badParameters)
//   - UserInfo/Add ditolak (notSupport)
// Jadi perbaikannya dilakukan di sisi APLIKASI: tabel employee_id_aliases
// menandai "nomor X di perangkat D sebenarnya menunjuk nomor canonical Y".
//
// PEMAKAIAN:
//   node scripts/manage-id-aliases.mjs check
//     → hanya menampilkan konflik
//   node scripts/manage-id-aliases.mjs suggest
//     → menampilkan saran pemetaan otomatis (dihitung dari nama di
//       perangkat referensi)
//   node scripts/manage-id-aliases.mjs fix <deviceKey> <deviceNo> <canonicalNo> [catatan]
//     → membuat pemetaan (canonicalNo HARUS ada di perangkat referensi)
//   node scripts/manage-id-aliases.mjs list
//     → menampilkan pemetaan yang ada
//   node scripts/manage-id-aliases.mjs remove <deviceKey> <deviceNo>
//     → menghapus pemetaan
import prisma from '../src/db.js';
import { config } from '../src/config/index.js';
import { getDeviceUsers } from '../src/services/hikvisionAdmin.js';
import {
  CANONICAL_DEVICE_KEY,
  suggestIdAliases,
} from '../src/services/employeeIdentityService.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'check';

async function readDevices() {
  const out = {};
  for (const [key, dev] of Object.entries(config.devices)) {
    try {
      const users = await getDeviceUsers(dev);
      out[key] = users.map((u) => ({
        employeeNo: String(u.employeeNo),
        name: (u.name || '').trim(),
      }));
    } catch (err) {
      out[key] = { error: err.message };
    }
  }
  return out;
}

async function showConflicts() {
  const perDevice = await readDevices();
  const keys = Object.keys(perDevice).filter((k) => Array.isArray(perDevice[k]));

  console.log('=== Data user per perangkat ===');
  for (const k of keys) {
    console.log(`  ${k}: ${perDevice[k].map((u) => `${u.employeeNo}=${u.name}`).join(', ')}`);
  }

  const allNos = new Set();
  for (const k of keys) for (const u of perDevice[k]) allNos.add(u.employeeNo);

  const conflicts = [];
  for (const no of allNos) {
    const perKey = {};
    for (const k of keys) {
      const f = perDevice[k].find((u) => u.employeeNo === no);
      if (f) perKey[k] = f;
    }
    const names = new Set(Object.values(perKey).map((u) => u.name.toLowerCase()));
    if (names.size > 1) {
      conflicts.push({ employeeNo: no, names: perKey });
    }
  }

  console.log('\n=== Konflik (nomor sama, nama berbeda) ===');
  if (conflicts.length === 0) {
    console.log('  Tidak ada konflik.');
  }
  for (const c of conflicts) {
    console.log(`\n  Nomor ${c.employeeNo}:`);
    for (const [k, u] of Object.entries(c.names)) {
      console.log(`    - ${k}: ${u.name}`);
    }
  }

  // Alias yang sudah ada.
  const aliases = await prisma.employeeIdAlias.findMany();
  if (aliases.length) {
    console.log('\n=== Pemetaan yang sudah ada ===');
    for (const a of aliases) {
      console.log(`  ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}${a.note ? ` (${a.note})` : ''}`);
    }
  }
  return conflicts;
}

async function showSuggestions() {
  const perDevice = await readDevices();
  const keys = Object.keys(perDevice).filter((k) => Array.isArray(perDevice[k]));

  const suggestions = suggestIdAliases(perDevice, keys, CANONICAL_DEVICE_KEY);

  const existing = await prisma.employeeIdAlias.findMany();
  const applied = new Set(existing.map((a) => `${a.deviceKey}:${a.deviceEmployeeNo}`));

  console.log(`=== Saran pemetaan (perangkat referensi: ${CANONICAL_DEVICE_KEY}) ===`);
  if (suggestions.length === 0) {
    console.log('  Tidak ada konflik nomor ID.');
    return suggestions;
  }
  for (const s of suggestions) {
    const status = applied.has(`${s.deviceKey}:${s.deviceEmployeeNo}`)
      ? '✅ sudah dipetakan'
      : '⬜ belum dipetakan';
    console.log(
      `  ${status}  ${s.deviceKey}:${s.deviceEmployeeNo} → ${CANONICAL_DEVICE_KEY}:${s.employeeNo}  (${s.name}) [${s.reason}]`
    );
  }
  console.log('\nTerapkan dengan: fix <deviceKey> <deviceNo> <canonicalNo>');
  return suggestions;
}

async function main() {
  if (cmd === 'check') {
    await showConflicts();
  } else if (cmd === 'suggest') {
    await showSuggestions();
  } else if (cmd === 'list') {
    const aliases = await prisma.employeeIdAlias.findMany();
    if (!aliases.length) console.log('Belum ada pemetaan.');
    for (const a of aliases) {
      console.log(`  ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}${a.note ? ` (${a.note})` : ''}`);
    }
  } else if (cmd === 'fix') {
    const [deviceKey, deviceNo, canonicalNo, note] = args.slice(1);
    if (!deviceKey || !deviceNo || !canonicalNo) {
      console.error('Pakai: fix <deviceKey> <deviceNo> <canonicalNo> [catatan]');
      process.exit(1);
    }
    const dev = config.devices[deviceKey];
    if (!dev) {
      console.error(`Perangkat "${deviceKey}" tidak dikenal. Pilihan: ${Object.keys(config.devices).join(', ')}`);
      process.exit(1);
    }
    const users = await getDeviceUsers(dev);
    const src = users.find((u) => String(u.employeeNo) === String(deviceNo));
    if (!src) {
      console.error(`Nomor ${deviceNo} tidak ada di ${deviceKey}`);
      process.exit(1);
    }

    // Nomor canonical HARUS ada di perangkat REFERENSI. Mencarinya di
    // perangkat yang sama adalah bug: pemetaan selalu mengarah ke nomor
    // canonical di perangkat referensi, bukan nomor lokal.
    const refDev = config.devices[CANONICAL_DEVICE_KEY];
    const refUsers = await getDeviceUsers(refDev);
    const dst = refUsers.find((u) => String(u.employeeNo) === String(canonicalNo));
    if (!dst) {
      console.error(
        `Nomor ${canonicalNo} tidak ada di perangkat referensi (${CANONICAL_DEVICE_KEY}). ` +
        `Pakai "suggest" untuk melihat nomor yang benar.`
      );
      process.exit(1);
    }

    const alias = await prisma.employeeIdAlias.upsert({
      where: { deviceKey_deviceEmployeeNo: { deviceKey, deviceEmployeeNo: String(deviceNo) } },
      create: { deviceKey, deviceEmployeeNo: String(deviceNo), employeeNo: String(canonicalNo), note: note || null },
      update: { employeeNo: String(canonicalNo), note: note || null },
    });
    console.log(`✅ Pemetaan dibuat: ${alias.deviceKey}:${alias.deviceEmployeeNo} → ${alias.employeeNo} (${dst.name})`);
  } else if (cmd === 'remove') {
    const [deviceKey, deviceNo] = args.slice(1);
    if (!deviceKey || !deviceNo) {
      console.error('Pakai: remove <deviceKey> <deviceNo>');
      process.exit(1);
    }
    const r = await prisma.employeeIdAlias.deleteMany({
      where: { deviceKey, deviceEmployeeNo: String(deviceNo) },
    });
    console.log(`✅ ${r.count} pemetaan dihapus.`);
  } else {
    console.error('Perintah tidak dikenal. Pilihan: check | suggest | list | fix | remove');
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
