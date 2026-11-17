import prisma from '../src/db.js';

// KRITIS: apakah deviceKey benar-benar "arah" (masuk/keluar) atau hanya lokasi scan?
const rows = await prisma.attendanceRecord.findMany({ orderBy: { time: 'asc' } });
const wibOf = (t) => new Date(new Date(t).getTime() + 7 * 3600 * 1000);

const buckets = { masuk: { pagi: 0, siang: 0, sore: 0, malam: 0 }, keluar: { pagi: 0, siang: 0, sore: 0, malam: 0 } };
for (const r of rows) {
  const hm = wibOf(r.time).toISOString().slice(11, 16);
  const key = hm < '09:00' ? 'pagi' : hm < '12:00' ? 'siang' : hm < '17:00' ? 'sore' : 'malam';
  buckets[r.deviceKey][key]++;
}
console.log('=== DISTRIBUSI JAM SCAN PER DEVICE ===');
console.log(JSON.stringify(buckets, null, 1));

console.log('\n=== SCAN "KELUAR" SEBELUM JAM 12:00 (bukti device bukan arah) ===');
const pagiKeluar = rows.filter(r => {
  const hm = wibOf(r.time).toISOString().slice(11, 16);
  return r.deviceKey === 'keluar' && hm < '12:00';
});
console.log('jumlah:', pagiKeluar.length, 'dari', rows.filter(r => r.deviceKey === 'keluar').length, 'event keluar');
const contoh = pagiKeluar.slice(0, 10).map(r => `${r.employeeName}@${wibOf(r.time).toISOString().slice(11, 16)}`);
console.log('contoh:', contoh.join(', '));

console.log('\n=== SCAN "MASUK" SETELAH JAM 17:00 ===');
const soreMasuk = rows.filter(r => {
  const hm = wibOf(r.time).toISOString().slice(11, 16);
  return r.deviceKey === 'masuk' && hm >= '17:00';
});
console.log('jumlah:', soreMasuk.length, 'dari', rows.filter(r => r.deviceKey === 'masuk').length, 'event masuk');
console.log('contoh:', soreMasuk.slice(0, 10).map(r => `${r.employeeName}@${wibOf(r.time).toISOString().slice(11, 16)}`).join(', '));

console.log('\n=== SEQUENCE per orang per hari (device masuk/keluar) ===');
const perDay = new Map();
for (const r of rows) {
  const w = wibOf(r.time);
  const dk = w.toISOString().slice(0, 10);
  const k = `${dk}|${r.employeeName}`;
  if (!perDay.has(k)) perDay.set(k, []);
  perDay.get(k).push(`${r.deviceKey[0].toUpperCase()}${w.toISOString().slice(11, 16)}`);
}
const sample = [...perDay.entries()].filter(([k, v]) => v.length >= 6).slice(0, 6);
for (const [k, v] of sample) console.log(k.padEnd(26), v.join(' '));

console.log('\n=== APAKAH ORANG SCAN DI MASUK LEBIH DARI 1X SEBULAN? ===');
const byName = {};
for (const r of rows) {
  const d = r.deviceKey;
  byName[r.employeeName] = byName[r.employeeName] || { masuk: 0, keluar: 0 };
  byName[r.employeeName][d]++;
}
for (const [n, c] of Object.entries(byName)) {
  const ratio = c.keluar > 0 ? (c.masuk / c.keluar).toFixed(2) : '∞';
  console.log(`${n.padEnd(10)} masuk=${String(c.masuk).padStart(3)} keluar=${String(c.keluar).padStart(3)} rasio masuk:keluar=${ratio}`);
}

await prisma.$disconnect();
