// Probe ground-truth: bandingkan user di kedua perangkat lewat cardNo.
//
// TUJUAN:
//   Nomor employee adalah kunci LOKAL tiap perangkat, jadi nomor yang sama
//   bisa menunjuk orang berbeda. cardNo (nomor kartu) milik orang yang
//   sama di kedua perangkat — itulah pembanding yang TIDAK ambigu untuk
//   menentukan siapa sebenarnya di balik suatu nomor.
//
// Output dipakai untuk membangun pemetaan canonical + saran alias.
import { getDeviceUsers } from '../src/services/hikvisionAdmin.js';
import { listDevices } from '../src/services/hikvisionAdmin.js';

const devs = listDevices();
const per = {};

for (const d of devs) {
  const users = await getDeviceUsers(d);
  per[d.type] = users;
  console.log(`\n=== ${d.type} (${d.label}) — ${users.length} user ===`);
  for (const u of users) {
    console.log(
      `  no=${String(u.employeeNo).padEnd(4)} name="${u.name}"`.padEnd(44) +
      ` card=${u.cardNo || '-'} valid=${u.valid} end=${u.validEnd || '-'}`
    );
  }
}

// ── Analisis: kelompokkan user berdasarkan cardNo ──────────────────────────
console.log('\n\n=== KELOMPOK BERDASARKAN CARDNO ===');
const byCard = new Map();
for (const [devKey, users] of Object.entries(per)) {
  for (const u of users) {
    const card = (u.cardNo || '').trim();
    if (!card) continue;
    if (!byCard.has(card)) byCard.set(card, []);
    byCard.get(card).push({ devKey, no: u.employeeNo, name: u.name });
  }
}
for (const [card, list] of byCard) {
  const names = [...new Set(list.map((x) => x.name))];
  console.log(`  card ${card}: ${list.map((x) => `${x.devKey}:${x.no}(${x.name})`).join('  ')}` +
    (names.length > 1 ? '   ← ⛔ NAMA BEDA' : ''));
}

// ── Analisis: nomor yang sama, nama berbeda antar perangkat ──────────────
console.log('\n=== NOMOR SAMA, NAMA BEDA ===');
const keys = Object.keys(per);
const allNos = new Set();
for (const k of keys) for (const u of per[k]) allNos.add(u.employeeNo);
for (const no of [...allNos].sort()) {
  const hits = keys
    .map((k) => { const f = per[k].find((u) => u.employeeNo === no); return f ? { k, ...f } : null; })
    .filter(Boolean);
  const names = new Set(hits.map((h) => (h.name || '').trim()));
  if (names.size > 1) {
    console.log(`  no=${no}: ` + hits.map((h) => `${h.k}=${h.name}(card:${h.cardNo || '-'})`).join('  '));
  }
}

// ── Analisis: nama sama, nomor berbeda (kandidat alias) ────────────────────
console.log('\n=== NAMA SAMA, NOMOR BEDA (kandidat pemetaan) ===');
for (const [card, list] of byCard) {
  const nos = list.map((x) => x.no);
  if (new Set(nos).size > 1) {
    console.log(`  card ${card}: ${list.map((x) => `${x.devKey}:${x.no}=${x.name}`).join('  ')}`);
  }
}

// ── Nama duplikat dalam satu perangkat (indikasi salah label) ──────────────
console.log('\n=== NAMA DUPLIKAT DALAM SATU PERANGKAT ===');
for (const [k, users] of Object.entries(per)) {
  const seen = new Map();
  for (const u of users) {
    const n = (u.name || '').trim();
    if (!seen.has(n)) seen.set(n, []);
    seen.get(n).push(u.employeeNo);
  }
  for (const [n, nos] of seen) {
    if (nos.length > 1) console.log(`  ${k}: "${n}" ada di nomor ${nos.join(', ')}`);
  }
}
