// Uji toleransi keterlambatan: verify calculateLateMinutes dan dampaknya
// terhadap lateArrivals pada agregasi laporan.
import { calculateLateMinutes } from '../src/services/reportService.js';

const cases = [
  // [jamMasuk, threshold, toleransi, expected, keterangan]
  ['09:00', '09:00', 0,  0,  'tepat waktu'],
  ['09:05', '09:00', 0,  5,  'terlambat 5 menit tanpa toleransi'],
  ['09:05', '09:00', 10, 0,  'terlambat 5 menit, toleransi 10 -> tepat waktu'],
  ['09:20', '09:00', 10, 10, 'terlambat 20 menit, toleransi 10 -> terlambat 10'],
  ['08:55', '09:00', 10, 0,  'datang lebih awal'],
  ['09:05', '09:00', 5,  0,  'terlambat tepat sebesar toleransi -> tepat waktu'],
];

let failed = 0;
for (const [time, threshold, tol, expected, note] of cases) {
  const got = calculateLateMinutes(time, threshold, tol);
  const ok = got === expected;
  if (!ok) failed = 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  masuk=${time} threshold=${threshold} toleransi=${tol}min -> ${got} menit (harus ${expected}) | ${note}`,
  );
}

// Edge case: input tidak valid tidak boleh melempar / menghasilkan NaN.
for (const bad of [null, undefined, '-', '', 'abc']) {
  const got = calculateLateMinutes(bad, '09:00', 10);
  const ok = got === 0;
  if (!ok) failed = 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  input=${JSON.stringify(bad)} -> ${got} (harus 0)`);
}

console.log(failed ? '\nGAGAL: ada case yang tidak sesuai' : '\nSEMUA CASE LOLOS');
process.exit(failed);
