// ─────────────────────────────────────────────────────────────────────────────
// OpenWA webhook client — sisi gateway (aplikasi → OpenWA).
//
// Modul ini menangani seluruh route management webhook OpenWA:
//
//   POST   /api/sessions/{sessionId}/webhooks              → buat webhook
//   GET    /api/sessions/{sessionId}/webhooks              → daftar webhook
//   GET    /api/sessions/{sessionId}/webhooks/{id}         → detail satu webhook
//   PUT    /api/sessions/{sessionId}/webhooks/{id}         → ubah webhook
//   DELETE /api/sessions/{sessionId}/webhooks/{id}         → hapus webhook
//   POST   /api/sessions/{sessionId}/webhooks/{id}/test    → kirim delivery uji
//
// WAJIB Ingat:
//   - `sessionId` = UUID sesi, BUKAN nama sesi. Nama sesi hanya dipakai
//     saat membuat sesi (`POST /api/sessions { name }`) dan saat mencari
//     UUID-nya (`GET /api/sessions?name=...`).
//   - Autentikasi lewat header `X-API-Key` — API key TIDAK boleh di URL.
//   - `secret` bersifat write-only: TIDAK pernah dikembalikan respons.
//   - `url` divalidasi gateway dan dilindungi SSRF — host internal ditolak
//     dengan HTTP 400. Itu perilaku gateway, bukan bug.
//   - Route webhook butuh kunci dengan role OPERATOR atau lebih tinggi.
// ─────────────────────────────────────────────────────────────────────────────

import prisma from '../db.js';
import {
  gatewayRequest,
  ensureGatewaySession,
  gatewaySessionName,
  getGatewayUrl,
} from './whatsapp.js';
import { resolveGatewayUrl } from './settingsService.js';

export { gatewaySessionName };

/**
 * Ambil UUID sesi OpenWA, atau null bila gateway tidak dikonfigurasi.
 * @returns {Promise<string|null>}
 */
export async function getGatewaySessionId() {
  // URL gateway dibaca dari settings (UI) dengan fallback env — nilai ini
  // bisa berubah saat runtime, jadi TIDAK lagi konstanta modul.
  const url = await getGatewayUrl();
  if (!url) return null;
  try {
    return await ensureGatewaySession();
  } catch (err) {
    console.warn('[OpenWA Webhook] Gagal mencari UUID sesi:', err.message);
    return null;
  }
}

/**
 * Daftar webhook yang terdaftar pada sebuah sesi di sisi gateway.
 * @param {string} sessionId UUID sesi
 * @returns {Promise<Array<object>>}
 */
export async function listRemoteWebhooks(sessionId) {
  const list = await gatewayRequest('GET', `/api/sessions/${sessionId}/webhooks`);
  // Respons list route OpenWA adalah ARRAY POLOS (tanpa envelope).
  return Array.isArray(list) ? list : (list?.webhooks || []);
}

/**
 * Ambil detail satu webhook dari gateway.
 */
export async function getRemoteWebhook(sessionId, webhookId) {
  return gatewayRequest('GET', `/api/sessions/${sessionId}/webhooks/${webhookId}`);
}

/**
 * Buat webhook baru di gateway.
 *
 * @param {string} sessionId UUID sesi
 * @param {{url: string, events: string[], secret?: string, retryCount?: number, headers?: object}} payload
 * @returns {Promise<object>} webhook yang dibuat
 */
export async function createRemoteWebhook(sessionId, payload) {
  const body = {
    url: payload.url,
    events: payload.events,
  };
  if (payload.secret) body.secret = payload.secret;
  if (typeof payload.retryCount === 'number') body.retryCount = payload.retryCount;
  if (payload.headers && Object.keys(payload.headers).length) body.headers = payload.headers;

  return gatewayRequest('POST', `/api/sessions/${sessionId}/webhooks`, body);
}

/**
 * Perbarui webhook di gateway. Semua field opsional — hanya kirim yang berubah.
 */
export async function updateRemoteWebhook(sessionId, webhookId, patch) {
  const body = {};
  if (patch.url !== undefined) body.url = patch.url;
  if (patch.events !== undefined) body.events = patch.events;
  if (patch.secret !== undefined) body.secret = patch.secret;
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.retryCount !== undefined) body.retryCount = patch.retryCount;

  return gatewayRequest('PUT', `/api/sessions/${sessionId}/webhooks/${webhookId}`, body);
}

/**
 * Hapus webhook di gateway.
 * Gateway membalas 204 No Content (body kosong).
 */
export async function deleteRemoteWebhook(sessionId, webhookId) {
  await gatewayRequest('DELETE', `/api/sessions/${sessionId}/webhooks/${webhookId}`);
}

/**
 * Kirim delivery uji ke webhook — memastikan endpoint kita hidup dan
 * signature benar.
 * @returns {Promise<{success: boolean, statusCode?: number, error?: string}>}
 */
export async function testRemoteWebhook(sessionId, webhookId) {
  return gatewayRequest('POST', `/api/sessions/${sessionId}/webhooks/${webhookId}/test`);
}

/**
 * Daftar delivery yang GAGAL (dead-letter log). Route ini butuh kunci
 * dengan role ADMIN.
 */
export async function listDeliveryFailures(sessionId = null, limit = 20) {
  const q = `?limit=${Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)}` +
    (sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : '');
  const list = await gatewayRequest('GET', `/api/webhooks/delivery-failures${q}`);
  return Array.isArray(list) ? list : (list?.failures || list?.deliveries || []);
}

// ─── Persistensi lokal ───────────────────────────────────────────────────────

/**
 * Simpan/mor refresher registration webhook lokal.
 *
 * Registration lokal BUKAN sumber kebenaran — sumber kebenaran tetap
 * gateway. Data ini dipakai supaya UI bisa menampilkan daftar tanpa
 * memanggil gateway setiap kali, dan supaya `secret` HMAC (yang tidak
 * pernah dikembalikan gateway) tetap tersimpan untuk verifikasi signature.
 *
 * @param {{remoteId: string, sessionId: string, url: string, events: string[], secret?: string, active?: boolean}} data
 */
export async function upsertRegistration(data) {
  const eventsJson = JSON.stringify(data.events || []);
  return prisma.whatsAppWebhookRegistration.upsert({
    where: { remoteId: data.remoteId },
    create: {
      remoteId: data.remoteId,
      sessionId: data.sessionId,
      sessionName: data.sessionName || gatewaySessionName,
      url: data.url,
      events: eventsJson,
      secret: data.secret || null,
      active: data.active !== false,
    },
    update: {
      sessionId: data.sessionId,
      sessionName: data.sessionName || gatewaySessionName,
      url: data.url,
      events: eventsJson,
      ...(data.secret ? { secret: data.secret } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  });
}

/**
 * Daftar registration webhook lokal (tanpa secret).
 */
export async function listRegistrations() {
  const rows = await prisma.whatsAppWebhookRegistration.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    remoteId: r.remoteId,
    sessionId: r.sessionId,
    sessionName: r.sessionName,
    url: r.url,
    events: safeParseJson(r.events),
    active: r.active,
    lastTriggeredAt: r.lastTriggeredAt,
    lastError: r.lastError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // Secret TIDAK pernah dikembalikan ke frontend.
    hasSecret: !!r.secret,
  }));
}

/**
 * Ambil secret HMAC untuk sebuah sesi — dipakai saat memverifikasi
 * signature delivery yang masuk.
 *
 * @param {string} sessionId UUID sesi OpenWA
 * @returns {Promise<string|null>}
 */
export async function getSecretForSession(sessionId) {
  if (!sessionId) return null;
  const row = await prisma.whatsAppWebhookRegistration.findFirst({
    where: { sessionId },
    orderBy: { updatedAt: 'desc' },
  });
  return row?.secret || null;
}

/**
 * Hapus registration lokal.
 */
export async function deleteRegistration(remoteId) {
  return prisma.whatsAppWebhookRegistration.deleteMany({ where: { remoteId } });
}

/**
 * Perbarui HANYA secret pada registration lokal.
 *
 * Dipakai saat rotasi secret. Sengaja terpisah dari `upsertRegistration`:
 * upsert menimpa url/events, dan pada rotasi kita hanya tahu id webhook —
 * url/events yang sudah ada harus TIDAK ditimpa dengan nilai kosong.
 *
 * @param {string} remoteId
 * @param {string} secret
 */
export async function updateRegistrationSecret(remoteId, secret) {
  return prisma.whatsAppWebhookRegistration.updateMany({
    where: { remoteId },
    data: { secret },
  });
}

/**
 * Parse JSON dengan fallback aman.
 */
function safeParseJson(text) {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
