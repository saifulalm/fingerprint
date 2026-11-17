// Settings service — satu-satunya sumber kebenaran untuk pengaturan sistem.
//
// Modul ini diekstrak dari `controllers/settingsController.js` supaya bisa
// dipakai oleh controller lain (report, scheduler, whatsapp) tanpa membuat
// circular import.
//
// CATATAN PENTING (bug class 50):
//   - Kolom `SystemSetting.value` bertipe String di Prisma. Nilai boolean
//     HARUS disimpan sebagai string 'true'/'false' — bukan boolean, bukan
//     'on'/'1'. Kalau boolean diteruskan apa adanya, Prisma melempar
//     "Expected String or Null, provided Boolean" dan PUT /api/settings
//     membalas HTTP 500.
//   - Nilai yang dibaca dari DB SELALU string, sehingga perbandingan
//     boolean harus lewat `settingBool()`, bukan `=== true`.
import prisma from '../db.js';
import { config } from '../config/index.js';
import { maskSensitiveUrl, validateGatewayUrl } from '../utils/urlGuard.js';

// Kunci rahasia: tidak boleh dikirim balik ke frontend.
//
// `wa_gateway_url` juga termasuk rahasia karena format gateway WhatsApp
// (Fonnte/WaBlas) putting token API sebagai query param:
//   https://fonnte.com/api/send?token=SECRET
// URL itu dikembalikan apa adanya ke browser → token bocor ke devtools,
// screenshot, dan proxy log.
//
// Perilaku yang disamakan dengan `smtp_pass`:
//   - Dibaca  → selalu string KOSONG (frontend menampilkan kolom kosong
//               plus penanda "sudah dikonfigurasi").
//   - Ditulis→ string kosong berarti "JANGAN diubah" (nilai lama di DB
//               tetap utuh). Nilai baru hanya bisa masuk lewat form.
//
// Kenapa bukan DISAMAR (mask)? Karena frontend menyimpan ulang payload
// apa adanya saat Save. Kalau server mengirim `?token=••••••`, payload
// itu akan menimpa URL asli dengan nilai yang sudah rusak.
export const SECRET_SETTING_KEYS = new Set(['smtp_pass', 'wa_gateway_url']);

// Kunci yang nilainya berupa URL gateway. Dipakai untuk membuat masker
// tampilan (nilai yang sudah tersimpan ditampilkan tersamar, BUKAN
// dikosongkan — supaya user bisa tahu gateway mana yang aktif).
const URL_SETTING_KEYS = new Set(['wa_gateway_url']);

/**
 * Normalisasi satu nilai settings menjadi string (atau null).
 * Boolean → 'true'/'false', number → string, objek/array → null.
 */
export function normalizeSettingValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') return value;
  return null;
}

/**
 * Baca seluruh settings dari DB sebagai objek { key: value }.
 * Semua nilai berupa string.
 */
export async function loadSettingsMap() {
  const rows = await prisma.systemSetting.findMany();
  const map = {};
  for (const r of rows) {
    const v = normalizeSettingValue(r.value);
    if (v !== null) map[r.id] = v;
  }
  return map;
}

/**
 * Ambil nilai setting sebagai boolean.
 * Nilai DB berupa string 'true'/'false'; seeded fallback boleh boolean.
 */
export function settingBool(map, key, fallback = false) {
  const v = map?.[key];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

/**
 * Ambil nilai setting sebagai integer.
 */
export function settingInt(map, key, fallback = 0) {
  const v = map?.[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Ambil nilai setting sebagai string, dengan fallback bila kosong.
 */
export function settingStr(map, key, fallback = '') {
  const v = map?.[key];
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

/**
 * Salin map settings tanpa nilai rahasia (untuk dikirim ke frontend).
 *
 * Nilai rahasia dikosongkan (string kosong) — frontend menampilkan kolom
 * kosong dan TIDAK mengirim ulang field itu saat Save (payload dihapus
 * di sisi klien), sehingga nilai lama di DB tidak tertimpa.
 *
 * Gunakan `maskSecrets()` bila nilai perlu TAMPIL tapi dalam bentuk
 * tersamar (mis. info gateway aktif di UI).
 */
export function stripSecrets(map) {
  const out = { ...map };
  for (const key of SECRET_SETTING_KEYS) {
    if (key in out) out[key] = '';
  }
  return out;
}

/**
 * Versi TERSAMAR dari nilai rahasia, untuk ditampilkan ke user.
 * Nilai url → host+path dengan query param dibullet-kan.
 * Nilai lainnya → indikator "sudah dikonfigurasi".
 */
export function maskSecrets(map) {
  const out = { ...map };
  for (const key of SECRET_SETTING_KEYS) {
    if (!(key in out)) continue;
    const v = String(out[key] || '');
    if (!v) { out[key] = ''; continue; }
    out[key] = URL_SETTING_KEYS.has(key) ? maskSensitiveUrl(v) : '••••••';
  }
  return out;
}

/**
 * Daftar kunci rahasia yang SUDAH terisi di DB.
 *
 * Frontend memakainya untuk menampilkan penanda "sudah dikonfigurasi"
 * di samping kolom kosong — supaya user tahu password lama masih aktif
 * tanpa pernah melihat nilainya.
 *
 * @param {Record<string,string>} map
 * @returns {Record<string, boolean>}
 */
export function configuredSecretFlags(map) {
  const flags = {};
  for (const key of SECRET_SETTING_KEYS) {
    flags[key] = !!String(map?.[key] || '').trim();
  }
  return flags;
}

/**
 * Ambil URL gateway WhatsApp yang efektif.
 *
 * PRIORITAS:
 *   1. Setting `wa_gateway_url` (diisi lewat UI Pengaturan) — inilah
 *      alasan field ini ADA di form.
 *   2. Env `WA_GATEWAY_URL` — fallback untuk instalasi yang hanya
 *      dikonfigurasi lewat .env.
 *
 * SEBELUMNYA: `services/whatsapp.js` membaca env SAJA, sehingga URL yang
 * disimpan lewat Pengaturan TIDAK PERNAH dipakai — field UI itu mati.
 * Fungsi ini menjadi sumber kebenaran tunggal; semua konsumen
 * (whatsapp service, webhook client, scheduler) memanggilnya.
 *
 * @param {Record<string,string>} [map] map settings (diambil otomatis bila dikosongkan)
 * @returns {Promise<string>} URL tanpa trailing slash, atau '' bila tidak ada
 */
export async function resolveGatewayUrl(map = null) {
  let m = map;
  if (!m) {
    m = await loadSettingsMap().catch(() => ({}));
  }
  const fromSetting = String(m.wa_gateway_url || '').trim();
  const fromEnv = String(process.env.WA_GATEWAY_URL || '').trim();
  const chosen = fromSetting || fromEnv;
  return chosen ? chosen.replace(/\/$/, '') : '';
}

/**
 * Ambil konfigurasi SMTP efektif (dari DB, dengan fallback ke env).
 *
 * SEBELUMNYA: `reportController.buildTransporter()` dan `emailController`
 * membaca `config.smtp` (env SAJA). Jadi setting SMTP yang diisi lewat
 * UI Pengaturan TIDAK BERPAKTIU untuk pengiriman laporan — user mengisi
 * form, melihat "tersimpan", tapi email tetap dikirim lewat .env.
 *
 * @param {Record<string,string>} [map] map settings (diambil otomatis bila dikosongkan)
 * @returns {Promise<{host:string,port:number,secure:boolean,user:string,pass:string,from:string,configured:boolean}>}
 */
export async function resolveSmtpConfig(map = null) {
  let m = map;
  if (!m) {
    m = await loadSettingsMap().catch(() => ({}));
  }
  const host = settingStr(m, 'smtp_host', '').trim();
  const user = settingStr(m, 'smtp_user', '').trim();
  const pass = String(m.smtp_pass || '');
  const port = settingInt(m, 'smtp_port', 587) || 587;
  const secure = settingBool(m, 'smtp_secure', false);
  const from = settingStr(m, 'smtp_from', '').trim() || user;

  // Tidak lengkap di DB → pakai env sebagai fallback.
  if (!host || !user || !pass) {
    const envSmtp = config.smtp;
    return {
      host: envSmtp.host, port: envSmtp.port, secure: envSmtp.secure,
      user: envSmtp.user, pass: envSmtp.pass, from: envSmtp.from,
      configured: !!(envSmtp.host && envSmtp.user && envSmtp.pass),
    };
  }

  return { host, port, secure, user, pass, from, configured: true };
}

/**
 * Simpan banyak setting sekaligus (semua nilai dinormalisasi ke string).
 * @param {Record<string, unknown>} updates
 */
export async function saveSettings(updates = {}) {
  for (const [key, rawValue] of Object.entries(updates)) {
    // Nilai rahasia kosong berarti "tidak diubah" — frontend tidak pernah
    // menerima sandi lama, jadi string kosong tidak boleh menimpanya.
    if (SECRET_SETTING_KEYS.has(key)) {
      const normalized = normalizeSettingValue(rawValue);
      if (!normalized) continue;

      // URL gateway divalidasi terhadap SSRF SEBELUM disimpan. Tanpa ini,
      // user bisa menyimpan `http://169.254.169.254/...` dan scheduler
      // akan melakukan POST ke metadata cloud.
      if (key === 'wa_gateway_url') {
        const check = validateGatewayUrl(normalized, [process.env.WA_GATEWAY_URL || '']);
        if (!check.ok) {
          const err = new Error(check.reason);
          err.status = 400;
          throw err;
        }
      }

      await prisma.systemSetting.upsert({
        where: { id: key },
        create: { id: key, value: normalized },
        update: { value: normalized },
      });
      continue;
    }

    const value = normalizeSettingValue(rawValue);
    await prisma.systemSetting.upsert({
      where: { id: key },
      create: { id: key, value },
      update: { value },
    });
  }
  return loadSettingsMap();
}
