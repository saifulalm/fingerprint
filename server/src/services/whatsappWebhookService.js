// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp webhook service — jembatan dua arah antara aplikasi ini dan
// OpenWA gateway.
//
// ARAH 1 — TERIMA (OpenWA → aplikasi)
//   OpenWA mengirim POST ke `/api/webhooks/openwa`. Endpoint ini:
//     - memverifikasi signature HMAC-SHA256 (header `X-OpenWA-Signature`),
//     - mendeduplikasi lewat `X-OpenWA-Idempotency-Key`,
//     - mencatat event ke `whatsapp_webhook_events`,
//     - menjalankan handler per jenis event.
//
// ARAH 2 — KELOLA (aplikasi → OpenWA)
//   Aplikasi mendaftarkan webhook ke gateway lewat
//   `POST /api/sessions/{sessionId}/webhooks`, lalu bisa melihat, menguji,
//   memperbarui, dan menghapusnya.
//
// KONTRAK OPENWA (docs.open-wa.org/guides/webhooks):
//   - Body delivery: { event, timestamp, sessionId, idempotencyKey,
//                      deliveryId, data }
//   - Header: X-OpenWA-Event, X-OpenWA-Idempotency-Key,
//             X-OpenWA-Delivery-Id, X-OpenWA-Retry-Count,
//             X-OpenWA-Signature ("sha256=<hex>")
//   - Signature = HMAC-SHA256 ATAS BYTE BODY MENTAH, bukan atas hasil
//     JSON.parse + JSON.stringify. Re-serialisasi bisa mengubah urutan key
//     dan membuat perbandingan gagal untuk payload yang sebenarnya sah.
//   - Delivery bersifat AT-LEAST-ONCE: event yang sama bisa datang berkali-
//     kali. Dedupe dilakukan pada idempotencyKey.
//   - `message.receipt` TIDAK ikut dari wildcard '*' — harus disebut eksplisit.
//
// PENTING SOAL PATH SESI:
//   Semua route webhook OpenWA di-scope per sesi dan memakai UUID sesi:
//     /api/sessions/{sessionId}/webhooks
//     /api/sessions/{sessionId}/webhooks/{webhookId}
//     /api/sessions/{sessionId}/webhooks/{webhookId}/test
//   Nama sesi (mis. 'bioclock') HANYA dipakai saat membuat sesi dan saat
//   mencari UUID-nya lewat `GET /api/sessions?name=...`.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import prisma from '../db.js';
import { whatsappService } from './whatsapp.js';

// ─── Konstanta ────────────────────────────────────────────────────────────────

// Katalog event OpenWA (subset yang relevan untuk aplikasi absensi).
//
// Event di luar daftar ini tetap diterima dan dicatat, tapi TIDAK memicu
// handler bisnis — jadi menambah event baru di gateway tidak langsung
// merusak aplikasi.
export const OPENWA_EVENTS = [
  'message.received',
  'message.sent',
  'message.ack',
  'message.receipt',
  'message.failed',
  'message.revoked',
  'message.edited',
  'message.reaction',
  'status.received',
  'session.qr',
  'session.authenticated',
  'session.disconnected',
  'session.status',
  'session.reconnect_loop',
  'session.restriction',
  'group.join',
  'group.leave',
  'group.update',
  'group.join_request',
  'presence.update',
  'call.received',
  'call.accepted',
  'call.rejected',
  'call.missed',
  'poll.vote',
  'event.response',
];

/**
 * Event yang tersedia di wildcard '*'.
 *
 * OpenWA TIDAK pernah mengirim `message.receipt` lewat wildcard — event itu
 * harus disebut eksplisit. Bila user memilih '*', daftar ini tetap dipakai
 * sebagai filter eksplisit agar receipt tetap masuk.
 */
export const WILDCARD_EXPLICIT_EVENTS = ['message.receipt'];

/**
 * Normalisasi daftar event dari input user.
 *
 * - Menerima '*' dan mengembalikannya apa adanya (serta menambah event
 *   yang tidak ikut wildcard, supaya pemanggil tidak perlu mengingat aturan
 *   itu sendiri).
 * - Menolak event yang tidak dikenal dengan pesan jelas, bukan diam-diam
 *   membuangnya — webhook yang salah subscribe akan muncul "tidak jalan"
 *   tanpa penjelasan.
 *
 * @param {unknown} raw
 * @returns {{events: string[], error?: string}}
 */
export function normalizeEventList(raw) {
  if (raw === undefined || raw === null) {
    return { events: ['message.received'] };
  }
  if (!Array.isArray(raw)) {
    return { error: 'Field "events" harus berupa array.' };
  }
  if (raw.length === 0) {
    return { error: 'Field "events" minimal berisi satu nama event.' };
  }

  const cleaned = raw
    .map((e) => String(e ?? '').trim())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return { error: 'Field "events" minimal berisi satu nama event.' };
  }

  if (cleaned.includes('*')) {
    // Wildcard + event eksplisit yang tidak ikut wildcard.
    return { events: ['*', ...WILDCARD_EXPLICIT_EVENTS] };
  }

  const unknown = cleaned.filter((e) => !OPENWA_EVENTS.includes(e));
  if (unknown.length) {
    return {
      error:
        'Event tidak dikenal: ' + unknown.join(', ') + '. ' +
        'Gunakan "*" untuk semua event, atau salah satu dari: ' + OPENWA_EVENTS.join(', '),
    };
  }

  // Buang duplikat tanpa mengubah urutan.
  return { events: [...new Set(cleaned)] };
}

// ─── Signature HMAC ───────────────────────────────────────────────────────────

/**
 * Hitung signature HMAC-SHA256 atas body mentah.
 * @param {string|Buffer} rawBody
 * @param {string} secret
 * @returns {string} "sha256=<hex>"
 */
export function computeSignature(rawBody, secret) {
  const hmac = crypto.createHmac('sha256', String(secret || ''));
  hmac.update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'));
  return 'sha256=' + hmac.digest('hex');
}

/**
 * Bandingkan signature dengan waktu-tetap.
 *
 * `===` biasa membocorkan informasi lewat timing: proses selesai lebih
 * cepat saat byte pertama berbeda. Untuk memblokir pemalsuan signature,
 * perbandingan HARUS waktu-tetap.
 *
 * @param {string} expected signature hasil hitungan kita
 * @param {string} received signature dari header
 */
export function safeCompareSignature(expected, received) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(received || ''), 'utf8');
  if (a.length !== b.length) {
    // Tetap lakukan perbandingan dummy agar waktu response tidak
    // membocorkan panjang input.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verifikasi signature dari header `X-OpenWA-Signature`.
 *
 * @param {string|Buffer} rawBody byte body MENTAH
 * @param {string} headerValue
 * @param {string|null} secret
 * @returns {{ok: boolean, reason?: string}}
 */
export function verifySignature(rawBody, headerValue, secret) {
  if (!secret) {
    // Tanpa secret, signature memang tidak dikirim — tidak bisa diverifikasi.
    // Caller yang butuh verifikasi ketat harus menolak di level lain.
    return { ok: true, reason: 'no-secret' };
  }
  if (!headerValue) {
    return { ok: false, reason: 'missing-signature' };
  }
  const expected = computeSignature(rawBody, secret);
  if (!safeCompareSignature(expected, String(headerValue))) {
    return { ok: false, reason: 'invalid-signature' };
  }
  return { ok: true };
}

// ─── Normalisasi event ────────────────────────────────────────────────────────

/**
 * Ringkasan event untuk disimpan di DB.
 * @param {object} body body delivery OpenWA
 */
export function summarizeEvent(body) {
  const data = body?.data || {};
  return {
    event: String(body?.event || 'unknown'),
    sessionId: body?.sessionId ? String(body.sessionId) : null,
    deliveryId: body?.deliveryId ? String(body.deliveryId) : null,
    idempotencyKey: String(body?.idempotencyKey || ''),
    from: data.from ? String(data.from) : null,
    chatId: data.chatId ? String(data.chatId) : null,
    body: data.body ? String(data.body) : null,
    eventStatus: data.status ? String(data.status) : null,
  };
}

// ─── Handler event ────────────────────────────────────────────────────────────

/**
 * Registry handler per event.
 *
 * Setiap handler menerima (event, ctx) dan mengembalikan objek ringkasan
 * yang disimpan di kolom `error`/log. Handler TIDAK boleh melempar error —
 * error yang dilempar akan tercatat sebagai 'failed' dan memaksa OpenWA
 * melakukan retry.
 */
const handlers = new Map();

/**
 * Daftarkan handler untuk satu jenis event.
 * @param {string} event
 * @param {(event: object, ctx: object) => (object|Promise<object>)} fn
 */
export function registerEventHandler(event, fn) {
  handlers.set(event, fn);
}

/** Daftar event yang punya handler (untuk introspection / UI). */
export function getHandledEvents() {
  return [...handlers.keys()];
}

/**
 * Jalankan handler untuk satu event.
 *
 * @param {object} event ringkasan event
 * @returns {Promise<{handled: boolean, result?: object, error?: string}>}
 */
export async function dispatchEvent(event) {
  const fn = handlers.get(event.event);
  if (!fn) {
    return { handled: false, result: { reason: 'no-handler', event: event.event } };
  }
  try {
    const result = await fn(event, { prisma });
    return { handled: true, result: result || {} };
  } catch (err) {
    return { handled: true, error: err.message };
  }
}

// ─── Penerimaan event (arah 1) ────────────────────────────────────────────────

/**
 * Simpan event ke DB dengan dedupe berbasis idempotencyKey.
 *
 * PENTING: `idempotencyKey` punya UNIQUE constraint. Retried delivery
 * memakai kunci yang sama, jadi INSERT kedua akan GAGAL dengan Prisma error
 * P2002 — itu justru yang kita mau: event duplikat tidak boleh diproses
 * dua kali.
 *
 * @param {object} event ringkasan event
 * @param {string} payloadJson payload mentah (JSON teks)
 * @returns {Promise<{duplicate: boolean, id?: string}>}
 */
export async function recordEvent(event, payloadJson) {
  const key = event.idempotencyKey;
  if (!key) {
    // Tanpa kunci idempotensi tidak ada cara dedupe yang aman. Ini payload
    // yang tidak valid — biarkan caller menolaknya.
    throw new Error('idempotencyKey wajib ada pada payload webhook');
  }

  try {
    const created = await prisma.whatsAppWebhookEvent.create({
      data: {
        event: event.event,
        sessionId: event.sessionId,
        deliveryId: event.deliveryId,
        idempotencyKey: key,
        status: 'received',
        from: event.from,
        chatId: event.chatId,
        body: event.body,
        eventStatus: event.eventStatus,
        payload: payloadJson,
      },
    });
    return { duplicate: false, id: created.id };
  } catch (err) {
    if (err?.code === 'P2002') {
      // Duplikat. Naikkan `attempts` supaya operator bisa melihat bahwa
      // event ini benar-benar pernah di-retry oleh gateway.
      try {
        await prisma.whatsAppWebhookEvent.updateMany({
          where: { idempotencyKey: key },
          data: { attempts: { increment: 1 } },
        });
      } catch { /* abaikan — tidak boleh menggagalkan balasan 2xx */ }
      return { duplicate: true };
    }
    throw err;
  }
}

/**
 * Tandai event sudah diproses.
 */
export async function markProcessed(id, status = 'processed', error = null) {
  try {
    await prisma.whatsAppWebhookEvent.update({
      where: { id },
      data: {
        status,
        error: error ? String(error).slice(0, 500) : null,
        processedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[WhatsApp Webhook] Gagal menandai event:', err.message);
  }
}

// ─── Query riwayat ────────────────────────────────────────────────────────────

/**
 * Ambil riwayat event webhook terbaru.
 * @param {{limit?: number, event?: string, status?: string}} opts
 */
export async function listEvents({ limit = 50, event = null, status = null } = {}) {
  const where = {};
  if (event) where.event = event;
  if (status) where.status = status;

  const rows = await prisma.whatsAppWebhookEvent.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200),
  });

  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    sessionId: r.sessionId,
    deliveryId: r.deliveryId,
    idempotencyKey: r.idempotencyKey,
    status: r.status,
    from: r.from,
    chatId: r.chatId,
    body: r.body,
    eventStatus: r.eventStatus,
    error: r.error,
    attempts: r.attempts,
    receivedAt: r.receivedAt,
    processedAt: r.processedAt,
  }));
}

/**
 * Ambil statistik event (jumlah per event dan per status).
 */
export async function getEventStats() {
  const [byEvent, byStatus, total] = await Promise.all([
    prisma.whatsAppWebhookEvent.groupBy({ by: ['event'], _count: { _all: true } }),
    prisma.whatsAppWebhookEvent.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.whatsAppWebhookEvent.count(),
  ]);
  return {
    total,
    byEvent: byEvent.map((r) => ({ event: r.event, count: r._count._all })),
    byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
  };
}

// ─── Handler bisnis (default) ────────────────────────────────────────────────

/**
 * Ambil nama-normalized nomor telepon dari JID WhatsApp.
 *
 * JID OpenWA untuk kontak personal: `628123456789@c.us` atau
 * `628123456789@s.whatsapp.net`. Nomor absolut (leading 62) dipakai sebagai
 * kunci pencarian karyawan.
 *
 * @param {string} jid
 * @returns {string} nomor absolut, atau string kosong
 */
export function jidToPhone(jid) {
  const raw = String(jid || '').trim();
  if (!raw) return '';
  const local = raw.split('@')[0];
  // Buang semua karakter yang bukan digit, lalu normalisasi leading 0 → 62.
  let phone = local.replace(/\D/g, '');
  if (!phone) return '';
  if (phone.startsWith('0')) phone = '62' + phone.slice(1);
  return phone;
}

/**
 * Cari karyawan berdasarkan nomor WhatsApp.
 *
 * Nomor karyawan dicocokkan dari tabel device_users. Karena nomor WA bisa
 * berbeda dari nomor ID perangkat, yang dicocokkan adalah SEMUA nomor yang
 * terdaftar untuk device_user tersebut — lalu hasilnya disaring dengan
 * pembanding longgar (digit terakhir 9-10), yang lazim dipakai di sini
 * sebagai heuristics karena data perangkat tidak menyimpan nomor telepon.
 *
 * @param {string} phone nomor absolut
 * @returns {Promise<object|null>}
 */
export async function findEmployeeByPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return null;

  // device_users menyimpan employeeNo (nomor ID perangkat) dan name.
  // Cari kandidat dengan nomor ID berakhiran sama seperti nomor WA.
  const candidates = await prisma.deviceUser.findMany({
    where: { enabled: true },
    select: { employeeNo: true, name: true, deviceKey: true },
  });

  const suffix = digits.slice(-9);
  const hits = candidates.filter((c) => {
    const empDigits = String(c.employeeNo || '').replace(/\D/g, '');
    return empDigits.endsWith(suffix) || suffix.endsWith(empDigits);
  });

  if (!hits.length) return null;

  // Prioritaskan device 'masuk' (device utama absensi).
  const primary = hits.find((h) => h.deviceKey === 'masuk') || hits[0];
  return { employeeNo: primary.employeeNo, name: primary.name };
}

/**
 * Format tanggal Indonesia ringkas untuk pesan WhatsApp.
 */
function fmtTanggalId(date = new Date()) {
  const bulan = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  return `${date.getDate()} ${bulan[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Handler default untuk `message.received`.
 *
 * Perintah yang dikenali (case-insensitive, boleh diawali "hai"/"hello"):
 *   - "absen" / "hadir"  → ringkasan kehadiran hari ini
 *   - "laporan"          → ringkasan rekap hari ini
 *   - "bantuan" / "help" → daftar perintah
 *
 * Perintah TIDAK dikenal → dibalas daftar bantuan (supaya user tidak
 * diam saja).
 *
 * @param {object} event ringkasan event
 * @returns {Promise<object>}
 */
async function handleMessageReceived(event) {
  const text = String(event.body || '').trim().toLowerCase();
  const from = event.from || event.chatId;

  // Balas lewat service WhatsApp (gateway atau Baileys) — memakai JID
  // apa adanya, bukan nomor polos.
  const reply = async (message) => {
    try {
      await whatsappService.sendMessage(from, message);
      return { replied: true, message };
    } catch (err) {
      // Kegagalan membalas tidak boleh menggagalkan pemrosesan event —
      // kalau tidak, OpenWA akan mengulang delivery tanpa guna.
      console.warn('[OpenWA Webhook] Gagal membalas:', err.message);
      return { replied: false, error: err.message };
    }
  };

  if (!text) {
    return { action: 'empty', replied: false };
  }

  const isAbsen = /\b(absen|absensi|hadir|check\s*in)\b/.test(text);
  const isLaporan = /\b(laporan|report|rekap|rekapan)\b/.test(text);
  const isBantuan = /\b(bantuan|help|menu|perintah)\b/.test(text);

  if (isBantuan || (!isAbsen && !isLaporan && !/^\s*(hai|halo|hello|hi|ping)\b/.test(text))) {
    await reply(
      'Perintah yang tersedia:\n' +
      '• absen — ringkasan kehadiran hari ini\n' +
      '• laporan — rekap absensi hari ini\n' +
      '• bantuan — daftar perintah ini',
    );
    return { action: 'help' };
  }

  // Hitung data kehadiran hari ini.
  const WIB_MS = 7 * 3600 * 1000;
  const nowWib = new Date(Date.now() + WIB_MS);
  const today = `${nowWib.getFullYear()}-${String(nowWib.getMonth() + 1).padStart(2, '0')}-${String(nowWib.getDate()).padStart(2, '0')}`;
  const dayStart = new Date(`${today}T00:00:00+07:00`);
  const dayEnd = new Date(`${today}T23:59:59+07:00`);

  const records = await prisma.attendanceRecord.findMany({
    where: { time: { gte: dayStart, lte: dayEnd } },
    orderBy: { time: 'asc' },
  });

  const employee = await findEmployeeByPhone(jidToPhone(event.from));

  const lines = [`*Rekap Absensi — ${fmtTanggalId(nowWib)}*`, ''];
  lines.push(`Total aktivitas hari ini: ${records.length}`);

  const masuk = records.filter((r) => r.direction === 'Masuk');
  const keluar = records.filter((r) => r.direction === 'Keluar');
  lines.push(`Masuk: ${masuk.length} | Keluar: ${keluar.length}`);

  if (employee) {
    const own = records.filter((r) => r.employeeName === employee.name);
    lines.push('', `Absensi Anda (${employee.name}):`);
    if (own.length) {
      for (const r of own) {
        const jam = new Date(r.time).toLocaleTimeString('id-ID', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
        });
        lines.push(`• ${jam} — ${r.direction}`);
      }
    } else {
      lines.push('• Belum ada catatan absensi hari ini.');
    }
  } else {
    lines.push('', 'Nomor Anda belum terdaftar di device absensi, jadi data pribadi tidak ditampilkan.');
  }

  await reply(lines.join('\n'));
  return { action: isAbsen ? 'absen' : 'laporan', employee: employee?.name || null, records: records.length };
}

/**
 * Handler untuk `session.status` — status sesi berubah.
 *
 * Fungsinya menyediakan status OpenWA supaya halaman WhatsApp tidak
 * perlu polling terus-menerus. Status dicatat di log server — bukan
 * disimpan ke DB, karena hanya relevan selama proses berjalan.
 */
async function handleSessionStatus(event) {
  const raw = event.eventStatus || 'unknown';
  console.log(`[OpenWA Webhook] Status sesi ${event.sessionId}: ${raw}`);
  return { status: raw };
}

/**
 * Handler untuk `session.authenticated` — sesi terpasang dan siap.
 */
async function handleSessionAuthenticated(event) {
  console.log(`[OpenWA Webhook] Sesi ${event.sessionId} terautentikasi.`);
  return { authenticated: true };
}

/**
 * Handler untuk `session.disconnected` — sesi terputus.
 */
async function handleSessionDisconnected(event) {
  console.warn(`[OpenWA Webhook] Sesi ${event.sessionId} terputus.`);
  return { disconnected: true };
}

// Daftarkan handler default.
//
// CATATAN: handler TIDAK boleh melempar error — error akan tercatat sebagai
// 'failed' dan memicu retry OpenWA. Semua error ditangkap di dispatchEvent().
registerEventHandler('message.received', handleMessageReceived);
registerEventHandler('session.status', handleSessionStatus);
registerEventHandler('session.authenticated', handleSessionAuthenticated);
registerEventHandler('session.disconnected', handleSessionDisconnected);
