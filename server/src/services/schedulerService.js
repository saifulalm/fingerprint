// Scheduler service — node-cron based report job scheduler
// Runs report delivery jobs on schedule, supports email + WhatsApp gateway
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import { buildDetailedReport, pdfToBuffer, reportTitle } from './reportService.js';
import { whatsappService } from './whatsapp.js';
import { fetchAttendanceData } from '../controllers/reportController.js';
import { fmtDateLong, fmtDateShort, fmtDateTimeIndonesia, nowWIB } from '../utils/time.js';
import prisma from '../db.js';
import { loadSettingsMap, settingBool, settingStr, resolveSmtpConfig } from './settingsService.js';
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
//
// Kredensial SMTP diambil dari SATU sumber kebenaran: `resolveSmtpConfig()`.
// Fungsi itu membaca tabel SystemSetting (diisi lewat UI Pengaturan) dan
// otomatis jatuh ke `.env` bila setting DB belum lengkap.
//
// SEBELUMNYA: fungsi ini membaca `smtp_host`/`smtp_user`/`smtp_pass` LANGSUNG
// dari DB saja. Konsekuensinya, instalasi yang kredensialnya ada di `.env`
// (bukan lewat UI) TIDAK PERNAH bisa mengirim email dari scheduler —
// transporter-nya `null` dan jadwal hanya diam-diam dilewati.
//
// Mengganti pembacaan ini dengan `resolveSmtpConfig()` membuat scheduler
// konsisten dengan `emailController` dan `reportController`, yang sudah
// memakai fungsi yang sama sejak awal.
//
// Mengembalikan null bila kredensial belum lengkap — pemanggil yang
// memutuskan apa yang terjadi (tidak diam-diam menandai sukses).
async function getTransporterFromDb() {
  const smtp = await resolveSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
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

  // PENTING — nama field hasil `periodToRange()` adalah `start`/`end`,
  // BUKAN `startDate`/`endDate`.
  //
  // SEBELUMNYA: `const { startDate, endDate } = periodToRange(period);`
  // → kedua variabel bernilai `undefined` karena fungsi itu mengembalikan
  //   `{ start, end }`. Akibatnya `fetchAttendanceData(undefined, undefined)`
  //   → Prisma melempar "Invalid value for argument `gte`: Provided Date
  //   object is invalid" → job SELALU GAGAL, tidak pernah terkirim.
  //
  //   Dan kegagalannya TIDAK terlihat: `executeSchedule` menelan error di
  //   dalam blok catch, sementara `trigger()` tetap membalas `{ success: true }`.
  //   Jadi user melihat badge "sukses" padahal TIDAK ADA email yang pernah
  //   dikirim. Bug ini sudah ada sejak scheduler pertama kali ditulis.
  const range = periodToRange(period);
  const startDate = range.start;
  const endDate = range.end;

  // Penjaga tambahan — bila `periodToRange` diubah di masa depan dan
  // mengembalikan bentuk yang tidak diharapkan, jangan sampai query Prisma
  // menerima `Invalid Date` (error 500 yang tidak informatif).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
    const err = new Error(
      `Rentang tanggal laporan tidak valid (start="${startDate}", end="${endDate}").
       Periksa periode jadwal.`
    );
    err.status = 500;
    // Tandai jadwal sebagai gagal + catat audit, lalu lempar ke pemanggil.
    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRun: new Date(), lastStatus: 'failed', lastError: err.message },
    }).catch(() => { /* abaikan — jangan sampai error masking error asli */ });
    await logAudit('schedule', `Schedule "${name}" FAILED: ${err.message}`, 'scheduler');
    throw err;
  }

  console.log(`[Scheduler] Running "${name}" (${period}) → ${fmtDateLong(startDate)} s/d ${fmtDateLong(endDate)}`);

  // Load DB settings
  const s = await getSettingsMap();
  const workStart = settingStr(s, 'work_start', '09:00');
  const workEnd   = settingStr(s, 'work_end', '17:00');
  const waGateway = waGatewayUrl || s.wa_gateway_url || '';
  // Nama perusahaan dipakai di judul laporan.
  //
  // SEBELUMNYA: `s.company_name || 'Fingerprint System'` — kalau nama
  // perusahaan kosong, judul laporan scheduler menjadi "… — FINGERPRINT
  // SYSTEM", berbeda dari halaman Laporan yang memakai "Laporan Absensi".
  // Dua sumber laporan, dua judul berbeda.
  //
  // Sekarang kosong = pakai judul bawaan, sama seperti halaman Laporan.
  const companyName = String(s.company_name || '').trim();
  // Branding laporan: judul, subjudul, footer custom dari Pengaturan → Umum.
  // SEBELUMNYA ketiga setting ini tidak pernah dibaca scheduler.
  const branding = {
    title:    String(s.report_title || '').trim(),
    subtitle: String(s.report_subtitle || '').trim(),
    footer:   String(s.report_footer || '').trim(),
  };
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
    const { html, text, report } = buildDetailedReport(
      data, stats, effectiveLang, workStart, workEnd, detectLate, startDate, endDate, toleranceMinutes, companyName, branding,
    );
    const recipientsList = (recipients || '').split(',').map(r => r.trim()).filter(Boolean);
    // Gunakan penerima default Pengaturan bila jadwal tidak menentukan.
    const effectiveRecipients = recipientsList.length ? recipientsList : defaultRecipients;
    // Use professional Indonesian date format
    // Subjek memakai judul yang SAMA dengan isi laporan — kalau judulnya
    // custom ("Rekap Bulanan"), subjek email/WhatsApp juga ikut custom.
    //
    // SEBELUMNYA subjek selalu "Laporan Absensi <company>" walau isi
    // PDF-nya titled lain.
    const titleText = reportTitle(
      effectiveLang, companyName,
      effectiveLang === 'id' ? 'Laporan Absensi' : 'Attendance Report',
      branding.title,
    );
    const subjectId = `${titleText} — ${fmtDateLong(startDate)} s/d ${fmtDateLong(endDate)}`;
    const subjectEn = `${titleText} — ${fmtDateLong(startDate)} to ${fmtDateLong(endDate)}`;
    const subject = effectiveLang === 'id' ? subjectId : subjectEn;

    // Ringkasan per kanal — dipakai untuk pesan hasil & audit.
    const sentChannels = [];

    // ─── Lampiran PDF ─────────────────────────────────────────────────────────
    //
    // FEATUR: laporan PDF dilampirkan ke email DAN dikirim sebagai dokumen
    // WhatsApp.
    //
    // ALASAN: penerima biasanya mau Arsipkan/mencetak laporan. Selama ini
    // hanya HTML (email) atau teks ringkasan (WhatsApp) yang terkirim.
    //
    // Objek `report` yang SAMA dipakai untuk HTML → angka di PDF dan HTML
    // dijamin identik.
    //
    // Catatan ukuran: WhatsApp membatasi dokumen ±16 MB. PDF laporan 30 hari
    // bisa cukup besar, jadi kegagalan attach tidak boleh menggagalkan
    // pengiriman teks/HTML — error ditangkap & dicatat.
    const pdfFilename = `laporan-absensi-${startDate}-${endDate}.pdf`;
    let pdfBuffer = null;
    try {
      pdfBuffer = await pdfToBuffer(report, effectiveLang);
    } catch (pdfErr) {
      console.error(`[Scheduler] Gagal membuat lampiran PDF untuk "${name}":`, pdfErr.message);
    }

    if (channel === 'email' || channel === 'both') {
      // Tidak ada penerima = tidak ada yang bisa dikirimi. Ini KEGAGALAN,
      // bukan kondisi yang boleh dilewati diam-diam.
      //
      // SEBELUMNYA kondisi ini hanya memicu `console.warn` dan jadwal tetap
      // ditandai `success`. User melihat badge hijau padahal TIDAK ADA email
      // yang pernah dikirim.
      if (!effectiveRecipients.length) {
        throw new Error(
          'Tidak ada penerima laporan. Isi kolom penerima pada jadwal, ' +
          'atau set "Penerima Default Laporan" di tab Pengaturan.'
        );
      }

      const transporter = await getTransporterFromDb();
      // SMTP belum lengkap = gagal keras. SEBELUMNYA transporter `null`
      // hanya menghasilkan `console.warn` lalu status tetap `success`.
      if (!transporter) {
        throw new Error(
          'SMTP belum dikonfigurasi. Isi Host, Email Pengirim, dan App Password ' +
          'di tab Pengaturan, atau set SMTP_HOST/SMTP_USER/SMTP_PASS di .env.'
        );
      }

      // `from` diambil dari konfigurasi SMTP yang EFEKTIF (DB → env).
      //
      // SEBELUMNYA `from` dibaca dari `s.smtp_from || s.smtp_user` — nilai
      // yang bisa KOSONG bila kredensial hanya ada di `.env`. Nodemailer
      // lalu gagal dengan "No 'from' field" ATAU email terkirim dengan
      // pengirim kosong. Sekarang sumbernya satu: `resolveSmtpConfig()`.
      const smtp = await resolveSmtpConfig();
      const mailFrom = smtp.from || smtp.user;
      if (!mailFrom) {
        throw new Error('Alamat pengirim email kosong. Set smtp_from atau SMTP_FROM.');
      }

      const attachments = [];
      if (pdfBuffer) {
        attachments.push({
          filename: pdfFilename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        });
      }

      await transporter.sendMail({
        from: mailFrom,
        to: effectiveRecipients.join(', '),
        subject,
        html,
        text,
        attachments,
      });
      sentChannels.push('email');
      console.log(
        `[Scheduler] Email sent for "${name}" → ${effectiveRecipients.join(', ')}` +
        `${attachments.length ? ` | lampiran: ${attachments[0].filename} (${pdfBuffer.length} bytes)` : ''}`,
      );
    }

    if (channel === 'whatsapp' || channel === 'both') {
      // Sama seperti email: gateway/penerima kosong = kegagalan nyata.
      if (!effectiveRecipients.length) {
        throw new Error(
          'Tidak ada penerima laporan untuk WhatsApp. Isi kolom penerima pada ' +
          'jadwal, atau set "Penerima Default Laporan" di tab Pengaturan.'
        );
      }
      if (!waGateway) {
        throw new Error(
          'URL gateway WhatsApp belum dikonfigurasi. Set "WA Gateway URL" di tab ' +
          'Pengaturan, atau set WA_GATEWAY_URL di .env.'
        );
      }

      for (const recipient of effectiveRecipients) {
        await sendViaGateway(waGateway, recipient, text);
      }
      sentChannels.push('whatsapp');
      console.log(`[Scheduler] WhatsApp sent for "${name}" to ${effectiveRecipients.length} recipient(s)`);

      // ─── Lampiran PDF via WhatsApp ──────────────────────────────────────────
      //
      // FEATUR: PDF laporan dikirim sebagai dokumen WhatsApp (bukan cuma teks
      // ringkasan).
      //
      // Dua jalur gateway:
      //   - OpenWA   → `POST /api/sessions/:id/messages/send-document`
      //   - Baileys  → `sock.sendMessage(jid, { document })`
      // keduanya ditangani `whatsappService.sendDocument()`.
      //
      // Gatekeeper URL (SSRF) tetap berlaku — `sendDocument()` memakai
      // `resolveGatewayUrl()` yang sudah divalidasi.
      if (pdfBuffer) {
        const caption = effectiveLang === 'id'
          ? `Laporan absensi ${fmtDateLong(startDate)} s/d ${fmtDateLong(endDate)}`
          : `Attendance report ${fmtDateLong(startDate)} to ${fmtDateLong(endDate)}`;

        for (const recipient of effectiveRecipients) {
          try {
            await whatsappService.sendDocument(
              recipient, pdfBuffer, pdfFilename, 'application/pdf', caption,
            );
            console.log(`[Scheduler] WhatsApp document sent to ${recipient} (${pdfBuffer.length} bytes)`);
          } catch (docErr) {
            // Lampiran gagal → pesan teks sudah terkirim. Jangan gagalkan
            // seluruh job hanya karena satu dokumen tidak bisa dikirim.
            console.error(
              `[Scheduler] Gagal kirim dokumen WhatsApp ke ${recipient}:`, docErr.message,
            );
          }
        }
      }
    }

    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRun: new Date(), lastStatus: 'success', lastError: null },
    });
    await logAudit(
      'schedule',
      `Schedule "${name}" ran successfully — ${sentChannels.join('+')} to ${effectiveRecipients.length} recipient(s)`,
      'scheduler'
    );
    console.log(`[Scheduler] ✓ "${name}" completed successfully`);

    // Kembalikan ringkasan supaya pemanggil (mis. trigger manual) bisa
    // memberi tahu user email benar-benar terkirim.
    return {
      success: true,
      channels: sentChannels,
      recipients: effectiveRecipients,
      period: { startDate, endDate },
    };
  } catch (err) {
    console.error(`[Scheduler] ✗ "${name}" failed:`, err.message);
    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRun: new Date(), lastStatus: 'failed', lastError: err.message },
    });
    await logAudit('schedule', `Schedule "${name}" FAILED: ${err.message}`, 'scheduler');

    // Rethrow supaya pemanggil manual (POST /:id/trigger) tahu job-nya
    // GAGAL dan tidak membalas "success" ke user.
    //
    // SEBELUMNYA error ditelan di sini, jadi `trigger()` selalu balas
    // `{ success: true }` — user menekan "Kirim Sekarang", melihat toast
    // sukses, padahal email TIDAK pernah dikirim.
    throw err;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const schedulerService = {

  /**
   * Load all enabled schedules from DB and register cron jobs.
   *
   * Scheduler bisa dimatikan lewat env `SCHEDULER_ENABLED=false` — berguna
   * untuk instalasi yang hanya memakai pemicu manual, atau untuk mencegah
   * pengiriman email berulang saat server sedang diuji.
   *
   * Nilai env yang diterima: 'false' | '0' | 'no' | 'off' (case-insensitive).
   */
  async init() {
    const disabled = ['false', '0', 'no', 'off'].includes(
      String(process.env.SCHEDULER_ENABLED || '').trim().toLowerCase()
    );
    if (disabled) {
      console.log('[Scheduler] Dinonaktifkan lewat SCHEDULER_ENABLED=false — tidak ada job yang didaftarkan');
      return;
    }

    const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true } });
    for (const s of schedules) this.register(s);
    console.log(`[Scheduler] Initialised — ${schedules.length} job(s) registered`);
  },

  /**
   * Register (or re-register) a single schedule.
   *
   * PENTING — data diambil dari DB SAAT JOB DIJALANKAN, bukan dari snapshot
   * saat registrasi.
   *
   * SEBELUMNYA: `cron.schedule(cronExpr, () => executeSchedule(schedule))`
   * memakai objek `schedule` yang tertangkap saat registrasi. Kalau user
   * mengubah jadwal (mis. ganti penerima, ubah periode, matikan jadwal),
   * job yang sudah terdaftar masih menjalankan konfigurasi LAMA sampai
   * server di-restart. Akibatnya laporan bisa terkirim ke penerima yang
   * sudah dihapus.
   *
   * SEKARANG: setiap tick membaca row terbaru dari DB. Perubahan dari UI
   * langsung berlaku tanpa restart.
   */
  register(schedule) {
    const { id, cronExpr, enabled } = schedule;
    this.unregister(id);
    if (!enabled) return;

    if (!cron.validate(cronExpr)) {
      console.warn(`[Scheduler] Invalid cron "${cronExpr}" for schedule ${id}`);
      return;
    }

    const job = cron.schedule(cronExpr, async () => {
      try {
        // Ambil data terbaru — jadwal bisa saja diubah/di-toggle dari UI
        // sejak job ini didaftarkan.
        const fresh = await prisma.reportSchedule.findUnique({ where: { id } });

        // Jadwal dihapus atau dimatikan → jangan jalankan.
        if (!fresh || !fresh.enabled) {
          console.log(`[Scheduler] Job ${id} dilewati — jadwal dihapus atau dinonaktifkan`);
          return;
        }

        await executeSchedule(fresh);
      } catch (err) {
        // Error sudah dicatat & di-audit di dalam executeSchedule.
        // Di sini cukup log ringkas agar tidak ada unhandled rejection.
        console.error(`[Scheduler] Job ${id} error:`, err.message);
      }
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

  /**
   * Run a schedule immediately (manual trigger).
   *
   * Mengembalikan ringkasan hasil yang BENAR-BENAR terjadi (kanal yang
   * terkirim, penerima, periode laporan).
   *
   * SEBELUMNYA: selalu `{ success: true }` apa pun yang terjadi di dalam
   * `executeSchedule`. Error (SMTP mati, penerima kosong, perangkat offline)
   * ditelan sehingga user melihat toast sukses padahal email TIDAK pernah
   * terkirim. Sekarang error dilempar dan `triggerSchedule` membalas 500
   * dengan pesan yang bisa ditindaklanjuti.
   */
  async trigger(id) {
    const schedule = await prisma.reportSchedule.findUnique({ where: { id } });
    if (!schedule) throw new Error('Schedule not found');

    const result = await executeSchedule(schedule);

    return {
      success: true,
      channels: result.channels,
      recipients: result.recipients,
      period: result.period,
    };
  },
};
