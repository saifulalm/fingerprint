import { Router } from 'express';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
  sendWhatsAppMessage,
  getWhatsAppQR,
  resetWhatsAppSession,
} from '../controllers/whatsappController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

import {
  registerWebhook,
  getWebhooks,
  getEventCatalog,
  getWebhookHistory,
  getWebhookStats,
  testWebhook,
  updateWebhook,
  removeWebhook,
  getDeliveryFailures,
  rotateSecret,
} from '../controllers/webhookController.js';

const router = Router();

router.post('/connect',    asyncHandler(connectWhatsApp));
router.post('/disconnect', asyncHandler(disconnectWhatsApp));
router.post('/reset',      asyncHandler(resetWhatsAppSession));
router.get('/status',      asyncHandler(getWhatsAppStatus));
router.post('/send',       asyncHandler(sendWhatsAppMessage));
router.get('/qr',          asyncHandler(getWhatsAppQR));

// ─── Manajemen webhook OpenWA ────────────────────────────────────────────────
//
// Semua endpoint di bawah ini dilindungi JWT (mount di /api/whatsapp, yang
// berada DI BAWAH auth guard). Endpoint PUBLIK untuk penerimaan event ada
// di /api/webhooks/openwa (lihat routes/webhookRoutes.js).
//
// CATATAN URUTAN: route literal (`/webhooks/events`, `/webhooks/history`,
// `/webhooks/stats`, `/webhooks/failures`, `/webhooks/rotate-secret`) harus
// diletakkan SEBELUM route parametrik (`/webhooks/:id`), kalau tidak
// Express akan menganggap "events" sebagai nilai parameter `id`.
router.get('/webhooks',                asyncHandler(getWebhooks));
router.post('/webhooks',               asyncHandler(registerWebhook));
router.get('/webhooks/events',         asyncHandler(getEventCatalog));
router.get('/webhooks/history',        asyncHandler(getWebhookHistory));
router.get('/webhooks/stats',          asyncHandler(getWebhookStats));
router.get('/webhooks/failures',       asyncHandler(getDeliveryFailures));
router.post('/webhooks/rotate-secret', asyncHandler(rotateSecret));
router.post('/webhooks/:id/test',      asyncHandler(testWebhook));
router.put('/webhooks/:id',            asyncHandler(updateWebhook));
router.delete('/webhooks/:id',         asyncHandler(removeWebhook));

export default router;
