// Server configuration — loaded from .env
//
// KEAMANAN — secret bawaan (fallback):
//   `sessionSecret` dipakai menandatangani JWT dan cookie session. Bila
//   fallback bawaan dibiarkan aktif di produksi, SIAPAPUN yang membaca
//   source code ini bisa menandatangani token valid miliknya sendiri dan
//   mengambil alih seluruh API. Jadi di production, server WAJIB gagal
//   start bila SESSION_SECRET tidak di-set.
//
//   Di development, fallback dipakai acak per-proses supaya `npm run dev`
//   langsung jalan tanpa setup — token tidak lagi berlaku lintas restart.
import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

// Secret acak per-proses untuk development. Tidak persisten, tapi cukup:
// token tetap valid selama server hidup.
const DEV_FALLBACK_SECRET = `fp-dev-${crypto.randomBytes(24).toString('hex')}`;

function resolveSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  if (isProd) {
    // Fail-fast: lebih baik server tidak start daripada berjalan dengan
    // secret yang bisa ditebak.
    console.error(
      '\n[FATAL] SESSION_SECRET wajib diisi saat NODE_ENV=production.\n' +
      '        Generate dengan: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
    );
    process.exit(1);
  }
  return DEV_FALLBACK_SECRET;
}

// Origin yang boleh memanggil API. Kosong = tanpa header
// Access-Control-Allow-Origin, jadi browser memblokir cross-origin (aman).
function resolveCorsOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: parseInt(process.env.PORT || '6601', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: resolveSessionSecret(),
  corsOrigins: resolveCorsOrigins(),
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'admin123',
  tzOffset: process.env.TZ_OFFSET || '+07:00',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  devices: {
    masuk: {
      ip: process.env.DEVICE_MASUK_IP || '192.168.89.241',
      username: process.env.DEVICE_MASUK_USER || 'admin',
      password: process.env.DEVICE_MASUK_PASS || 'Hikvision12',
      label: 'Fingerprint Masuk',
      type: 'masuk',
      direction: 'Masuk',
    },
    keluar: {
      ip: process.env.DEVICE_KELUAR_IP || '192.168.89.240',
      username: process.env.DEVICE_KELUAR_USER || 'admin',
      password: process.env.DEVICE_KELUAR_PASS || 'Hikvision12',
      label: 'Fingerprint Keluar',
      type: 'keluar',
      direction: 'Keluar',
    },
  },
};
