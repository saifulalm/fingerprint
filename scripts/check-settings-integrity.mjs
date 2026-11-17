// Guard: nilai settings harus dinormalisasi ke string, dan field yang
// ditampilkan di UI harus benar-benar dibaca server.
//
// Bug class 50: kolom SystemSetting.value bertipe String. Boolean dari
// checkbox frontend membuat Prisma melempar error dan PUT /api/settings
// membalas HTTP 500.
//
// Bug class 53: field yang dirender UI tapi tidak dibaca server = field mati.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '.';
const SERVER = path.join(ROOT, 'server', 'src');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// ─── 1. Semua nilai settings dinormalisasi ke string ──────────────────────────
const settingsService = path.join(SERVER, 'services', 'settingsService.js');
const svc = readFileSync(settingsService, 'utf8');
const hasNormalize = /function normalizeSettingValue/.test(svc);
const hasBooleanMap = /value \? 'true' : 'false'/.test(svc);

let failed = 0;
if (!hasNormalize || !hasBooleanMap) {
  failed = 1;
  console.log(
    `FAIL  settingsService.js tidak menormalisasi nilai boolean ke string 'true'/'false'` +
    `\n      normalizeSettingValue: ${hasNormalize} | boolean mapping: ${hasBooleanMap}`,
  );
} else {
  console.log('PASS  settingsService.js menormalisasi boolean → string');
}

// Controller settingsController tidak boleh menulis nilai mentah ke Prisma.
const ctrl = readFileSync(path.join(SERVER, 'controllers', 'settingsController.js'), 'utf8');
if (/prisma\.systemSetting\.upsert/.test(ctrl)) {
  failed = 1;
  console.log('FAIL  settingsController.js menulis langsung ke prisma.systemSetting — harus lewat saveSettings()');
} else {
  console.log('PASS  settingsController.js memakai saveSettings()');
}

// ─── 2. Field UI harus dibaca server ───────────────────────────────────────────
const panel = readFileSync(path.join(ROOT, 'web', 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
const uiKeys = new Set([...panel.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]));

const serverFiles = walk(SERVER);
const serverSrc = serverFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// Key yang memang hanya relevan di sisi server / definisi saja.
const IGNORE = new Set(['email', 'whatsapp', 'general']);

const dead = [];
for (const key of uiKeys) {
  if (IGNORE.has(key)) continue;
  // Hitung kemunculan DI LUAR settingsController ( tempat pemakaian nyata).
  const hits = serverFiles.filter((f) => {
    if (f.endsWith('settingsController.js')) return false;
    if (f.endsWith('settingsService.js')) return false;
    return readFileSync(f, 'utf8').includes(key);
  });
  if (hits.length === 0) dead.push(key);
}

if (dead.length) {
  failed = 1;
  console.log(`FAIL  field UI tanpa pemakaian server (field mati): ${dead.join(', ')}`);
} else {
  console.log(`PASS  semua ${uiKeys.size - IGNORE.size} field UI dipakai di server`);
}

// ─── 3. Tidak ada menit 60 pada format waktu ───────────────────────────────────
const analytics = readFileSync(path.join(SERVER, 'services', 'attendanceAnalyticsService.js'), 'utf8');
if (/Math\.round\(mins % 60\)/.test(analytics)) {
  failed = 1;
  console.log('FAIL  format waktu memakai Math.round(mins % 60) — bisa menghasilkan menit 60');
} else {
  console.log('PASS  format waktu tidak menghasilkan menit 60');
}

// ─── 4. Nilai rahasia tidak boleh bocor ke frontend ───────────────────────────
//
// Bug class 54: `wa_gateway_url` (berisi token API sebagai query param) dan
// `smtp_pass` dikirim apa adanya ke browser. Akibatnya token terlihat di
// form, bisa di-screenshot, dan bocor lewat log DevTools.
//
// Invariant yang dijaga di sini:
//   a) SECRET_SETTING_KEYS memuat kedua field itu.
//   b) GET /api/settings memakai stripSecrets() (nilai dikosongkan) DAN
//      maskSecrets() (versi tersamar) — bukan nilai mentah.
//   c) saveSettings() MENGAWAL nilai kosong: string kosong berarti
//      "tidak diubah", bukan "hapus".
//   d) Frontend menghapus field rahasia kosong dari payload saat Save.
const SECRET_EXPECTED = ['smtp_pass', 'wa_gateway_url'];

const secretSet = svc.match(/SECRET_SETTING_KEYS\s*=\s*new Set\(\[([^\]]*)\]/);
const declaredSecrets = secretSet
  ? [...secretSet[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];

const missingSecrets = SECRET_EXPECTED.filter((k) => !declaredSecrets.includes(k));
if (missingSecrets.length) {
  failed = 1;
  console.log(`FAIL  SECRET_SETTING_KEYS tidak memuat: ${missingSecrets.join(', ')}`);
} else {
  console.log(`PASS  SECRET_SETTING_KEYS memuat ${SECRET_EXPECTED.join(', ')}`);
}

// GET /api/settings harus memakai stripSecrets + maskSecrets.
const getBlock = ctrl.match(/export async function getSettings[\s\S]*?\n}/);
const getSrc = getBlock ? getBlock[0] : '';
if (!/stripSecrets\(/.test(getSrc) || !/maskSecrets\(/.test(getSrc)) {
  failed = 1;
  console.log('FAIL  getSettings() tidak memakai stripSecrets()+maskSecrets() — nilai rahasia bisa bocor');
} else {
  console.log('PASS  getSettings() menyembunyikan + menyamarkan nilai rahasia');
}

// Nilai rahasia kosong harus di-skip saat disimpan (defense in depth).
const saveBlock = svc.match(/export async function saveSettings[\s\S]*?\n}/);
const saveSrc = saveBlock ? saveBlock[0] : '';
if (!/SECRET_SETTING_KEYS\.has\(key\)/.test(saveSrc) || !/if \(!normalized\) continue;/.test(saveSrc)) {
  failed = 1;
  console.log('FAIL  saveSettings() tidak menahan nilai rahasia kosong — nilai lama bisa tertimpa');
} else {
  console.log('PASS  saveSettings() menahan nilai rahasia kosong (tidak menimpa nilai lama)');
}

// Frontend: field rahasia kosong harus dihapus dari payload.
if (!/SECRET_FIELDS/.test(panel) || !/delete payload\[key\]/.test(panel)) {
  failed = 1;
  console.log('FAIL  SettingsPanel.jsx tidak menghapus field rahasia kosong dari payload');
} else {
  console.log('PASS  SettingsPanel.jsx menghapus field rahasia kosong dari payload');
}

// ─── 5. SSRF guard untuk URL gateway ──────────────────────────────────────────
//
// Bug class 55: URL gateway berasal dari input user lalu di-fetch() oleh
// server. Tanpa validasi, user bisa menyimpan `http://169.254.169.254/...`
// (metadata cloud) atau `http://127.0.0.1:6601/...` (loopback).
const urlGuardPath = path.join(SERVER, 'utils', 'urlGuard.js');
if (!existsSync(urlGuardPath)) {
  failed = 1;
  console.log('FAIL  server/src/utils/urlGuard.js tidak ada — proteksi SSRF hilang');
} else {
  const guard = readFileSync(urlGuardPath, 'utf8');
  const guardOk =
    /export function validateGatewayUrl/.test(guard) &&
    /169 && b === 254/.test(guard) &&   // metadata cloud
    /a === 127/.test(guard) &&          // loopback
    /a === 10/.test(guard) &&           // private 10/8
    /a === 192 && b === 168/.test(guard) && // private 192.168/16
    /ALLOWED_SCHEMES/.test(guard);

  if (!guardOk) {
    failed = 1;
    console.log('FAIL  urlGuard.js tidak memblokir host internal / skema berbahaya');
  } else {
    console.log('PASS  urlGuard.js memblokir loopback, jaringan privat, dan metadata cloud');
  }

  // saveSettings() harus memvalidasi URL gateway sebelum disimpan.
  if (!/validateGatewayUrl/.test(saveSrc)) {
    failed = 1;
    console.log('FAIL  saveSettings() tidak memvalidasi wa_gateway_url terhadap SSRF');
  } else {
    console.log('PASS  saveSettings() memvalidasi wa_gateway_url terhadap SSRF');
  }

  // Pesan error ke user tidak boleh memuat token mentah.
  if (!/maskSensitiveUrl/.test(svc) && !/maskSensitiveUrl/.test(serverSrc)) {
    failed = 1;
    console.log('FAIL  nilai gateway tidak pernah disamarkan — token bisa bocor lewat error/log');
  } else {
    console.log('PASS  nilai gateway disamarkan di output');
  }
}

// ─── 6. URL gateway per-jadwal tidak boleh bocor ──────────────────────────────
//
// Bug class 56: `ReportSchedule.waGatewayUrl` bisa memuat token API gateway
// sebagai query param. Field itu dikirim apa adanya di response
// POST/PUT/GET /api/scheduler → token tampil di kolom form Jadwal.
//
// Invariant: semua response schedule melewati `sanitizeSchedule()` yang
// mengosongkan nilai asli dan menyertakan versi tersamar.
const schedulerCtrlPath = path.join(SERVER, 'controllers', 'schedulerController.js');
if (!existsSync(schedulerCtrlPath)) {
  failed = 1;
  console.log('FAIL  server/src/controllers/schedulerController.js tidak ada');
} else {
  const schedCtrl = readFileSync(schedulerCtrlPath, 'utf8');

  if (!/function sanitizeSchedule/.test(schedCtrl)) {
    failed = 1;
    console.log('FAIL  schedulerController.js tidak punya sanitizeSchedule()');
  } else {
    console.log('PASS  schedulerController.js punya sanitizeSchedule()');
  }

  // Setiap response schedule harus melewati sanitizer.
  //
  // Regex sengaja longgar: yang dicari adalah setiap `res.json(...)`/
  // `res.status(N).json(...)` yang argumennya Berasal dari data schedule
  // (schedules / schedule / updated). Kalau argumen itu TIDAP memuat
  // `sanitizeSchedule`, berarti ada jalur yang mengirim nilai mentah.
  const schedResponses = [
    ...schedCtrl.matchAll(/res\.(?:json|status\(\d+\)\.json)\(([^;]*?)\);/g),
  ].map((m) => m[1]);

  const SCHEDULE_DATA = /\b(schedules|schedule|updated)\b/;
  const scheduleResponses = schedResponses.filter((arg) => SCHEDULE_DATA.test(arg));
  const unsanitized = scheduleResponses.filter((arg) => !/sanitizeSchedule/.test(arg));

  if (scheduleResponses.length < 4 || unsanitized.length) {
    failed = 1;
    console.log(
      `FAIL  response schedule ada yang TIDAK disanitasi (${unsanitized.length} dari ${scheduleResponses.length})` +
      (unsanitized.length ? `\n     Missed: ${unsanitized.map((a) => a.trim()).join(' | ')}` : ''),
    );
  } else {
    console.log(`PASS  semua ${scheduleResponses.length} response schedule disanitasi`);
  }

  // Nilai gateway kosong pada update berarti "tidak diubah".
  if (!/delete validated\.data\.waGatewayUrl/.test(schedCtrl)) {
    failed = 1;
    console.log('FAIL  waGatewayUrl kosong pada update akan menimpa nilai lama');
  } else {
    console.log('PASS  waGatewayUrl kosong pada update berarti "tidak diubah"');
  }

  // Frontend: form Jadwal tidak boleh mengisi ulang nilai gateway asli.
  const schedPage = path.join(ROOT, 'web', 'src', 'pages', 'SchedulerPage.jsx');
  if (!existsSync(schedPage)) {
    failed = 1;
    console.log('FAIL  web/src/pages/SchedulerPage.jsx tidak ada');
  } else {
    const schedSrc = readFileSync(schedPage, 'utf8');
    if (/waGatewayUrl:\s*edit\.waGatewayUrl/.test(schedSrc)) {
      failed = 1;
      console.log('FAIL  SchedulerPage.jsx mengisi form dari nilai gateway mentah server');
    } else {
      console.log('PASS  SchedulerPage.jsx tidak mengisi form dari nilai gateway mentah');
    }
    if (!/delete payload\.waGatewayUrl/.test(schedSrc)) {
      failed = 1;
      console.log('FAIL  SchedulerPage.jsx mengirim gateway kosong yang bisa menimpa nilai lama');
    } else {
      console.log('PASS  SchedulerPage.jsx menghapus gateway kosong dari payload');
    }
  }
}

console.log(failed ? '\nGAGAL: guard settings gagal' : '\nSEMUA GUARD SETTINGS LOLOS');
process.exit(failed);
