// Uji resolver nama terhadap ground truth dari kedua perangkat.
//
// Ground truth (probe live 2026-11-10):
//   masuk : 2=Saiful 3=Astrid 4=Chika 5=Juanto 6=Adit  8=Cepi 9=Dian 10=Ibu Christina 11=Brook
//   keluar: 2=Saiful 3=Astrid 4=-      5=Adit  6=Chika 7=Juanto 8=Cepi 9=Dian 10=Ibu Christina 11=Brook
//
// MODEL KEBENARAN:
//   Nama TIDAK pernah konflik antar perangkat (perangkat menyimpan nama asli
//   orang). Yang konflik adalah NOMOR employee — kunci lokal tiap perangkat.
//   Alias memetakan nomor di perangkat non-referensi → nomor canonical yang
//   dipakai di perangkat referensi.
//
// Alias yang benar:
//   keluar:5 → 6   (Adit   di Keluar; di Masuk orang itu bernomor 6)
//   keluar:6 → 4   (Chika  di Keluar; di Masuk orang itu bernomor 4)
//   keluar:7 → 5   (Juanto di Keluar; di Masuk orang itu bernomor 5)
import prisma from '../src/db.js';
import {
  buildEmployeeIndex,
  loadIdAliases,
  resolveDisplayName,
  resolveCanonicalEmployeeNo,
  suggestIdAliases,
} from '../src/services/employeeIdentityService.js';

let gagal = 0;
function cek(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label} → "${actual}"${ok ? '' : `  (harus "${expected}")`}`);
}

// ── 1. Saran alias otomatis dari ground truth ──────────────────────────────
const groundTruth = {
  masuk: [
    { employeeNo: '2', name: 'Saiful' }, { employeeNo: '3', name: 'Astrid' },
    { employeeNo: '4', name: 'Chika' }, { employeeNo: '5', name: 'Juanto' },
    { employeeNo: '6', name: 'Adit' }, { employeeNo: '8', name: 'Cepi' },
    { employeeNo: '9', name: 'Dian' }, { employeeNo: '10', name: 'Ibu Christina' },
    { employeeNo: '11', name: 'Brook' },
  ],
  keluar: [
    { employeeNo: '2', name: 'Saiful' }, { employeeNo: '3', name: 'Astrid' },
    { employeeNo: '5', name: 'Adit' }, { employeeNo: '6', name: 'Chika' },
    { employeeNo: '7', name: 'Juanto' }, { employeeNo: '8', name: 'Cepi' },
    { employeeNo: '9', name: 'Dian' }, { employeeNo: '10', name: 'Ibu Christina' },
    { employeeNo: '11', name: 'Brook' },
  ],
};

console.log('=== 1. SARAN ALIAS DARI GROUND TRUTH ===');
const saran = suggestIdAliases(groundTruth, ['masuk', 'keluar']);
for (const s of saran) {
  console.log(`  ${s.deviceKey}:${s.deviceEmployeeNo} → ${s.employeeNo}  (${s.name})  [${s.reason}]`);
}

const harusAda = [
  { dev: 'keluar', src: '5', dst: '6', name: 'Adit', reason: 'conflict' },
  { dev: 'keluar', src: '6', dst: '4', name: 'Chika', reason: 'conflict' },
  { dev: 'keluar', src: '7', dst: '5', name: 'Juanto', reason: 'only_one_device' },
];
for (const h of harusAda) {
  const hit = saran.find(
    (s) => s.deviceKey === h.dev && s.deviceEmployeeNo === h.src && s.employeeNo === h.dst
  );
  cek(`saran ${h.dev}:${h.src} → ${h.dst} (${h.name})`, hit ? 'ADA' : 'TIDAK ADA', 'ADA');
  if (hit) cek(`  alasan`, hit.reason, h.reason);
}

// Nomor yang TIDAK konflik tidak boleh menghasilkan saran.
for (const t of ['2', '3', '8', '9', '10', '11']) {
  const noise = saran.filter((s) => s.deviceEmployeeNo === t);
  cek(`tidak ada saran untuk nomor ${t}`, String(noise.length), '0');
}

// ── 2. Terapkan alias ke DB lalu uji resolver ──────────────────────────────
console.log('\n=== 2. TERAPKAN ALIAS KE DB ===');
for (const h of harusAda) {
  await prisma.employeeIdAlias.upsert({
    where: { deviceKey_deviceEmployeeNo: { deviceKey: h.dev, deviceEmployeeNo: h.src } },
    update: { employeeNo: h.dst },
    create: { deviceKey: h.dev, deviceEmployeeNo: h.src, employeeNo: h.dst },
  });
  console.log(`  alias ${h.dev}:${h.src} → ${h.dst} disimpan`);
}

const index = await buildEmployeeIndex();
const aliases = await loadIdAliases();

console.log('\n=== 3. NAMA TAMPILAN PER PERANGKAT ===');
// Nama diambil dari baris device_users perangkat ASAL → selalu benar.
const harapanNama = [
  ['5', 'masuk', 'Juanto'], ['5', 'keluar', 'Adit'],
  ['6', 'masuk', 'Adit'], ['6', 'keluar', 'Chika'],
  ['7', 'keluar', 'Juanto'],
  ['2', 'masuk', 'Saiful'], ['2', 'keluar', 'Saiful'],
  ['3', 'masuk', 'Astrid'], ['3', 'keluar', 'Astrid'],
  ['4', 'masuk', 'Chika'],
  ['8', 'masuk', 'Cepi'], ['8', 'keluar', 'Cepi'],
  ['9', 'masuk', 'Dian'], ['9', 'keluar', 'Dian'],
  ['10', 'masuk', 'Ibu Christina'], ['10', 'keluar', 'Ibu Christina'],
  ['11', 'masuk', 'Brook'], ['11', 'keluar', 'Brook'],
];
for (const [no, dev, expect] of harapanNama) {
  cek(`nama ID ${no} @ ${dev}`, resolveDisplayName(no, index, aliases, dev), expect);
}

console.log('\n=== 4. NOMOR CANONICAL ===');
for (const [no, dev, expect] of [
  ['5', 'keluar', '6'],   // Adit   di Keluar → nomor 6 di Masuk
  ['6', 'keluar', '4'],   // Chika  di Keluar → nomor 4 di Masuk
  ['7', 'keluar', '5'],   // Juanto di Keluar → nomor 5 di Masuk
  ['5', 'masuk', '5'],    // perangkat referensi → tidak dipetakan
  ['2', 'keluar', '2'],   // tidak konflik → tetap
]) {
  cek(`canonical ${dev}:${no}`, resolveCanonicalEmployeeNo(no, aliases, dev), expect);
}

console.log('\n=== 5. TANPA KONTEKS PERANGKAT ===');
cek('canonical global 5', resolveCanonicalEmployeeNo('5', aliases, null), '5');
cek('canonical global 7', resolveCanonicalEmployeeNo('7', aliases, null), '7');

console.log('\n=== 6. TIDAK ADA KERUSAKAN ID LAIN ===');
for (const [no, dev, expect] of [
  ['2', 'keluar', 'Saiful'], ['3', 'keluar', 'Astrid'],
  ['8', 'keluar', 'Cepi'], ['9', 'keluar', 'Dian'],
  ['10', 'keluar', 'Ibu Christina'], ['11', 'keluar', 'Brook'],
]) {
  cek(`nama ID ${no} @ ${dev}`, resolveDisplayName(no, index, aliases, dev), expect);
}

console.log(`\n=== HASIL: ${gagal === 0 ? 'SEMUA LOLOS ✅' : `${gagal} GAGAL ❌`} ===`);
await prisma.$disconnect();
process.exit(gagal === 0 ? 0 : 1);
