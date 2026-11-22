// Audit alias ID yang sudah USANG (tidak lagi sesuai kondisi perangkat).
//
// MASALAH YANG DISELESAIKAN:
//
//   Alias `employee_id_aliases` memetakan nomor employee di satu perangkat ke
//   nomor canonical di perangkat acuan. Tapi nomor employee bisa BERUBAH
//   di perangkat — misalnya saat HR memindahkan user.
//
//   KASUS NYATA di repo ini (device "keluar"):
//
//     Periode 1 Okt – 27 Okt      Periode 28 Okt – 11 Nov
//     No.5 = Juanto               No.5 = Adit
//     No.6 = Adit                 No.6 = Chika
//
//   Artinya: No.5 di "keluar" dulunya Juanto (orang yang sama dengan No.5 di
//   "masuk"), sekarang Adit (orang yang sama dengan No.6 di "masuk").
//
//   Alias lama `keluar:5 → 6` (Adit → Adit) sekarang SALAH: No.5 di
//   "keluar" adalah Adit, yang merujuk ke No.6 di "masuk" — jadi secara
//   tidak langsung nyatanya masih cocok. Tapi `keluar:6 → 4` (Chika → Chika)
//   benar, dan `keluar:7 → 5` (Juanto → Juanto) benar.
//
//   Alias yang salah ARAH (nomor di perangkat lain → nomor canonical yang
//   bukan orang yang sama) membuat laporan menampilkan ORANG YANG SALAH.
//
// APA YANG DIUKUR:
//
//   Untuk tiap alias, cek apakah orang yang di-device-akuan (nomor
//   canonical) dan orang di-device-lain (nomor device) punya NAMA yang
//   sama di `device_users` ATAU di `attendance_records`.
//
//   - Nama sama → alias masih relevan.
//   - Nama berbeda → alias usang / salah → perlu dikoreksi.
//
//   Alias yang relevan TIDAK dihapus otomatis — karena perubahan nomor
//   di masa lalu tetap perlu ditangani agar laporan historis tidak salah
//   orang. Yang ditampilkan adalah daftar kandidat koreksi.
//
// Jalankan: node scripts/audit-stale-id-aliases.mjs
//         node scripts/audit-stale-id-aliases.mjs --json

import prisma from '../src/db.js';

const asJson = process.argv.includes('--json');

const aliases = await prisma.employeeIdAlias.findMany({
  orderBy: [{ deviceKey: 'asc' }, { deviceEmployeeNo: 'asc' }],
});

const users = await prisma.deviceUser.findMany();
const records = await prisma.attendanceRecord.findMany({
  select: { employeeNo: true, employeeName: true, deviceKey: true, time: true },
});

/** Nama untuk (device, no) — dari device_users, fallback ke record. */
function nameFor(deviceKey, employeeNo) {
  const u = users.find((x) => x.deviceKey === deviceKey && String(x.employeeNo) === String(employeeNo));
  if (u?.name) return { name: u.name, source: 'device_users' };

  const rel = records
    .filter((r) => r.deviceKey === deviceKey && String(r.employeeNo) === String(employeeNo))
    .sort((a, b) => b.time - a.time);
  if (rel.length) return { name: rel[0].employeeName, source: 'attendance_records' };

  return { name: null, source: null };
}

/** Normalisasi nama untuk perbandingan. */
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const CANONICAL_DEVICE = 'masuk';
const results = aliases.map((a) => {
  const canonical = nameFor(CANONICAL_DEVICE, a.employeeNo);
  const other = nameFor(a.deviceKey, a.deviceEmployeeNo);

  const same = canonical.name && other.name && norm(canonical.name) === norm(other.name);
  const status = !canonical.name || !other.name
    ? 'unknown'
    : (same ? 'ok' : 'stale');

  return {
    alias: `${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}`,
    deviceKey: a.deviceKey,
    deviceEmployeeNo: a.deviceEmployeeNo,
    employeeNo: a.employeeNo,
    canonicalName: canonical.name,
    canonicalSource: canonical.source,
    otherName: other.name,
    otherSource: other.source,
    note: a.note,
    status,
  };
});

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

console.log('══════════════════════════════════════════════════════════════════');
console.log('  AUDIT ALIAS ID (apakah masih sesuai kondisi perangkat?)');
console.log('══════════════════════════════════════════════════════════════════\n');

if (results.length === 0) {
  console.log('  (belum ada alias)');
} else {
  console.log('  Alias                        | Nama acuan      | Nama device     | Status');
  console.log('  -----------------------------+-----------------+-----------------+-------');
  for (const r of results) {
    const label = r.status === 'ok' ? '✅ masih relevan'
      : (r.status === 'stale' ? '⚠️  USANG / salah orang'
        : '? tidak bisa diverifikasi');
    console.log(
      `  ${r.alias.padEnd(29)}| ${String(r.canonicalName ?? '—').padEnd(15)}| ` +
      `${String(r.otherName ?? '—').padEnd(15)}| ${label}`,
    );
  }
}

const stale = results.filter((r) => r.status === 'stale');
const unknown = results.filter((r) => r.status === 'unknown');

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`  RINGKASAN: ${results.length - stale.length - unknown.length} relevan, ` +
  `${stale.length} usang, ${unknown.length} tidak terverifikasi`);
console.log('══════════════════════════════════════════════════════════════════');

if (stale.length) {
  console.log('');
  console.log('  ALIAS YANG PERLU DIKOREKSI:');
  for (const r of stale) {
    console.log(`    ${r.alias}`);
    console.log(`      "${r.canonicalName}" (acuan) vs "${r.otherName}" (device) — orang BERBEDA`);
    console.log(`      Perbaiki dengan: node scripts/match-device-roster.mjs apply --device ${r.deviceKey} ` +
      `--no ${r.deviceEmployeeNo} --to <nomor-yang-benar>`);
  }
}

if (unknown.length) {
  console.log('');
  console.log('  ALIAS YANG TIDAK BISA DIVERIFIKASI (nomor/nama tidak ditemukan):');
  for (const r of unknown) {
    console.log(`    ${r.alias} — nama acuan: ${r.canonicalName ?? '—'}, nama device: ${r.otherName ?? '—'}`);
  }
}

console.log('');

await prisma.$disconnect();
process.exit(stale.length > 0 ? 1 : 0);
