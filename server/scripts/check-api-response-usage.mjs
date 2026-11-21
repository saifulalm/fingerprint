// Guard: frontend TIDAK BOLEH salah membaca respons axios.
//
// BUG YANG DICEGAH:
//
//   `api.get()` / `api.post()` mengembalikan OBJECT AXIOS
//   (`{ data, status, statusText, headers, config }`), BUKAN body responsnya.
//
//   Di SchedulerPage pernah ada:
//
//     const data = await api.get('/scheduler');
//     setSchedules(Array.isArray(data) ? data : []);
//
//   Karena `data` adalah object axios, `Array.isArray(data)` selalu FALSE →
//   `setSchedules([])` → halaman selalu menampilkan "Belum ada jadwal",
//   WALAUPUN jadwal berhasil dibuat (server balas HTTP 201). User mengira
//   "create schedule tidak tercreate".
//
//   Bug yang sama: `if (res.error)` — `res.error` tidak pernah ada pada
//   axios response, jadi pesan error server tidak pernah ditampilkan.
//
// ATURAN:
//   - Ambil array dari `res.data` (atau `res.data?.something`).
//   - Pesan error server dari `err.serverMessage` (interceptor sudah
//     mengekstraknya) atau `err.response?.data?.error`.
//
// Guard ini statis: ia memindai source frontend untuk pola yang salah.
//
// Jalankan: node scripts/check-api-response-usage.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WEB_SRC = path.join(ROOT, 'web', 'src');

let gagal = 0;
function cek(label, ok, detail = '') {
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

/** Kumpulkan semua file .js / .jsx di bawah folder. */
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Buang baris komentar supaya pola yang sengaja didokumentasikan di
 * komentar tidak dianggap sebagai regresi.
 */
const codeOnly = (src) => src
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*/.test(l))
  .join('\n');

const files = walk(WEB_SRC);

console.log('=== 1. POLA SALAH: Array.isArray(res) LANGSUNG dari api.get ===');
let polaSalah = 0;
for (const f of files) {
  const src = codeOnly(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(ROOT, f);

  // `const data = await api.get(...);` → `Array.isArray(data)`
  const bad = [...src.matchAll(
    /(?:const|let|var)\s+(\w+)\s*=\s*await\s+api\.(get|post|put|delete)\s*\([^;]*;/g,
  )].filter((m) => {
    const varname = m[1];
    // Cek apakah variabel itu dipakai langsung sebagai array (bukan res.data).
    const usedDirect = new RegExp(`Array\\.isArray\\(\\s*${varname}\\s*\\)`).test(src);
    const usedViaData = new RegExp(`\\b${varname}\\.data\\b`).test(src);
    return usedDirect && !usedViaData;
  });

  for (const m of bad) {
    polaSalah++;
    console.log(`  ❌ ${rel}: "${m[1]}" dibaca langsung dari api.${m[2]}() — harus lewat .data`);
  }
}
if (polaSalah === 0) {
  console.log('  ✅ tidak ada respons axios yang dibaca langsung sebagai array');
}

// ─── 2. POLA SALAH: res.error pada respons axios ─────────────────────────────
console.log('\n=== 2. POLA SALAH: res.error pada respons axios ===');
let polaError = 0;
for (const f of files) {
  const src = codeOnly(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(ROOT, f);

  // `res.error` / `response.error` — axios response tidak punya field ini.
  const bad = [...src.matchAll(/\b(res|response)\.error\b/g)];
  for (const m of bad) {
    polaError++;
    console.log(`  ❌ ${rel}: "${m[0]}" — axios response tidak punya field .error; pakai res.data?.error atau err.serverMessage`);
  }
}
if (polaError === 0) {
  console.log('  ✅ tidak ada pembacaan .error langsung dari respons axios');
}

// ─── 3. POLA BENAR yang dipakai sebagai acuan ────────────────────────────────
console.log('\n=== 3. POLA BENAR YANG ADA (acuan) ===');
const schedulerPage = fs.readFileSync(path.join(WEB_SRC, 'pages', 'SchedulerPage.jsx'), 'utf8');
cek(
  'SchedulerPage membaca array lewat res.data',
  /const\s+list\s*=\s*res\.data/.test(schedulerPage) &&
  /Array\.isArray\(list\)/.test(schedulerPage),
);
cek(
  'SchedulerPage memeriksa error lewat res.data?.error',
  /body\?\.error/.test(schedulerPage),
);
cek(
  'SchedulerPage memakai err.serverMessage sebagai pesan utama',
  /e\.serverMessage/.test(schedulerPage),
);

// Hitung pemakaian res.data sebagai pembanding.
let pakaiResData = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  pakaiResData += (src.match(/\bres\.data\b/g) || []).length;
}
console.log(`  ℹ️  total pemakaian "res.data" di frontend: ${pakaiResData}`);

// ─── 4. Endpoint template terjadwal ada ───────────────────────────────────────
console.log('\n=== 4. ENDPOINT TEMPLATE JADWAL ===');
const routes = fs.readFileSync(path.join(ROOT, 'server', 'src', 'routes', 'schedulerRoutes.js'), 'utf8');
cek(
  'route GET /api/scheduler/templates terdaftar',
  /router\.get\(\s*'\/templates'/.test(routes),
);

// Route '/templates' harus-SEBELUM route parametrik pada METHOD YANG SAMA
// (GET). Kalau tidak, GET /api/scheduler/templates tertangkap oleh
// GET '/:id' dan dianggap lookup jadwal dengan id = "templates".
const getTemplatesIdx = routes.indexOf("router.get('/templates'");
const getParamIdx = routes.indexOf("router.get('/:id'");
cek(
  "route GET '/templates' didaftarkan SEBELUM GET '/:id'",
  getTemplatesIdx !== -1 && (getParamIdx === -1 || getTemplatesIdx < getParamIdx),
  '(kalau tidak, /templates tertangkap sebagai id)',
);

const templateService = path.join(ROOT, 'server', 'src', 'services', 'schedulerTemplateService.js');
cek('schedulerTemplateService.js ada', fs.existsSync(templateService));

if (fs.existsSync(templateService)) {
  const svc = fs.readFileSync(templateService, 'utf8');
  cek('service punya validasi template', /export\s+function\s+validateScheduleTemplates/.test(svc));
  cek('service punya getter template', /export\s+function\s+getScheduleTemplates/.test(svc));
}

console.log(gagal === 0
  ? '\n✅ SEMUA GUARD PEMAKAIAN RESPONS API LOLOS'
  : `\n❌ HASIL: ${gagal} guard gagal`);
process.exit(gagal === 0 ? 0 : 1);
