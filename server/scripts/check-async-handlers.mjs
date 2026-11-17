// Guard: setiap handler async di server HARUS dibungkus asyncHandler.
//
// MASALAH YANG DISELESAIKAN:
//   Express 4 tidak menangkap rejected promise. Route seperti
//     router.get('/x', async (req, res) => { await boom(); })
//   tanpa try/catch menghasilkan unhandled rejection: request TIDAK PERNAH
//   dijawab, socket menggantung, dan frontend menampilkan "Network Error"
//   atau timeout — tanpa informasi request mana yang gagal.
//
//   Satu route yang lupa dibungkus = satu endpoint yang bisa menggantung.
//
// ATURAN:
//   - Semua router.get/post/put/delete WAJIB memakai asyncHandler(...).
//   - File ini mendeteksi route yang masih telanjang.
// Dijalankan: node scripts/check-async-handlers.mjs
import fs from 'node:fs';
import path from 'node:path';

const routesDir = path.resolve('src/routes');
const files = fs.existsSync(routesDir)
  ? fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'))
  : [];

const problems = [];
let total = 0;

for (const file of files) {
  const full = path.join(routesDir, file);
  const src = fs.readFileSync(full, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    const m = line.match(/router\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2\s*,\s*(.+?)\s*\)?\s*;?\s*$/);
    if (!m) return;
    total++;
    const [, method, , routePath, handler] = m;

    // Handler inline (fungsi anonim) juga wajib asyncHandler.
    const isWrapped = /asyncHandler\(/.test(handler);
    const isInlineAsync = /^\s*async\s*\(/.test(handler);
    const isPlainFn = /^\s*\(?\s*req\s*,\s*res/.test(handler);

    if (!isWrapped && (isInlineAsync || isPlainFn)) {
      problems.push({
        file,
        line: i + 1,
        detail: `${method.toUpperCase()} ${routePath} — handler tidak dibungkus asyncHandler`,
        code: line.trim(),
      });
    }
  });
}

if (problems.length) {
  console.log('FAIL — ada route async yang tidak dibungkus asyncHandler:\n');
  for (const p of problems) {
    console.log(`  ${p.file}:${p.line}  ${p.detail}`);
    console.log(`      ${p.code}`);
  }
  console.log('\nPerbaiki dengan: router.get(path, asyncHandler(handler))');
  process.exit(1);
}

console.log(`PASS  semua ${total} route di src/routes memakai asyncHandler`);
