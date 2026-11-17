// Report controller — email, WhatsApp preview, export, and HTML preview endpoints
import nodemailer from 'nodemailer';
import { dateKey, dayOfWeek, dayOfWeekShort, fmtDateLong, fmtDateLongLang, fmtDateShort, fmtDateShortLang, fmtDateTimeFull, fmtDateTimeIndonesia, fmtDateTimeLang, fmtTime, fmtWIBShort, isValidDateStr, nowWIB, wibRangeToUtc } from '../utils/time.js';
import { buildDetailedReport, buildExportReport } from '../services/reportService.js';
import { syncRangeToDb, checkRangeCoverage } from '../services/attendanceSyncService.js';
import { loadSettingsMap, settingStr, settingBool, settingInt, resolveSmtpConfig } from '../services/settingsService.js';
import prisma from '../db.js';
import { createNameResolver } from '../services/employeeIdentityService.js';
import { whatsappService } from '../services/whatsapp.js';

const DEFAULT_WORK_START = '09:00';
const DEFAULT_WORK_END = '17:00';

// ─── Auto-sync: pastikan laporan tidak pernah kosong ───────────────────────────
//
// MASALAH: laporan dibangun HANYA dari tabel attendance_records. Bila sync
// terakhir tertinggal (mis. server dimatikan semalaman), laporan periode
// terkini kosong padahal perangkat sudah punya datanya.
//
// SOLUSI: sebelum membangun laporan, cek cakupan DB untuk rentang tersebut.
// Bila kosong atau data terbaru tertinggal, sinkronkan dari perangkat dulu.
//
// Jaga:
//   - Rentang > 31 hari tidak disinkronkan otomatis (terlalu lama).
//   - Memo per rentang mencegah sync berulang dalam window waktu tertentu.
const AUTO_SYNC_MAX_DAYS = 31;
const AUTO_SYNC_TTL_MS = 5 * 60 * 1000;
const autoSyncMemo = new Map();

/**
 * Pastikan data rentang tertentu tersedia di DB; sinkronkan bila perlu.
 * @returns {Promise<{ synced:boolean, count:number }>}
 */
async function ensureRangeSynced(startDate, endDate) {
  const days = Math.round(
    (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000,
  ) + 1;
  if (!Number.isFinite(days) || days < 1 || days > AUTO_SYNC_MAX_DAYS) {
    return { synced: false, count: 0 };
  }

  const memoKey = `${startDate}|${endDate}`;
  const memo = autoSyncMemo.get(memoKey);
  const now = Date.now();

  // Sudah disinkronkan belakangan ini dalam TTL → jangan ulang.
  if (memo && now - memo.at < AUTO_SYNC_TTL_MS) {
    return { synced: false, count: memo.count };
  }

  const { count } = await checkRangeCoverage(startDate, endDate);

  // Data sudah ada → cukup catat, tidak perlu menyentuh perangkat.
  if (count > 0) {
    autoSyncMemo.set(memoKey, { at: now, count });
    return { synced: false, count };
  }

  // Kosong → sinkronkan dari perangkat.
  console.log(`[report] Auto-sync ${startDate}..${endDate} (DB kosong untuk rentang ini)`);
  const result = await syncRangeToDb(startDate, endDate);
  const after = await checkRangeCoverage(startDate, endDate);
  autoSyncMemo.set(memoKey, { at: now, count: after.count });
  console.log(`[report] Auto-sync selesai: ${result.synced} event, DB kini ${after.count} record`);
  return { synced: true, count: after.count };
}

// ─── Helper: resolver nama karyawan ───────────────────────────────────────────
//
// Salinan `buildEmployeeNameMap()` yang tadinya ada di sini sudah dihapus.
// Shapanya hampir sama, tapi TIDAK identik dengan versi controller lain —
// dan perbedaan itulah yang membuat laporan sometimes menampilkan nama yang
// berbeda dari absensi untuk orang yang sama.
//
// Sekarang semua memakai `employeeIdentityService`: satu sumber kebenaran,
// sekaligus menerapkan pemetaan alias untuk memperbaiki konflik nomor ID
// (nomor ID yang sama menunjuk nama berbeda di dua perangkat).


// Parse time string "HH:MM" to minutes since midnight (0-1439)
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// Calculate late minutes (positive number of minutes late)
function calcLateMinutes(firstIn, thresholdStart) {
  if (!firstIn || firstIn === '-') return 0;
  const first = timeToMinutes(firstIn);
  const threshold = timeToMinutes(thresholdStart);
  if (first === null || threshold === null) return 0;
  const late = first - threshold;
  return late > 0 ? late : 0;
}

// Calculate early leave minutes (positive number of minutes early)
function calcEarlyLeave(lastOut, thresholdEnd) {
  if (!lastOut || lastOut === '-') return 0;
  const last = timeToMinutes(lastOut);
  const threshold = timeToMinutes(thresholdEnd);
  if (last === null || threshold === null) return 0;
  const early = threshold - last;
  return early > 0 ? early : 0;
}

// ─── Helper: fetch attendance data from DB ─────────────────────────────────────
export async function fetchAttendanceData(startDate, endDate, workStart = DEFAULT_WORK_START, workEnd = DEFAULT_WORK_END) {
  // Batas query harus mengikuti zona WIB, bukan UTC. Data tersimpan sebagai UTC
  // yang setara jam WIB, sehingga memakai T00:00:00Z memotong 7 jam pertama
  // setiap hari. Lihat wibRangeToUtc() di utils/time.js.
  const where = {
    time: wibRangeToUtc(startDate, endDate),
  };

  const records = await prisma.attendanceRecord.findMany({
    where,
    orderBy: { time: 'desc' },
  });

  const statsGroup = await prisma.attendanceRecord.groupBy({
    by: ['deviceKey'],
    where,
    _count: true,
  });

  // Build unified name map from DeviceUser table
  const resolver = await createNameResolver();

  const enrichRecord = (r) => {
    const t = r.time instanceof Date ? r.time : new Date(r.time);
    const displayName = resolver.name(r.employeeNo, r.deviceKey);
    return {
      employeeNo:    r.employeeNo,
      name:          displayName,
      time:          t instanceof Date ? t.toISOString() : String(r.time),
      timeFormatted: t instanceof Date ? t.toISOString() : String(r.time),
      date:          fmtDateShort(r.time),
      dateKey:       dateKey(r.time),
      timeOnly:      fmtTime(r.time),
      dayOfWeek:     dayOfWeek(r.time),
      direction:     r.deviceKey === 'masuk' ? 'Masuk' : 'Keluar',
      deviceKey:     r.deviceKey,
      userType:      r.userType || 'Normal',
      verifyMode:    r.verifyMode || 'Unknown',
      cardNo:        r.cardNo || '-',
      deviceLabel:   r.deviceLabel || null,
      deviceIP:      r.deviceIP || null,
    };
  };

  const data = records.map(enrichRecord);
  const stats = {
    totalEvents: records.length,
    totalMasuk:  statsGroup.find(s => s.deviceKey === 'masuk')?._count || 0,
    totalKeluar: statsGroup.find(s => s.deviceKey === 'keluar')?._count || 0,
    uniqueUsers: [...new Set(records.map(r => r.employeeNo))].length,
    uniqueDays:  [...new Set(records.map(r => dateKey(r.time)))].length,
  };

  return { data, stats };
}

// ─── Helper: build nodemailer transporter ─────────────────────────────────────
//
// Konfigurasi SMTP diambil dari PENGATURAN (UI) dengan fallback ke env.
//
// SEBELUMNYA: `config.smtp` (env SAJA) — setting SMTP yang diisi lewat UI
// Pengaturan TIDAK BERPAKTIU. User mengisi form, klik Simpan, melihat
// "tersimpan", tapi laporan tetap dikirim lewat .env (atau gagal karena
// .env kosong).
//
// Fungsi ini SEKARANG async karena harus membaca DB.
async function buildTransporter() {
  const smtp = await resolveSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass) {
    throw new Error('SMTP belum dikonfigurasi. Isi pengaturan Email/SMTP di tab Pengaturan.');
  }
  return nodemailer.createTransport({
    host:   smtp.host,
    port:   smtp.port,
    secure: smtp.secure,
    auth:   { user: smtp.user, pass: smtp.pass },
  });
}

// ─── Helper: default recipients from env ──────────────────────────────────────
//
// Prioritas: query param ?recipients= → setting `report_default_recipients`
// (disimpan dari UI Pengaturan) → env REPORT_DEFAULT_RECIPIENTS.
//
// SEBELUMNYA setting `report_default_recipients` tidak pernah dibaca — user
// mengisinya di Pengaturan tapi laporan tetap memakai env/kosong.
async function getDefaultRecipients() {
  // 1) Setting dari UI Pengaturan (tab Pengaturan di halaman WhatsApp)
  try {
    const map = await loadSettingsMap();
    const fromSetting = settingStr(map, 'report_default_recipients', '').trim();
    if (fromSetting) {
      const list = fromSetting.split(',').map(r => r.trim()).filter(Boolean);
      if (list.length) return list;
    }
  } catch (err) {
    console.warn('[report] Gagal membaca report_default_recipients:', err.message);
  }

  // 2) Fallback ke environment variable
  return process.env.REPORT_DEFAULT_RECIPIENTS
    ? process.env.REPORT_DEFAULT_RECIPIENTS.split(',').map(r => r.trim()).filter(Boolean)
    : [];
}

// ─── Helper: resolve parameter laporan dari query + pengaturan sistem ─────────
//
// Parameter query (dari UI Laporan) selalu menang. Bila parameter tidak
// dikirim, nilai diambil dari Pengaturan (tab Pengaturan di halaman
// WhatsApp) — sehingga pengaturan jam kerja, deteksi terlambat, toleransi,
// dan bahasa default benar-benar berlaku.
//
// `toleranceMinutes` TIDAK ada di query — selalu dari Pengaturan.
async function resolveReportParams(query = {}) {
  const map = await loadSettingsMap().catch(() => ({}));
  const workStart = query.workStart || settingStr(map, 'work_start', DEFAULT_WORK_START);
  const workEnd   = query.workEnd   || settingStr(map, 'work_end',   DEFAULT_WORK_END);
  const detectLate = query.detectLate !== undefined
    ? (query.detectLate === 'true' || query.detectLate === true)
    : settingBool(map, 'detect_late', true);
  const toleranceMinutes = settingInt(map, 'late_threshold_minutes', 0);
  const companyName = settingStr(map, 'company_name', '');
  // Bahasa laporan default dari Pengaturan dipakai bila query tidak menyebut
  // `lang`. SEBELUMNYA setting `report_lang` tidak pernah dibaca server —
  // user memilih "English" di Pengaturan tapi laporan tetap mengikuti env.
  const lang = query.lang || settingStr(map, 'report_lang', '') || process.env.REPORT_DEFAULT_LANG || 'en';
  return { workStart, workEnd, detectLate, toleranceMinutes, companyName, lang };
}

// ─── GET /api/report/preview ────────────────────────────────────────────────────
// Returns full HTML for browser preview
// Query: startDate, endDate, lang (en|id), workStart, workEnd, detectLate
export async function getReportPreview(req, res) {
  try {
    const {
      startDate,
      endDate,
      lang: langParam,
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos dan berakhir jadi HTTP 500 di Prisma.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    const { workStart, workEnd, detectLate: isLateEnabled, toleranceMinutes, lang } =
      await resolveReportParams({ ...req.query, lang: langParam });

    await ensureRangeSynced(startDate, endDate);
    const { data, stats } = await fetchAttendanceData(startDate, endDate, workStart, workEnd);
    const { html } = buildDetailedReport(
      data, stats, lang, workStart, workEnd, isLateEnabled, startDate, endDate, toleranceMinutes,
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(html);
  } catch (err) {
    console.error('[report/preview]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/report/email ──────────────────────────────────────────────────────
// Sends detailed HTML email with attendance report
// Query: startDate, endDate, lang (en|id), recipients (comma-separated, optional), workStart, workEnd, detectLate
export async function sendReportEmail(req, res) {
  try {
    const {
      startDate,
      endDate,
      lang: langParam,
      recipients: recipientsParam,
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos dan berakhir jadi HTTP 500 di Prisma.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    const recipientsList = recipientsParam
      ? recipientsParam.split(',').map(r => r.trim()).filter(Boolean)
      : await getDefaultRecipients();

    if (!recipientsList.length) {
      return res.status(400).json({ error: 'Tidak ada penerima laporan. Atur REPORT_DEFAULT_RECIPIENTS di .env atau isi kolom penerima.' });
    }

    const { workStart, workEnd, detectLate: isLateEnabled, toleranceMinutes, companyName, lang } =
      await resolveReportParams({ ...req.query, lang: langParam });

    await ensureRangeSynced(startDate, endDate);
    const { data, stats } = await fetchAttendanceData(startDate, endDate, workStart, workEnd);
    const { html, text } = buildDetailedReport(
      data, stats, lang, workStart, workEnd, isLateEnabled, startDate, endDate, toleranceMinutes,
    );

    const smtp = await resolveSmtpConfig();
    const transporter = await buildTransporter();

    // Subjek email mengikuti bahasa laporan (bukan hardcoded English) dan
    // menyertakan nama perusahaan dari Pengaturan bila diisi.
    const subjDate = `${fmtDateShortLang(startDate, lang)} - ${fmtDateShortLang(endDate, lang)}`;
    const companySuffix = companyName ? ` - ${companyName}` : '';
    const subject = lang === 'id'
      ? `Laporan Absensi${companySuffix} - ${subjDate}`
      : `Attendance Report${companySuffix} - ${subjDate}`;

    const sentToLabel = lang === 'id' ? 'Dikirim kepada' : 'Sent to';
    const htmlWithMeta = html.replace('</body>', `
<div style="padding:20px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
  <p style="margin:0 0 6px;font-size:12px;color:#64748b">
    ${sentToLabel}: ${recipientsList.join(', ')}
  </p>
</div></body>`);

    await transporter.sendMail({
      from:    smtp.from || smtp.user,
      to:      recipientsList.join(', '),
      subject,
      html:    htmlWithMeta,
      text,
    });

    console.log(`[report/email] Sent to ${recipientsList.join(', ')} | period: ${startDate}–${endDate} | lang: ${lang}`);
    res.json({
      success: true,
      message: lang === 'id'
        ? `Laporan absensi terkirim ke ${recipientsList.length} penerima`
        : `Report email sent to ${recipientsList.length} recipient(s)`,
      recipients: recipientsList,
      stats,
    });
  } catch (err) {
    console.error('[report/email]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/report/export ─────────────────────────────────────────────────────
// Downloads attendance report as Excel, PDF, or HTML file
// Query: startDate, endDate, lang (en|id), format (excel|pdf|html), workStart, workEnd, detectLate
export async function getReportExport(req, res) {
  try {
    const {
      startDate,
      endDate,
      lang: langParam,
      format = 'excel',
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos dan berakhir jadi HTTP 500 di Prisma.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    const validFormats = ['excel', 'pdf', 'html'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: `format must be one of: ${validFormats.join(', ')}` });
    }

    const { workStart, workEnd, detectLate: isLateEnabled, toleranceMinutes, lang } =
      await resolveReportParams({ ...req.query, lang: langParam });

    await ensureRangeSynced(startDate, endDate);
    const { data, stats } = await fetchAttendanceData(startDate, endDate, workStart, workEnd);

    if (format === 'excel') {
      const wb = buildExportReport(data, stats, lang, 'excel', workStart, workEnd, isLateEnabled, startDate, endDate, toleranceMinutes);
      const filename = `attendance-report-${startDate}-${endDate}.xlsx`;

      // Mode 'base64' — lihat catatan pada cabang 'pdf' di bawah.
      if (req.query.encoding === 'base64') {
        const { PassThrough } = await import('stream');
        const sink = new PassThrough();
        const chunks = [];
        sink.on('data', c => chunks.push(c));
        await wb.xlsx.write(sink);
        return res.json({
          filename,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          encoding: 'base64',
          data: Buffer.concat(chunks).toString('base64'),
        });
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
      return;
    }

    if (format === 'pdf') {
      const doc = buildExportReport(data, stats, lang, 'pdf', workStart, workEnd, isLateEnabled, startDate, endDate, toleranceMinutes);
      const filename = `attendance-report-${startDate}-${endDate}.pdf`;

      // Mode 'base64' mengirim PDF sebagai JSON. Dipakai sebagai fallback
      // ketika browser extension (mis. Internet Download Manager) meng-intercept
      // respons dengan Content-Type application/pdf dan menggantinya dengan
      // 204 kosong — JSON tidak terblokir, jadi file tetap bisa diunduh.
      if (req.query.encoding === 'base64') {
        const chunks = [];
        // doc.end() harus dipanggil SEBELUM iterasi, jika tidak stream tidak
        // pernah selesai dan request akan hang.
        doc.end();
        for await (const chunk of doc) chunks.push(chunk);
        const base64 = Buffer.concat(chunks).toString('base64');
        return res.json({ filename, mime: 'application/pdf', encoding: 'base64', data: base64 });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      doc.pipe(res);
      doc.end();
      return;
    }

    // HTML — return as downloadable file
    const { html } = buildExportReport(data, stats, lang, 'html', workStart, workEnd, isLateEnabled, startDate, endDate, toleranceMinutes);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${startDate}-${endDate}.html"`);
    res.send(html);
  } catch (err) {
    console.error('[report/export]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/report/whatsapp ───────────────────────────────────────────────────
// Sends a WhatsApp-friendly text summary
// Query: startDate, endDate, recipients (comma-separated phone numbers, optional)
// Returns the WhatsApp-formatted text — integrate with WA gateway as needed
export async function sendReportWhatsApp(req, res) {
  try {
    const {
      startDate,
      endDate,
      recipients: recipientsParam,
      lang = process.env.REPORT_DEFAULT_LANG || 'en',
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos dan berakhir jadi HTTP 500 di Prisma.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    const language = (lang === 'id' || lang === 'id-ID') ? 'id' : 'en';

    // Nomor default WhatsApp dari Pengaturan dipakai bila parameter
    // `recipients` tidak diberikan. SEBELUMNYA setting `wa_default_to` tidak
    // pernah dibaca di mana pun — user mengisinya tapi tidak ada efeknya.
    let recipientsList = recipientsParam
      ? recipientsParam.split(',').map(r => r.trim()).filter(Boolean)
      : [];

    if (!recipientsList.length) {
      try {
        const map = await loadSettingsMap();
        const defaultTo = settingStr(map, 'wa_default_to', '').trim();
        if (defaultTo) recipientsList = defaultTo.split(',').map(r => r.trim()).filter(Boolean);
      } catch (err) {
        console.warn('[report/whatsapp] Gagal membaca wa_default_to:', err.message);
      }
    }

    await ensureRangeSynced(startDate, endDate);
    const { data, stats } = await fetchAttendanceData(startDate, endDate);

    // Pesan WhatsApp mengikuti bahasa laporan (bukan hardcoded Indonesia).
    const waTitle    = language === 'id' ? 'LAPORAN ABSENSI' : 'ATTENDANCE REPORT';
    const waPeriod   = language === 'id' ? 'Periode' : 'Period';
    const waSummary  = language === 'id' ? 'RINGKASAN' : 'SUMMARY';
    const waTotalEv  = language === 'id' ? 'Total Kejadian' : 'Total Events';
    const waMasuk    = language === 'id' ? 'Total Masuk' : 'Check-In';
    const waKeluar   = language === 'id' ? 'Total Keluar' : 'Check-Out';
    const waUnique   = language === 'id' ? 'Karyawan Unik' : 'Unique Employees';
    const waDays     = language === 'id' ? 'Hari Kerja' : 'Working Days';
    const waGen      = language === 'id' ? 'Dibuat' : 'Generated';
    const waFooter   = language === 'id'
      ? 'Sistem Absensi Fingerprint'
      : 'Fingerprint Attendance System';

    // Build WhatsApp text (short, mobile-friendly)
    const lines = [
      `*📋 ${waTitle}*`,
      `─────────────────`,
      `📅 ${waPeriod}: ${fmtDateLongLang(startDate, language)} s/d ${fmtDateLongLang(endDate, language)}`,
      ``,
      `*📊 ${waSummary}*`,
      `▸ ${waTotalEv}: *${stats.totalEvents}*`,
      `▸ ${waMasuk}: *${stats.totalMasuk}*`,
      `▸ ${waKeluar}: *${stats.totalKeluar}*`,
      `▸ ${waUnique}: *${stats.uniqueUsers}*`,
      `▸ ${waDays}: *${stats.uniqueDays}*`,
      ``,
      `🕐 ${waGen}: ${fmtDateTimeLang(nowWIB('full'), language)} WIB`,
      `─────────────────`,
      `_${waFooter}_`,
    ];

    const whatsappText = lines.join('\n');

    // Kirim pesan melalui service WhatsApp (OpenWA gateway atau Baileys).
    //
    // SEBELUMNYA endpoint ini HANYA membangun teks dan mengembalikanannya —
    // pesan tidak pernah sampai ke penerima, padahal UI memberi tahu
    // "Pesan WhatsApp dibuat". Sekarang pengiriman benar-benar dilakukan
    // lewat whatsappService, dan hasil per-penerima dikembalikan agar user
    // tahu mana yang gagal.
    const results = [];
    for (const recipient of recipientsList) {
      try {
        const sent = await whatsappService.sendMessage(recipient, whatsappText);
        results.push({
          to: recipient,
          ok: true,
          messageId: sent?.messageId || sent?.key?.id || sent?.id?._serialized || null,
        });
      } catch (err) {
        console.error('[report/whatsapp] Gagal kirim ke', recipient, err.message);
        results.push({ to: recipient, ok: false, error: err.message });
      }
    }

    const sentCount = results.filter(r => r.ok).length;
    const failedCount = results.length - sentCount;

    const waNote = language === 'id'
      ? (recipientsList.length
          ? `${sentCount} pesan terkirim${failedCount ? `, ${failedCount} gagal` : ''}.`
          : 'Tidak ada penerima — pesan dibuat tetapi belum dikirim. Kirim parameter recipients.')
      : (recipientsList.length
          ? `${sentCount} message(s) sent${failedCount ? `, ${failedCount} failed` : ''}.`
          : 'No recipients provided — message generated but not sent. Pass recipients query param.');

    console.log(`[report/whatsapp] ${startDate}–${endDate} | recipients: ${recipientsList.join(', ') || 'none'} | terkirim: ${sentCount}/${recipientsList.length}`);

    res.json({
      success: failedCount === 0,
      message: whatsappText,
      recipients: recipientsList,
      results,
      sentCount,
      failedCount,
      stats,
      note: waNote,
    });
  } catch (err) {
    console.error('[report/whatsapp]', err);
    res.status(500).json({ error: err.message });
  }
}
