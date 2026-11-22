// Uji logika pencocokan roster In ↔ Out berdasarkan NAMA.
//
// DESAIN TEST — WAJIB PORTABEL:
//
//   Test ini TIDAK bergantung pada isi database. Semua skenario memakai
//   FIXTURE yang didefinisikan di file ini.
//
//   SEBELUMNYA test memakai data `device_users` + `attendance_records` dari
//   DB. Akibatnya:
//     - Di instalasi dengan DB kosong (mis. server produksi yang baru
//       `db:push` tapi belum `seed`), seluruh skenario gagal karena roster
//       kosong → `npm run verify` PECAH.
//     - Test jadi tidak portabel antar instalasi.
//
//   Sekarang: fixture statis (deterministik, hasil sama di mana pun),
//   PLUS pemeriksaan tambahan terhadap DB yang HANYA informasional
//   (tidak pernah menggagalkan test).
//
// SKENARIO YANG DIUJI:
//   A. Normalisasi nama (spasi berlebih + case).
//   B. Pencocokan dengan fixture konflik nyata (Chika/Adit/Juanto).
//   C. Diff terhadap alias existing (tidak menimpa alias yang sudah ada).
//   C2. Alias existing yang bentrok → dilaporkan, bukan ditimpa.
//   D. Alias existing sebagai petunjuk saat nama DUPLIKAT di satu device.
//   E. Pengguna yang hanya ada di satu perangkat.
//   F. Perangkat offline → tidak boleh menghasilkan alias palsu.
//   G. Normalisasi: nama dengan spasi/case berbeda tetap cocok.
//   H. Deteksi peralihan orang pada nomor yang sama (riwayat).
//
// Jalankan: node scripts/test-device-roster-match.mjs

import { PrismaClient } from '@prisma/client';
import {
  matchRostersByName,
  diffAgainstExistingAliases,
  summarizeRosterMatch,
  normalizeRosterName,
  detectEmployeeNumberReassignments,
} from '../src/services/deviceRosterService.js';

const prisma = new PrismaClient();
let gagal = 0;
function cek(label, ok, detail = '') {
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURE — roster dua perangkat dengan konflik nomor seperti data nyata.
// ═══════════════════════════════════════════════════════════════════════════════
//
//   In  (masuk) : 2 Saiful, 3 Astrid, 4 Chika, 5 Juanto, 6 Adit, 8 Cepi,
//                  9 Dian, 10 Ibu Christina, 11 Brook
//   Out (keluar): 2 Saiful, 3 Astrid, 4 Chika, 5 Adit,   6 Chika, 7 Juanto,
//                  8 Cepi, 9 Dian, 10 Ibu Christina, 11 Brook
//
//   → No.5 keluar (Adit)   = No.6 masuk  → alias keluar:5 → 6
//   → No.6 keluar (Chika)  = No.4 masuk  → alias keluar:6 → 4
//   → No.7 keluar (Juanto) = No.5 masuk  → alias keluar:7 → 5
const FIXTURE_ROSTER = {
  masuk: [
    { employeeNo: '2',  name: 'Saiful' },
    { employeeNo: '3',  name: 'Astrid' },
    { employeeNo: '4',  name: 'Chika' },
    { employeeNo: '5',  name: 'Juanto' },
    { employeeNo: '6',  name: 'Adit' },
    { employeeNo: '8',  name: 'Cepi' },
    { employeeNo: '9',  name: 'Dian' },
    { employeeNo: '10', name: 'Ibu Christina' },
    { employeeNo: '11', name: 'Brook' },
  ],
  keluar: [
    { employeeNo: '2',  name: 'Saiful' },
    { employeeNo: '3',  name: 'Astrid' },
    { employeeNo: '4',  name: 'Chika' },
    { employeeNo: '5',  name: 'Adit' },
    { employeeNo: '6',  name: 'Chika' },
    { employeeNo: '7',  name: 'Juanto' },
    { employeeNo: '8',  name: 'Cepi' },
    { employeeNo: '9',  name: 'Dian' },
    { employeeNo: '10', name: 'Ibu Christina' },
    { employeeNo: '11', name: 'Brook' },
  ],
};

// Alias yang sudah ada di DB (fixture) — dipakai sebagai petunjuk.
const FIXTURE_ALIASES = [
  { deviceKey: 'keluar', deviceEmployeeNo: '5', employeeNo: '6' },
  { deviceKey: 'keluar', deviceEmployeeNo: '6', employeeNo: '4' },
  { deviceKey: 'keluar', deviceEmployeeNo: '7', employeeNo: '5' },
];

console.log('═══════════════════════════════════════════════════════');
console.log('  UJI PENCOCOKAN ROSTER IN ↔ OUT BERDASARKAN NAMA');
console.log('  (fixture statis — tidak bergantung pada isi database)');
console.log('═══════════════════════════════════════════════════════\n');

// ─── A. Normalisasi nama ─────────────────────────────────────────────────────
console.log('=== A. NORMALISASI NAMA ===');
cek('"Adit" → "adit"', normalizeRosterName('Adit') === 'adit');
cek('"  Adit  " → "adit"', normalizeRosterName('  Adit  ') === 'adit');
cek('"ADIT" → "adit"', normalizeRosterName('ADIT') === 'adit');
cek('"Ibu  Christina" → "ibu christina"', normalizeRosterName('Ibu  Christina') === 'ibu christina');
cek('"" → ""', normalizeRosterName('') === '');
cek('null → ""', normalizeRosterName(null) === '');

// ─── B. Pencocokan dengan fixture ─────────────────────────────────────────────
console.log('\n=== B. PENCOCOKAN DENGAN FIXTURE ===');
const match = matchRostersByName(FIXTURE_ROSTER, 'masuk', FIXTURE_ALIASES);
console.log(`  matched=${match.matched.length} missing=${match.missing.length} conflicts=${match.conflicts.length}`);
for (const m of match.matched) {
  console.log(`    MATCHED  ${m.name.padEnd(16)} ref masuk:${m.reference.employeeNo} → ${m.other.deviceKey}:${m.other.employeeNo}`);
}
for (const m of match.missing) {
  console.log(`    MISSING  ${m.name.padEnd(16)} ${m.reason} (ada di ${m.presentOn.deviceKey}, tidak di ${m.missingOn})`);
}

cek('terdeteksi 3 nomor beda dengan nama sama', match.matched.length === 3,
  `(ditemukan: ${match.matched.length})`);

const aditMatch = match.matched.find((m) => m.name === 'Adit');
cek('Adit: keluar:5 → masuk:6',
  !!aditMatch && aditMatch.other.employeeNo === '5' && aditMatch.reference.employeeNo === '6',
  aditMatch ? `(dapat: keluar:${aditMatch.other.employeeNo} → masuk:${aditMatch.reference.employeeNo})` : '');

const chikaMatch = match.matched.find((m) => m.name === 'Chika');
cek('Chika: keluar:6 → masuk:4',
  !!chikaMatch && chikaMatch.other.employeeNo === '6' && chikaMatch.reference.employeeNo === '4',
  chikaMatch ? `(dapat: keluar:${chikaMatch.other.employeeNo} → masuk:${chikaMatch.reference.employeeNo})` : '');

const juantoMatch = match.matched.find((m) => m.name === 'Juanto');
cek('Juanto: keluar:7 → masuk:5',
  !!juantoMatch && juantoMatch.other.employeeNo === '7' && juantoMatch.reference.employeeNo === '5',
  juantoMatch ? `(dapat: keluar:${juantoMatch.other.employeeNo} → masuk:${juantoMatch.reference.employeeNo})` : '');

// "hanya ada di satu perangkat": No.7 (Juanto) ada di "keluar" tapi TIDAK
// ada di "masuk". Karena "masuk" punya Juanto di No.5, dan alias
// `keluar:7 → 5` sudah ada, Juanto TERDAKAR sebagai orang yang sama — jadi
// ini BUKAN kasus "hanya ada di satu perangkat".
const missingOnlyOther = match.missing.filter((m) => m.reason === 'only_on_other_device');
console.log(`  missing: only_on_other_device=${missingOnlyOther.length} missing_on_device=${match.missing.filter((m) => m.reason === 'missing_on_device').length}`);
cek('tidak ada false-positive "hanya ada di satu perangkat" untuk Juanto',
  !missingOnlyOther.some((m) => m.name === 'Juanto'),
  '(Juanto ada di "masuk" sebagai No.5 — jadi memang bukan kasus ini)');

// ─── C. Diff terhadap alias existing ─────────────────────────────────────────
console.log('\n=== C. DIFF DENGAN ALIAS YANG SUDAH ADA ===');
const diff = diffAgainstExistingAliases(match, FIXTURE_ALIASES);
console.log(`  toCreate=${diff.toCreate.length} existing=${diff.existing.length} conflicts=${diff.conflicts.length}`);

cek('alias yang cocok dengan DB tidak dibuat ulang',
  diff.toCreate.length === 0,
  `(toCreate: ${diff.toCreate.map((a) => `${a.deviceKey}:${a.deviceEmployeeNo}→${a.employeeNo}`).join(', ') || 'tidak ada'})`);
cek('semua kandidat alias terdeteksi sudah ada',
  diff.existing.length === 3,
  `(existing: ${diff.existing.length})`);
cek('tidak ada alias bentrok', diff.conflicts.length === 0,
  `(conflicts: ${diff.conflicts.length})`);

for (const a of FIXTURE_ALIASES) {
  const found = diff.existing.find(
    (x) => x.deviceKey === a.deviceKey && x.deviceEmployeeNo === a.deviceEmployeeNo,
  );
  cek(`alias DB ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo} cocok dengan hasil pencocokan`,
    !!found && found.employeeNo === a.employeeNo);
}

// ─── C2. Alias existing yang bentrok → dilaporkan, bukan ditimpa ─────────────
console.log('\n=== C2. ALIAS EXISTING YANG BENTROK ===');
const conflictAliases = [
  { deviceKey: 'keluar', deviceEmployeeNo: '5', employeeNo: '99' },  // salah
];
const diffConflict = diffAgainstExistingAliases(match, conflictAliases);
cek('alias bentrok terdeteksi', diffConflict.conflicts.length >= 1,
  `(conflicts: ${diffConflict.conflicts.length})`);
cek('alias bentrok TIDAK masuk kategori "toCreate"',
  !diffConflict.toCreate.some((a) => a.deviceEmployeeNo === '5' && a.employeeNo === '6'),
  '(alias existing tidak pernah ditimpa)');
cek('alias bentrok dilaporkan lengkap',
  diffConflict.conflicts.length >= 1 &&
  diffConflict.conflicts[0].existingEmployeeNo === '99' &&
  diffConflict.conflicts[0].employeeNo === '6',
  diffConflict.conflicts[0]
    ? `(existing: ${diffConflict.conflicts[0].existingEmployeeNo}, saran: ${diffConflict.conflicts[0].employeeNo})`
    : '');

// ─── D. Alias existing sebagai petunjuk saat nama duplikat ───────────────────
console.log('\n=== D. ALIAS EXISTING SEBAGAI PETUNJUK (nama duplikat) ===');
const perDeviceDup = {
  masuk: [{ employeeNo: '4', name: 'Chika' }],
  keluar: [
    { employeeNo: '4', name: 'Chika' },
    { employeeNo: '6', name: 'Chika' },
  ],
};
const matchNoHint = matchRostersByName(perDeviceDup, 'masuk');
cek('tanpa petunjuk: No.6 (keluar) dianggap sudah cocok dengan No.4',
  matchNoHint.matched.length === 0,
  `(matched: ${matchNoHint.matched.length})`);

const matchWithHint = matchRostersByName(perDeviceDup, 'masuk', [
  { deviceKey: 'keluar', deviceEmployeeNo: '6', employeeNo: '4' },
]);
const hintedChika = matchWithHint.matched.find((m) => m.other.employeeNo === '6');
cek('dengan petunjuk alias: No.6 (keluar) dipetakan ke No.4 (masuk)',
  !!hintedChika && hintedChika.reference.employeeNo === '4',
  hintedChika ? `(dapat: keluar:${hintedChika.other.employeeNo} → masuk:${hintedChika.reference.employeeNo})` : '(tidak ditemukan)');
cek('petunjuk alias ditandai di hasil',
  !!hintedChika && hintedChika.fromExistingAlias === true);

// ─── E. Pengguna yang hanya ada di satu perangkat ────────────────────────────
console.log('\n=== E. HANYA ADA DI SATU PERANGKAT ===');
const perDeviceOneOnly = {
  masuk: [
    { employeeNo: '5', name: 'Juanto' },
    { employeeNo: '6', name: 'Adit' },
  ],
  keluar: [
    { employeeNo: '5', name: 'Juanto' },
    { employeeNo: '6', name: 'Adit' },
    { employeeNo: '9', name: 'Budi' },      // hanya di keluar
  ],
};
const matchOneOnly = matchRostersByName(perDeviceOneOnly, 'masuk');
const budi = matchOneOnly.missing.find((m) => m.name === 'Budi');
cek('Budi (hanya di keluar) terdeteksi sebagai "only_on_other_device"',
  !!budi && budi.reason === 'only_on_other_device',
  budi ? `(ditemukan: ${budi.reason})` : '(tidak ditemukan)');
cek('Budi dilaporkan dengan nomor & device yang benar',
  !!budi && budi.presentOn.deviceKey === 'keluar' && budi.presentOn.employeeNo === '9');
cek('Budi tidak menghasilkan alias (tidak ada pasangan di referensi)',
  !matchOneOnly.matched.some((m) => m.name === 'Budi'));
cek('tidak ada alias palsu untuk user yang hanya di satu perangkat',
  matchOneOnly.matched.length === 0,
  `(matched: ${matchOneOnly.matched.length})`);

// Sebaliknya: ada di "masuk" tapi tidak di "keluar".
const perDeviceOneOnlyRef = {
  masuk: [
    { employeeNo: '5', name: 'Juanto' },
    { employeeNo: '12', name: 'Sari' },    // hanya di masuk
  ],
  keluar: [
    { employeeNo: '5', name: 'Juanto' },
  ],
};
const matchRefOnly = matchRostersByName(perDeviceOneOnlyRef, 'masuk');
const sari = matchRefOnly.missing.find((m) => m.name === 'Sari');
cek('Sari (hanya di masuk) terdeteksi sebagai "missing_on_device"',
  !!sari && sari.reason === 'missing_on_device',
  sari ? `(ditemukan: ${sari.reason})` : '(tidak ditemukan)');
cek('Sari tidak menghasilkan alias',
  !matchRefOnly.matched.some((m) => m.name === 'Sari'));

// ─── F. Perangkat offline ───────────────────────────────────────────────────
console.log('\n=== F. PERANGKAT OFFLINE ===');
const perDeviceOffline = {
  masuk: [{ employeeNo: '5', name: 'Juanto' }],
  keluar: { error: 'timeout' },
};
const matchOffline = matchRostersByName(perDeviceOffline, 'masuk');
cek('perangkat offline ditandai', (matchOffline.offline || []).includes('keluar'));
cek('tidak ada alias palsu dari perangkat offline',
  matchOffline.matched.length === 0,
  `(matched: ${matchOffline.matched.length})`);

const matchNoRef = matchRostersByName({ keluar: [{ employeeNo: '5', name: 'Juanto' }] }, 'masuk');
cek('perangkat acuan tidak ada → ok=false, bukan crash', matchNoRef.ok === false);

// ─── G. Normalisasi: nama dengan spasi/case berbeda tetap cocok ─────────────
console.log('\n=== G. NAMA DENGAN SPASI/CASE BERBEDA TETAP COCOK ===');
const perDeviceWeird = {
  masuk: [
    { employeeNo: '5', name: 'Juanto' },
    { employeeNo: '6', name: '  ADIT  ' },
  ],
  keluar: [
    { employeeNo: '9', name: 'juanto' },
    { employeeNo: '8', name: 'Adit' },
  ],
};
const matchWeird = matchRostersByName(perDeviceWeird, 'masuk');
cek('"Juanto" vs "juanto" tetap cocok',
  matchWeird.matched.some((m) => m.other.employeeNo === '9' && m.reference.employeeNo === '5'),
  `(ditemukan: ${matchWeird.matched.length})`);
cek('"  ADIT  " vs "Adit" tetap cocok',
  matchWeird.matched.some((m) => m.other.employeeNo === '8' && m.reference.employeeNo === '6'),
  '(spasi excess + case berbeda tetap dicocokkan)');

// ─── H. Deteksi peralihan orang pada nomor yang sama ─────────────────────────
//
// KASUS NYATA: HR memindahkan user, jadi nomor berubah seiring waktu:
//
//   No.5 = Juanto (1–27 Okt) → Adit (28 Okt–11 Nov)
//   No.6 = Adit   (1–27 Okt) → Chika (28 Okt–11 Nov)
//
// Ini RIWAYAT perpindahan user, bukan data rusak.
console.log('\n=== H. DETEKSI PERALIHAN ORANG PADA NOMOR YANG SAMA ===');
const reassignFixture = detectEmployeeNumberReassignments([
  { employeeNo: '5', employeeName: 'Juanto', deviceKey: 'keluar', time: new Date('2026-10-01T00:00:00Z') },
  { employeeNo: '5', employeeName: 'Juanto', deviceKey: 'keluar', time: new Date('2026-10-20T00:00:00Z') },
  { employeeNo: '5', employeeName: 'Adit',   deviceKey: 'keluar', time: new Date('2026-11-01T00:00:00Z') },
  { employeeNo: '5', employeeName: 'Adit',   deviceKey: 'keluar', time: new Date('2026-11-10T00:00:00Z') },
  { employeeNo: '4', employeeName: 'Chika',  deviceKey: 'masuk',  time: new Date('2026-10-01T00:00:00Z') },
  { employeeNo: '4', employeeName: 'Chika',  deviceKey: 'masuk',  time: new Date('2026-11-10T00:00:00Z') },
]);
console.log(`  nomor yang dipakai >1 orang: ${reassignFixture.size}`);
for (const r of reassignFixture.values()) {
  console.log(`    ${r.deviceKey}:No.${r.employeeNo} → ${r.names.map((n) => `${n.name} (${n.from}..${n.to})`).join(' | ')}`);
}

const keluar5 = reassignFixture.get('keluar|5');
cek('keluar:No.5 terdeteksi punya 2 nama', !!keluar5 && keluar5.names.length === 2);
cek('keluar:No.5: periode pertama = Juanto',
  !!keluar5 && keluar5.names[0].name === 'Juanto',
  keluar5 ? `(dapat: ${keluar5.names[0].name})` : '');
cek('keluar:No.5: periode kedua = Adit',
  !!keluar5 && keluar5.names[1].name === 'Adit',
  keluar5 ? `(dapat: ${keluar5.names[1].name})` : '');
cek('masuk:No.4 (Chika) tidak dilaporkan sebagai berganti',
  !reassignFixture.get('masuk|4'),
  '(Chika selalu No.4 di device masuk)');

// ─── I. Ringkasan ────────────────────────────────────────────────────────────
console.log('\n=== I. RINGKASAN ===');
const sum = summarizeRosterMatch(match, diff);
console.log(`  ${JSON.stringify(sum, null, 2)}`);
cek('ringkasan punya hitungan yang masuk akal',
  sum.matchedCount === 3 && sum.toCreateCount === 0 && sum.existingCount === 3);

// ─── J. PEMERIKSAAN DB (INFORMASIONAL — tidak pernah menggagalkan test) ────────
//
// Ini memberi gambaran kondisi instalasi tempat test dijalankan, tapi TIDAK
// jadi assertion. Alasannya: instalasi dengan DB kosong atau dengan roster
// berbeda sama sekali tetap harus LULUS — yang diuji adalah LOGIKA
// pencocokan, bukan isi database.
console.log('\n=== J. KONDISI DATABASE INSTALASI INI (informasional) ===');
try {
  const duCount = await prisma.deviceUser.count();
  const recCount = await prisma.attendanceRecord.count();
  const aliasCount = await prisma.employeeIdAlias.count();
  console.log(`  device_users        : ${duCount}`);
  console.log(`  attendance_records  : ${recCount}`);
  console.log(`  employee_id_aliases : ${aliasCount}`);
  if (duCount === 0) {
    console.log('  ℹ️  DB belum punya device_users. Jalankan `npm run seed` atau');
    console.log('      "Pusat Perangkat → Sinkron User" agar data perangkat terisi.');
    console.log('      (Test tetap LOLOS karena memakai fixture.)');
  }
} catch (err) {
  console.log(`  ⚠️  Gagal membaca DB: ${err.message}`);
  console.log('      (Test tetap LOLOS karena memakai fixture.)');
}

await prisma.$disconnect();

console.log(gagal === 0
  ? '\n✅ SEMUA UJI PENCOCOKAN ROSTER LOLOS'
  : `\n❌ HASIL: ${gagal} uji gagal`);
process.exit(gagal === 0 ? 0 : 1);
