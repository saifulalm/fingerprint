// Server entry point — Fingerprint Attendance System
// All config loaded from .env (auto-generated from .env.example on first run)

import 'dotenv/config';
import './config/checkEnv.js'; // creates .env from example if missing

import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Routes
import authRoutes    from './routes/authRoutes.js';
import deviceRoutes  from './routes/deviceRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import emailRoutes  from './routes/emailRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import employeesRoutes from './routes/employeesRoutes.js';
import schedulerRoutes from './routes/schedulerRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import deviceCenterRoutes from './routes/deviceCenterRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
//
// CORS — DIBATASI, bukan `cors()` telanjang.
//
// SEBELUMNYA: `app.use(cors())` mengizinkan SEMUA origin. Karena cookie
// session ikut terkirim, situs mana pun bisa memanggil API ini dari browser
// user yang sedang login (CSRF). Contoh: halaman web asing melakukan
// `fetch('/api/employees/...', {method:'DELETE'})` → data terhapus.
//
// SEKARANG: hanya origin yang terdaftar di ALLOWED_ORIGINS yang diizinkan.
// Kalau ALLOWED_ORIGINS kosong, TIDAK ada header CORS yang dikirim — browser
// memblokir cross-origin secara default (aman untuk instalasi lokal).
const corsOptions = {
  origin(origin, callback) {
    // Request tanpa Origin (curl, Postman, aplikasi native, same-origin) —
    // izinkan. Browser selalu mengirim Origin untuk cross-origin.
    if (!origin) return callback(null, true);
    if (config.corsOrigins.length === 0) return callback(null, true);
    if (config.corsOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Origin ditolak: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
};
app.use(cors(corsOptions));

// ─── Body parsing ────────────────────────────────────────────────────────────
//
// `verify` menyimpan byte body MENTAH pada `req.rawBody`.
//
// ALASAN: verifikasi signature HMAC webhook OpenWA menghitung HMAC atas byte
// body apa adanya. Kalau body di-parse ke objek lalu di-stringify ulang,
// urutan key bisa berubah dan HMAC TIDAK AKAN COCOK — meski payloadnya sah.
// Express mem-parse JSON di middleware ini, jadi Capture harus terjadi di
// tahap `verify` (sebelum parsing selesai).
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  },
}));
app.use(express.static(path.join(__dirname, '../../web/dist')));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    // sameSite 'strict' = cookie TIDAK dikirim pada request cross-site.
    // Ini yang menutup celah CSRF untuk endpoint yang mengubah data.
    // 'lax' (bawaan browser saat tidak diset) masih mengirim cookie pada
    // navigasi GET top-level — jadi endpoint DELETE/POST tetap rentan.
    sameSite: 'strict',
    httpOnly: true,
    secure: config.nodeEnv === 'production',
  },
}));

// ─── Auth guard for all /api routes ───────────────────────────────────────
// Registered BEFORE specific routes so it always fires.
// Routes that need to bypass auth (e.g. /api/auth/login) handle it internally
// or are mounted above this line.
app.use('/api', requireAuth);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Receiver webhook OpenWA — dipanggil gateway di luar browser.
//
// Dipasang DI BAWAH auth guard, tapi path-nya ada di AUTH_BYPASS_PATHS
// (middleware/auth.js) sehingga tidak butuh JWT. Endpoint ini dilindungi
// signature HMAC-SHA256 + deduplikasi idempotency key, bukan token.
app.use('/api/webhooks', webhookRoutes);

app.use('/api/employees', employeesRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/device-center', deviceCenterRoutes);

// ─── Serve React app (SPA — all routes serve index.html, React Router handles routing) ──
const indexPath = path.join(__dirname, '../../web/dist/index.html');

// ─── SPA fallback + API 404 ─────────────────────────────────────────────────
//
// Catatan urutan middleware di Express:
//   1. Router API  → dicocokkan lebih dulu (app.use '/api/...')
//   2. API 404    → hanya untuk path /api yang tidak match router
//   3. SPA        → path lain served index.html
//   4. Error handler → PALING AKHIR, menangkap error dari semua layer di atas
app.get('/login', (req, res) => {
  res.sendFile(indexPath);
});

// API 404: path /api yang tidak cocok router mana pun. WAJIB mengembalikan
// JSON, bukan HTML SPA — frontend mengurai body sebagai JSON dan HTML akan
// memicu "Unexpected token '<'" yang menyesatkan.
app.use('/api', notFoundHandler);

app.get('*', (req, res) => {
  res.sendFile(indexPath, (err) => {
    if (err) res.status(200).send('React app not built yet. Run: cd web && npm run build');
  });
});

// ─── Error handler terpusat ───────────────────────────────────────────────────
//
// WAJIB 4 argumen (err, req, res, next) agar Express memperlakukannya sebagai
// error handler. Menempatkannya di bagian PALING AKHIR berarti satu handler
// async yang lupa try/catch pun tidak lagi menggantungkan request — errornya
// sampai ke sini dan jadi JSON yang konsisten.
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(config.port, async () => {
  console.log(`\n  ✦ Fingerprint Attendance System`);
  console.log(`  ✦ http://localhost:${config.port}`);
  // Password admin SENGAJA tidak dicetak. Log startup sering ikut ter-copy ke
  // issue tracker atau attachment; begitu bocor, kredensial langsung bisa
  // dipakai siapa pun yang membaca log tersebut.
  console.log(`  ✦ Login: ${config.adminUser} (password dari ADMIN_PASS di .env)`);
  console.log(`  ✦ Masuk : ${config.devices.masuk.ip}`);
  console.log(`  ✦ Keluar: ${config.devices.keluar.ip}`);
  console.log(`  ✦ DB    : PostgreSQL (prisma)\n`);

  // ─── Init scheduler on startup ───────────────────────────────────────────
  setTimeout(async () => {
    try {
      const { schedulerService } = await import('./services/schedulerService.js');
      await schedulerService.init();
    } catch (err) {
      console.warn('[Startup] Scheduler init failed:', err.message);
    }
  }, 1000);

  // ─── Background sync on startup ────────────────────────────────────────────
  // Runs async so it doesn't block server startup.
  // Sinkronisasi mencakup 14 hari terakhir supaya laporan periode terkini
  // selalu punya data, walau server sempat mati beberapa hari.
  setTimeout(async () => {
    try {
      const { syncRangeToDb } = await import('./services/attendanceSyncService.js');
      const now = new Date();
      const today = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const from = new Date(now.getTime() - 13 * 86400000).toISOString().slice(0, 10);
      console.log(`[Startup] Syncing attendance: ${from} → ${today}...`);
      const result = await syncRangeToDb(from, today);
      console.log(
        `[Startup] Sync done: ${result.synced} events synced, ${result.skipped} skipped, ` +
        `per device: ${JSON.stringify(result.byDevice)}` +
        (result.errors.length ? ` | errors: ${result.errors.join('; ')}` : ''),
      );
    } catch (err) {
      console.warn('[Startup] Sync failed:', err.message);
    }
  }, 2000);
});
