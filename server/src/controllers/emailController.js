// Email controller -- fully bilingual EN/ID
import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import { fetchAllEvents, isValidAccess, getVerifyModeFromMinor, getEmpNo, normName } from '../services/hikvision.js';
import { dateKey, dayOfWeek, fmtDateLong, fmtDateShort, fmtTime, fmtWIB, isValidDateStr, nowWIB, parseDeviceTime } from '../utils/time.js';
import { config } from '../config/index.js';
import prisma from '../db.js';
import { createNameResolver, preferRealName } from '../services/employeeIdentityService.js';
import { resolveSmtpConfig } from '../services/settingsService.js';

// -- Email labels (bilingual) --
const E = {
  en: {
    title:          'Attendance Report',
    period:         'Period',
    totalEvents:    'Total Events',
    totalMasuk:     'Check-In',
    totalKeluar:    'Check-Out',
    uniqueEmployees:'Unique Employees',
    subtitle:       'Attendance report for the specified period.',
    attached:       'Excel file attached.',
    footer:         'Automated by Fingerprint Attendance System',
    subject_prefix: 'Attendance Report',
    col_no:         '#',
    col_name:       'Name',
    col_date:       'Date',
    col_day:        'Day',
    col_time:       'Time',
    col_direction:  'Direction',
    col_verify:     'Verification Mode',
    col_door:       'Door',
    col_device:     'Device',
    ws_name:        'Attendance',
    err_no_recipient: 'Recipient email is required',
    err_no_smtp:      'SMTP not configured. Set SMTP settings first.',
    err_no_period:    'Report period (startDate and endDate) is required',
    err_bad_period:   'Date format must be YYYY-MM-DD (e.g. 2026-11-10)',
    success_msg:      'Email sent to',
  },
  id: {
    title:          'Laporan Absensi',
    period:         'Periode',
    totalEvents:    'Total Kejadian',
    totalMasuk:     'Total Masuk',
    totalKeluar:    'Total Keluar',
    uniqueEmployees:'Karyawan Unik',
    subtitle:       'Laporan absensi untuk periode yang dimaksud.',
    attached:       'File Excel terlampir.',
    footer:         'Dikirim otomatis oleh Sistem Absensi Fingerprint',
    subject_prefix: 'Laporan Absensi',
    col_no:         'No.',
    col_name:       'Nama',
    col_date:       'Tanggal',
    col_day:        'Hari',
    col_time:       'Jam',
    col_direction:  'Arah',
    col_verify:     'Mode Verifikasi',
    col_door:       'Pintu',
    col_device:     'Perangkat',
    ws_name:        'Absensi',
    err_no_recipient: 'Email tujuan wajib diisi',
    err_no_smtp:      'SMTP belum dikonfigurasi. Atur pengaturan SMTP terlebih dahulu.',
    err_no_period:    'Periode laporan (startDate dan endDate) wajib diisi',
    err_bad_period:   'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10)',
    success_msg:      'Email terkirim ke',
  },
};

function lbl(lang, key) {
  return (E[lang] && E[lang][key]) ? E[lang][key] : (E.en[key] || key);
}

// Enrich raw device event dengan field yang bisa dibaca manusia.
//
// MASALAH YANG DISELESAIKAN:
//   Versi lama memakai `devMaps` — peta nama PER PERANGKAT yang dibuat
//   kosong (`devMaps[key] = new Map()`) dan TIDAK PERNAH diisi. Akibatnya
//   nama selalu jatuh ke `ev.name` milik perangkat, tanpa pernah menerapkan
//   pemetaan alias. Laporan email bisa menampilkan ORANG YANG SALAH untuk
//   nomor ID yang konflik antar perangkat — persis bug yang
//   `employeeIdentityService` diciptakan untuk mencegah.
//
// SEKARANG: nama diambil dari resolver terpusat (index + alias), sama
// seperti laporan absensi, rekap, export, dan WhatsApp.
function enrichEvent(ev, resolver, lang) {
  const empNo = getEmpNo(ev);

  // Nama dari resolver (device_users + alias). Fallback ke nama yang dibaca
  // langsung dari perangkat kalau resolver tidak punya entri untuk nomor ini.
  const resolved = resolver?.name(empNo, ev.deviceKey);
  const fallback = (ev.name && ev.name.trim()) ? ev.name.trim() : `ID ${empNo || '?'}`;
  const name = preferRealName(resolved, fallback);

  const hasRealName = !name.startsWith('ID ');
  const nameKey = hasRealName ? normName(name) : `#${ev.deviceKey}:${empNo}`;
  const verifyMode = getVerifyModeFromMinor(ev.minor);

  const isMasuk = ev.deviceKey === 'masuk';
  const direction = lang === 'id'
    ? (isMasuk ? 'Masuk' : 'Keluar')
    : (isMasuk ? 'Check-In' : 'Check-Out');

  const ut = ev.userType || 'normal';
  const userType = lang === 'id'
    ? (ut === 'administrator' ? 'Administrator' : ut === 'visitor' ? 'Tamu' : 'Karyawan')
    : (ut === 'administrator' ? 'Administrator' : ut === 'visitor' ? 'Visitor' : 'Employee');

  const d = parseDeviceTime(ev.time);
  return {
    employeeNo:    empNo || '-',
    name, nameKey, userType,
    time:          d ? d.toISOString() : ev.time,
    timeFormatted: fmtWIB(d || ev.time),
    date:          fmtDate(d || ev.time),
    dateKey:       dateKey(d || ev.time),
    timeOnly:      fmtTime(d || ev.time),
    dayOfWeek:     dayOfWeek(d || ev.time),
    direction, verifyMode,
    cardNo:     ev.cardNo || '-',
    doorNo:     ev.doorNo != null ? ev.doorNo : 1,
    deviceKey:    ev.deviceKey,
    deviceLabel:  ev.deviceLabel,
    deviceIP:     ev.deviceIP,
  };
}

export async function sendEmail(req, res) {
  try {
    const {
      to, subject, message, startDate, endDate,
      device = 'all', includeExcel = true,
      lang = 'en',
    } = req.body;

    const L = lang === 'id' ? 'id' : 'en';

    if (!to) return res.status(400).json({ error: lbl(L, 'err_no_recipient') });

    // Rentang tanggal WAJIB diisi dan formatnya YYYY-MM-DD.
    // Tanpa rentang, laporan email terkirim kosong dan terlihat "sukses".
    if (!startDate || !endDate) {
      return res.status(400).json({ error: lbl(L, 'err_no_period') });
    }
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: lbl(L, 'err_bad_period') });
    }

    // Konfigurasi SMTP dari PENGATURAN (UI) dengan fallback ke env.
    // SEBELUMNYA hanya `config.smtp` (env) yang dipakai — setting SMTP di
    // UI Pengaturan tidak berlaku untuk email ini.
    const smtp = await resolveSmtpConfig();
    if (!smtp.host || !smtp.user || !smtp.pass) {
      return res.status(400).json({ error: lbl(L, 'err_no_smtp') });
    }

    const targets = device === 'all'
      ? Object.values(config.devices)
      : [config.devices[device]].filter(Boolean);

    // Resolver nama terpusat — menerapkan device_users + alias ID.
    const resolver = await createNameResolver();

    // Kegagalan perangkat TIDAK boleh disembunyikan.
    //
    // SEBELUMNYA: `.catch(() => [])` membuat perangkat yang tidak bisa
    // dihubungi terlihat SEPERTI perangkat tanpa data. Laporan tetap terkirim
    // dengan "sukses" padahal isinya tidak lengkap — user mengira semua
    // orang absen, padahal perangkatnya offline.
    //
    // SEKARANG: kegagalan dicatat, dan kalau SEMUA perangkat gagal, request
    // ditolak dengan 502 (tidak mengirim laporan yang menyesatkan).
    const eventResults = await Promise.all(
      targets.map(async (dev) => {
        try {
          return await fetchAllEvents(dev, startDate, endDate);
        } catch (err) {
          console.error(`[email] gagal membaca perangkat ${dev.type} (${dev.ip}):`, err.message);
          throw err;
        }
      })
    );

    const allEvents = eventResults.flat()
      .filter((ev) => isValidAccess(ev))
      .map((ev) => enrichEvent(ev, resolver, L));

    allEvents.sort((a, b) =>
      (b.dateKey + 'T' + b.timeOnly).localeCompare(a.dateKey + 'T' + a.timeOnly)
    );

    const masukC  = allEvents.filter((e) => e.deviceKey === 'masuk').length;
    const keluarC = allEvents.filter((e) => e.deviceKey === 'keluar').length;
    const uniqC   = [...new Set(allEvents.map((e) => e.nameKey))].length;

    const attachments = [];
    if (includeExcel) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(lbl(L, 'ws_name'));
      ws.addRow([
        lbl(L, 'col_no'),
        lbl(L, 'col_name'),
        'User Type',
        lbl(L, 'col_date'),
        lbl(L, 'col_day'),
        lbl(L, 'col_time'),
        lbl(L, 'col_direction'),
        lbl(L, 'col_verify'),
        lbl(L, 'col_door'),
        lbl(L, 'col_device'),
      ]);
      allEvents.forEach((ev, i) =>
        ws.addRow([i + 1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly, ev.direction, ev.verifyMode, ev.doorNo, ev.deviceLabel])
      );
      [5, 22, 14, 14, 10, 10, 12, 22, 8, 22].forEach((w, i) => ws.getColumn(i + 1).width = w);
      const buf = await wb.xlsx.writeBuffer();
      attachments.push({
        filename: 'attendance-' + startDate + '-' + endDate + '.xlsx',
        content: buf,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>\n' +
      'body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:20px}\n' +
      '.c{max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)}\n' +
      '.h{background:#1e40af;color:#fff;padding:28px;text-align:center}\n' +
      '.h h1{margin:0;font-size:20px}.h p{margin:6px 0 0;opacity:.8;font-size:13px}\n' +
      '.s{display:flex;gap:10px;padding:20px;background:#f1f5f9;flex-wrap:wrap}\n' +
      '.sc{flex:1;background:#fff;border-radius:8px;padding:14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06);min-width:100px}\n' +
      '.sc .n{font-size:26px;font-weight:700;color:#1e40af}.sc .l{font-size:11px;color:#64748b;margin-top:3px}\n' +
      '.b{padding:20px}.b p{color:#374151;line-height:1.6;font-size:14px}\n' +
      '.f{background:#f8fafc;padding:14px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}\n' +
      '</style></head><body><div class="c">\n' +
      '<div class="h"><h1>' + lbl(L, 'title') + '</h1><p>' + lbl(L, 'period') + ': ' + fmtDateLong(startDate) + ' \u2014 ' + fmtDateLong(endDate) + '</p></div>\n' +
      '<div class="s">\n' +
      '<div class="sc"><div class="n">' + allEvents.length + '</div><div class="l">' + lbl(L, 'totalEvents') + '</div></div>\n' +
      '<div class="sc"><div class="n">' + masukC + '</div><div class="l">' + lbl(L, 'totalMasuk') + '</div></div>\n' +
      '<div class="sc"><div class="n">' + keluarC + '</div><div class="l">' + lbl(L, 'totalKeluar') + '</div></div>\n' +
      '<div class="sc"><div class="n">' + uniqC + '</div><div class="l">' + lbl(L, 'uniqueEmployees') + '</div></div>\n' +
      '</div>\n' +
      '<div class="b"><p>' + (message || lbl(L, 'subtitle')) + '</p>' + (attachments.length ? '<p>' + lbl(L, 'attached') + '</p>' : '') + '</div>\n' +
      '<div class="f">' + lbl(L, 'footer') + ' \u2022 ' + nowWIB('short') + ' WIB</div>\n' +
      '</div></body></html>';

    const finalSubject = subject
      || (lbl(L, 'subject_prefix') + ' \u2014 ' + fmtDateShort(startDate) + (L === 'id' ? ' s/d ' : ' to ') + fmtDateShort(endDate));

    await transporter.sendMail({
      from: smtp.from, to,
      subject: finalSubject,
      html,
      attachments,
    });

    // Audit log
    try {
      await prisma.auditLog.create({
        data: {
          action: 'email',
          detail: 'Email sent to ' + to + ' \u2014 ' + allEvents.length + ' events, period ' + startDate + ' to ' + endDate,
          user: req.session?.user?.username || 'admin',
        },
      });
    } catch (err) {
      // Audit gagal menulis harus TERLIHAT — `catch (_) {}` membuat jejak
      // audit bolong tanpa jejak apa pun.
      console.warn('[Audit] gagal menulis audit "email":', err.message);
    }

    res.json({ success: true, message: lbl(L, 'success_msg') + ' ' + to });
  } catch (err) {
    console.error('[sendEmail]', err);
    // Perangkat yang tidak merespons → 502 (bukan 500) supaya pesan di
    // frontend tidak menyesatkan ("server error" vs "perangkat offline").
    const status = /ECONN|ETIMEDOUT|ENOTFOUND|socket|timeout/i.test(err.message || '') ? 502 : 500;
    res.status(status).json({ error: err.message });
  }
}
