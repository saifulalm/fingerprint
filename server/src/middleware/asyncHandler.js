// asyncHandler — pembungkus handler async Express.
//
// MASALAH YANG DISELESAIKAN:
//   Express 4 tidak menangkap rejected promise. Handler seperti
//     router.get('/x', async (req, res) => { await boom(); })
//   tanpa try/catch menghasilkan UNHANDLED REJECTION: request tidak pernah
//   dijawab, socket menggantung, dan frontend akhirnya menampilkan
//   "Network Error" atau "timeout" — tanpa memberi tahu request MANA yang gagal.
//
//   Dengan membungkus SEMUA handler async di asyncHandler, rejection
//   diteruskan ke error handler terpusat (middleware/errorHandler.js) yang
//   mengubahnya menjadi JSON yang konsisten.
//
// CARA PAKAI (di routes/*.js):
//   import { asyncHandler } from '../middleware/asyncHandler.js';
//   router.get('/overview', asyncHandler(getCenterOverview));
//
// CATATAN: controller yang sudah punya try/catch sendiri TETAP aman —
// wrapper hanya menangkap apa pun yang lolos ke luar.
import { errorHandler } from './errorHandler.js';

/**
 * Bungkus handler async agar error-nya selalu sampai ke error handler.
 * @param {Function} fn handler async (req, res, next)
 * @returns {Function} handler yang aman dari unhandled rejection
 */
export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    try {
      const result = fn(req, res, next);
      // Handler boleh berupa async (mengembalikan promise) atau sinkron.
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
    } catch (err) {
      // Error sinkron juga diteruskan ke error handler.
      next(err);
    }
  };
}

/**
 * Cara singkat yang sekaligus Merapikan respons: success/error JSON seragam.
 * Dipakai controller baru agar tidak perlu mengulangi pola try/catch.
 *
 * @param {Function} fn async (req, res) => payload
 * @param {{status?: number}} [opts] status sukses
 */
export function handler(fn, opts = {}) {
  const ok = opts.status || 200;
  return asyncHandler(async (req, res) => {
    const payload = await fn(req, res);
    if (res.headersSent) return;
    res.status(ok).json({ success: true, data: payload });
  });
}

export { errorHandler };
