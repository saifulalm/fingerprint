// Error middleware terpusat — titik tunggal untuk mengubah error apa pun
// menjadi respons HTTP yang CONSISTEN dan pesan yang bisa dipahami user.
//
// MASALAH YANG DISELESAIKAN:
//   1. Express 4 TIDAK menangkap rejected promise dari handler async.
//      Contoh: `router.get('/x', async (req, res) => { await boom(); })`
//      tanpa try/catch → promise ditolak, request menggantung tanpa respons,
//      client akhirnya timeout dengan pesan "Network Error" yang tidak
//      informatif. Tanpa middleware ini, satu handler yang lupa try/catch
//      bisa menggantungkan seluruh halaman.
//   2. Setiap controller punya bentuk error sendiri: sebagian `{ error }`,
//      sebagian `{ success: false, error }`, sebagian `{ data, error }`.
//      Frontend harus 처리 beberapa bentuk sekaligus — sumber bug
//      "pesan error kosong di layar".
//
// ATURAN PENGGUNAAN:
//   - Controller tetap boleh memakai try/catch sendiri untuk kasus yang
//     perlu pesan spesifik (mis. "Nomor 5 tidak ada di perangkat Keluar").
//   - Untuk semua error lain, cukup LETAKKAN error di `err.status` lalu
//     `throw err`; middleware ini yang merapikan responsnya.
//   - Jangan pernah membalas 200 di dalam catch lalu membuang error-nya:
//     itu membuat UI menampilkan "sukses" padahal operasi gagal.
import { config } from '../config/index.js';

/**
 * Normalisasi error menjadi bentuk seragam.
 * @param {unknown} err error asli
 * @returns {{status: number, message: string, code?: string, details?: unknown}}
 */
export function normalizeError(err) {
  // Error dari `throw new Error('...')` pada controller device-center
  // sudah membawa status eksplisit (400/404).
  const status =
    Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599
      ? err.status
      : 500;

  // Pesan dari server internal (umumnya Bahasa Indonesia) boleh tampil apa
  // adanya. Error dari library (axios, prisma, dsb) Often berbahasa Inggris
  // dan teknis — itu TIDAK berguna untuk user, jadi digantikan pesan umum.
  const raw = String(err?.message || '').trim();
  const isInternal =
    status >= 500 ||
    /^(PrismaClient|Request failed with status|connect |ECONN|timeout)/i.test(raw) ||
    raw.includes('at ') === false && /^[A-Z][a-z]+[A-Z]/.test(raw);

  const messages = {
    400: 'Permintaan tidak valid. Periksa kembali data yang Anda masukkan.',
    401: 'Sesi habis, silakan login kembali.',
    403: 'Anda tidak punya izin untuk tindakan ini.',
    404: 'Data yang diminta tidak ditemukan.',
    409: 'Data sudah ada / bentrok dengan data yang ada.',
    422: 'Data tidak dapat diproses. Periksa kembali isian Anda.',
    429: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
    500: 'Terjadi kesalahan di server. Silakan coba beberapa saat lagi.',
    502: 'Server perangkat tidak merespons. Periksa koneksi jaringan.',
    503: 'Layanan sedang tidak tersedia. Coba lagi sebentar.',
    504: 'Server perangkat terlalu lama merespons. Periksa koneksi jaringan.',
  };

  let message = raw;
  if (status >= 500) {
    message = messages[500];
  } else if (!raw || messages[status]) {
    // Pesan spesifik dari controller (400/404) diutamakan, tapi pesan
    // default per-kode dipakai bila controller tidak memberi teks.
    message = raw || messages[status] || 'Permintaan gagal diproses.';
  }

  return {
    status,
    message,
    code: err?.code || undefined,
    details: config.nodeEnv === 'production' ? undefined : err?.details,
  };
}

/**
 * Error handler 4-argumen. WAJIB 4 argumen agar Express memperlakukannya
 * sebagai error handler, bukan middleware biasa.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // Respons sudah terkirim — tidak boleh menulis ulang body.
    return next(err);
  }

  const { status, message, code, details } = normalizeError(err);

  if (status >= 500) {
    console.error(`[Error] ${req.method} ${req.originalUrl} -> ${status}:`, err);
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Handler 404 untuk route API yang tidak cocok dengan path mana pun.
 * Harus dipasang SETELAH semua router, sebelum error handler.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
}
