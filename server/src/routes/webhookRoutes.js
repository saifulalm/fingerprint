// ─────────────────────────────────────────────────────────────────────────────
// Webhook routes — endpoint yang DIPANGGIL OLEH OpenWA gateway.
//
// Dipasang SEBELUM auth guard (`app.use('/api', requireAuth)` di index.js),
// karena webhook dipanggil oleh gateway di luar browser — tidak punya JWT.
// Endpoint ini diproteksi dengan signature HMAC, bukan dengan token.
//
// CATATAN SANGAT PENTING SOAL `express.raw()`:
//   Signature HMAC OpenWA dihitung atas BYTE BODY MENTAH yang diterima.
//   Kalau body di-parse ke objek JSON lalu di-stringify ulang, urutan key
//   bisa berubah dan HMAC-nya TIDAK AKAN COCOK — padahal payloadnya sah.
//
//   Express secara default mem-parse `application/json` menjadi objek
//   (`req.body` = object). Karena itu router ini memasang `express.raw()`
//   secara LOKAL untuk path webhook, sehingga `req.body` berupa Buffer.
//   Router lain (/api/whatsapp, /api/auth, ...) tetap memakai express.json()
//   global — tidak ada efek samping di sana.
//
//   `type: '*/*'` dipakai supaya body yang dikirim dengan content-type lain
//   (atau tanpa content-type) tetap terbaca mentah untuk diverifikasi.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import express from 'express';
import { receiveOpenwaWebhook } from '../controllers/webhookController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Body mentah (Buffer) — wajib untuk verifikasi signature HMAC.
const rawBodyParser = express.raw({ type: '*/*', limit: '2mb' });

/**
 * POST /api/webhooks/openwa
 *
 * Menerima event dari OpenWA gateway:
 *   message.received, message.sent, message.ack, session.status, dll.
 *
 * Security: signature HMAC-SHA256 diverifikasi terhadap `X-OpenWA-Signature`.
 * Dedup: `X-OpenWA-Idempotency-Key` (juga ada di body sebagai
 * `idempotencyKey`) dipakai untuk menolak delivery ulang.
 */
router.post('/openwa', rawBodyParser, asyncHandler(receiveOpenwaWebhook));

export default router;
