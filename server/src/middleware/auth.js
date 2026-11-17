// Auth middleware — JWT Bearer token
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config/index.js';

const SECRET = (config.sessionSecret || 'fp-secret-2024') + '-fp-auth';

// Paths that bypass authentication.
//
// PENTING — pencocokan harus PERSIS, bukan prefix.
//
// SEBELUMNYA: `fullPath.startsWith(p + '/')` membuat '/api/auth/login/apa-saja'
// juga lolos auth. Cukup satu route susceptible di masa depan (atau typo)
// untuk membuka jalur tanpa autentikasi.
//
// SEKARANG: hanya path yang persis sama yang lolos. Query string tetap
// diizinkan (mis. '/api/auth/login?next=/dashboard').
const AUTH_BYPASS_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  // Receiver webhook OpenWA — dipanggil oleh gateway, bukan browser.
  // Endpoint ini tidak punya JWT; KEAMANAN-nya berasal dari verifikasi
  // signature HMAC-SHA256 (header X-OpenWA-Signature) plus deduplikasi
  // idempotency key. Tanpa bypass di sini, gateway tidak akan pernah bisa
  // mengirim event.
  '/api/webhooks/openwa',
]);

/**
 * Perbandingan string waktu-tetap (constant-time).
 *
 * `password === config.adminPass` bisa membocorkan informasi lewat timing:
 * proses selesai lebih cepat saat byte pertama berbeda. Untuk nilai
 * rahasia seperti password, itu mempercepat brute force.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  // crypto.timingSafeEqual butuh panjang sama. Kalau panjang berbeda,
  // tetap lakukan perbandingan dummy agar waktu response tidak
  // membocorkan panjang input.
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireAuth(req, res, next) {
  // Use originalUrl to get full path including /api prefix
  const fullPath = req.originalUrl || req.url || req.path;

  // Pisahkan query string — '/api/auth/login?next=x' harus tetap lolos.
  const pathOnly = fullPath.split('?')[0];
  const bypass = AUTH_BYPASS_PATHS.has(pathOnly);

  if (bypass) {
    console.log(`[Auth] Bypass: ${fullPath}`);
    return next();
  }

  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
      console.log(`[Auth] Token OK: ${decoded.username}`);
      return next();
    } catch (err) {
      console.log(`[Auth] Token invalid: ${err.message}`);
      // fall through to 401
    }
  }

  if (req.session && req.session.user) {
    console.log(`[Auth] Session OK: ${req.session.user.username}`);
    return next();
  }

  console.log(`[Auth] Rejected: ${fullPath} (no valid token or session)`);
  
  if (fullPath.startsWith('/api/')) {
    return res.status(401).json({ error: 'Sesi habis, silakan login kembali' });
  }
  res.redirect('/login');
}

/**
 * Bandingkan username/password admin dengan waktu-tetap.
 * Dipakai controller login agar waktu response tidak membocorkan
 * apakah username-nya benar atau hanya passwordnya yang salah.
 */
export function verifyAdminCredentials(username, password) {
  const userOk = safeEqual(username, config.adminUser);
  const passOk = safeEqual(password, config.adminPass);
  // Selalu hitung KEDUA perbandingan (tanpa short-circuit) agar waktu
  // response sama untuk "username salah" dan "password salah".
  return userOk & passOk;
}
