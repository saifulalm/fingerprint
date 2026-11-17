// Cek sintaks ESM untuk daftar file server (dipakai sebagai guard).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = process.argv.slice(2);
let failed = 0;

for (const f of files) {
  try {
    const src = readFileSync(f, 'utf8');
    // Gambar modul ESM sebagai Skrip dengan import dinonaktifkan: ini hanya
    // memeriksa sintaks, bukan resolusi import.
    new vm.SourceTextModule(src, { identifier: f });
    console.log('OK  ', f);
  } catch (e) {
    failed = 1;
    console.log('FAIL', f, '->', (e.message || '').split('\n')[0]);
  }
}
process.exit(failed);
