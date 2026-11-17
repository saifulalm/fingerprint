// Skrip audit bundle — memetakan ukuran bundle ke file sumber.
// Dijalankan: node scripts/audit-bundle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const outDir = 'dist-audit';

await build({
  configFile: path.resolve('vite.config.js'),
  logLevel: 'error',
  build: {
    sourcemap: true,
    minify: false,
    outDir,
    emptyOutDir: true,
  },
});

const assets = fs.readdirSync(path.join(outDir, 'assets'));
const mapFile = assets.find((f) => f.endsWith('.map'));
if (!mapFile) {
  console.log('tidak ada sourcemap');
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(path.join(outDir, 'assets', mapFile), 'utf8'));

const byFile = new Map();
map.sources.forEach((src, i) => {
  const len = (map.sourcesContent?.[i] || '').length;
  byFile.set(src, (byFile.get(src) || 0) + len);
});

const short = (f) =>
  f.replace(/^.*?web[\\/]/, '').replace(/^.*?node_modules[\\/]/, 'nm/');

console.log('=== 30 FILE TERBESAR DI BUNDLE ===');
for (const [f, len] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(String(len).padStart(8), short(f));
}

const pkg = new Map();
for (const [f, v] of byFile.entries()) {
  const m = f.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
  const key = m ? m[1].replace(/[\\/]/g, '/') : 'APLIKASI';
  pkg.set(key, (pkg.get(key) || 0) + v.len);
}
console.log('\n=== TOTAL PER PACKAGE ===');
for (const [p, len] of [...pkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(String(len).padStart(8), p);
}
