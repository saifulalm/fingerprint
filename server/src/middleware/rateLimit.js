// Rate limiter sederhana untuk endpoint login.
//
// MASALAH YANG DISELESAIKAN:
//   `POST /api/auth/login` membandingkan username/password dengan string
//   tanpa batas percobaan. Password admin adalah satu-satunya gerbang ke
//   SELURUH API, jadi brute force ke endpoint ini langsung membuka sistem.
//
// Memakai dependency `express-rate-limit` butuh paket baru; versi
// in-memory di bawah cukup untuk instalasi single-process (server absensi
// ini dijalankan sebagai satu proses PM2) dan tidak menambah dependensi.
//
// CATATAN: state di-memory hilang saat restart. Untuk instalasi multi-instance
// atau multi-PM2-cluster, pindahkan ke Redis.
//
// PEMAKAIAN:
//   import { loginRateLimiter } from '../middleware/rateLimit.js';
//   router.post('/login', loginRateLimiter, asyncHandler(login));

// Berapa percobaan login yang boleh gagal dalam satu jendela waktu.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 menit

// Map key → { count, resetAt }
const attempts = new Map();

// Membersihkan entri kedaluwarsa secara berkala supaya Map tidak tumbuh
// tanpa batas (server bisa hidup berbulan-bulan).
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}, WINDOW_MS);
// Jangan menahan proses tetap hidup hanya karena interval ini.
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

function clientKey(req) {
  // Preferensi IP. X-Forwarded-For dipakai hanya bila app benar-benar
  // dijalankan di belakang reverse proxy yang menyetelnya.
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}|${String(req.body?.username || '')}`;
}

/**
 * Middleware express-rate-limit sederhana.
 * Respon 429一旦 memicu, header Retry-After disertakan.
 */
export function loginRateLimiter(req, res, next) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.`,
    });
  }

  // Pasang penanda: res.json di controller dipanggil SETELAH middleware ini,
  // jadi nilai status diambil saat response benar-benar dikirim.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    if (status === 401) {
      // Percobaan gagal → naikkan penghitung.
      const cur = attempts.get(key);
      if (cur && cur.resetAt > now) cur.count += 1;
      else attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    } else if (status < 400) {
      // Login berhasil → reset penghitung.
      attempts.delete(key);
    }
    return originalJson(body);
  };

  next();
}

/**
 * Reset penghitung untuk key tertentu (dipanggil setelah login berhasil).
 */
export function resetLoginAttempts(req) {
  attempts.delete(clientKey(req));
}

/** Jumlah percobaan gagal yang tercatat untuk IP+username tertentu. */
export function loginAttemptCount(req) {
  const entry = attempts.get(clientKey(req));
  if (!entry || entry.resetAt <= Date.now()) return 0;
  return entry.count;
}
