// ─────────────────────────────────────────────────────────────────────────────
// Webhook controller — dua kelompok endpoint:
//
//   A. RECEIVER (PUBLIK, tanpa JWT)
//      POST /api/webhooks/openwa
//      Dipanggil OpenWA gateway. Wajib memverifikasi signature HMAC dan
//      mendeduplikasi event.
//
//   B. MANAGEMENT (butuh JWT, di-mount di /api/whatsapp/webhooks)
//      POST   /api/whatsapp/webhooks            → daftarkan webhook ke gateway
//      GET    /api/whatsapp/webhooks            → daftar webhook
//      GET    /api/whatsapp/webhooks/events     → katalog event
//      GET    /api/whatsapp/webhooks/history    → riwayat event diterima
//      GET    /api/whatsapp/webhooks/stats      → statistik event
//      POST   /api/whatsapp/webhooks/:id/test   → kirim delivery uji
//      PUT    /api/whatsapp/webhooks/:id        → ubah webhook
//      DELETE /api/whatsapp/webhooks/:id        → hapus webhook
//
// CATATAN PENTING SOAL ARAH PENANGANAN ERROR:
//   Untuk receiver, jawaban HARUS 2xx kalau event sudah diterima — termasuk
//   kalau eventnya duplikat. Kalau endpoint membalas 4xx/5xx, OpenWA akan
//   MENGULANG delivery (retry, backoff eksponensial) sampai `retryCount`
//   habis. Duplikat yang dibalas error akan memicu rantai retry sia-sia.
//
//   Sebaliknya, signature yang TIDAK valid HARUS dibalas 401 — kalau tidak,
//   siapa pun bisa menyuntikkan event palsu ke aplikasi.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import {
  summarizeEvent,
  recordEvent,
  markProcessed,
  dispatchEvent,
  listEvents,
  getEventStats,
  normalizeEventList,
  OPENWA_EVENTS,
  verifySignature,
} from '../services/whatsappWebhookService.js';
import {
  getGatewaySessionId,
  listRemoteWebhooks,
  createRemoteWebhook,
  updateRemoteWebhook,
  deleteRemoteWebhook,
  testRemoteWebhook,
  listRegistrations,
  upsertRegistration,
  updateRegistrationSecret,
  deleteRegistration,
  getSecretForSession,
  listDeliveryFailures,
} from '../services/openwaWebhookClient.js';
import { resolveGatewayUrl } from '../services/settingsService.js';

// ─── A. RECEIVER ─────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/openwa — menerima event dari OpenWA gateway.
 *
 * Body mentah diambil dari `req.rawBody` — byte persis yang diterima server.
 * `req.rawBody` diisi oleh hook `verify` pada express.json() di index.js.
 * Kalau content-type tidak dikenali express.json, parser lokal
 * `express.raw()` pada router yang menanganinya.
 */
export async function receiveOpenwaWebhook(req, res) {
  // Prioritaskan rawBody dari middleware global (byte persis seperti yang
  // diterima). Fallback ke req.body kalau router lokal yang mem-parse.
  const rawBody = req.rawBody
    ? Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(req.rawBody)
    : Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}), 'utf8');

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    // Payload rusak — jangan diproses. 400 supaya gateway knows, tapi
    // ini payload yang memang invalid, retry tidak akan menolong.
    return res.status(400).json({ success: false, error: 'Body webhook bukan JSON yang valid.' });
  }

  const event = summarizeEvent(body);
  if (!event.event || event.event === 'unknown') {
    return res.status(400).json({ success: false, error: 'Field "event" wajib ada pada payload webhook.' });
  }
  if (!event.idempotencyKey) {
    return res.status(400).json({
      success: false,
      error: 'Field "idempotencyKey" wajib ada pada payload webhook.',
    });
  }

  // ── Verifikasi signature ──────────────────────────────────────────────────
  //
  // Secret diambil dari registration lokal untuk sesi tersebut. Bila belum
  // ada registration (mis. webhook dibuat manual di luar aplikasi), tidak
  // ada secret yang bisa diverifikasi — event tetap diterima tapi ditandai
  // agar operator bisa melihatnya perlu ditinjau.
  const secret = await getSecretForSession(event.sessionId);
  const signatureHeader = req.get('X-OpenWA-Signature');
  const verdict = verifySignature(rawBody, signatureHeader, secret);

  if (!verdict.ok) {
    console.warn(
      `[OpenWA Webhook] Signature ditolak (${verdict.reason}) untuk event ${event.event}`,
    );
    return res.status(401).json({
      success: false,
      error: 'Signature webhook tidak valid.',
      reason: verdict.reason,
    });
  }

  // ── Dedupe ────────────────────────────────────────────────────────────────
  //
  // OpenWA memakai delivery at-least-once. Kunci idempotensi bersifat
  // content-based, jadi retry memakai kunci yang sama. UNIQUE constraint
  // di DB yang menangkap duplikatnya — bukan pengecekan manual.
  let record;
  try {
    record = await recordEvent(event, rawBody.toString('utf8'));
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal menyimpan event:', err.message);
    return res.status(500).json({ success: false, error: 'Gagal menyimpan event webhook.' });
  }

  if (record.duplicate) {
    // Event sudah pernah diproses. Balas 2xx supaya gateway TIDAK mengulang.
    return res.status(200).json({
      success: true,
      duplicate: true,
      event: event.event,
      message: 'Event sudah pernah diproses (duplikat diabaikan).',
    });
  }

  // ── Proses event ─────────────────────────────────────────────────────────
  const outcome = await dispatchEvent(event);

  if (outcome.error) {
    await markProcessed(record.id, 'failed', outcome.error);
    console.error(`[OpenWA Webhook] Handler ${event.event} gagal:`, outcome.error);
    // Balas 5xx supaya gateway melakukan retry — handler yang gagal SHOULD
    // dicoba ulang.
    return res.status(500).json({
      success: false,
      error: 'Pemrosesan event webhook gagal.',
      event: event.event,
    });
  }

  const status = outcome.handled ? 'processed' : 'ignored';
  await markProcessed(record.id, status, null);

  return res.status(200).json({
    success: true,
    duplicate: false,
    event: event.event,
    handled: outcome.handled,
    result: outcome.result || null,
  });
}

// ─── B. MANAGEMENT ───────────────────────────────────────────────────────────

/**
 * Helper: pastikan gateway dikonfigurasi dan sesi tersedia.
 *
 * Konfigurasi gateway dibaca dari PENGATURAN (UI) dengan fallback env —
 * bukan hanya `process.env.WA_GATEWAY_URL`. SEBELUMNYA pemeriksaan hanya
 * mengecek env, sehingga gateway yang dikonfigurasi lewat UI dianggap
 * "belum dikonfigurasi" dan seluruh endpoint webhook menolak bekerja.
 *
 * @returns {Promise<{sessionId: string}|null>}
 */
async function requireGatewaySession(res) {
  const gatewayUrl = await resolveGatewayUrl();
  if (!gatewayUrl) {
    res.status(400).json({
      success: false,
      error: 'OpenWA gateway belum dikonfigurasi. Isi "WA Gateway URL" di tab Pengaturan, atau set WA_GATEWAY_URL di server/.env.',
    });
    return null;
  }
  const sessionId = await getGatewaySessionId();
  if (!sessionId) {
    res.status(502).json({
      success: false,
      error: 'Tidak dapat menjangkau OpenWA gateway atau sesi belum tersedia.',
    });
    return null;
  }
  return { sessionId };
}

/**
 * POST /api/whatsapp/webhooks — daftarkan webhook ke gateway.
 *
 * Body: { url, events?, secret?, retryCount? }
 * - `url` wajib, dan harus bisa dijangkau OpenWA (host publik/HTTPS).
 * - `events` default ["message.received"].
 * - `secret` opsional tapi SANGAT Disarankan: tanpa secret, siapa pun bisa
 *   menyuntikkan event palsu ke endpoint receiver.
 */
export async function registerWebhook(req, res) {
  try {
    const ctx = await requireGatewaySession(res);
    if (!ctx) return;

    const { url, secret, retryCount } = req.body || {};

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'Field "url" wajib diisi.' });
    }

    // Validasi bentuk URL. Validasi host (SSRF) dilakukan gateway — kita
    // hanya memastikan ini URL yang masuk akal supaya pesan errornya jelas.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: 'Field "url" bukan URL yang valid.' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({
        success: false,
        error: 'URL webhook harus memakai http atau https.',
      });
    }

    const normalized = normalizeEventList(req.body?.events);
    if (normalized.error) {
      return res.status(400).json({ success: false, error: normalized.error });
    }

    // Secret minimal 16 karakter (aturan OpenWA v0.20.0+). Validasi di sini
    // supaya errornya langsung muncul, bukan dari gateway.
    if (secret !== undefined && secret !== null && secret !== '') {
      if (typeof secret !== 'string' || secret.length < 16) {
        return res.status(400).json({
          success: false,
          error: 'Secret minimal 16 karakter (aturan OpenWA).',
        });
      }
    }

    const created = await createRemoteWebhook(ctx.sessionId, {
      url,
      events: normalized.events,
      secret: secret || undefined,
      retryCount: typeof retryCount === 'number' ? retryCount : undefined,
    });

    if (!created?.id) {
      return res.status(502).json({
        success: false,
        error: 'Gateway tidak mengembalikan id webhook.',
      });
    }

    // Simpan registration lokal (termasuk secret, yang tidak pernah
    // dikembalikan gateway) supaya signature bisa diverifikasi saat event
    // masuk, dan UI tidak perlu memanggil gateway terus-menerus.
    await upsertRegistration({
      remoteId: created.id,
      sessionId: ctx.sessionId,
      url: created.url || url,
      events: Array.isArray(created.events) ? created.events : normalized.events,
      secret: secret || null,
      active: created.active !== false,
    });

    res.status(201).json({
      success: true,
      webhook: {
        id: created.id,
        sessionId: ctx.sessionId,
        url: created.url || url,
        events: Array.isArray(created.events) ? created.events : normalized.events,
        active: created.active !== false,
        retryCount: created.retryCount ?? 3,
        createdAt: created.createdAt || null,
        // Secret tidak pernah dikembalikan.
        hasSecret: !!secret,
      },
    });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal mendaftarkan webhook:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/whatsapp/webhooks — daftar webhook.
 *
 * Sumber kebenaran adalah GATEWAY (bukan DB lokal), supaya webhook yang
 * dibuat manual di dashboard OpenWA ikut terlihat. Data lokal hanya
 * dipakai untuk menyorot webhook milik aplikasi ini.
 */
export async function getWebhooks(req, res) {
  try {
    // Gateway bisa dikonfigurasi lewat Pengaturan (UI) ATAU lewat env.
    if (!await resolveGatewayUrl()) {
      return res.status(400).json({
        success: false,
        error: 'OpenWA gateway belum dikonfigurasi. Isi "WA Gateway URL" di tab Pengaturan, atau set WA_GATEWAY_URL di server/.env.',
      });
    }

    const sessionId = await getGatewaySessionId();
    if (!sessionId) {
      return res.status(502).json({
        success: false,
        error: 'Tidak dapat menjangkau OpenWA gateway atau sesi belum tersedia.',
      });
    }

    const [remote, local] = await Promise.all([
      listRemoteWebhooks(sessionId),
      listRegistrations(),
    ]);

    const localByRemote = new Map(local.map((l) => [l.remoteId, l]));

    res.json({
      success: true,
      sessionId,
      webhooks: remote.map((w) => {
        const own = localByRemote.get(w.id);
        return {
          id: w.id,
          url: w.url,
          events: Array.isArray(w.events) ? w.events : [],
          active: w.active !== false,
          retryCount: w.retryCount ?? 3,
          lastTriggeredAt: w.lastTriggeredAt || null,
          createdAt: w.createdAt || null,
          // Ditandai kalau webhook ini dibuat oleh aplikasi ini (bukan manual).
          managed: !!own,
          hasSecret: own ? own.hasSecret : false,
        };
      }),
    });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal mengambil daftar webhook:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/whatsapp/webhooks/events — katalog event OpenWA.
 */
export async function getEventCatalog(req, res) {
  res.json({
    success: true,
    events: OPENWA_EVENTS,
    wildcardNote:
      'Wildcard "*" mencakup semua event KECUALI message.receipt — event itu harus disebut eksplisit.',
  });
}

/**
 * GET /api/whatsapp/webhooks/history — riwayat event yang diterima.
 */
export async function getWebhookHistory(req, res) {
  try {
    const { limit, event, status } = req.query || {};
    const events = await listEvents({
      limit: limit ? parseInt(limit, 10) : 50,
      event: event || null,
      status: status || null,
    });
    res.json({ success: true, count: events.length, events });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal membaca riwayat:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/whatsapp/webhooks/stats — statistik event.
 */
export async function getWebhookStats(req, res) {
  try {
    const stats = await getEventStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal membaca statistik:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/whatsapp/webhooks/:id/test — kirim delivery uji.
 */
export async function testWebhook(req, res) {
  try {
    const ctx = await requireGatewaySession(res);
    if (!ctx) return;

    const result = await testRemoteWebhook(ctx.sessionId, req.params.id);
    res.json({ success: true, result });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal menguji webhook:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/whatsapp/webhooks/:id — ubah webhook.
 */
export async function updateWebhook(req, res) {
  try {
    const ctx = await requireGatewaySession(res);
    if (!ctx) return;

    const body = req.body || {};
    const patch = {};

    if (body.url !== undefined) {
      if (typeof body.url !== 'string') {
        return res.status(400).json({ success: false, error: 'Field "url" harus berupa string.' });
      }
      let parsed;
      try {
        parsed = new URL(body.url);
      } catch {
        return res.status(400).json({ success: false, error: 'Field "url" bukan URL yang valid.' });
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({
          success: false,
          error: 'URL webhook harus memakai http atau https.',
        });
      }
      patch.url = body.url;
    }

    if (body.events !== undefined) {
      const normalized = normalizeEventList(body.events);
      if (normalized.error) {
        return res.status(400).json({ success: false, error: normalized.error });
      }
      patch.events = normalized.events;
    }

    if (body.active !== undefined) {
      patch.active = body.active === true;
    }

    if (body.secret !== undefined && body.secret !== null && body.secret !== '') {
      if (typeof body.secret !== 'string' || body.secret.length < 16) {
        return res.status(400).json({
          success: false,
          error: 'Secret minimal 16 karakter (aturan OpenWA).',
        });
      }
      patch.secret = body.secret;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Tidak ada field yang diubah. Kirim url, events, active, atau secret.',
      });
    }

    const updated = await updateRemoteWebhook(ctx.sessionId, req.params.id, patch);

    await upsertRegistration({
      remoteId: req.params.id,
      sessionId: ctx.sessionId,
      url: updated?.url || patch.url || '',
      events: Array.isArray(updated?.events) ? updated.events : (patch.events || []),
      secret: patch.secret || null,
      active: updated?.active !== false,
    }).catch((err) => console.warn('[OpenWA Webhook] Gagal memperbarui registration lokal:', err.message));

    res.json({
      success: true,
      webhook: {
        id: updated?.id || req.params.id,
        url: updated?.url || patch.url || null,
        events: Array.isArray(updated?.events) ? updated.events : (patch.events || null),
        active: updated?.active !== false,
        retryCount: updated?.retryCount ?? null,
      },
    });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal memperbarui webhook:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /api/whatsapp/webhooks/:id — hapus webhook.
 */
export async function removeWebhook(req, res) {
  try {
    const ctx = await requireGatewaySession(res);
    if (!ctx) return;

    await deleteRemoteWebhook(ctx.sessionId, req.params.id);
    await deleteRegistration(req.params.id).catch(() => {});

    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal menghapus webhook:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/whatsapp/webhooks/failures — dead-letter log delivery yang gagal.
 * Route ini butuh kunci dengan role ADMIN di sisi gateway.
 */
export async function getDeliveryFailures(req, res) {
  try {
    const { limit, sessionId } = req.query || {};
    const failures = await listDeliveryFailures(sessionId || null, limit || 20);
    res.json({ success: true, count: failures.length, failures });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal membaca delivery failures:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/whatsapp/webhooks/rotate-secret — buat secret HMAC baru.
 *
 * Secret yang sudah dipakai webhook lama tetap berlaku di gateway sampai
 * webhook di-update. Rotasi berarti: update webhook dengan secret baru,
 * lalu simpan secret baru di registration lokal.
 */
export async function rotateSecret(req, res) {
  try {
    const ctx = await requireGatewaySession(res);
    if (!ctx) return;

    const remoteId = req.body?.id;
    if (!remoteId) {
      return res.status(400).json({ success: false, error: 'Field "id" (webhook id) wajib diisi.' });
    }

    // 32 byte acak → 64 karakter heksadesimal, jauh di atas batas 16 karakter.
    const secret = crypto.randomBytes(32).toString('hex');

    await updateRemoteWebhook(ctx.sessionId, remoteId, { secret });

    // Hanya secret yang diubah — url/events TIDAK ditimpa (tidak diketahui
    // pada saat rotasi).
    await updateRegistrationSecret(remoteId, secret);

    // Secret TIDAK dikembalikan ke frontend — hanya konfirmasi bahwa
    // rotasi berhasil. Secret baru hanya dipakai server.
    res.json({
      success: true,
      rotated: true,
      message: 'Secret webhook berhasil diperbarui di gateway.',
    });
  } catch (err) {
    console.error('[OpenWA Webhook] Gagal merotasi secret:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
