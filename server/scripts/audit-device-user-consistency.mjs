// Audit konsistensi `device_users` vs `attendance_records`.
//
// MASALAH YANG DI TEMUKAN:
//
//   `device_users` adalah CACHE roster user per perangkat. Kalau cache ini
//   rusak (mis. tertimpa user uji, atau sync dari perangkat yang salah),
//   laporan bisa menampilkan NAMA YANG SALAH untuk nomor employee tertentu.
//
//   Data nyata di repo ini (device "keluar"):
//
//     No.  device_users    attendance_records (mayoritas)
//     4    "Chika"         (tidak ada record)
//     5    "Adit"          "Juanto"  (53 record)   ← BEDA
//     6    "Chika"         "Adit"    (156 record)  ← BEDA
//     7    "Juanto"        "Juanto"  (202 record)  ← benar
//
//   Dua sumber ini berbeda → device_users perlu disinkronkan ulang dari
//   perangkat. Selama tidak sinkron, laporan bisa salah orang.
//
// APA YANG DIUKUR:
//
//   1. Per nomor employee: apakah nama di `device_users` sama dengan nama
//      yang dipakai di `attendance_records`?
//   2. Berapa record yang memakai tiap nama (minoritas/mayoritas).
//   3. Nomor yang HANYA ada di satu perangkat.
//
// OUTPUT: tabel per device + daftar nomor yang perlu disinkronkan.
//
// Jalankan: node scripts/audit-device-user-consistency.mjs
//         node scripts/audit-device-user-consistency.mjs --json

import prisma from '../src/db.js';

const asJson = process.argv.includes('--json');

const rows = await prisma.deviceUser.findMany({
  orderBy: [{ deviceKey: 'asc' }, { employeeNo: 'asc' }],
});

const records = await prisma.attendanceRecord.findMany({
  select: { employeeNo: true, employeeName: true, deviceKey: true },
});

// Hitung kemunculan nama per (deviceKey, employeeNo).
const nameCount = new Map();
for (const r of records) {
  const key = `${r.deviceKey}|${r.employeeNo}`;
  if (!nameCount.has(key)) nameCount.set(key, new Map());
  const m = nameCount.get(key);
  m.set(r.employeeName, (m.get(r.employeeName) || 0) + 1);
}

/** Nama yang paling sering muncul untuk (device, no) — dianggap "benar". */
function dominantName(deviceKey, employeeNo) {
  const m = nameCount.get(`${deviceKey}|${employeeNo}`);
  if (!m || m.size === 0) return null;
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { name: sorted[0][0], count: sorted[0][1], total: [...m.values()].reduce((a, b) => a + b, 0), variants: sorted.length };
}

const devices = [...new Set(rows.map((r) => r.deviceKey))];
const report = {};

for (const dk of devices) {
  const list = rows.filter((r) => r.deviceKey === dk);
  const detail = list.map((u) => {
    const dom = dominantName(dk, String(u.employeeNo));
    return {
      employeeNo: String(u.employeeNo),
      cachedName: u.name,
      recordName: dom?.name ?? null,
      recordCount: dom?.total ?? 0,
      nameVariants: dom?.variants ?? 0,
      mismatch: !!dom && dom.name !== u.name,
      noRecord: !dom,
    };
  });
  report[dk] = detail;
}

// Nomor yang hanya ada di satu perangkat.
const byNo = new Map();
for (const r of rows) {
  const no = String(r.employeeNo);
  if (!byNo.has(no)) byNo.set(no, new Set());
  byNo.get(no).add(r.deviceKey);
}
const onlyOneDevice = [...byNo.entries()]
  .filter(([, devs]) => devs.size === 1)
  .map(([no, devs]) => ({ employeeNo: no, onlyOn: [...devs][0] }));

if (asJson) {
  console.log(JSON.stringify({ report, onlyOneDevice }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

console.log('══════════════════════════════════════════════════════════════════');
console.log('  AUDIT KONSISTENSI device_users vs attendance_records');
console.log('══════════════════════════════════════════════════════════════════');

let mismatchTotal = 0;

for (const [dk, detail] of Object.entries(report)) {
  console.log(`\n═══ DEVICE ${dk.toUpperCase()} ═══`);
  console.log('  No.    | device_users | record (mayoritas) | #record | status');
  console.log('  -------+-------------+--------------------+---------+-------');
  for (const d of detail) {
    const status = d.mismatch
      ? '⚠️  BEDA — perlu sinkron ulang'
      : (d.noRecord ? '· tidak ada record' : '✅ konsisten');
    if (d.mismatch) mismatchTotal++;
    console.log(
      `  ${d.employeeNo.padEnd(7)}| ${String(d.cachedName).padEnd(12)}| ` +
      `${String(d.recordName ?? '—').padEnd(19)}| ${String(d.recordCount).padEnd(8)}| ${status}`,
    );
  }
}

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('  NOMOR YANG HANYA ADA DI SATU PERANGKAT');
console.log('══════════════════════════════════════════════════════════════════');
if (onlyOneDevice.length === 0) {
  console.log('  (tidak ada)');
} else {
  for (const o of onlyOneDevice) {
    console.log(`  No.${o.employeeNo} — hanya ada di device "${o.onlyOn}"`);
  }
}

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`  RINGKASAN: ${mismatchTotal} nomor perlu disinkronkan ulang`);
console.log('══════════════════════════════════════════════════════════════════');
console.log('');
console.log('  CARA MEMPERBAIKI:');
console.log('    1. Buka Pusat Perangkat → pilih device → "Sinkron User"');
console.log('       (data device_users ditimpa dengan roster yang benar dari perangkat)');
console.log('    2. Jalankan ulang: npm run check:device-roster');
//   3. Cek lagi laporan — nama harus sesuai
console.log('');

// ─── OPSI: PERBAIKI OTOMATIS dari attendance_records ─────────────────────────
//
// `--fix` menulis ulang `device_users` memakai nama yang dipakai di
// `attendance_records` (mayoritas). Sumber ini lebih reliable daripada
// cache yang sudah tercemar.
//
// ATURAN AMAN:
//   - Hanya nomor yang BEDA dan punya record yang diperbaiki.
//   - Nomor tanpa record TIDAK disentuh (tidak ada bukti nama yang benar).
//   - Nomor dengan >1 nama berbeda di record TIDAK disentuh (ambigu).
//   - Tiap perubahan dicatat (audit log).
const wantFix = process.argv.includes('--fix');
if (wantFix && mismatchTotal > 0) {
  console.log('  ── MEMPERBAIKI device_users dari attendance_records ──');
  let fixed = 0;
  let skipped = 0;

  for (const [dk, detail] of Object.entries(report)) {
    for (const d of detail) {
      if (!d.mismatch) continue;

      // Ambigu → jangan sentuh.
      if (d.nameVariants > 1) {
        console.log(`    ⏭  ${dk}:${d.employeeNo} — ${d.nameVariants} nama berbeda di record, ambigu → dilewati`);
        skipped++;
        continue;
      }

      const newName = d.recordName;
      if (!newName) { skipped++; continue; }

      await prisma.deviceUser.updateMany({
        where: { deviceKey: dk, employeeNo: d.employeeNo },
        data: { name: newName },
      });
      console.log(`    ✅ ${dk}:${d.employeeNo}  "${d.cachedName}" → "${newName}"  (${d.recordCount} record)`);
      fixed++;

      await prisma.auditLog.create({
        data: {
          action: 'device_user_name_fixed',
          user: 'system',
          detail: `device ${dk} No.${d.employeeNo}: "${d.cachedName}" → "${newName}" (dari ${d.recordCount} record attendance)`,
        },
      });
    }
  }

  console.log('');
  console.log(`    Diperbaiki: ${fixed} | dilewati: ${skipped}`);
  console.log('    Jalankan ulang audit untuk memverifikasi.');
  console.log('');
}

await prisma.$disconnect();
// Exit 1 kalau ada data yang perlu disinkronkan — supaya bisa dipakai
// sebagai gate di CI / npm script.
process.exit(mismatchTotal > 0 && !wantFix ? 1 : 0);
