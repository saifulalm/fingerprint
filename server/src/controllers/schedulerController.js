// Scheduler controller — CRUD for report schedules + manual trigger
import cron from 'node-cron';
import { schedulerService } from '../services/schedulerService.js';
import prisma from '../db.js';
import { validateGatewayUrl, maskSensitiveUrl } from '../utils/urlGuard.js';
import { loadSettingsMap } from '../services/settingsService.js';

/**
 * Sanitasi satu schedule sebelum dikirim ke frontend.
 *
 * Bug class 56: `waGatewayUrl` per-jadwal bisa memuat token API gateway
 * sebagai query param (mis. `https://fonnte.com/api/send?token=RAHASIA`).
 * Field itu dikirim apa adanya di response POST/PUT/GET /api/scheduler,
 * sehingga token tampil di kolom form Jadwal — bisa di-screenshot, di-copy,
 * dan bocor lewat log browser.
 *
 * Perilaku yang sama seperti Pengaturan:
 *   - Nilai ASLI dikosongkan di response (frontend tidak pernah
 *     menerima token mentah).
 *   - Field `_maskedWaGatewayUrl` berisi versi tersamar untuk
 *     ditampilkan sebagai informasi.
 *   - `hasWaGatewayUrl` memberi tahu apakah nilai lama masih tersimpan.
 */
function sanitizeSchedule(schedule) {
  if (!schedule) return schedule;
  const { waGatewayUrl, ...rest } = schedule;
  const raw = String(waGatewayUrl || '').trim();
  return {
    ...rest,
    // Nilai asli TIDAK pernah dikirim ke browser.
    waGatewayUrl: '',
    _maskedWaGatewayUrl: raw ? maskSensitiveUrl(raw) : '',
    hasWaGatewayUrl: !!raw,
  };
}

async function logAudit(action, detail) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        detail,
        user: 'admin',
      },
    });
  } catch (err) {
    // Jangan ditelan diam-diam. Audit yang gagal menulis = jejak audit
    // yang bolong, dan user tidak akan pernah tahu. Setidaknya catat ke log
    // server supaya masalahnya terlihat.
    console.warn(`[Audit] gagal menulis audit "${action}":`, err.message);
  }
}

// ─── Nilai yang diperbolehkan ────────────────────────────────────────────────
//
// SEBELUMNYA semua field diterima apa adanya. Akibatnya:
//
//   1. `channel: 'emial'` (typo) → jadwal TERDAFTAR dan cron jalan, tapi
//      email tidak pernah terkirim. User mengira jadwal aktif.
//   2. `period: 'lastyear'` → diam-diam jatuh ke default "yesterday".
//   3. `enabled: 'false'` (string) → Prisma menyimpan TRUE, karena string
//      'false' itu truthy di sisi JavaScript. Jadwal yang seharusnya mati
//      justru aktif dan mengirim email.
//   4. `waGatewayUrl` bebas → SSRF (lihat utils/urlGuard.js).
//
// SEKARANG semua field divalidasi, dan nilai di luar daftar ditolak dengan
// pesan yang menyebut nilai yang diperbolehkan.
const ALLOWED_CHANNELS = ['email', 'whatsapp', 'both'];
const ALLOWED_PERIODS = [
  'yesterday',
  'last_week',
  'last_month',
  'last_7d',
  'last_30d',
];
const ALLOWED_LANGS = ['id', 'en'];

/**
 * Validasi dan normalisasi payload jadwal.
 *
 * Async karena satu aturan (validasi URL gateway) perlu membaca host
 * gateway yang dikonfigurasi lewat PENGATURAN — supaya gateway OpenWA
 * lokal yang diisi lewat UI tidak ditolak sebagai SSRF.
 *
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: string }>}
 */
async function validateSchedulePayload(body, { partial = false } = {}) {
  const data = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return { ok: false, error: 'name wajib diisi' };
    if (name.length > 120) return { ok: false, error: 'name maksimal 120 karakter' };
    data.name = name;
  } else if (!partial) {
    return { ok: false, error: 'name wajib diisi' };
  }

  if (body.cronExpr !== undefined) {
    const cronExpr = String(body.cronExpr).trim();
    if (!cronExpr) return { ok: false, error: 'cronExpr wajib diisi' };
    if (!cron.validate(cronExpr)) {
      return { ok: false, error: `Invalid cron expression: "${cronExpr}"` };
    }
    data.cronExpr = cronExpr;
  } else if (!partial) {
    return { ok: false, error: 'cronExpr wajib diisi' };
  }

  if (body.channel !== undefined) {
    const channel = String(body.channel).trim();
    if (!ALLOWED_CHANNELS.includes(channel)) {
      return {
        ok: false,
        error: `channel "${channel}" tidak dikenal. Pilihan: ${ALLOWED_CHANNELS.join(', ')}.`,
      };
    }
    data.channel = channel;
  }

  if (body.period !== undefined) {
    const period = String(body.period).trim();
    if (!ALLOWED_PERIODS.includes(period)) {
      return {
        ok: false,
        error: `period "${period}" tidak dikenal. Pilihan: ${ALLOWED_PERIODS.join(', ')}.`,
      };
    }
    data.period = period;
  }

  if (body.lang !== undefined) {
    const lang = String(body.lang).trim();
    if (!ALLOWED_LANGS.includes(lang)) {
      return { ok: false, error: `lang "${lang}" tidak dikenal. Pilihan: ${ALLOWED_LANGS.join(', ')}.` };
    }
    data.lang = lang;
  }

  // `enabled` harus boolean sejati. String 'false' adalah nilai yang
  // truthy dan akan tersimpan sebagai true — bug yang membuat jadwal
  // mati tetap aktif.
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return { ok: false, error: 'enabled harus berupa true atau false' };
    }
    data.enabled = body.enabled;
  }

  if (body.recipients !== undefined && body.recipients !== null) {
    const recipients = String(body.recipients).trim();
    if (recipients.length > 2000) {
      return { ok: false, error: 'recipients terlalu panjang' };
    }
    data.recipients = recipients;
  }

  // SSRF: URL gateway harus host publik (kecuali yang dikonfigurasi di .env
  // atau lewat Pengaturan UI).
  if (body.waGatewayUrl !== undefined && body.waGatewayUrl !== null) {
    const map = await loadSettingsMap().catch(() => ({}));
    const trusted = [process.env.WA_GATEWAY_URL || '', map.wa_gateway_url || ''];
    const check = validateGatewayUrl(body.waGatewayUrl, trusted);
    if (!check.ok) return { ok: false, error: check.reason };
    data.waGatewayUrl = check.url;
  }

  return { ok: true, data };
}

export async function listSchedules(req, res) {
  try {
    const schedules = await schedulerService.list();
    res.json(schedules.map(sanitizeSchedule));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSchedule(req, res) {
  try {
    const validated = await validateSchedulePayload(req.body || {});
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }
    const data = validated.data;

    const schedule = await prisma.reportSchedule.create({
      data: {
        name: data.name,
        cronExpr: data.cronExpr,
        period: data.period || 'yesterday',
        channel: data.channel || 'email',
        recipients: data.recipients ?? null,
        lang: data.lang || 'id',
        waGatewayUrl: data.waGatewayUrl ?? null,
        enabled: data.enabled ?? true,
      },
    });

    if (schedule.enabled) schedulerService.register(schedule);
    await logAudit('schedule', `Created schedule "${schedule.name}" — cron=${schedule.cronExpr}, channel=${schedule.channel}`);
    res.status(201).json(sanitizeSchedule(schedule));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateSchedule(req, res) {
  try {
    const { id } = req.params;

    const validated = await validateSchedulePayload(req.body || {}, { partial: true });
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }

    const existing = await prisma.reportSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });

    // `waGatewayUrl` kosong berarti "tidak diubah" — sama seperti nilai
    // rahasia di Pengaturan. Server tidak pernah mengirim nilai aslinya ke
    // browser, jadi kolom form selalu kosong; kalau string kosong ikut
    // dikirim, nilai lama yang benar akan TERTIMPA dan hilang.
    if (validated.data.waGatewayUrl === '') {
      delete validated.data.waGatewayUrl;
    }

    const updated = await prisma.reportSchedule.update({
      where: { id },
      data: validated.data,
    });

    schedulerService.register(updated);
    res.json(sanitizeSchedule(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteSchedule(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.reportSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });

    await prisma.reportSchedule.delete({ where: { id } });
    schedulerService.unregister(id);
    await logAudit('schedule', `Deleted schedule "${existing.name}"`);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function toggleSchedule(req, res) {
  try {
    const { id } = req.params;
    const { enabled } = req.body || {};

    // Wajib boolean sejati. String 'false' akan tersimpan sebagai true.
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled harus berupa true atau false' });
    }

    const existing = await prisma.reportSchedule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });

    const updated = await prisma.reportSchedule.update({
      where: { id },
      data: { enabled },
    });

    schedulerService.register(updated);
    res.json(sanitizeSchedule(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function triggerSchedule(req, res) {
  try {
    const { id } = req.params;
    const result = await schedulerService.trigger(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
