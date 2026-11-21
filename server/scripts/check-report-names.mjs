// Guard: nama karyawan di laporan TIDAK BOLEH pernah berupa placeholder "ID N".
//
// BUG YANG DICEGAH:
//
//   Di commit 5b96e16 (sebelum fix), `reportController.fetchAttendanceData()`
//   mengambil nama dengan:
//
//     const displayName = resolver.name(r.employeeNo, r.deviceKey);
//
//   TANPA fallback. Resolver hanya mengenal orang yang tercatat di tabel
//   `device_users`. Bila sinkronisasi user belum jalan, resolver mengembalikan
//   placeholder "ID 11" — dan itu langsung dipakai di laporan.
//
//   `reportService.aggregateByEmployee()` lalu memakai `ev.name` apa adanya
//   untuk mengisi kolom "Nama" pada tabel rekap. Hasilnya PDF/HTML laporan
//   menampilkan "ID 11", "ID 3", ... sebagai NAMA — bukan sebagai nomor.
//
//   Fix: `preferRealName(resolver.name(...), r.employeeName)` — nama asli
//   yang tersimpan di `attendance_records.employee_name` dipakai sebagai
//   cadangan.
//
// PERINGATAN: file ini SENGAJA memakai data dengan `name` = placeholder
// ("ID 11") dan `employeeName` = nama asli ("Brook"). Kalau di suatu saat
// fallback-nya dihapus lagi, test ini LANGSUNG gagal — itulah tujuannya.
//
// Jalankan: node scripts/check-report-names.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'server', 'src');

let gagal = 0;
function cek(label, ok, detail = '') {
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

const read = (p) => fs.readFileSync(p, 'utf8');

// ─── 1. Semua jalur yang merender nama WAJIB punya fallback ──────────────────
console.log('=== 1. SETIAP JALUR NAMA PUNYA FALLBACK ===');

// File yang merender nama karyawan. Masing-masing harus memakai
// `preferRealName` ATAU `isPlaceholderName` — kalau tidak, satu jalur
// forgotten bisa mengembalikan "ID N" ke laporan.
const NAME_PATHS = [
  'controllers/attendanceController.js',
  'controllers/emailController.js',
  'controllers/exportController.js',
  'controllers/reportController.js',
  'services/attendanceAnalyticsService.js',
  'services/attendanceSyncService.js',
  'services/reportService.js',
];

for (const rel of NAME_PATHS) {
  const src = read(path.join(SRC, rel));
  const hasHelper = /preferRealName/.test(src);
  cek(`${rel} memakai preferRealName`, hasHelper);
}

// ─── 2. Helper itu sendiri benar ─────────────────────────────────────────────
console.log('\n=== 2. preferRealName MEMILIKI ATURAN YANG BENAR ===');
const identity = read(path.join(SRC, 'services/employeeIdentityService.js'));
cek('preferRealName diekspor', /export\s+function\s+preferRealName/.test(identity));
cek('isPlaceholderName diekspor', /export\s+function\s+isPlaceholderName/.test(identity));
cek('placeholder dikenali lewat awalan "ID "',
  /startsWith\(\s*['"]ID ['"]\s*\)/.test(identity));
cek('fallback dipakai HANYA bila resolved bukan placeholder',
  /if\s*\(\s*r\s*&&\s*!isPlaceholderName\(r\)\s*\)\s*return\s+r;/.test(identity));
cek('fallback dipakai bila fallback bukan placeholder',
  /if\s*\(\s*f\s*&&\s*!isPlaceholderName\(f\)\s*\)\s*return\s*f;/.test(identity));

// ─── 3. Guard statis: pola buggy TIDAK boleh ada di source aktif ─────────────
console.log('\n=== 3. POLA BUGGY TIDAK ADA DI SOURCE AKTIF ===');

// Abaikan baris komentar supaya pola yang didokumentasikan di komentar tidak
// dianggap sebagai regresi.
const codeOnly = (src) => src
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*/.test(l))
  .join('\n');

const controllerSrc = codeOnly(read(path.join(SRC, 'controllers/reportController.js')));
cek(
  'reportController tidak assigns displayName tanpa fallback',
  !/const\s+displayName\s*=\s*resolver\.name\(/.test(controllerSrc),
  '(regression: resolver.name tanpa fallback → "ID N" masuk laporan)',
);

const reportServiceSrc = codeOnly(read(path.join(SRC, 'services/reportService.js')));
cek(
  'reportService memakai evName() untuk nama',
  /function\s+evName\s*\(/.test(reportServiceSrc),
);
cek(
  'evName memakai preferRealName',
  /function\s+evName[\s\S]{0,200}preferRealName/.test(reportServiceSrc),
);
cek(
  'aggregateByEmployee memakai evName(ev) — bukan ev.name mentah',
  /aggregateByEmployee[\s\S]{0,3000}evName\(ev\)/.test(reportServiceSrc),
);

// ─── 4. Uji FUNGSIONAL: aggregator tidak boleh menghasilkan placeholder ─────
console.log('\n=== 4. UJI FUNGSIONAL — nama di tabel rekap ===');

const { buildDetailedReport } = await import('../src/services/reportService.js');

// Data tiruan kondisi "device_users belum ter-sync":
//   name         → placeholder dari resolver (tanpa device_users)
//   employeeName → nama asli yang tersimpan di record absensi
const fakeEvents = [
  { employeeNo: '11', name: 'ID 11', employeeName: 'Brook',  deviceKey: 'masuk', timeOnly: '08:00', dateKey: '2026-11-10', userType: 'Normal', canonicalNo: '11', time: '2026-11-10T01:00:00.000Z' },
  { employeeNo: '3',  name: 'ID 3',  employeeName: 'Astrid', deviceKey: 'keluar', timeOnly: '17:00', dateKey: '2026-11-10', userType: 'Normal', canonicalNo: '3',  time: '2026-11-10T10:00:00.000Z' },
  { employeeNo: '5',  name: 'ID 5',  employeeName: 'Juanto', deviceKey: 'masuk', timeOnly: '08:30', dateKey: '2026-11-10', userType: 'Normal', canonicalNo: '5',  time: '2026-11-10T01:30:00.000Z' },
];

const { html } = buildDetailedReport(
  fakeEvents, {}, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0,
);

// Ambil baris tabel "Per Karyawan".
const section = (html.split('Per Karyawan')[1] || '').split('<tbody>')[1]?.split('</tbody>')[0] || '';
const rows = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
  [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()),
);

const namaDiTabel = rows.map((r) => r[1]).filter(Boolean);
console.log('  nama di tabel rekap:', JSON.stringify(namaDiTabel));

const placeholderDiTabel = namaDiTabel.filter((n) => /^ID\s?\d+$/.test(n));
cek(
  'TIDAK ADA nama placeholder "ID N" di tabel rekap',
  placeholderDiTabel.length === 0,
  placeholderDiTabel.length ? `(ditemukan: ${placeholderDiTabel.join(', ')})` : '',
);

cek(
  'nama asli "Brook" muncul (fallback ke employeeName)',
  namaDiTabel.includes('Brook'),
);
cek(
  'nama asli "Astrid" muncul',
  namaDiTabel.includes('Astrid'),
);
cek(
  'nama asli "Juanto" muncul',
  namaDiTabel.includes('Juanto'),
);

// ─── 5. Uji FUNGSIONAL: HTML & teks tidak boleh memuat placeholder sebagai nama ─
console.log('\n=== 5. UJI FUNGSIONAL — HTML & TEKS ===');
const { html: htmlFull, text } = buildDetailedReport(
  fakeEvents, {}, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0,
);

// Di HTML, "ID 11" BOLEH muncul di kolom ID — tapi TIDAK sebagai nilai kolom
// Nama. Jadi yang diperiksa adalah baris rekap (sudah di atas) plus pastikan
// tidak ada pola "Terlambat rutin: ID N" yang memakai placeholder sebagai nama.
const namaPlaceholderDiTemuan = [...htmlFull.matchAll(/Terlambat rutin:\s*ID\s?\d+/g)];
cek(
  'temuan "Terlambat rutin: ID N" tidak ada (nama bukan placeholder)',
  namaPlaceholderDiTemuan.length === 0,
  namaPlaceholderDiTemuan.length ? `(ditemukan: ${namaPlaceholderDiTemuan.length})` : '',
);

cek(
  'versi teks laporan tidak punya baris nama "ID N"',
  !/^ID\s?\d+\s+Normal/m.test(text),
);

// ─── 6. Guard: PDF builder & export juga memakai nama bermasalah ─────────────
console.log('\n=== 6. JALUR LAIN (PDF / Excel / Export) ===');
const exportSrc = codeOnly(read(path.join(SRC, 'controllers/exportController.js')));
cek(
  'exportController memakai preferRealName',
  /preferRealName/.test(exportSrc),
);
cek(
  'exportController tidak assigns name dari resolver tanpa fallback',
  !/enriched\.name\s*=\s*resolver\.name\(/.test(exportSrc),
);

console.log(gagal === 0
  ? '\n✅ SEMUA GUARD NAMA LAPORAN LOLOS'
  : `\n❌ HASIL: ${gagal} guard gagal`);
process.exit(gagal === 0 ? 0 : 1);
