// Ekstrak objek LANGS dari useLang.js ke file data terpisah.
// Dipakai sekali untuk memindahkan kamus ke `hooks/langData.js`
// tanpa menyalin 300+ key secara manual.
import fs from 'node:fs';

const src = fs.readFileSync('web/src/hooks/useLang.js', 'utf8');
const start = src.indexOf('const LANGS = {');
const end = src.indexOf('\n};', start) + 3;
if (start < 0 || end < 3) {
  console.error('GAGAL: blok LANGS tidak ditemukan');
  process.exit(1);
}
const block = src.slice(start, end);
const out = `// Kamus terjemahan UI (ID/EN) — sumber tunggal untuk seluruh label teks.
//
// CARA MENAMBAHKAN KEY:
//   1. Tambahkan key di bagian 'id' DAN 'en' (script audit memverifikasi
//      kedua daftar punya key yang identik — key yang ada di satu sisi saja
//      akan menampilkan teks mentah / fallback).
//   2. Jangan memakai terjemahan mesin yang tidak natural; label harus
//      enak dibaca sebagai teks UI.
//
// Audit: node scripts/audit-web-i18n.mjs
${block.replace('const LANGS = {', 'export const LANGS = {')}`;
fs.writeFileSync('web/src/hooks/langData.js', out, 'utf8');
console.log('OK -> web/src/hooks/langData.js');
