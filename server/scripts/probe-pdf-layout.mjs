// Probe verifikasi layout PDF laporan absensi.
// Menghasilkan PDF dari data sintetis; pemeriksaan layout (tumpang tindih baris)
// dilakukan oleh scripts/check-pdf-layout.py yang memakai bbox absolut PyMuPDF.
// Dijalankan lewat `npm run check:pdf-layout`.
import fs from 'fs';
import { buildExportReport } from '../src/services/reportService.js';

const mk = (name, empNo, day, time, device) => ({
  name, employeeNo: empNo, userType: 'Karyawan',
  deviceKey: device,
  dateKey: day,
  time: time,
  timeOnly: time,
  timeFormatted: `2026-11-05T0${Number(time.slice(0, 2))}:00:00.000Z`,
  date: '05 Nov',
  dayOfWeek: 'Kamis',
  direction: device === 'masuk' ? 'Masuk' : 'Keluar',
  verifyMode: 'Fingerprint',
  cardNo: '',
  device: device === 'masuk' ? 'Mesin Masuk' : 'Mesin Keluar',
});

const events = [];
// 8 karyawan; sebagian hanya di perangkat masuk (memicu temuan DEVICE_COVERAGE)
const people = [
  ['Budi Santoso', 'EMP001'], ['Siti Aminah', 'EMP002'],
  ['Andi Wijaya', 'EMP003'], ['Dewi Lestari', 'EMP004'],
  ['Eko Prasetyo', 'EMP005'], ['Fitri Handayani', 'EMP006'],
  ['Agus Salim', 'EMP007'], ['Maya Puspita', 'EMP008'],
];
const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
people.forEach(([n, e], pi) => {
  days.forEach((d, di) => {
    const lateM = di === 0 && pi % 3 === 0;
    const inT = lateM ? '09:2' + (di % 10) + ':00' : '08:' + String(45 + di).padStart(2, '0') + ':00';
    events.push(mk(n, e, d, inT, 'masuk'));
    if (pi % 3 !== 2) {
      const outT = '17:' + String(10 + di * 5).padStart(2, '0') + ':00';
      events.push(mk(n, e, d, outT, 'keluar'));
    }
  });
});

const stats = {
  totalEvents: events.length,
  totalMasuk: events.filter(e => e.deviceKey === 'masuk').length,
  totalKeluar: events.filter(e => e.deviceKey === 'keluar').length,
  uniqueUsers: new Set(events.map(e => e.name)).size,
};

// Build PDF dari data sintetis.
//
// PENTING: dua varian dibangun — TANPA branding dan DENGAN branding
// (judul + subjudul + footer).
//
// SEBELUMNYA hanya satu varian (tanpa branding) yang diuji. Padahal
// subjudul menambah satu baris di header PDF dan menggeser seluruh isi
// halaman — dan posisi header yang hardcoded pernah menyebabkan subtitle
// menabrak baris periode (terukur: subtitle y 29.8–36.3 vs periode
// y 34.8–41.3).
//
// Gate layout WAJIB menguji kedua varian, kalau tidak regresi header tidak
// akan pernah terdeteksi.
async function buildPdf(branding) {
  const doc = buildExportReport(
    events, stats, 'en', 'pdf', '09:00', '17:00', true,
    '2026-11-02', '2026-11-05', 0, 'PT Guard Test', branding,
  );
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  await new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
    doc.end();
  });
  return Buffer.concat(chunks);
}

const out = process.argv[2] || 'probe.pdf';
const buf = await buildPdf({});
fs.writeFileSync(out, buf);
console.log('PDF bytes:', buf.length, '->', out);

// Varian kedua: dengan branding lengkap (judul + subjudul + footer).
const brandedOut = out.replace(/\.pdf$/, '') + '-branded.pdf';
const brandedBuf = await buildPdf({
  title:    'Rekap Absensi Bulanan',
  subtitle: 'Rekap Absensi Karyawan PT Guard Test',
  footer:   'RAHASIA - Hanya Untuk Internal',
});
fs.writeFileSync(brandedOut, brandedBuf);
console.log('PDF bytes:', brandedBuf.length, '->', brandedOut);
console.log('Pemeriksaan layout dijalankan oleh scripts/check-pdf-layout.py (bbox absolut).');

