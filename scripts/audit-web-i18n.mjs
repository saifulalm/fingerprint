// Audit: paritas key + nilai IDENTIK id/en (indikasi terjalin tidak diterjemahkan).
import fs from 'node:fs';

const src = fs.readFileSync('web/src/hooks/langData.js', 'utf8');
const idStart = src.indexOf('  id: {');
const enStart = src.indexOf('  en: {');
const end = src.indexOf('\n};', enStart);

function parse(section) {
  const out = {};
  // Nilai boleh diapit single- atau double-quote (mis. teks berisi
  // apostrophe seperti "Today's attendance events"). Backslash di dalam
  // string di-escape agar tidak merusak parsing.
  const re = /'([a-z0-9_.]+)'\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const val = m[2] !== undefined ? m[2] : m[3];
    out[m[1]] = val.replace(/\\(.)/g, '$1');
  }
  return out;
}

const id = parse(src.slice(idStart, enStart));
const en = parse(src.slice(enStart, end));

console.log('id keys:', Object.keys(id).length, '| en keys:', Object.keys(en).length);
console.log('missing in en:', Object.keys(id).filter((k) => !(k in en)).join(', ') || '(none)');
console.log('missing in id:', Object.keys(en).filter((k) => !(k in id)).join(', ') || '(none)');

const same = Object.keys(id).filter((k) => en[k] === id[k]);
console.log('\n== IDENTIK id==en (perlu ditinjau) ==');
same.forEach((k) => console.log('  ', k, '=>', JSON.stringify(id[k])));

// Nilai yang contains kata Indonesia tapi_EN_ juga pakai → belum diterjemahkan
const idWords = /\b(Masuk|Keluar|Karyawan|Periode|Ringkasan|Laporan|Hadir|Tepat|Terlambat|Tamu|Rekap|Jam|Simpan|Hapus|Batal|Ya|Tidak|Dari|Sampai|Total|Lebih|hari|karyawan|dikirim|gagal|berhasil)\b/;
console.log('\n== suspect: nilai ID masih Bahasa Indonesia ==');
Object.keys(id).forEach((k) => {
  if (idWords.test(id[k]) && !idWords.test(en[k] || '')) console.log('  ', k, '| id:', id[k], '| en:', en[k]);
});
