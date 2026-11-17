// Pembungkus gate layout PDF.
//
// `npm run check:pdf-layout` sebelumnya memanggil `python` secara langsung.
// Di mesin ini `python` bisa menunjuk ke interpreter yang TIDAK punya
// `pymupdf` (mis. venv tanpa pip), sehingga gate gagal karena masalah
// lingkungan, bukan karena layout PDF-nya.
//
// Skrip ini mencoba beberapa interpreter berurutan dan memakai yang pertama
// yang bisa mengimpor `pymupdf`. Kalau tidak ada, ia chain ke perintah
// `python` bawaan sistem agar pesan errornya tetap informatif.
//
// Pakai: node scripts/run-pdf-layout-check.mjs <file.pdf>
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pdfArg = process.argv[2];
if (!pdfArg) {
  console.error('Pemakaian: node scripts/run-pdf-layout-check.mjs <file.pdf>');
  process.exit(2);
}

const checker = path.join(__dirname, 'check-pdf-layout.py');

// Kandidat interpreter, urut dari yang paling mungkin punya pymupdf.
// `python3` lebih dulu karena di Windows launcher `python` sering tertaut ke
// Microsoft Store stub atau venv tanpa pip.
const CANDIDATES = ['python3', 'python', 'py'];

let chosen = null;
for (const exe of CANDIDATES) {
  const probe = spawnSync(exe, ['-c', 'import pymupdf'], { stdio: 'ignore' });
  if (probe.status === 0) { chosen = exe; break; }
}

if (!chosen) {
  console.error(
    'Tidak ada interpreter Python dengan pymupdf yang ditemukan.\n' +
    'Pasang dulu:  python3 -m pip install pymupdf\n' +
    'Diperiksa: ' + CANDIDATES.join(', '),
  );
  process.exit(1);
}

const res = spawnSync(chosen, [checker, pdfArg], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
