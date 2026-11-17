import prisma from '../src/db.js';

// Analisis pola absensi untuk merancang metrik laporan yang bermakna.
const rows = await prisma.attendanceRecord.findMany({ orderBy: { time: 'asc' } });

const byDay = new Map();
for (const r of rows) {
  const wib = new Date(new Date(r.time).getTime() + 7 * 3600 * 1000);
  const dk = wib.toISOString().slice(0, 10);
  const hm = wib.toISOString().slice(11, 16);
  if (!byDay.has(dk)) byDay.set(dk, []);
  byDay.get(dk).push({ emp: r.employeeNo, name: r.employeeName, dir: r.deviceKey, hm });
}

console.log('=== HARI KERJA (dari device) ===');
for (const [dk, evs] of byDay) {
  const dow = new Date(dk + 'T00:00:00Z').getUTCDay();
  const hari = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dow];
  const masuk = evs.filter(e => e.dir === 'masuk');
  const keluar = evs.filter(e => e.dir === 'keluar');
  const first = masuk.map(e => e.hm).sort()[0];
  const last = keluar.map(e => e.hm).sort().pop();
  const uniqM = new Set(masuk.map(e => e.name)).size;
  const uniqK = new Set(keluar.map(e => e.name)).size;
  const unikOrang = new Set(evs.map(e => e.name)).size;
  console.log(
    `${dk} ${hari} | masuk=${masuk.length}(${uniqM} org) keluar=${keluar.length}(${uniqK} org) ` +
    `total=${evs.length} orang unik=${unikOrang} | first=${first || '-'} last=${last || '-'}`,
  );
}

console.log('\n=== POLA MINGGUAN (agregat per hari-dalam-minggu) ===');
const dowAgg = new Map();
for (const [dk, evs] of byDay) {
  const dow = new Date(dk + 'T00:00:00Z').getUTCDay();
  if (!dowAgg.has(dow)) dowAgg.set(dow, { days: [], masuk: [], keluar: [] });
  const a = dowAgg.get(dow);
  a.days.push(dk);
  const m = evs.filter(e => e.dir === 'masuk').map(e => e.hm).sort();
  const k = evs.filter(e => e.dir === 'keluar').map(e => e.hm).sort();
  if (m.length) a.masuk.push(m[0]);
  if (k.length) a.keluar.push(k[k.length - 1]);
}
const NAMA_DOW = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
for (const [dow, a] of [...dowAgg.entries()].sort((x, y) => x[0] - y[0])) {
  const avg = (arr) => (arr.length ? arr.reduce((s, t) => s + (+t.slice(0, 2) * 60 + +t.slice(3, 5)), 0) / arr.length : null);
  const fm = avg(a.masuk), fk = avg(a.keluar);
  const fmt = (m) => (m == null ? '-' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`);
  console.log(`${NAMA_DOW[dow].padEnd(8)} hari=${a.days.length} rata2 masuk=${fmt(fm)} rata2 keluar=${fmt(fk)}`);
}

console.log('\n=== PER KARYAWAN ===');
const perEmp = new Map();
for (const [dk, evs] of byDay) {
  for (const e of evs) {
    if (!perEmp.has(e.name)) perEmp.set(e.name, { masuk: [], keluar: [], days: new Set() });
    const p = perEmp.get(e.name);
    p.days.add(dk);
    if (e.dir === 'masuk') p.masuk.push({ dk, hm: e.hm });
    else p.keluar.push({ dk, hm: e.hm });
  }
}
for (const [name, p] of [...perEmp.entries()].sort()) {
  const late = p.masuk.filter(x => x.hm > '09:00').length;
  console.log(
    `${name.padEnd(14)} hari=${p.days.size} masuk=${p.masuk.length} keluar=${p.keluar.length} ` +
    `terlambat=${late} | masuk: ${p.masuk.map(x => x.hm).sort().slice(0, 6).join(',')}...`,
  );
}

console.log('\n=== PASCA JAM KERJA / ANOMALI ===');
const anomalies = { sebelumMasuk: 0, setelahKeluar: 0, tanpaPasangan: 0, hariLibur: 0 };
const hariLibur = new Set();
for (const [dk, evs] of byDay) {
  const dow = new Date(dk + 'T00:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) hariLibur.add(dk);
}
for (const [dk, evs] of byDay) {
  const masuk = evs.filter(e => e.dir === 'masuk').map(e => e.hm).sort();
  const keluar = evs.filter(e => e.dir === 'keluar').map(e => e.hm).sort();
  if (masuk.length && masuk[0] < '07:00') anomalies.sebelumMasuk++;
  if (keluar.length && keluar[keluar.length - 1] > '19:00') anomalies.setelahKeluar++;
  if (masuk.length && !keluar.length) anomalies.tanpaPasangan++;
  if (hariLibur.has(dk)) anomalies.hariLibur++;
}
console.log(JSON.stringify(anomalies));
console.log('hari akhir pekan:', [...hariLibur].join(', ') || 'tidak ada');

console.log('\n=== RENTANG WAKTU OBSERVASI ===');
console.log('periode data:', [...byDay.keys()].sort()[0], '→', [...byDay.keys()].sort().pop());
console.log('total hari kerja:', byDay.size);
console.log('total event:', rows.length);

await prisma.$disconnect();
