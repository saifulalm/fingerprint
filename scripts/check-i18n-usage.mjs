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
