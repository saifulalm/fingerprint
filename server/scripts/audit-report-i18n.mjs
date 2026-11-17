// Audit script: cek paritas key T (reportService) dan label hardcoded.
import fs from 'node:fs';

const src = fs.readFileSync('src/services/reportService.js', 'utf8');
const start = src.indexOf('const T = {');
const body = src.slice(start);
const enStart = body.indexOf('  en: {');
const idStart = body.indexOf('  id: {');
const idEnd = body.indexOf('\n};', idStart);
const enBody = body.slice(enStart, idStart);
const idBody = body.slice(idStart, idEnd);

const grab = (s) => [...s.matchAll(/^\s{4}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]);
const en = grab(enBody);
const id = grab(idBody);
const enSet = new Set(en);
const idSet = new Set(id);

console.log('T.en keys:', enSet.size, '| T.id keys:', idSet.size);
console.log('MISSING IN T.id:', [...enSet].filter((k) => !idSet.has(k)).join(', ') || '(none)');
console.log('MISSING IN T.en:', [...idSet].filter((k) => !enSet.has(k)).join(', ') || '(none)');

// Cek destructuring `= T[lang]` — key yang di-ambil tapi tidak ada di T.id
// akan bernilai undefined → label kosong di PDF/Excel.
//
// Catatan: pola `foo: bar` adalah ALIAS (nama lokal `bar` mengambil nilai
// key `foo`), bukan key baru. Kunci alias ikut diabaikan.
const lines = src.split('\n');
const destructureFindings = [];
lines.forEach((line, i) => {
  if (!/=\s*T\[lang\]/.test(line)) return;
  let k = i;
  while (k > 0 && !/const\s*\{/.test(lines[k])) k--;
  const block = lines.slice(k, i + 1).join(' ');
  // Nama-nama yang dipetakan ke alias (source: target) — target BUKAN key.
  const aliasTargets = new Set(
    [...block.matchAll(/([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)/g)].map((m) => m[2]),
  );
  const names = [...block.matchAll(/([a-zA-Z0-9_]+)\s*(?=[,}])/g)]
    .map((m) => m[1])
    .filter((n) => !aliasTargets.has(n));
  const missing = names.filter((n) => !idSet.has(n) && n !== 'totalLabel');
  if (missing.length) destructureFindings.push({ line: k + 1, missing });
});
console.log('DESTRUCTURE gaps (id):', JSON.stringify(destructureFindings));

// lbl() fallback aman?
console.log('lbl fallback ok:', /T\[lang\]\?\.\[key\]\s*\?\?\s*T\.en\[key\]\s*\?\?\s*key/.test(src));
