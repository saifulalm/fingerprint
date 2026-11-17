// Scheduler service — node-cron based report job scheduler
// Runs report delivery jobs on schedule, supports email + WhatsApp gateway
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import { buildDetailedReport } from './reportService.js';
import { fetchAttendanceData } from '../controllers/reportController.js';
import { fmtDateLong, fmtDateShort, fmtDateTimeIndonesia, nowWIB } from '../utils/time.js';
import prisma from '../db.js';
import { loadSettingsMap, settingBool, settingStr } from './settingsService.js';
import { assertGatewayUrlAllowed } from '../utils/urlGuard.js';

// ─── State ─────────────────────────────────────────────────────────────────────
const jobs = new Map(); // scheduleId → cron job
const WIB_MS = 7 * 60 * 60 * 1000;

// ─── Period → date range ──────────────────────────────────────────────────────
function periodToRange(period) {
  const now = new Date(Date.now() + WIB_MS);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const subDays = (d, n) => {
    const r = new Date(d); r.setDate(r.getDate() - n);
    return { start: r.toISOString().slice(0, 10), end: r.toISOString().slice(0, 10) };
  };

  switch (period) {
    case 'yesterday': return subDays(today, 1);
    case 'last_week': return { start: subDays(today, 7).start, end: subDays(today, 1).end };
    case 'last_month': return { start: subDays(today, 30).start, end: subDays(today, 1).end };
    case 'last_7d': return { start: subDays(today, 6).start, end: subDays(today, 0).end };
    case 'last_30d': return { start: subDays(today, 29).start, end: subDays(today, 0).end };
    default: return subDays(today, 1);
  }
}

// ─── Load settings from DB (cached, refreshes on each job run) ──────────────────
async function getSettingsMap() {
  return loadSettingsMap();
}

// ─── Build transporter from DB settings ─────────────────────────────────────────
async function getTransporterFromDb() {
  const s = await getSettingsMap();
  const host = s.smtp_host, user = s.smtp_user, pass = s.smtp_pass;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(s.smtp_port) || 587,
    secure: settingBool(s, 'smtp_secure', false),
    auth: { user, pass },
  });
}

// ─── Send via WhatsApp gateway ────────────────────────────────────────────────
//
// KEAMANAN — SSRF: URL gateway berasal dari input user. Sebelum di-fetch,
// URL diperiksa lagi (lapisan kedua; lapis pertama ada di controller saat
// penyimpanan). Tanpa ini, URL yang diubah langsung di database atau lewat
// jalur lain bisa membuat server POST ke alamat jaringan internal.
async function sendViaGateway(url, phone, text) {
  if (!url) return;
  // Host gateway yang dikonfigurasi lewat PENGATURAN ikut dipercaya —
  // kalau tidak, gateway OpenWA lokal (127.0.0.1) yang diisi lewat UI
  // akan ditolak sebagai SSRF dan scheduler tidak pernah bisa mengirim.
  const settings = await getSettingsMap().catch(() => ({}));
  assertGatewayUrlAllowed(url, [settings.wa_gateway_url || '']);
  const phoneClean = String(phone).replace(/\D/g, '');
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: phoneClean, message: text }),
  });
}

// ─── Audit helper ──────────────────────────────────────────────────────────────
async function logAudit(action, detail, user = 'scheduler') {
  try {
    await prisma.auditLog.create({ data: { action, detail, user } });
  } catch (err) {
    // Audit gagal menulis harus TERLIHAT. `catch (_) {}` membuat jejak audit
    // bolong tanpa jejak apa pun — persis bug yang mematikan audit sejak Oktober.
    console.warn(`[Audit] gagal menulis audit "${action}":`, err.message);
  }
}

// ─── Execute one schedule ──────────────────────────────────────────────────────
async function executeSchedule(schedule) {
  const { id, name, period, channel, recipients, lang, waGatewayUrl } = schedule;
  const { startDate, endDate } = periodToRange(period);

  console.log(`[Scheduler] Running "${name}" (${period}) → ${fmtDateLong(startDate)} s/d ${fmtDateLong(endDate)}`);

  // Load DB settings
  const s = await getSettingsMap();
  const workStart = settingStr(s, 'work_start', '09:00');
  const workEnd   = settingStr(s, 'work_end', '17:00');
  const smtpFrom  = s.smtp_from || s.smtp_user || '';
  const waGateway = waGatewayUrl || s.wa_gateway_url || '';
  const companyName = s.company_name || 'Fingerprint System';
  const detectLate = settingBool(s, 'detect_late', true);
  const toleranceMinutes = parseInt(s.late_threshold_minutes, 10) || 0;
  // Bahasa laporan default dari Pengaturan dipakai bila jadwal tidak
  // menentukan sendiri. SEBELUMNYA setting `report_lang` tidak pernah dibaca
  // server — user memilih "English" di Pengaturan tapi laporan tetap Indonesia.
  const effectiveLang = lang || settingStr(s, 'report_lang', '') || 'id';

  // Penerima default dari Pengaturan dipakai bila jadwal tidak punya penerima
  // sendiri. SEBELUMNYA setting `report_default_recipients` tidak pernah
  // dibaca di scheduler — user mengisinya tapi jadwal tetap gagal terkirim.
  const defaultRecipients = (s.report_default_recipients || '')
    .split(',').map(r => r.trim()).filter(Boolean);

  try {
    const { data, stats } = await fetchAttendanceData(startDate, endDate, workStart, workEnd);
    const { html, text } = buildDetailedReport(
      data, stats, effectiveLang, workStart, workEnd, detectLate, startDate, endDate, toleranceMinutes,
    );
    const recipientsList = (recipients || '').split(',').map(r => r.trim()).filter(Boolean);
    // Gunakan penerima default Pengaturan bila jadwal tidak menentukan.
    const effectiveRecipients = recipientsList.length ? recipientsList : defaultRecipients;
    // Use professional Indonesian date format
    const subjectId = `Laporan Absensi ${companyName} — ${fmtDateLong(startDate)} s/d ${fmtDateLong(endDate)}`;
    const subjectEn = `Attendance Report ${companyName} — ${fmtDateLong(startDate)} to ${fmtDateLong(endDate)}`;
    const subject = effectiveLang === 'id' ? subjectId : subjectEn;

    if (channel === 'email' || channel === 'both') {
      const transporter = await getTransporterFromDb();
      if (transporter && effectiveRecipients.length) {
        await transporter.sendMail({
          from: smtpFrom,
          to: effectiveRecipients.join(', '),
          subject,
          html,
          text,
        });
        console.log(`[Scheduler] Email sent for "${name}"`);
      } else {
        console.warn(`[Scheduler] SMTP not configured or no recipients for "${name}"`);
      }
    }

    if (channel === 'whatsapp' || channel === 'both') {
      if (waGateway && effectiveRecipients.length) {
        for (const recipient of effectiveRecipients) {
          await sendViaGateway(waGateway, recipient, text);
        }
        console.log(`[Scheduler] WhatsApp sent for "${name}" to ${effectiveRecipients.length} recipient(s)`);
      } else {
        console.warn(`[Scheduler] WA gateway not configured or no recipients for "${name}"`);
      }
    }

    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRun: new Date(), lastStatus: 'success', lastError: null },
    });
    await logAudit('schedule', `Schedule "${name}" ran successfully — ${channel} to ${effectiveRecipients.length} recipient(s)`, 'scheduler');
    console.log(`[Scheduler] ✓ "${name}" completed successfully`);
  } catch (err) {
    console.error(`[Scheduler] ✗ "${name}" failed:`, err.message);
    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRun: new Date(), lastStatus: 'failed', lastError: err.message },
    });
    await logAudit('schedule', `Schedule "${name}" FAILED: ${err.message}`, 'scheduler');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const schedulerService = {

  /** Load all enabled schedules from DB and register cron jobs */
  async init() {
    const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true } });
    for (const s of schedules) this.register(s);
    console.log(`[Scheduler] Initialised — ${schedules.length} job(s) registered`);
  },

  /** Register (or re-register) a single schedule */
  register(schedule) {
    const { id, cronExpr, enabled } = schedule;
    this.unregister(id);
    if (!enabled) return;

    if (!cron.validate(cronExpr)) {
      console.warn(`[Scheduler] Invalid cron "${cronExpr}" for schedule ${id}`);
      return;
    }

    const job = cron.schedule(cronExpr, () => {
      executeSchedule(schedule).catch(err => console.error(`[Scheduler] Job ${id} error:`, err.message));
    }, { timezone: 'Asia/Jakarta' });

    jobs.set(id, job);
    console.log(`[Scheduler] Registered: "${schedule.name}" — ${cronExpr} (${schedule.period})`);
  },

  /** Remove a schedule without touching DB */
  unregister(id) {
    const job = jobs.get(id);
    if (job) { job.stop(); jobs.delete(id); }
  },

  /** Refresh all jobs from DB — call after create/update/delete */
  async reload() {
    const schedules = await prisma.reportSchedule.findMany();
    for (const [id] of jobs) {
      if (!schedules.find(s => s.id === id)) this.unregister(id);
    }
    for (const s of schedules) this.register(s);
  },

  /** List all schedules */
  async list() {
    return prisma.reportSchedule.findMany({ orderBy: { createdAt: 'asc' } });
  },

  /** Run a schedule immediately (manual trigger) */
  async trigger(id) {
    const schedule = await prisma.reportSchedule.findUnique({ where: { id } });
    if (!schedule) throw new Error('Schedule not found');
    await executeSchedule(schedule);
    return { success: true };
  },
};
