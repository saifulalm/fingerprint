// Mock OpenWA gateway — mensimulasikan kontrak resmi OpenWA untuk pengujian.
// Dipakai untuk memverifikasi integrasi tanpa gateway sungguhan.
//
// Kontrak yang ditiru (docs.open-wa.org/guides/webhooks + 06-api-specification.md):
//   - prefix global /api
//   - header X-API-Key
//   - respons tanpa envelope; list route = array polos
//   - status sesi lowercase: created|initializing|qr_ready|ready|...
//   - field QR bernama `qrCode`
//   - chatId wajib localpart@host
//   - route webhook di-scope per SESI (UUID):
//       POST   /api/sessions/:id/webhooks
//       GET    /api/sessions/:id/webhooks
//       GET    /api/sessions/:id/webhooks/:wid
//       PUT    /api/sessions/:id/webhooks/:wid
//       DELETE /api/sessions/:id/webhooks/:wid
//       POST   /api/sessions/:id/webhooks/:wid/test
//   - delivery webhook: body { event, timestamp, sessionId, idempotencyKey,
//       deliveryId, data } + header X-OpenWA-Signature (HMAC-SHA256 atas
//       body mentah), X-OpenWA-Idempotency-Key, X-OpenWA-Event

import http from 'http';
import crypto from 'node:crypto';

const API_KEY = process.env.MOCK_API_KEY || 'test-key';

const sessions = new Map(); // id -> session
const webhooks = new Map(); // webhookId -> webhook
let seq = 0;
let lastSend = null; // payload pesan terakhir — dipakai uji integrasi
// Dokumen terakhir yang dikirim lewat `send-document` — dipakai uji integrasi
// untuk MEMBUKTIKAN file PDF benar-benar sampai ke gateway (bukan cuma teks).
let lastDocument = null;
const deliveries = []; // riwayat delivery yang dikirim mock
// Dead-letter log: delivery yang GAGAL (status non-2xx atau error jaringan).
// Diisi otomatis saat `deliver()` gagal, lalu dibaca lewat
// GET /api/webhooks/delivery-failures.
const deliveryFailures = [];

// Kontrak: chatId WAJIB localpart@host.
function isValidChatId(v) {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+$/.test(v);
}

// Hitung signature HMAC atas body mentah.
function signBody(rawBody, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Secret bersifat WRITE-ONLY — tidak pernah muncul di respons.
function stripSecret(wh) {
  const { secret, ...rest } = wh;
  return rest;
}

/**
 * Kirim delivery webhook ke URL target.
 *
 * Menggantikan node fetch bawaan (Node 18 punya fetch global) supaya
 * signature bisa dihitung atas BYTE BODY MENTAH — re-serialisasi akan
 * mengubah urutan key dan membuat HMAC tidak cocok.
 *
 * @param {URL} target
 * @param {string} rawBody
 * @param {object} payload
 * @param {string|null} secret
 */
async function deliver(target, rawBody, payload, secret) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'OpenWA-Webhook/1.0.0',
    'X-OpenWA-Event': payload.event,
    'X-OpenWA-Idempotency-Key': payload.idempotencyKey,
    'X-OpenWA-Delivery-Id': payload.deliveryId,
    'X-OpenWA-Retry-Count': '0',
  };
  if (secret) headers['X-OpenWA-Signature'] = signBody(rawBody, secret);

  const res = await fetch(target, {
    method: 'POST',
    headers,
    body: rawBody,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text().catch(() => '');
  const ok = res.status >= 200 && res.status < 300;
  deliveries.push({
    event: payload.event,
    url: target.toString(),
    status: res.status,
    signed: !!secret,
    at: new Date().toISOString(),
  });
  // Delivery yang gagal masuk dead-letter log supaya bisa dibaca lewat
  // GET /api/webhooks/delivery-failures (endpoint yang dipakai UI).
  if (!ok) {
    deliveryFailures.push({
      deliveryId: payload.deliveryId,
      event: payload.event,
      sessionId: payload.sessionId,
      url: target.toString(),
      status: res.status,
      error: `HTTP ${res.status}`,
      response: text.slice(0, 500),
      attempts: 1,
      failedAt: new Date().toISOString(),
    });
  }
  return { ok, status: res.status, body: text };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    // Auth guard — kecuali health.
    if (!path.startsWith('/api/health') && req.headers['x-api-key'] !== API_KEY) {
      return json(401, { statusCode: 401, message: 'Missing or invalid API key', error: 'Unauthorized' });
    }

    // ── GET /api/sessions?name=... → ARRAY POLOS ────────────────────────────
    if (path === '/api/sessions' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      let list = [...sessions.values()];
      if (name) list = list.filter((s) => s.name === name);
      return json(200, list);
    }

    // ── POST /api/sessions { name } ─────────────────────────────────────────
    if (path === '/api/sessions' && req.method === 'POST') {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      const name = payload.name;
      if (!name || !/^[a-zA-Z0-9-]{3,50}$/.test(name)) {
        return json(400, { statusCode: 400, message: 'name must match /^[a-zA-Z0-9-]{3,50}$/', error: 'Bad Request' });
      }
      if ([...sessions.values()].some((s) => s.name === name)) {
        return json(409, { statusCode: 409, message: `Session name '${name}' already exists`, error: 'Conflict' });
      }
      const id = `session-${++seq}`;
      sessions.set(id, {
        id, name,
        status: 'created',
        phone: null, pushName: null,
        engineLoaded: false,
        lastError: null,
      });
      return json(201, sessions.get(id));
    }

    // ── GET /api/sessions/:id ──────────────────────────────────────────────
    let m = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: `Session with id '${m[1]}' not found`, error: 'Not Found' });
      return json(200, s);
    }

    // ── POST /api/sessions/:id/start ───────────────────────────────────────
    m = path.match(/^\/api\/sessions\/([^/]+)\/start$/);
    if (m && req.method === 'POST') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      if (s.engineLoaded) return json(400, { statusCode: 400, message: 'Session already started', error: 'Bad Request' });
      s.engineLoaded = true;
      // Bila sesi sudah `ready` (hasil helper uji), JANGAN dikembalikan ke
      // `qr_ready` — start pada sesi yang sudah running memang ditolak 400.
      if (s.status !== 'ready') s.status = 'qr_ready';
      return json(200, s);
    }

    // ── GET /api/sessions/:id/qr → { qrCode, status } ───────────────────────
    m = path.match(/^\/api\/sessions\/([^/]+)\/qr$/);
    if (m && req.method === 'GET') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      if (!s.engineLoaded) return json(400, { statusCode: 400, message: 'Session not started', error: 'Bad Request' });
      // PNG data-URL 1x1 yang valid.
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      return json(200, { qrCode: png, status: s.status });
    }

    // ── POST /api/sessions/:id/messages/send-text ──────────────────────────
    m = path.match(/^\/api\/sessions\/([^/]+)\/messages\/send-text$/);
    if (m && req.method === 'POST') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      if (!isValidChatId(payload.chatId)) {
        return json(400, {
          statusCode: 400,
          message: 'chatId must be a valid chat JID in the form localpart@host',
          error: 'Bad Request',
        });
      }
      if (typeof payload.text !== 'string' || !payload.text.length) {
        return json(400, { statusCode: 400, message: 'text is required', error: 'Bad Request' });
      }
      console.log('[MOCK] send-text →', payload.chatId, '|', payload.text.slice(0, 40).replace(/\n/g, ' '));
      lastSend = { chatId: payload.chatId, text: payload.text, at: new Date().toISOString() };
      return json(201, { messageId: 'mock-msg-' + (++seq), timestamp: new Date().toISOString() });
    }

    // ── POST /api/sessions/:id/messages/send-document ──────────────────────
    //
    // Endpoint ini WAJIB ada untuk menguji pengiriman laporan PDF sebagai
    // dokumen WhatsApp. Tanpa endpoint ini, jalur `whatsappService.sendDocument()`
    // tidak pernah bisa dibuktikan bekerja.
    //
    // Kontrak OpenWA: dokumen dikirim lewat field `base64` (atau `url`),
    // plus `filename` + `mimetype`, dan `caption` opsional.
    m = path.match(/^\/api\/sessions\/([^/]+)\/messages\/send-document$/);
    if (m && req.method === 'POST') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      if (!isValidChatId(payload.chatId)) {
        return json(400, {
          statusCode: 400,
          message: 'chatId must be a valid chat JID in the form localpart@host',
          error: 'Bad Request',
        });
      }
      const hasUrl = typeof payload.url === 'string' && payload.url.length > 0;
      // base64 didekode LEBIH DAHULU, baru dicek panjangnya.
      //
      // SEBELUMNYA: `hasBase64 = payload.base64.length > 0` — string spasi
      // saja lolos sebagai "ada" (truthy), padahal Node mengabaikannya saat
      // decode sehingga hasilnya 0 byte. Request dengan dokumen KOSONG
      // diterima dengan status 201.
      //
      // Decoded-dulu membuat check-nya jujur: payload yang tidak menghasilkan
      // satu byte pun DITOLAK.
      const buf = typeof payload.base64 === 'string' && payload.base64.length > 0
        ? Buffer.from(payload.base64, 'base64')
        : Buffer.from('');
      const hasBase64 = buf.length > 0;

      if (!hasBase64 && !hasUrl) {
        return json(400, {
          statusCode: 400,
          message: 'base64 or url is required',
          error: 'Bad Request',
        });
      }
      console.log('[MOCK] send-document →', payload.chatId, '|', payload.filename || '(tanpa nama)',
        '|', buf.length, 'bytes');
      lastDocument = {
        chatId: payload.chatId,
        filename: payload.filename || '',
        mimetype: payload.mimetype || 'application/octet-stream',
        caption: payload.caption || '',
        size: buf.length,
        // Magic bytes 4 byte pertama — dipakai assertion "%PDF".
        magic: buf.subarray(0, 4).toString('latin1'),
        at: new Date().toISOString(),
      };
      return json(201, { messageId: 'mock-doc-' + (++seq), timestamp: new Date().toISOString() });
    }

    // ── Helper uji: tandai sesi sebagai ready ─────────────────────────────
    if (path === '/__mock/ready' && req.method === 'POST') {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      const s = sessions.get(payload.id);
      if (!s) return json(404, { statusCode: 404, message: 'not found' });
      s.status = 'ready';
      s.engineLoaded = true;
      s.phone = payload.phone || '6281234567890';
      s.pushName = payload.pushName || 'BioClock';
      return json(200, s);
    }

    // ── POST /api/sessions/:id/webhooks → buat webhook ──────────────────────
    m = path.match(/^\/api\/sessions\/([^/]+)\/webhooks$/);
    if (m && req.method === 'POST') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      if (!payload.url || typeof payload.url !== 'string') {
        return json(400, { statusCode: 400, message: 'url is required', error: 'Bad Request' });
      }
      // Secret minimal 16 karakter (aturan OpenWA v0.20.0+).
      if (payload.secret !== undefined && payload.secret !== null && payload.secret !== ''
          && String(payload.secret).length < 16) {
        return json(400, { statusCode: 400, message: 'secret must be at least 16 characters', error: 'Bad Request' });
      }
      const id = 'wh-' + (++seq);
      const wh = {
        id,
        sessionId: m[1],
        url: payload.url,
        events: Array.isArray(payload.events) && payload.events.length ? payload.events : ['message.received'],
        filters: payload.filters ?? null,
        active: payload.active !== false,
        retryCount: typeof payload.retryCount === 'number' ? payload.retryCount : 3,
        secret: payload.secret || null,
        lastTriggeredAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      webhooks.set(id, wh);
      // Secret bersifat WRITE-ONLY: tidak pernah dikembalikan.
      return json(201, stripSecret(wh));
    }

    // ── GET /api/sessions/:id/webhooks → ARRAY POLOS ───────────────────────
    if (m && req.method === 'GET') {
      const s = sessions.get(m[1]);
      if (!s) return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      const list = [...webhooks.values()].filter((w) => w.sessionId === m[1]);
      return json(200, list.map(stripSecret));
    }

    // ── GET/PUT/DELETE /api/sessions/:id/webhooks/:wid ─────────────────────
    m = path.match(/^\/api\/sessions\/([^/]+)\/webhooks\/([^/]+)$/);
    if (m && (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE')) {
      const wh = webhooks.get(m[2]);
      // Webhook di-scope per sesi: id dari sesi lain → 404.
      if (!wh || wh.sessionId !== m[1]) {
        return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      }
      if (req.method === 'GET') return json(200, stripSecret(wh));
      if (req.method === 'DELETE') {
        webhooks.delete(m[2]);
        res.writeHead(204);
        return res.end();
      }
      // PUT
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      if (payload.url !== undefined) wh.url = payload.url;
      if (payload.events !== undefined) wh.events = payload.events;
      if (payload.active !== undefined) wh.active = payload.active === true;
      if (payload.secret !== undefined) wh.secret = payload.secret;
      if (payload.retryCount !== undefined) wh.retryCount = payload.retryCount;
      wh.updatedAt = new Date().toISOString();
      return json(200, stripSecret(wh));
    }

    // ── POST /api/sessions/:id/webhooks/:wid/test → kirim delivery uji ─────
    m = path.match(/^\/api\/sessions\/([^/]+)\/webhooks\/([^/]+)\/test$/);
    if (m && req.method === 'POST') {
      const wh = webhooks.get(m[2]);
      if (!wh || wh.sessionId !== m[1]) {
        return json(404, { statusCode: 404, message: 'not found', error: 'Not Found' });
      }
      const payload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        sessionId: wh.sessionId,
        idempotencyKey: `test_${wh.id}_${Date.now()}`,
        deliveryId: 'dlv_' + (++seq),
        data: { test: true, webhookId: wh.id },
      };
      const raw = JSON.stringify(payload);
      try {
        const target = new URL(wh.url);
        const result = await deliver(target, raw, payload, wh.secret);
        wh.lastTriggeredAt = new Date().toISOString();
        return json(200, { success: result.ok, statusCode: result.status, error: result.error });
      } catch (err) {
        return json(200, { success: false, error: err.message });
      }
    }

    // ── GET /api/webhooks/delivery-failures → dead-letter log ─────────────
    // Route ini TIDAK di-scope per sesi (menurut kontrak OpenWA), jadi
    // sessionId hanya acted sebagai filter opsional.
    if (path === '/api/webhooks/delivery-failures' && req.method === 'GET') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 20, 1), 100);
      const sessionId = url.searchParams.get('sessionId');
      let list = [...deliveryFailures].reverse();
      if (sessionId) list = list.filter((f) => f.sessionId === sessionId);
      return json(200, list.slice(0, limit));
    }

    // ── Helper uji: jumlah sesi (deteksi duplikasi) ───────────────────────
    if (path === '/__mock/count' && req.method === 'GET') {
      return json(200, { count: sessions.size, ids: [...sessions.keys()] });
    }

    // ── Helper uji: trigger delivery event ke semua webhook sebuah sesi ──
    // Body: { sessionId, event, data, idempotencyKey?, secret? }
    // `secret` dipakai bila penguji ingin menguji penolakan signature.
    if (path === '/__mock/emit' && req.method === 'POST') {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      const sessionId = payload.sessionId;
      const event = payload.event || 'message.received';
      const data = payload.data || {};
      const idempotencyKey = payload.idempotencyKey || `msg_${sessionId}_${Date.now()}`;

      const targets = [...webhooks.values()].filter(
        (w) => w.sessionId === sessionId && w.active !== false
          && (w.events.includes('*') || w.events.includes(event)),
      );
      if (!targets.length) return json(200, { delivered: 0, results: [] });

      const msgPayload = {
        event,
        timestamp: new Date().toISOString(),
        sessionId,
        idempotencyKey,
        deliveryId: 'dlv_' + (++seq),
        data,
      };
      const raw = JSON.stringify(msgPayload);

      const results = [];
      for (const wh of targets) {
        try {
          const r = await deliver(new URL(wh.url), raw, msgPayload, wh.secret);
          results.push({ webhookId: wh.id, status: r.status, ok: r.ok });
        } catch (err) {
          results.push({ webhookId: wh.id, status: 0, ok: false, error: err.message });
        }
      }
      return json(200, { delivered: results.length, results });
    }

    // ── Helper uji: seed satu kegagalan delivery (dead-letter) ────────────
    // Body: { event?, sessionId?, url?, status?, error? }
    // Dipakai uji untuk mengisi log kegagalan tanpa harus menunggu timeout.
    if (path === '/__mock/seed-failure' && req.method === 'POST') {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* noop */ }
      const rec = {
        deliveryId: payload.deliveryId || 'dlv_fail_' + (++seq),
        event: payload.event || 'message.received',
        sessionId: payload.sessionId || null,
        url: payload.url || 'http://localhost:1/unreachable',
        status: payload.status ?? 500,
        error: payload.error || 'HTTP 500',
        response: payload.response || '',
        attempts: payload.attempts || 1,
        failedAt: new Date().toISOString(),
      };
      deliveryFailures.push(rec);
      return json(200, { seeded: true, failure: rec, total: deliveryFailures.length });
    }

    // ── Helper uji: daftar delivery yang sudah dikirim ─────────────────────
    if (path === '/__mock/deliveries' && req.method === 'GET') {
      return json(200, { count: deliveries.length, deliveries });
    }

    // ── Helper uji: daftar webhook yang terdaftar ──────────────────────────
    if (path === '/__mock/webhooks' && req.method === 'GET') {
      const list = [...webhooks.values()].map(stripSecret);
      return json(200, { count: list.length, webhooks: list });
    }

    // ── Helper uji: pesan terakhir yang dikirim ───────────────────────────
    if (path === '/__mock/last-send' && req.method === 'GET') {
      return json(200, lastSend || {});
    }

    // ── Helper uji: dokumen terakhir yang dikirim ──────────────────────────
    // Dipakai uji integrasi untuk MEMBUKTIKAN file PDF benar-benar terkirim
    // sebagai dokumen (bukan cuma ringkasan teks).
    if (path === '/__mock/last-document' && req.method === 'GET') {
      return json(200, lastDocument || {});
    }

    if (path === '/api/health') return json(200, { status: 'ok' });

    return json(404, { statusCode: 404, message: `No route for ${req.method} ${path}`, error: 'Not Found' });
  });
});

const PORT = Number(process.env.MOCK_PORT || 2785);
server.listen(PORT, () => {
  console.log('[MOCK] OpenWA gateway mock listening on http://localhost:' + PORT);
});
