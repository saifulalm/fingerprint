// Guard: Scheduler + Email credential — cegah regresi pada bug yang sudah
// pernah ditemukan.
//
// BUG YANG DICEGAH DI SINI:
//
// 1. Destructure salah nama field (bug produksi).
//    `periodToRange()` mengembalikan `{ start, end }`, tapi `executeSchedule`
//    pernah menulis `const { startDate, endDate } = periodToRange(period)`.
//    Akibatnya startDate/endDate = undefined → Prisma "Invalid Date" →
//    scheduler TIDAK PERNAH bisa mengirim email sejak awal.
//
// 2. Scheduler hanya membaca kredensial dari DB (abaikan .env).
//    Scheduler harus memakai `resolveSmtpConfig()` — satu sumber kebenaran
//    untuk DB (UI Pengaturan) DAN fallback env.
//
// 3. Kegagalan ditelan → dilaporkan sebagai "sukses".
//    `executeSchedule` harus melempar error, dan `trigger()` tidak boleh
//    hardcode `{ success: true }`.
//
// 4. `from` email kosong.
//    Alamat pengirim harus diambil dari konfigurasi SMTP efektif.
//
// 5. Job cron memakai snapshot jadwal lama.
//    Perubahan jadwal dari UI harus berlaku tanpa restart server.
//
// 6. Env wajib yang belum terdokumentasi.
//    `SCHEDULER_ENABLED` harus bisa mematikan scheduler.
//
// 7. `.env.example` harus lengkap & konsisten dengan kode.
//    Semua env yang dibaca kode harus ada di .env.example, dan tidak boleh
//    ada env "mati" (dideklarasikan tapi tidak dibaca kode).
//
// Jalankan: node scripts/check-scheduler-email.mjs [path-repo]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root repo = dua level di atas folder `server/scripts`.
// Argumen CLI (opsional) bisa menimpanya.
const ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', '..');

const SERVER = path.join(ROOT, 'server', 'src');
const SCRIPTS = path.join(ROOT, 'server', 'scripts');

let gagal = 0;
function cek(label, ok, detail = '') {
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

const read = (p) => fs.readFileSync(p, 'utf8');

const schedulerPath = path.join(SERVER, 'services', 'schedulerService.js');
const controllerPath = path.join(SERVER, 'controllers', 'schedulerController.js');
const settingsServicePath = path.join(SERVER, 'services', 'settingsService.js');

const scheduler = read(schedulerPath);
const controller = read(controllerPath);
const settingsService = read(settingsServicePath);

// Blok executeSchedule untuk pemeriksaan yang lebih detail.
//
// CATATAN: batas blok memakai `\n}` TIDAK bisa dipakai — di dalam
// executeSchedule ada banyak `}` (object literal, template literal) sehingga
// blok terpotong di tengah. Karena itu yang dipakai adalah rentang baris
// dari `async function executeSchedule` sampai baris `export const
// schedulerService` (baris penanda akhir bagian publik).
const execStart = scheduler.indexOf('async function executeSchedule');
const execEnd = scheduler.indexOf('export const schedulerService');
const execBlock = execStart !== -1 && execEnd !== -1
  ? scheduler.slice(execStart, execEnd)
  : '';

console.log('=== GUARD 1: Destructure rentang tanggal ===');
// Nama field yang dikembalikan periodToRange.
const periodFn = scheduler.match(/function\s+periodToRange[\s\S]*?\n}/)?.[0] || '';
const returnedKeys = [...periodFn.matchAll(/\b(start|end|startDate|endDate)\s*:/g)].map((m) => m[1]);
const uniqueReturned = [...new Set(returnedKeys)];

cek(
  'periodToRange mengembalikan field "start" & "end"',
  uniqueReturned.includes('start') && uniqueReturned.includes('end'),
  `(ditemukan: ${uniqueReturned.join(', ')})`
);

// Pemakaian di executeSchedule harus konsisten dengan field yang dikembalikan.
//
// CATATAN 1: regex TIDAK boleh memakai `\n}` untuk batas blok, karena di
// dalam executeSchedule ada banyak `}` (object literal, template literal)
// sehingga blok terpotong di tengah.
//
// CATATAN 2: pemeriksaan harus mengabaikan BARIS KOMENTAR. Kode ini
// sengaja mendokumentasikan pola bug yang pernah ada
// (`const { startDate, endDate } = periodToRange(period);`) di dalam
// komentar — kalau komentar ikut diperiksa, guard selalu gagal хотя
// kodenya sudah benar.
//
// CATATAN 3: pola searched harus mengabaikan spasi berlebih di sekitar
// tanda kurung kurawal.
const codeOnly = (src) => src
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*/.test(line) && !/^\s*\/\*/.test(line))
  .join('\n');

const schedulerCode = codeOnly(scheduler);

cek(
  'executeSchedule TIDAK destructure startDate/endDate langsung dari periodToRange',
  !/const\s*\{\s*startDate\s*,\s*endDate\s*\}\s*=\s*periodToRange\s*\(/.test(schedulerCode),
  '(regression: destructure salah nama → Invalid Date)'
);
cek(
  'executeSchedule memakai range.start / range.end',
  /const\s+range\s*=\s*periodToRange\s*\(/.test(schedulerCode) &&
  /const\s+startDate\s*=\s*range\.start/.test(schedulerCode) &&
  /const\s+endDate\s*=\s*range\.end/.test(schedulerCode)
);

console.log('\n=== GUARD 2: Scheduler memakai sumber kebenaran kredensial ===');
cek(
  'schedulerService meng-import resolveSmtpConfig',
  /import\s*\{[^}]*resolveSmtpConfig[^}]*\}\s*from\s*'\.\/settingsService\.js'/.test(scheduler),
);
cek(
  'schedulerService tidak membaca smtp_host langsung dari map DB',
  !/const\s+host\s*=\s*s\.smtp_host/.test(scheduler),
  '(regression: scheduler hanya baca DB, abaikan .env)'
);
cek(
  'getTransporterFromDb memakai resolveSmtpConfig()',
  /async\s+function\s+getTransporterFromDb[\s\S]*?resolveSmtpConfig\(\)/.test(scheduler),
);

console.log('\n=== GUARD 3: Kegagalan tidak ditelan ===');
cek(
  'executeSchedule melempar error (throw err)',
  /throw\s+err;/.test(execBlock),
  '(regression: error ditelan → trigger() selalu success:true)'
);
cek(
  'trigger() mengembalikan hasil nyata, bukan hardcoded success',
  !/await\s+executeSchedule\(schedule\);\s*\n\s*return\s*\{\s*success:\s*true\s*\}/.test(scheduler),
);
cek(
  'trigger() menyertakan informasi kanal terkirim',
  /channels:\s*result\.channels/.test(scheduler),
);
cek(
  'SMTP belum konfigurasi → error (bukan warn lalu lanjut)',
  /throw\s+new\s+Error\(\s*\n?\s*'SMTP belum dikonfigurasi/.test(execBlock),
);
cek(
  'kegagalan "tidak ada penerima" → error',
  /throw\s+new\s+Error\(\s*\n?\s*'Tidak ada penerima laporan/.test(execBlock),
);

console.log('\n=== GUARD 4: Alamat pengirim konsisten ===');
cek(
  'from diambil dari konfigurasi SMTP efektif',
  /const\s+mailFrom\s*=\s*smtp\.from\s*\|\|\s*smtp\.user/.test(execBlock),
);
cek(
  'from kosong → error, bukan kirim email tanpa pengirim',
  /Alamat pengirim email kosong/.test(execBlock),
);

console.log('\n=== GUARD 5: Cron job memakai data terbaru dari DB ===');
cek(
  'callback cron membaca ulang schedule dari DB',
  /cron\.schedule\([^]*?findUnique\(\s*\{\s*where:\s*\{\s*id\s*\}\s*\}\s*\)/.test(scheduler),
  '(regression: job memakai snapshot lama sampai restart)'
);
cek(
  'jadwal yang dimatikan/dihapus dilewati',
  /if\s*\(\s*!fresh\s*\|\|\s*!fresh\.enabled\s*\)/.test(scheduler),
);

console.log('\n=== GUARD 6: Env scheduler ===');
cek(
  'schedulerService membaca SCHEDULER_ENABLED',
  scheduler.includes('SCHEDULER_ENABLED'),
);
cek(
  'nilai env yang menonaktifkan: false/0/no/off',
  /'false',\s*'0',\s*'no',\s*'off'/.test(scheduler),
);

console.log('\n=== GUARD 7: .env.example lengkap & konsisten ===');
const envExamplePath = path.join(ROOT, 'server', '.env.example');
if (!fs.existsSync(envExamplePath)) {
  gagal++;
  console.log('  ❌ server/.env.example tidak ada');
} else {
  const envExample = read(envExamplePath);

  // Semua env yang dibaca kode harus ada di .env.example.
  const serverFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) serverFiles.push(p);
    }
  };
  walk(SERVER);

  const usedEnv = new Set();
  for (const f of serverFiles) {
    for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      usedEnv.add(m[1]);
    }
  }

  // Env yang TIDAK boleh hilang dari .env.example (dipakai untuk fitur inti).
  const REQUIRED = [
    'DATABASE_URL', 'PORT', 'NODE_ENV', 'SESSION_SECRET',
    'ADMIN_USER', 'ADMIN_PASS', 'TZ_OFFSET',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
    'SCHEDULER_ENABLED',
    'REPORT_DEFAULT_LANG', 'REPORT_DEFAULT_RECIPIENTS',
    'ALLOWED_ORIGINS',
    'DEVICE_MASUK_IP', 'DEVICE_MASUK_USER', 'DEVICE_MASUK_PASS',
    'DEVICE_KELUAR_IP', 'DEVICE_KELUAR_USER', 'DEVICE_KELUAR_PASS',
    'WHATSAPP_SESSION_DIR',
  ];

  const missing = REQUIRED.filter((k) => !new RegExp(`^${k}=`, 'm').test(envExample));
  cek(
    `semua ${REQUIRED.length} env wajib ada di .env.example`,
    missing.length === 0,
    missing.length ? `(hilang: ${missing.join(', ')})` : ''
  );

  // Env "mati": ada di .env.example tapi tidak dibaca kode mana pun.
  // (env yang dikomentari di example tetap dihitung — hanya yang aktif.)
  const declaredActive = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  const dead = declaredActive.filter((k) => !usedEnv.has(k));
  cek(
    'tidak ada env aktif yang tidak dibaca kode (dead env)',
    dead.length === 0,
    dead.length ? `(mati: ${dead.join(', ')})` : ''
  );

  // Env yang dibaca kode tapi TIDAK ada di .env.example → dokumentasi kurang.
  const undocumented = [...usedEnv].filter((k) => !declaredActive.includes(k));
  const ALLOWED_COMMENTED = [
    'CHROME_PATH', 'WA_GATEWAY_URL', 'WA_GATEWAY_API_KEY', 'WA_GATEWAY_KEY',
    'WA_GATEWAY_SESSION', 'WA_GATEWAY_TYPE',
  ];
  const trulyUndocumented = undocumented.filter((k) => !ALLOWED_COMMENTED.includes(k));
  cek(
    'semua env yang dibaca kode terdokumentasi di .env.example',
    trulyUndocumented.length === 0,
    trulyUndocumented.length ? `(tak terdokumentasi: ${trulyUndocumented.join(', ')})` : ''
  );

  // Inkonsistensi nama env gateway: kode memakai WA_GATEWAY_KEY, example
  // sebelumnya menulis WA_GATEWAY_API_KEY (nama berbeda).
  cek(
    'nama env gateway konsisten (WA_GATEWAY_KEY dipakai kode)',
    usedEnv.has('WA_GATEWAY_KEY') && envExample.includes('WA_GATEWAY_KEY'),
  );
}

console.log('\n=== GUARD 8: Skrip uji & mock SMTP tersedia ===');
const testPath = path.join(SCRIPTS, 'test-scheduler-email.mjs');
const mockPath = path.join(SCRIPTS, 'mock-smtp-server.mjs');
const localPath = path.join(SCRIPTS, 'test-email-local.mjs');
cek('scripts/test-scheduler-email.mjs ada', fs.existsSync(testPath));
cek('scripts/mock-smtp-server.mjs ada', fs.existsSync(mockPath));
cek('scripts/test-email-local.mjs ada', fs.existsSync(localPath));

if (fs.existsSync(testPath)) {
  const t = read(testPath);
  cek('test memverifikasi email benar-benar diterima (bukan hanya "no error")',
    /mock\.messages\.length/.test(t) && /email diterima mock SMTP/.test(t));
  cek('test memverifikasi kegagalan tidak dilaporkan sukses',
    /tanpa penerima → error dilempar/.test(t) && /SMTP kosong → error dilempar/.test(t));
  cek('test mengembalikan data ke kondisi semula',
    /restoreSettings/.test(t) && /cleanupSchedules/.test(t));
}

const pkg = JSON.parse(read(path.join(ROOT, 'server', 'package.json')));
cek('npm script "test:scheduler" ada', !!pkg.scripts['test:scheduler']);
cek('npm script "test:email" ada', !!pkg.scripts['test:email']);
cek('npm script "test:smtp" ada', !!pkg.scripts['test:smtp']);

console.log('\n=== GUARD 9: Controller trigger melapor status akurat ===');
// Catatan: pola `status\(404\)` TIDAK boleh memakai regex literal dengan
// karakter `/` di dalamnya tanpa escape, karena teks sumber memuat
// `res.status(404)` (bukan `res.status(/404/)`).
cek(
  'triggerSchedule membedakan 404 / 502 / 500',
  controller.includes('status(404)') && controller.includes('status(502)') && controller.includes('status(500)'),
);

console.log('\n=== GUARD 10: Settings service tetap menjadi sumber kebenaran ===');
cek(
  'resolveSmtpConfig ada di settingsService',
  /export\s+async\s+function\s+resolveSmtpConfig/.test(settingsService),
);
cek(
  'resolveSmtpConfig jatuh ke env bila DB tidak lengkap',
  /config\.smtp/.test(settingsService),
);

console.log(gagal === 0
  ? '\n✅ SEMUA GUARD SCHEDULER + EMAIL LOLOS'
  : `\n❌ HASIL: ${gagal} guard gagal`);
process.exit(gagal === 0 ? 0 : 1);
