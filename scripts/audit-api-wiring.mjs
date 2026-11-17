// Audit keter Wiring: backend route vs pemakaian frontend.
//
// Tujuan: temukan route backend yang TIDAK PERNAH dipanggil frontend
// (kode mati / fitur yang belum di consommer UI), dan panggilan frontend
// yang tidak punya route backend (path salah).
//
// Cara kerja:
//   1. Baca server/src/index.js → pasangan mount prefix ↔ file router.
//   2. Baca tiap file router → daftar method + path.
//   3. Baca seluruh web/src → kumpulkan path API yang dipanggil.
//   4. Cocokkan dengan normalisasi path parameter (:id → *).

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

const SERVER = path.join(ROOT, 'server/src');
const WEB = path.join(ROOT, 'web/src');

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}
function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

// ── 1. Mount prefix dari index.js ────────────────────────────────────────────
const indexSrc = readFileSafe(path.join(SERVER, 'index.js'));
const mounts = [];
for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) {
  mounts.push({ prefix: m[1], routerVar: m[2] });
}
// Pasangan import: import xxxRoutes from './routes/yyyRoutes.js'
const imports = {};
for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)'/g)) {
  imports[m[1]] = path.join(SERVER, 'routes', m[2]);
}

// ── 2. Kumpulkan route per file ─────────────────────────────────────────────
const routes = [];
for (const { prefix, routerVar } of mounts) {
  const file = imports[routerVar];
  if (!file) continue;
  const src = readFileSafe(file);
  for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']*)'/g)) {
    routes.push({
      method: m[1].toUpperCase(),
      path: (prefix + (m[2] === '/' ? '' : m[2])).replace(/\/+$/, '') || '/',
      file: path.relative(ROOT, file),
    });
  }
}

// ── 3. Kumpulkan panggilan frontend ─────────────────────────────────────────
//
// Dua POLA pemanggilan ada di proyek ini:
//   1. `api.get('/employees')`          → axios instance, baseURL '/api'
//   2. `apiFetch('/api/whatsapp/status', { method: 'POST' })` → wrapper
//      (WhatsAppPage) yang meneruskan method lewat opsi.
//
// DAN path boleh berupa KONSTENSI string (`'/scheduler/' + id`). Path
// konkatenasi tidak bisa dicocokkan statis — ditandai `dynamic` supaya
// tidak salah dilaporkan sebagai orphan.
const calls = [];
for (const f of walk(WEB)) {
  const src = readFileSafe(f);
  const rel = path.relative(ROOT, f);

  // Pola 1 — axios instance dengan path STATIS.
  //   - String biasa (`'...'`, `"..."`) tanpa konkatenasi.
  //   - Template literal (`...`) yang TIDAK memuat ekspresi `${...}` —
  //     template dengan ekspresi ditangani Pola 3d.
  // Negative lookahead `(?!\s*\+)` mencegah string yang LANJUT dengan
  // konkatenasi (`'/scheduler/' + id`) ikut tercatat sebagai path statis.
  // PENTING: `\s*` di dalam lookahead, bukan sesudahnya — kalau `\s*`
  // berada DI LUAR lookahead, regex bisa backtrack dan mencocokkan dengan
  // spasi yang diabaikan, sehingga pola konkatenasi tetap ikut terekam.
  for (const m of src.matchAll(/api\.(get|post|put|delete|patch)\(\s*'([^']+)'\s*(?!\s*\+)/g)) {
    calls.push({ method: m[1].toUpperCase(), path: m[2], file: rel, dynamic: false });
  }
  for (const m of src.matchAll(/api\.(get|post|put|delete|patch)\(\s*"([^"]+)"\s*(?!\s*\+)/g)) {
    calls.push({ method: m[1].toUpperCase(), path: m[2], file: rel, dynamic: false });
  }
  for (const m of src.matchAll(/api\.(get|post|put|delete|patch)\(\s*`([^`$]+)`\s*(?!\s*\+)/g)) {
    calls.push({ method: m[1].toUpperCase(), path: m[2], file: rel, dynamic: false });
  }
  // Pola 2 — wrapper apiFetch(path, { method })
  for (const m of src.matchAll(/apiFetch\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*\{[^}]*?method:\s*'(\w+)'/gs)) {
    calls.push({ method: m[2].toUpperCase(), path: m[1], file: rel, dynamic: false });
  }
  // Pola 2b — apiFetch(path) TANPA opsi → method default GET.
  for (const m of src.matchAll(/apiFetch\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g)) {
    calls.push({ method: 'GET', path: m[1], file: rel, dynamic: false });
  }
  // Pola 3 — axios mentah
  for (const m of src.matchAll(/axios\.(get|post|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    calls.push({ method: m[1].toUpperCase(), path: m[2], file: rel, dynamic: false });
  }
  // Pola 3b — helper readers di ReportsPage: apiGetText/apiGetBlob/apiGetJson
  for (const m of src.matchAll(/apiGet(?:Text|Blob|Json)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    calls.push({ method: 'GET', path: m[1], file: rel, dynamic: false });
  }
  // Pola 3c — authApi.* di services/api.js
  for (const m of src.matchAll(/authApi\.(get|post|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    calls.push({ method: m[1].toUpperCase(), path: m[2], file: rel, dynamic: false });
  }
  // Pola 3d — TEMPLATE LITERAL dengan ekspresi di dalam `${...}`.
  // Contoh: api.delete(`/admin/audit${query}`) → '/admin/audit*'.
  // String biasa dengan '+' (pola 4) TIDAK tertangkap di sini.
  for (const m of src.matchAll(/api\.(get|post|put|delete|patch)\(\s*`([^`]*\$\{[^`]*)`/g)) {
    const tmpl = m[2].replace(/\$\{[^}]*\}/g, '*');
    calls.push({ method: m[1].toUpperCase(), path: tmpl, file: rel, dynamic: false });
  }
  // Pola 4 — path konkatenasi dengan STRING BIASA:
  //   api.put('/scheduler/' + edit.id, form)
  // Seluruh ekspresi argumen diambil (sampai koma/`)'), lalu setiap bagian
  // non-literal diganti '*'. Contoh:
  //   '/scheduler/' + s.id + '/toggle'  →  '/scheduler/*/toggle'
  //   '/scheduler/' + edit.id           →  '/scheduler/*'
  // Template literal handled oleh Pola 3d (tidak masuk ke sini).
  for (const m of src.matchAll(/api\.(get|post|put|delete|patch)\(\s*((?:'[^']*'|"[^"]*")\s*(?:\+\s*[^,)]+)+)/g)) {
    const parts = m[2].split('+').map((s) => s.trim());
    const tmpl = parts.map((p) => {
      const lit = /^['"]([\s\S]*)['"]$/.exec(p);
      return lit ? lit[1] : '*';
    }).join('');
    if (!tmpl.includes('*')) continue;
    calls.push({ method: m[1].toUpperCase(), path: tmpl, file: rel, dynamic: false });
  }
  // Pola 5 — apiFetch dengan konkatenasi (ekspresi sama seperti pola 4).
  for (const m of src.matchAll(/apiFetch\(\s*([^,)]+(?:\([^)]*\)[^,)]*)*)/g)) {
    const expr = m[1].trim();
    if (!expr.includes('+')) continue;
    if (!/^[`'"]/.test(expr)) continue;
    const parts = expr.split('+').map((s) => s.trim());
    const tmpl = parts.map((p) => {
      const lit = /^[`'"]([\s\S]*)[`'"]$/.exec(p);
      return lit ? lit[1] : '*';
    }).join('');
    if (!tmpl.includes('*')) continue;
    calls.push({ method: 'GET', path: tmpl, file: rel, dynamic: false });
  }
}

// Normalisasi path → pola (parameter → wildcard)
//
// PENTING: instance axios frontend memakai `baseURL: '/api'`, jadi path
// yang ditulis di frontend ('/employees') TIDAK menyertakan prefix '/api'.
// Backend-nya di-mount sebagai '/api/employees'. Karena itu setiap path
// frontend harus diberi prefix '/api' dulu sebelum dicocokkan.
//
// Wildcard dipisah DARI segmen, bukan menyatu di dalamnya:
//   '/api/scheduler/*'      → segmen ['api','scheduler','*']  (wildcard penuh)
//   '/api/admin/audit*'     → segmen ['api','admin','audit'] + trailingWildcard
// Kalau wildcard dibiarkan menyatu ('audit*'), pencocokan dengan route
// '/api/admin/audit' selalu gagal karena panjang segmen berbeda.
function norm(p, isBackend = false) {
  let s = p.replace(/\?.*$/, '');   // buang query string
  if (!isBackend && !s.startsWith('/api/')) s = '/api' + s;
  const raw = s.split('/');
  const segs = [];
  for (let i = 0; i < raw.length; i++) {
    let seg = raw[i];
    if (seg.startsWith(':')) seg = '*';
    // Wildcard menempel di ujung segmen ('audit*') berarti "segmen ini
    // diikuti query/path apa pun" — wildcard itu TIDAP menambah segmen.
    // Contoh: '/api/admin/audit*' → segs ['api','admin','audit'].
    seg = seg.replace(/\*+$/, '');
    if (seg) segs.push(seg);
    else if (i === raw.length - 1) segs.push('*');  // segmen '*' utuh
  }
  return { segs, trailingWildcard: false };
}

/** Bentuk path ternormalisasi sebagai string (untuk printing). */
function normStr(p, isBackend = false) {
  const { segs, trailingWildcard } = norm(p, isBackend);
  return (segs.join('/') + (trailingWildcard ? '*' : '')) || '/';
}

const routePatterns = routes.map((r) => ({ ...r, pat: norm(r.path, true) }));
// usedPatterns menyimpan SEGMENT ARRAY, bukan string — supaya wildcard di
// ujung (trailing) dan wildcard penuh (segmen '*') tidak tertukar.
const usedPatterns = calls.map((c) => ({
  method: c.method,
  segs: norm(c.path).segs,
  trailingWildcard: norm(c.path).trailingWildcard,
}));

// Panggilan dengan path konkatenasi (`'/scheduler/' + id`) tetap gestured
// sebagai prefix yang bisa mencocoki route ber-parameter.
const dynamicCalls = calls.filter((c) => c.dynamic);

/**
 * Cocokkan segmen path frontend ke pola route backend.
 *
 * Aturan:
 *   - Route '/api/employees/:employeeNo' (wildcard penuh) cocok dengan
 *     frontend '/api/employees/*' maupun '/api/employees/EMP001'.
 *   - Frontend '/api/admin/audit*' (wildcard menempel di ujung, misal
 *     dari template literal `${query}`) TIDAP menambah segmen, jadi
 *     cocok dengan route '/api/admin/audit'.
 *
 * @param {string} method
 * @param {string[]} fp segmen path frontend
 * @returns {boolean}
 */
function matchesRoute(method, fp) {
  return routePatterns.some((r) => {
    if (r.method !== method) return false;
    const rp = r.pat.segs;
    if (rp.length !== fp.length) return false;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i] === '*') continue;          // parameter route → wild
      if (fp[i] === '*') continue;          // wildcard frontend → wild
      if (rp[i] !== fp[i]) return false;
    }
    return true;
  });
}

// ── 4. Route yang tidak terpakai ─────────────────────────────────────────────
const unused = routePatterns.filter((r) => {
  const rp = r.pat.segs;

  const covered = usedPatterns.some((u) => {
    if (u.method !== r.method) return false;
    if (rp.length !== u.segs.length) return false;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i] === '*') continue;
      if (u.segs[i] === '*') continue;
      if (rp[i] !== u.segs[i]) return false;
    }
    return true;
  });
  if (covered) return false;

  // Route dengan parameter bisa dipenuhi oleh panggilan konkatenasi.
  const dynamicCovered = dynamicCalls.some((c) => {
    if (c.method !== r.method) return false;
    const prefix = norm(c.path).segs;
    if (prefix.length > rp.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === '*') continue;
      if (prefix[i] !== rp[i]) return false;
    }
    return rp.slice(prefix.length).every((s) => s === '*');
  });
  return !dynamicCovered;
});

// ── Allowlist: route yang memang TIDAK dipakai frontend ──────────────────────
//
// Setiap entri wajib disertai alasan. Route tanpa alasan yang jelas
// berarti feature belum selesai, bukan kode mati — biarkan audit
// menolaknya.
const ALLOWLIST = {
  'POST /api/admin/audit': 'Dipakai integrasi eksternal untuk menulis log audit; UI hanya butuh DELETE.',
  'GET /api/admin/stats': 'Digantikan GET /api/admin/dashboard yang lebih lengkap.',
  'POST /api/attendance/sync': 'Dipanggil internal saat boot (syncAttendanceToDb) + trigger manual.',
  'POST /api/attendance/repair': 'Utilitas sekali jalan untuk memperbaiki waktu tersimpan.',
  'POST /api/export/excel': 'Legacy — digantikan GET /api/report/export?format=excel.',
  'POST /api/export/pdf': 'Legacy — digantikan GET /api/report/export?format=pdf.',
  'POST /api/export/csv': 'Legacy — CSV dibuat di sisi browser (AttendancePage).',
  'POST /api/email': 'Legacy — digantikan GET /api/report/email.',
  'POST /api/webhooks/openwa': 'Receiver publik; dipanggil OpenWA gateway, bukan browser.',
  'POST /api/employees/bulk': 'Endpoint API untuk impor massal dari luar; UI belum menyediakan.',
};

const isAllowlisted = (r) => ALLOWLIST[`${r.method} ${r.path}`];

// ── 5. Panggilan frontend tanpa route ────────────────────────────────────────
const orphans = calls.filter((c) => {
  if (c.dynamic) return false;   // path konkatenasi: tidak bisa diverifikasi statis
  return !matchesRoute(c.method, norm(c.path).segs);
});

console.log('ROUTE BACKEND :', routePatterns.length);
console.log('PANGGILAN FE :', calls.length);
console.log('');

const unexpected = unused.filter((r) => !isAllowlisted(r));
const known = unused.filter(isAllowlisted);

console.log('=== ROUTE TIDAK DIPAKAI FRONTEND — TANPA ALASAN (perlu ditinjau) ===');
unexpected.forEach((r) => console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(42)} ${r.file}`));
if (!unexpected.length) console.log('  (tidak ada)');

console.log('');
console.log('=== ROUTE TIDAK DIPAKAI FRONTEND — SUDAH DIREKOMENDASIKAN ===');
known.forEach((r) => console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(42)} ${ALLOWLIST[`${r.method} ${r.path}`]}`));
if (!known.length) console.log('  (tidak ada)');

console.log('');
console.log('=== PANGGILAN FRONTEND TANPA ROUTE BACKEND ===');
orphans.forEach((c) => console.log(`  ${c.method.padEnd(6)} ${c.path.padEnd(42)} ${c.file}`));
if (!orphans.length) console.log('  (tidak ada)');

// Exit code non-zero bila ada route tak terduga atau panggilan yatim —
// supaya audit ini bisa dipakai sebagai gate di `npm run verify`.
const problems = unexpected.length + orphans.length;
console.log('');
if (problems === 0) {
  console.log('OK — semua route either terpakai frontend atau punya alasan yang jelas.');
} else {
  console.log(`PERLU TINJAU: ${problems} temuan.`);
}

process.exit(problems === 0 ? 0 : 1);
