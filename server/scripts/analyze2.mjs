import prisma from '../src/db.js';

// Cek anomali: event per employeeNo per device, dan pola scan ganda.
const rows = await prisma.attendanceRecord.findMany({ orderBy: { time: 'asc' } });

const wibOf = (t) => new Date(new Date(t).getTime() + 7 * 3600 * 1000);

console.log('=== EVENT PER EMPLOYEE x DEVICE ===');
const m = new Map();
for (const r of rows) {
  const k = `${r.employeeNo} ${r.employeeName} [${r.deviceKey}]`;
  if (!m.has(k)) m.set(k, { n: 0, days: new Set(), times: [] });
  const e = m.get(k);
  e.n++;
  const w = wibOf(r.time);
  e.days.add(w.toISOString().slice(0, 10));
  e.times.push(w.toISOString().slice(11, 19));
}
for (const [k, e] of [...m.entries()].sort()) {
  console.log(`${k.padEnd(30)} n=${String(e.n).padStart(4)} hari=${e.days.size} rata2/hari=${(e.n / e.days.size).toFixed(1)}`);
}

console.log('\n=== POLA SCAN GANDA (device keluar, 5 menit terakhir) ===');
const keluar = rows.filter(r => r.deviceKey === 'keluar').map(r => ({ r, w: wibOf(r.time) }));
keluar.sort((a, b) => a.w - b.w);
let pairs = 0, total = 0;
for (let i = 1; i < keluar.length; i++) {
  const gap = (keluar[i].w - keluar[i - 1].w) / 1000;
  if (gap <= 300) { pairs++; total += gap; }
}
console.log(`scan berdekatan (≤5 mnt): ${pairs} dari ${keluar.length - 1} transisi, rata2 gap ${(total / Math.max(pairs, 1)).toFixed(1)} detik`);

console.log('\n=== CHIKA: adakah event di device keluar? ===');
const chika = rows.filter(r => r.employeeName === 'Chika');
console.log('total Chika:', chika.length, '| device:', JSON.stringify(chika.reduce((a, r) => { a[r.deviceKey] = (a[r.deviceKey] || 0) + 1; return a; }, {})));
const contoh = chika.slice(0, 8).map(r => `${r.deviceKey} ${wibOf(r.time).toISOString().slice(11, 19)}`);
console.log('contoh:', contoh.join(' | '));

console.log('\n=== JUANTO:_ID 5 vs 7 ===');
const juanto = rows.filter(r => r.employeeName === 'Juanto');
const perNo = {};
for (const r of juanto) {
  perNo[r.employeeNo] = perNo[r.employeeNo] || { n: 0, dev: {} };
  perNo[r.employeeNo].n++;
  perNo[r.employeeNo].dev[r.deviceKey] = (perNo[r.employeeNo].dev[r.deviceKey] || 0) + 1;
}
console.log(JSON.stringify(perNo, null, 1));

console.log('\n=== DURASI KERJA (masuk pertama → keluar terakhir per hari, per orang) ===');
const dayEmp = new Map();
for (const r of rows) {
  const w = wibOf(r.time);
  const dk = w.toISOString().slice(0, 10);
  const hm = w.toISOString().slice(11, 16);
  const k = `${dk}|${r.employeeName}`;
  if (!dayEmp.has(k)) dayEmp.set(k, { masuk: [], keluar: [] });
  const e = dayEmp.get(k);
  if (r.deviceKey === 'masuk') e.masuk.push(hm); else e.keluar.push(hm);
}
const dur = [];
for (const [k, e] of dayEmp) {
  if (!e.masuk.length || !e.keluar.length) continue;
  const m1 = Math.min(...e.masuk.map(t => +t.slice(0, 2) * 60 + +t.slice(3)));
  const k1 = Math.max(...e.keluar.map(t => +t.slice(0, 2) * 60 + +t.slice(3)));
  if (k1 > m1) dur.push({ who: k.split('|')[1], mins: k1 - m1 });
}
const byWho = {};
for (const d of dur) (byWho[d.who] = byWho[d.who] || []).push(d.mins);
for (const [w, arr] of Object.entries(byWho)) {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  console.log(`${w.padEnd(10)} hari= ${String(arr.length).padStart(3)} rata2 durasi= ${Math.floor(avg / 60)}j ${Math.round(avg % 60)}m`);
}
const allAvg = dur.reduce((a, b) => a + b.mins, 0) / dur.length;
console.log(`\nRATA2 DURASI seluruh: ${Math.floor(allAvg / 60)}j ${Math.round(allAvg % 60)}m`);

await prisma.$disconnect();
