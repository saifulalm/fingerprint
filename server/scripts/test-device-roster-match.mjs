// Uji logika pencocokan roster dengan data dari DB (device offline).
//
// Data user diambil dari `device_users` — bukan dari perangkat — supaya
// logika pencocokan bisa diuji tanpa perangkat menyala.
//
// Skenario yang diuji:
//   A. Roster normal (No.7 hanya di keluar) → harus terdeteksi MISSING.
//   B. Nomor berbeda, nama sama → harus terdeteksi MATCHED + alias saran.
//   C. Alias yang sudah ada → harus masuk kategori "sudah ada", bukan
//      dibuat ulang.
//   D. Normalisasi nama (spasi/case) → "adit" harus cocok dengan "Adit".

import { PrismaClient } from '@prisma/client';
import {
  fetchDeviceRosters,
  matchRostersByName,
  diffAgainstExistingAliases,
  loadExistingAliases,
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

console.log('═══════════════════════════════════════════════════════');
console.log('  UJI PENCOCOKAN ROSTER IN ↔ OUT BERDASARKAN NAMA');
console.log('═══════════════════════════════════════════════════════\n');

// ─── 1. Normalisasi nama ─────────────────────────────────────────────────────
console.log('=== 1. NORMALISASI NAMA ===');
cek('"Adit" → "adit"', normalizeRosterName('Adit') === 'adit');
cek('"  Adit  " → "adit"', normalizeRosterName('  Adit  ') === 'adit');
cek('"ADIT" → "adit"', normalizeRosterName('ADIT') === 'adit');
cek('"Ibu  Christina" → "ibu christina"', normalizeRosterName('Ibu  Christina') === 'ibu christina');
cek('"" → ""', normalizeRosterName('') === '');
cek('null → ""', normalizeRosterName(null) === '');

// ─── 2. Roster dari DB ───────────────────────────────────────────────────────
console.log('\n=== 2. ROSTER DARI DB ===');
const du = await prisma.deviceUser.findMany({ orderBy: [{ deviceKey: 'asc' }, { employeeNo: 'asc' }] });
const perDevice = {};
for (const u of du) {
  if (!perDevice[u.deviceKey]) perDevice[u.deviceKey] = [];
  perDevice[u.deviceKey].push({ employeeNo: String(u.employeeNo), name: u.name });
}

// Buang user uji (990001/990002) supaya skenario fokus pada konflik nyata.
for (const k of Object.keys(perDevice)) {
  perDevice[k] = perDevice[k].filter((u) => !u.employeeNo.startsWith('990'));
  console.log(`  ${k}: ${perDevice[k].length} user (${perDevice[k].map((u) => `${u.employeeNo}=${u.name}`).join(', ')})`);
}

// ─── 3. Pencocokan ───────────────────────────────────────────────────────────
console.log('\n=== 3. HASIL PENCOCOKAN ===');
const match = matchRostersByName(perDevice, 'masuk', await loadExistingAliases());
console.log(`  matched=${match.matched.length} missing=${match.missing.length} conflicts=${match.conflicts.length}`);
for (const m of match.matched) {
  console.log(`    MATCHED  ${m.name.padEnd(16)} ref masuk:${m.reference.employeeNo} → ${m.other.deviceKey}:${m.other.employeeNo}`);
}
for (const m of match.missing) {
  console.log(`    MISSING  ${m.name.padEnd(16)} ${m.reason} (ada di ${m.presentOn.deviceKey}, tidak di ${m.missingOn})`);
}

// Ekspektasi dari data user:
//   In:  2 Saiful, 3 Astrid, 4 Chika, 5 Juanto, 6 Adit, 8 Cepi, 9 Dian, 10 Ibu Christina, 11 Brook
//   Out: 2 Saiful, 3 Astrid, 4 Chika, 5 Adit,   6 Chika, 7 Juanto, 8 Cepi, 9 Dian, 10 Ibu Christina, 11 Brook
//
//   → No.5 keluar (Adit)  = No.6 masuk  → MATCHED (alias keluar:5 → 6)
//   → No.6 keluar (Chika) = No.4 masuk  → MATCHED (alias keluar:6 → 4)
//   → No.7 keluar (Juanto)= No.5 masuk  → MATCHED (alias keluar:7 → 5)
//   → No.7 hanya di keluar → tidak ada di masuk → MISSING (only_on_other_device)
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
//
// Kasus "hanya ada di satu perangkat" yangsesuai adalah nama yang TIDAK
// ada di perangkat referensi sama sekali. Diuji di skenario terpisah
// (lihat blok "HANYA ADA DI SATU PERANGKAT" di bawah).
const missingOnlyOther = match.missing.filter((m) => m.reason === 'only_on_other_device');
const missingOnDevice = match.missing.filter((m) => m.reason === 'missing_on_device');
console.log(`  missing: only_on_other_device=${missingOnlyOther.length} missing_on_device=${missingOnDevice.length}`);
cek('tidak ada false-positive "hanya ada di satu perangkat" untuk Juanto',
  !missingOnlyOther.some((m) => m.name === 'Juanto'),
  '(Juanto ada di "masuk" sebagai No.5 — jadi memang bukan kasus ini)');

// ─── 4. Diff dengan alias yang sudah ada ─────────────────────────────────────
console.log('\n=== 4. DIFF DENGAN ALIAS YANG SUDAH ADA ===');
const existing = await loadExistingAliases();
console.log(`  alias di DB: ${existing.length}`);
for (const a of existing) console.log(`    ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}`);

const diff = diffAgainstExistingAliases(match, existing);
console.log(`  toCreate=${diff.toCreate.length} existing=${diff.existing.length} conflicts=${diff.conflicts.length}`);

cek('alias yang cocok dengan DB tidak dibuat ulang',
  diff.toCreate.length === 0,
  `(toCreate: ${diff.toCreate.map((a) => `${a.deviceKey}:${a.deviceEmployeeNo}→${a.employeeNo}`).join(', ') || 'tidak ada'})`);
cek('semua kandidat alias terdeteksi sudah ada',
  diff.existing.length === 3,
  `(existing: ${diff.existing.length})`);
cek('tidak ada alias bentrok', diff.conflicts.length === 0,
  `(conflicts: ${diff.conflicts.length})`);

// Alias yang sudah ada harus PERSIS sama dengan hasil pencocokan.
for (const a of existing) {
  const found = diff.existing.find(
    (x) => x.deviceKey === a.deviceKey && x.deviceEmployeeNo === a.deviceEmployeeNo,
  );
  cek(`alias DB ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo} cocok dengan hasil pencocokan`,
    !!found && found.employeeNo === a.employeeNo);
}

// ─── 5. Skenario: alias kosong (mis. instalasi baru) ─────────────────────────
console.log('\n=== 5. SKENARIO ALIAS KOSONG (instalasi baru) ===');
const diffFresh = diffAgainstExistingAliases(match, []);
cek('3 alias perlu dibuat dari nol', diffFresh.toCreate.length === 3,
  `(toCreate: ${diffFresh.toCreate.length})`);
for (const a of diffFresh.toCreate) {
  console.log(`    ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo}  (${a.name})`);
  cek(`alias ${a.deviceKey}:${a.deviceEmployeeNo} → ${a.employeeNo} arahnya benar`,
    a.deviceKey === 'keluar' && ['6', '4', '5'].includes(a.employeeNo),
    '(nomor di perangkat non-acuan → nomor di perangkat acuan)');
}

// ─── 6. Normalisasi: nama dengan spasi/case berbeda tetap cocok ─────────────
console.log('\n=== 6. NAMA DENGAN SPASI/CASE BERBEDA TETAP COCOK ===');
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

// ─── 7. Perangkat offline → tidak boleh memunculkan hasil palsu ─────────────
console.log('\n=== 7. PERANGKAT OFFLINE ===');
const perDeviceOffline = {
  masuk: [{ employeeNo: '5', name: 'Juanto' }],
  keluar: { error: 'timeout' },
};
const matchOffline = matchRostersByName(perDeviceOffline, 'masuk');
cek('perangkat offline ditandai', (matchOffline.offline || []).includes('keluar'));
cek('tidak ada alias palsu dari perangkat offline',
  matchOffline.matched.length === 0,
  `(matched: ${matchOffline.matched.length})`);

// Roster acuan tidak tersedia → hasil jelas, bukan crash.
const matchNoRef = matchRostersByName({ keluar: [{ employeeNo: '5', name: 'Juanto' }] }, 'masuk');
cek('perangkat acuan tidak ada → ok=false, bukan crash', matchNoRef.ok === false);

// ─── 7b. HANYA ADA DI SATU PERANGKAT ──────────────────────────────────────────
//
// Skenario nyata: seorang karyawan terdaftar di "keluar" tapi BELUM di
// "masuk" (mis. baru di-scan di pintu keluar). Nama itu tidak ada di
// perangkat referensi sama sekali → harus dilaporkan sebagai "hanya ada
// di satu perangkat", BUKAN dianggap orang yang sama.
console.log('\n=== 7b. HANYA ADA DI SATU PERANGKAT ===');
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

// ─── 7c. Alias existing dipakai sebagai PETUNJUK saat nama duplikat ──────────
//
// KASUS NYATA: device "keluar" punya No.4 = Chika DAN No.6 = Chika.
// Tanpa alias existing sebagai petunjuk, pencocokan akan menganggap
// No.4 (keluar) = No.4 (masuk) → "sudah cocok", dan No.6 (keluar) tidak
// pernah dipetakan. Alias `keluar:6 → 4` memberi tahu bahwa yang
// sebenarnya adalah No.6.
console.log('\n=== 7c. ALIAS EXISTING SEBAGAI PETUNJUK (nama duplikat) ===');
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

// ─── 8. Ringkasan ────────────────────────────────────────────────────────────
console.log('\n=== 8. RINGKASAN ===');
const sum = summarizeRosterMatch(match, diff);
console.log(`  ${JSON.stringify(sum, null, 2)}`);
cek('ringkasan punya hitungan yang masuk akal',
  sum.matchedCount === 3 && sum.toCreateCount === 0 && sum.existingCount === 3);

// ─── 9. DETEKSI PERALIHAN ORANG pada nomor yang sama ─────────────────────────
//
// KASUS NYATA di repo ini (device "keluar"):
//   No.5 = Juanto (1–27 Okt) → Adit (28 Okt–11 Nov)
//   No.6 = Adit   (1–27 Okt) → Chika (28 Okt–11 Nov)
// Ini RIWAYAT perpindahan user, bukan data rusak.
console.log('\n=== 9. DETEKSI PERALIHAN ORANG PADA NOMOR YANG SAMA ===');
const allRecords = await prisma.attendanceRecord.findMany({
  select: { employeeNo: true, employeeName: true, deviceKey: true, time: true },
});
const reassign = detectEmployeeNumberReassignments(allRecords);
console.log(`  nomor yang dipakai >1 orang: ${reassign.size}`);
for (const r of reassign.values()) {
  console.log(`    ${r.deviceKey}:No.${r.employeeNo} → ${r.names.map((n) => `${n.name} (${n.from}..${n.to})`).join(' | ')}`);
}

const keluar5 = reassign.get('keluar|5');
cek('keluar:No.5 terdeteksi punya 2 nama', !!keluar5 && keluar5.names.length === 2);
cek('keluar:No.5: periode pertama = Juanto',
  !!keluar5 && keluar5.names[0].name === 'Juanto',
  keluar5 ? `(dapat: ${keluar5.names[0].name})` : '');
cek('keluar:No.5: periode kedua = Adit',
  !!keluar5 && keluar5.names[1].name === 'Adit',
  keluar5 ? `(dapat: ${keluar5.names[1].name})` : '');

const keluar6 = reassign.get('keluar|6');
cek('keluar:No.6 terdeteksi punya 2 nama', !!keluar6 && keluar6.names.length === 2);
cek('keluar:No.6: periode pertama = Adit',
  !!keluar6 && keluar6.names[0].name === 'Adit');
cek('keluar:No.6: periode kedua = Chika',
  !!keluar6 && keluar6.names[1].name === 'Chika');

// Nomor yang TIDAK pernah berganti orang tidak boleh dilaporkan.
const masuk4 = reassign.get('masuk|4');
cek('masuk:No.4 (Chika) tidak dilaporkan sebagai berganti', !masuk4,
  '(Chika selalu No.4 di device masuk)');

await prisma.$disconnect();

console.log(gagal === 0
  ? '\n✅ SEMUA UJI PENCOCOKAN ROSTER LOLOS'
  : `\n❌ HASIL: ${gagal} uji gagal`);
process.exit(gagal === 0 ? 0 : 1);
