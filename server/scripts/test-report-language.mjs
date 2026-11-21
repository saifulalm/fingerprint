// Uji Laporan Absensi berbahasa Indonesia — nama karyawan & konsistensi nomor ID.
//
// CACAT YANG DIPERBAIKI (lihat laporan user):
//   "Terlambat rutin: ID 3 — 4 dari 8 hari (50%) terlambat, rata-rata 40 menit."
//   Nama karyawan TIDAK muncul; yang tampil hanya nomor ID mentah.
//
// AKAR MASALAH (kelas bug, bukan satu tempat):
//   1. Nama placeholder "ID <nomor>" dibiarkan bocor ke laporan, rekap, dan
//      email. Sumbernya: resolver nama sentral (`employeeIdentityService`)
//      hanya mengenal orang yang tercatat di tabel `device_users`. Bila tabel
//      itu belum tersinkron, resolver mengembalikan placeholder.
//   2. Nomor employee bersifat LOKAL per perangkat. Satu orang punya nomor
//      berbeda di dua perangkat (Adit: 6 di Masuk, 5 di Keluar). Laporan lalu
//      menampilkan dua nomor untuk orang yang sama ("ID 5, 6").
//
// YANG DIUJI:
//   A. Nama pada temuan analitik = nama asli, DITANDAI nomor canonical.
//   B. Placeholder "ID N" tidak pernah muncul di judul temuan.
//   C. Analitik memakai SATU nomor canonical per orang.
//   D. Placeholder yang tidak punya nama asli tetap tampil sebagai
//      "ID N (perangkat:no)" — dibedakan, bukan digabung.
//   E. Bahasa Indonesia benar-benar dipakai (tidak ada teks Inggris bocor).
//
// Jalankan: cd server && node scripts/test-report-language.mjs
import { buildAnalytics } from '../src/services/attendanceAnalyticsService.js';
import {
  buildEmployeeIndex,
  loadIdAliases,
  preferRealName,
  resolveCanonicalEmployeeNo,
} from '../src/services/employeeIdentityService.js';

let gagal = 0;
function cek(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label} → "${actual}"${ok ? '' : `  (harus "${expected}")`}`);
}
function cekMemuat(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : `  (tidak menemukan "${needle}")`}`);
}

// ── A. Helper: preferRealName memilih nama non-placeholder ─────────────────
console.log('=== 1. preferRealName MEMILIH NAMA ASLI ===');
cek('resolver placeholder + fallback asli', preferRealName('ID 3', 'Astrid'), 'Astrid');
cek('resolver asli + fallback placeholder', preferRealName('Astrid', 'ID 3'), 'Astrid');
cek('keduanya placeholder', preferRealName('ID 3', 'ID 3'), 'ID 3');
cek('keduanya kosong', preferRealName('', ''), '');

// ── B. Helper: nomor canonical memakai alias per perangkat ──────────────────
console.log('\n=== 2. NOMOR CANONICAL ===');
const aliases = new Map([
  ['keluar:5', '6'], // Adit   di Keluar → nomor 6 di Masuk
  ['keluar:6', '4'], // Chika  di Keluar → nomor 4 di Masuk
  ['keluar:7', '5'], // Juanto di Keluar → nomor 5 di Masuk
]);
cek('keluar:5 → 6', resolveCanonicalEmployeeNo('5', aliases, 'keluar'), '6');
cek('keluar:6 → 4', resolveCanonicalEmployeeNo('6', aliases, 'keluar'), '4');
cek('keluar:7 → 5', resolveCanonicalEmployeeNo('7', aliases, 'keluar'), '5');
cek('masuk:5 tidak dipetakan', resolveCanonicalEmployeeNo('5', aliases, 'masuk'), '5');
cek('tanpa konteks: 5 tetap 5', resolveCanonicalEmployeeNo('5', aliases, null), '5');

// ── C. Skenario 1: resolver tidak kenal ID, record punya nama asli ─────────
// Ini persis skenario laporan user: "Terlambat rutin: ID 3".
console.log('\n=== 3. SKENARIO PLACEHOLDER (laporan user) ===');
const evPlaceholder = [];
for (let d = 1; d <= 8; d++) {
  const dk = `2026-11-${String(d).padStart(2, '0')}`;
  // 4 hari terlambat 40 menit, 4 hari tepat waktu
  const jam = d <= 4 ? '09:40' : '08:50';
  evPlaceholder.push({
    employeeNo: '3',
    name: 'ID 3',            // resolver hanya bisa placeholder
    employeeName: 'Astrid',  // nama asli tersimpan di record
    dateKey: dk,
    timeOnly: jam,
    deviceKey: 'masuk',
    verifyMode: 'Fingerprint',
  });
}
const anPlaceholder = buildAnalytics(evPlaceholder, {}, 'id', '09:00', '17:00', {
  startDate: '2026-11-01', endDate: '2026-11-08', detectLate: true,
});
cek('nama karyawan tampil', anPlaceholder.employees[0]?.name, 'Astrid');
const fPlaceholder = anPlaceholder.findings.find((f) => f.code === 'LATE_HABITUAL');
cekMemuat('judul temuan memakai nama', fPlaceholder?.title, 'Astrid');
// Judul tidak boleh memuat placeholder "Terlambat rutin: ID 3".
// (perAssertion: TIDAK ditemukan = benar)
const judulPlaceholder = String(fPlaceholder?.title || '');
const adaPlaceholder = judulPlaceholder.includes('Terlambat rutin: ID 3');
if (adaPlaceholder) gagal++;
console.log(`  ${!adaPlaceholder ? '✅' : '❌'} judul temuan TIDAK memakai placeholder "Terlambat rutin: ID 3"`);
cek('jumlah hari hadir', String(anPlaceholder.employees[0]?.hariHadir), '8');
cek('jumlah keterlambatan', String(anPlaceholder.employees[0]?.lateCount), '4');
cekMemuat('detail: 4 dari 8 hari', fPlaceholder?.detail, '4 dari 8 hari hadir');
cekMemuat('detail: rata-rata 40 menit', fPlaceholder?.detail, 'rata-rata keterlambatan 40 menit');

// ── D. Skenario 2: nama asli tersedia, nomor konflik antar perangkat ──────
//
// PENTING: ambang temuan "Terlambat rutin" adalah rate >= 30% DAN lateCount
// >= 3. Fixture harus punya minimal 3 hari terlambat, kalau tidak temuan
// tidak pernah terbentuk dan pengujiannya tidak berarti.
console.log('\n=== 4. NOMOR KONFLIK ANTAR PERANGKAT (Adit) ===');
const evAdit = [];
// 5 hari kerja: 4 hari terlambat, 1 hari tepat waktu.
// Pada device "keluar" orang ini bernomor 5, di "masuk" bernomor 6.
for (let d = 1; d <= 5; d++) {
  const dk = `2026-11-${String(d).padStart(2, '0')}`;
  const jamMasuk = d <= 4 ? '09:30' : '08:50'; // 4 hari terlambat
  evAdit.push({
    employeeNo: '6', canonicalNo: '6', name: 'Adit',
    dateKey: dk, timeOnly: jamMasuk, deviceKey: 'masuk', verifyMode: 'Fingerprint',
  });
  evAdit.push({
    employeeNo: '5', canonicalNo: '6', name: 'Adit',
    dateKey: dk, timeOnly: '17:30', deviceKey: 'keluar', verifyMode: 'Fingerprint',
  });
}
const anAdit = buildAnalytics(evAdit, {}, 'id', '09:00', '17:00', {
  startDate: '2026-11-01', endDate: '2026-11-08', detectLate: true,
});
cek('satu orang = satu entri', String(anAdit.employees.length), '1');
cek('nomor canonical tunggal', anAdit.employees[0]?.employeeNos.join(','), '6');
cek('jumlah hari hadir', String(anAdit.employees[0]?.hariHadir), '5');
cek('jumlah keterlambatan', String(anAdit.employees[0]?.lateCount), '4');
const judulAdit = String(anAdit.findings.find((f) => f.code === 'LATE_HABITUAL')?.title || '');
cekMemuat('judul: satu ID saja', judulAdit, '(ID 6)');
const okSatuId = !/\(ID [^)]*,/.test(judulAdit);
if (!okSatuId) gagal++;
console.log(`  ${okSatuId ? '✅' : '❌'} judul tidak menampilkan dua ID untuk satu orang`);

// ── E. Skenario 3: dua placeholder berbeda tidak boleh digabung ────────────
console.log('\n=== 5. PLACEHOLDER BERBEDA TIDAK DIGABUNG ===');
const evDuaPlaceholder = [
  { employeeNo: '3', name: 'ID 3', dateKey: '2026-11-02', timeOnly: '09:40', deviceKey: 'masuk', verifyMode: 'Fingerprint' },
  { employeeNo: '4', name: 'ID 4', dateKey: '2026-11-02', timeOnly: '09:40', deviceKey: 'masuk', verifyMode: 'Fingerprint' },
];
const anDua = buildAnalytics(evDuaPlaceholder, {}, 'id', '09:00', '17:00', {
  startDate: '2026-11-01', endDate: '2026-11-08', detectLate: true,
});
cek('dua orang terpisah', String(anDua.employees.length), '2');

// ── F. Bahasa: Indonesia & Inggris tidak bocor satu sama lain ───────────────
console.log('\n=== 6. KONSISTENSI BAHASA ===');
const anId = buildAnalytics(evPlaceholder, {}, 'id', '09:00', '17:00', {
  startDate: '2026-11-01', endDate: '2026-11-08', detectLate: true,
});
const anEn = buildAnalytics(evPlaceholder, {}, 'en', '09:00', '17:00', {
  startDate: '2026-11-01', endDate: '2026-11-08', detectLate: true,
});
const idTexts = anId.findings.map((f) => `${f.title} ${f.detail} ${f.action}`).join(' ');
const enTexts = anEn.findings.map((f) => `${f.title} ${f.detail} ${f.action}`).join(' ');

cekMemuat('ID: memuat "terlambat"', idTexts, 'terlambat');
cekMemuat('ID: memuat "hari hadir"', idTexts, 'hari hadir');
for (const leak of ['Habitual lateness', 'Late on ', 'days present', 'averaging ', 'Consider adjusting']) {
  const ada = idTexts.includes(leak);
  if (ada) gagal++;
  console.log(`  ${ada ? '❌' : '✅'} ID tidak memuat teks Inggris "${leak}"`);
}
cekMemuat('EN: memuat "Habitual lateness"', enTexts, 'Habitual lateness');
cekMemuat('EN: memuat "days present"', enTexts, 'days present');
for (const leak of ['Terlambat rutin', 'hari hadir', 'terlambat,', 'Optimalkan jam kerja']) {
  const ada = enTexts.includes(leak);
  if (ada) gagal++;
  console.log(`  ${ada ? '❌' : '✅'} EN tidak memuat teks Indonesia "${leak}"`);
}

// ── G. Ejaan: tidak ada kata ohne spasi ─────────────────────────────────────
console.log('\n=== 7. EJAAN RAPI ===');
const semuaTeks = [
  ...anId.findings, ...anId.recommendations,
  ...anEn.findings, ...anEn.recommendations,
].map((x) => `${x.title} ${x.detail || ''} ${x.action || ''} ${x.impact || ''}`).join(' ');
for (const salah of ['tanpa menurunkanProduktivitas', 'Terlambat rutin: ID ']) {
  const ada = semuaTeks.includes(salah);
  if (ada) gagal++;
  console.log(`  ${ada ? '❌' : '✅'} tidak ada "${salah}"`);
}

// ── H. Cek DB: tidak ada nama placeholder di device_users ───────────────────
console.log('\n=== 8. DEVICE_USERS BERSIH (placeholder) ===');
const { default: prisma } = await import('../src/db.js');
// Catatan: kolom `name` di tabel `device_users` bersifat NOT NULL, jadi filter
// `name: null` ditolak Prisma ("Argument `name` is missing"). Hanya nama
// placeholder yang dicek.
const placeholderUsers = await prisma.deviceUser.findMany({
  where: { name: { startsWith: 'ID ' } },
  select: { deviceKey: true, employeeNo: true, name: true },
});
cek('jumlah device_users placeholder', String(placeholderUsers.length), '0');
if (placeholderUsers.length) {
  for (const u of placeholderUsers) console.log(`     ${u.deviceKey}:${u.employeeNo} → ${u.name}`);
}

// ── I. Alias DB tetap utuh (tidak rusak oleh perubahan ini) ────────────────
console.log('\n=== 9. ALIAS DB UTUH ===');
const dbAliases = await loadIdAliases();
cek('jumlah alias', String(dbAliases.size), '3');
cek('alias keluar:5 → 6', dbAliases.get('keluar:5'), '6');
cek('alias keluar:6 → 4', dbAliases.get('keluar:6'), '4');
cek('alias keluar:7 → 5', dbAliases.get('keluar:7'), '5');

await prisma.$disconnect();
console.log(`\n=== HASIL: ${gagal === 0 ? 'SEMUA LOLOS ✅' : `${gagal} GAGAL ❌`} ===`);
process.exit(gagal === 0 ? 0 : 1);
