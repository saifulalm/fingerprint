// Audit cepat: cek key i18n yang dipakai di markup tapi belum ada di langData.js
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'web');
const src = fs.readFileSync(path.join(ROOT, 'src/hooks/langData.js'), 'utf8');
const keys = new Set([...src.matchAll(/'([a-z0-9_.]+)':/g)].map((m) => m[1]));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jsx|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const used = new Map();
for (const f of walk(path.join(ROOT, 'src'))) {
  const c = fs.readFileSync(f, 'utf8').replace(/<style>[\s\S]*?<\/style>/g, '');
  for (const m of c.matchAll(/\bt\(\s*'([^']+)'/g)) {
    const key = m[1];
    // Kunci dinamis (t('wa.' + status)) tidak bisa diaudit statis — lewati.
    if (key.endsWith('.') || key.endsWith('_')) continue;
    if (!used.has(key)) used.set(key, f);
  }
}
const missing = [...used].filter(([k]) => !keys.has(k));
console.log('used:', used.size, '| missing:', missing.length);
for (const [k, f] of missing) console.log('  ', k, '->', path.relative(process.cwd(), f));

// ─── Key harus ada di BOTH bahasa ─────────────────────────────────────────────
//
// Cek di atas cuma memastikan key ada DI MANA SAJA di langData.js. Kalau
// sebuah key hanya ada di seksi `id`, UI bahasa Inggris akan menampilkannya
// lewat `t()` — yang fallback-nya adalah seksi bahasa LAIN, jadi teks
// Indonesia bocor ke layar berbahasa Inggris.
//
// Cek ini menutup celah itu: setiap key harus ada di `id` DAN `en`.
//
// PENTING — ini fail-closed: kalau regex-nya tidak lagi cocok (struktur
// seksi berubah), hasilnya kosong dan cek akan SILENTLY lolos. Karena itu
// jumlah key per seksi ikut diverifikasi.
//
// Regex memakai penanda seksi BERIKUTNYA (`\n  en:` / `\n};`) supaya seksi
// `id` diakhiri oleh awal seksi `en` — bukan oleh `},` seksi mana pun di
// dalam. Dengan penanda `\n  },` saja, penyisipan objek di dalam seksi
// membuat regex berhenti di titik yang salah dan seksi terpotong diam-diam.
function sectionKeys(name, nextName) {
  const re = nextName
    ? new RegExp(`\\n  ${name}:\\s*\\{([\\s\\S]*?)\\n  ${nextName}:\\s*\\{`)
    : new RegExp(`\\n  ${name}:\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = src.match(re);
  if (!m) return null;
  return new Set([...m[1].matchAll(/'([a-z0-9_.]+)':/g)].map((x) => x[1]));
}

const idKeys = sectionKeys('id', 'en');
const enKeys = sectionKeys('en', null);

if (!idKeys || !enKeys || idKeys.size === 0 || enKeys.size === 0) {
  console.log('FAIL  tidak bisa mengekstrak seksi id/en dari langData.js (fail-closed)');
  process.exit(1);
}

const onlyId = [...idKeys].filter((k) => !enKeys.has(k));
const onlyEn = [...enKeys].filter((k) => !idKeys.has(k));

if (onlyId.length || onlyEn.length) {
  console.log(`FAIL  key i18n tidak lengkap di kedua bahasa (id: ${idKeys.size}, en: ${enKeys.size})`);
  for (const k of onlyId) console.log(`  hanya di 'id': ${k}`);
  for (const k of onlyEn) console.log(`  hanya di 'en': ${k}`);
  process.exit(1);
}
console.log(`PASS  semua ${idKeys.size} key i18n ada di 'id' DAN 'en'`);
