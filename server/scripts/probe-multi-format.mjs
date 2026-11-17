// Probe multi-format: memastikan PDF/Excel/HTML/Teks tetap valid dalam bahasa ID & EN.
import fs from 'fs';
import { buildExportReport } from '../src/services/reportService.js';

const mk = (name, empNo, day, time, device) => ({
  name, employeeNo: empNo, userType: 'Karyawan', deviceKey: device,
  dateKey: day, time, timeOnly: time,
  timeFormatted: `2026-11-05T0${Number(time.slice(0, 2))}:00:00.000Z`,
  date: '05 Nov', dayOfWeek: 'Kamis',
  direction: device === 'masuk' ? 'Masuk' : 'Keluar',
  verifyMode: 'Fingerprint', cardNo: '',
  device: device === 'masuk' ? 'Mesin Masuk' : 'Mesin Keluar',
});

const events = [];
const people = [
  ['Budi Santoso', 'EMP001'], ['Siti Aminah', 'EMP002'],
  ['Andi Wijaya', 'EMP003'], ['Dewi Lestari', 'EMP004'],
  ['Eko Prasetyo', 'EMP005'], ['Fitri Handayani', 'EMP006'],
  ['Agus Salim', 'EMP007'], ['Maya Puspita', 'EMP008'],
];
const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
people.forEach(([n, e], pi) => days.forEach((d, di) => {
  const lateM = di === 0 && pi % 3 === 0;
  const inT = lateM ? '09:2' + (di % 10) + ':00' : '08:' + String(45 + di).padStart(2, '0') + ':00';
  events.push(mk(n, e, d, inT, 'masuk'));
  if (pi % 3 !== 2) {
    events.push(mk(n, e, d, '17:' + String(10 + di * 5).padStart(2, '0') + ':00', 'keluar'));
  }
}));

const stats = {
  totalEvents: events.length,
  totalMasuk: events.filter(e => e.deviceKey === 'masuk').length,
  totalKeluar: events.filter(e => e.deviceKey === 'keluar').length,
  uniqueUsers: new Set(events.map(e => e.name)).size,
};

for (const lang of ['en', 'id']) {
  for (const fmt of ['pdf', 'excel', 'html']) {
    const r = buildExportReport(events, stats, lang, fmt, '09:00', '17:00', true, '2026-11-02', '2026-11-05');
    if (fmt === 'pdf') {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      await new Promise((res, rej) => { r.on('end', res); r.on('error', rej); r.end(); });
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(`probe-${lang}.pdf`, buf);
      console.log(lang, fmt, 'OK pdf bytes', buf.length);
    } else if (fmt === 'excel') {
      await r.xlsx.writeFile(`probe-${lang}.xlsx`);
      console.log(lang, fmt, 'OK xlsx');
    } else {
      fs.writeFileSync(`probe-${lang}.html`, r.html);
      console.log(lang, fmt, 'OK html bytes', r.html.length, 'text bytes', r.text.length);
    }
  }
}
