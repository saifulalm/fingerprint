// Settings controller — system settings CRUD + test email
import nodemailer from 'nodemailer';
import { buildDetailedReport, pdfToBuffer, reportFileName, reportTitle } from '../services/reportService.js';
import { fetchAttendanceData } from './reportController.js';
import { fmtDateLong } from '../utils/time.js';
import {
  loadSettingsMap,
  settingBool,
  settingInt,
  settingStr,
  saveSettings,
  stripSecrets,
  maskSecrets,
  configuredSecretFlags,
  resolveSmtpConfig,
} from '../services/settingsService.js';

// ─── All known settings keys ────────────────────────────────────────────────────
export const SETTINGS_KEYS = [
  // Email / SMTP
  { key: 'smtp_host',      label: 'SMTP Host',          group: 'email', password: false, placeholder: 'smtp.gmail.com', desc: 'Hostname SMTP server' },
  { key: 'smtp_port',      label: 'SMTP Port',            group: 'email', password: false, placeholder: '587', desc: 'Port SMTP (587=STARTTLS, 465=SSL)' },
  { key: 'smtp_secure',    label: 'Use SSL/TLS',         group: 'email', password: false, type: 'boolean', placeholder: 'false', desc: 'Aktifkan jika port 465' },
  { key: 'smtp_user',      label: 'SMTP Username / Email', group: 'email', password: false, placeholder: 'your@email.com', desc: 'Username atau email pengirim' },
  { key: 'smtp_pass',      label: 'SMTP Password / App Password', group: 'email', password: true, placeholder: 'xxxx xxxx xxxx xxxx', desc: 'App Password (bukan password biasa)' },
  { key: 'smtp_from',      label: 'Sender Name / Email',  group: 'email', password: false, placeholder: 'Fingerprint System <noreply@company.com>', desc: 'Nama pengirim yang tampil di email' },
  // WhatsApp
  // `wa_gateway_url` ditandai `secret: true` karena format gateway
  // (Fonnte/WaBlas) putting token API sebagai query param. Nilainya tidak
  // pernah dikirim balik ke frontend apa adanya — hanya versi TERSAMAR.
  { key: 'wa_gateway_url', label: 'WA Gateway URL',      group: 'whatsapp', password: false, secret: true, placeholder: 'https://fonnte.com/api/send?token=...', desc: 'URL API gateway WhatsApp' },
  { key: 'wa_default_to',  label: 'Default Recipient',    group: 'whatsapp', password: false, placeholder: '6281234567890', desc: 'Nomor default penerima WhatsApp' },
  // General
  { key: 'company_name',   label: 'Nama Perusahaan',      group: 'general', password: false, placeholder: 'PT. Nama Perusahaan', desc: 'Nama perusahaan untuk laporan' },
  { key: 'report_title',   label: 'Judul Laporan',        group: 'general', password: false, placeholder: 'Laporan Absensi', desc: 'Judul utama laporan (PDF/HTML/Excel). Kosong = pakai judul bawaan' },
  { key: 'report_subtitle', label: 'Subjudul Laporan',    group: 'general', password: false, placeholder: 'Rekap Absensi Karyawan', desc: 'Teks kecil di bawah judul (opsional)' },
  { key: 'report_footer',  label: 'Footer Laporan',      group: 'general', password: false, placeholder: 'Rahasia — hanya untuk internal', desc: 'Teks kaki halaman laporan (opsional)' },
  { key: 'report_lang',    label: 'Bahasa Laporan Default', group: 'general', password: false, placeholder: 'id', options: ['id', 'en'], desc: 'Bahasa default laporan' },
  { key: 'work_start',     label: 'Jam Masuk Normal',     group: 'general', password: false, placeholder: '09:00', desc: 'Threshold deteksi keterlambatan (HH:MM)' },
  { key: 'work_end',       label: 'Jam Pulang Normal',    group: 'general', password: false, placeholder: '17:00', desc: 'Threshold deteksi pulang awal (HH:MM)' },
  { key: 'late_threshold_minutes', label: 'Menit Toleransi Terlambat', group: 'general', password: false, placeholder: '0', desc: 'Menit toleransi sebelum ditandai terlambat' },
  { key: 'detect_late',    label: 'Deteksi Terlambat',    group: 'general', password: false, type: 'boolean', placeholder: 'true', desc: 'Aktifkan deteksi keterlambatan pada laporan' },
  { key: 'report_default_recipients', label: 'Penerima Default Laporan', group: 'general', password: false, placeholder: 'hrd@company.com, finance@company.com', desc: 'Koma-separated' },
];

export const SETTING_GROUPS = [
  { key: 'email',     label: 'Email / SMTP',   labelEn: 'Email / SMTP' },
  { key: 'whatsapp',  label: 'WhatsApp',       labelEn: 'WhatsApp' },
  { key: 'general',    label: 'Umum',           labelEn: 'General' },
];

// Kunci yang rahasianya TIDAK boleh dikirim balik ke frontend.
// (Implementasi shared ada di services/settingsService.js)

// ─── GET /api/settings ─────────────────────────────────────────────────────────
export async function getSettings(req, res) {
  try {
    const raw = await loadSettingsMap();

    // Password SMTP dan URL gateway TIDAK pernah dikirim apa adanya ke
    // frontend. Keduanya bisa mengandung kredensial (App Password, token
    // API gateway sebagai query param).
    //
    // `stripSecrets` mengosongkan nilainya → kolom form tampil kosong dan
    // frontend TIDAK mengirim ulang field itu saat Save, sehingga nilai
    // lama di DB tidak tertimpa.
    //
    // `masked` berisi versi TERSAMAR untuk ditampilkan sebagai informasi
    // (mis. "gateway aktif: https://host/api?token=••••••"), dan
    // `configured` memberi tahu frontend field mana yang sudah terisi
    // tanpa membocorkan nilainya.
    res.json({
      ...stripSecrets(raw),
      _masked: maskSecrets(raw),
      _configured: configuredSecretFlags(raw),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── PUT /api/settings ─────────────────────────────────────────────────────────
//
// KEAMANAN — whitelist kunci.
//
// SEBELUMNYA: `saveSettings(req.body)` menyimpan APAPUN yang dikirim client
// ke tabel SystemSetting. Authenticated user bisa menulis baris acak di
// luar SETTINGS_KEYS — termasuk baris yang tidak pernah ditampilkan UI.
// Itu mengotori tabel dan membuat state server tidak bisa diprediksi.
//
// SEKARANG: hanya kunci yang dikenal (SETTINGS_KEYS) yang disimpan.
// Kunci lain DIHAPUS diam-diam dan dikembalikan di `rejected` supaya
// frontend bisa memberi tahu user.
export async function updateSettings(req, res) {
  try {
    const body = req.body || {};
    const known = new Set(SETTINGS_KEYS.map((k) => k.key));

    const accepted = {};
    const rejected = [];
    for (const [key, value] of Object.entries(body)) {
      if (known.has(key)) accepted[key] = value;
      else rejected.push(key);
    }

    // Semua nilai dinormalisasi ke string di saveSettings() — checkbox
    // boolean dari frontend tidak lagi memicu Prisma error HTTP 500.
    const map = await saveSettings(accepted);

    // Cache URL gateway di-refresh supaya perubahan dari UI langsung
    // berlaku tanpa restart server.
    try {
      const { refreshGatewayUrl } = await import('../services/whatsapp.js');
      await refreshGatewayUrl();
    } catch (err) {
      console.warn('[settings/update] Gagal refresh cache gateway:', err.message);
    }

    if (rejected.length) {
      console.warn(`[settings/update] kunci tidak dikenal diabaikan: ${rejected.join(', ')}`);
    }

    res.json({
      success: true,
      settings: stripSecrets(map),
      _masked: maskSecrets(map),
      _configured: configuredSecretFlags(map),
      ...(rejected.length ? { rejected } : {}),
    });
  } catch (err) {
    console.error('[settings/update]', err);
    // Error validasi (mis. URL gateway menunjuk jaringan internal) punya
    // status 400 — itu kesalahan input, bukan kegagalan server.
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── POST /api/settings/test-email ─────────────────────────────────────────────
//
// KEAMANAN — SSRF:
//   Parameter `smtp_host` datang dari request body. Bila diteruskan apa
//   adanya ke nodemailer, server bisa dipaksa membuka koneksi TCP ke
//   alamat internal (127.0.0.1, 10.x, 169.254.169.254 metadata cloud, …)
//   dan memakai hasilnya untuk memindai jaringan internal.
//
//   Mitigasi: host WAJIB berupa hostname/IP yang:
//     1. punya skema yang valid (tipe string 'email'/'nama' di .env),
//     2. bukan alamat loopback/link-local/private-range,
//     3. TIDAK berupa URL (menolak "http://169.254.169.254/"),
//     4. kecuali host tersebut memang dikonfigurasi di .env (memakai
//        SMTP_HOST) — itu host yang sudah dipercaya, bukan input user.
//
//   Dengan begitu "Test Email" tetap bisa dipakai untuk SMTP baru yang
//   diizinkan, tanpa membuka pintu ke jaringan internal.
function isBlockedSmtpHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return true;
  // Tolak skema URL — nodemailer expects a bare hostname.
  if (h.includes('://') || h.includes('/') || h.includes('@')) return true;
  // Loopback & unspecified
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  // IPv4 private / loopback / link-local / metadata
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;   // cloud metadata
    if (a >= 224) return true;                 // multicast/reserved
  }
  // IPv6 loopback / unique-local
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

export async function testEmail(req, res) {
  try {
    const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, test_to } = req.body;

    if (!test_to) {
      return res.status(400).json({ error: 'Email tujuan test wajib diisi.' });
    }

    // Kredensial di-body OPSIONAL. Bila `smtp_pass` tidak dikirim (atau
    // kosong), password yang SUDAH TERSIMPAN di Pengaturan yang dipakai.
    //
    // SEBELUMNYA: `smtp_pass` wajib ada di body, tapi `GET /api/settings`
    // tidak pernah mengirimkannya (demi keamanan). Akibatnya frontend
    // SELALU mengirim string kosong → endpoint selalu membalas 400
    // "wajib diisi" dan tombol "Test Koneksi" tidak pernah bisa dipakai.
    //
    // likewise `smtp_host`/`smtp_user`: bila kosong, ambil dari Pengaturan.
    const stored = await loadSettingsMap();
    const host = String(smtp_host || '').trim() || settingStr(stored, 'smtp_host', '').trim();
    const user = String(smtp_user || '').trim() || settingStr(stored, 'smtp_user', '').trim();
    const pass = String(smtp_pass || '') || String(stored.smtp_pass || '');
    const from = String(smtp_from || '').trim() || settingStr(stored, 'smtp_from', '').trim() || user;

    if (!host || !user || !pass) {
      return res.status(400).json({
        error: 'Konfigurasi SMTP belum lengkap. Isi Host, Email Pengirim, dan App Password di tab Pengaturan (atau di form ini), lalu coba lagi.',
      });
    }

    // Host yang dikonfigurasi di .env boleh localhost (umumnya SMTP lokal /
    // Laragon). Host dari input user TIDAK boleh menunjuk jaringan internal.
    const envHost = String(process.env.SMTP_HOST || '').trim().toLowerCase();
    const reqHost = String(host).trim().toLowerCase();
    if (reqHost !== envHost && isBlockedSmtpHost(reqHost)) {
      return res.status(400).json({
        error: 'Host SMTP tidak diizinkan. Gunakan hostname publik (contoh: smtp.gmail.com).',
      });
    }

    const port = parseInt(smtp_port) || settingInt(stored, 'smtp_port', 587) || 587;
    const secure = smtp_secure !== undefined && smtp_secure !== null && smtp_secure !== ''
      ? (smtp_secure === true || smtp_secure === 'true')
      : settingBool(stored, 'smtp_secure', false);

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10000,
    });

    await transporter.verify();

    const testHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:24px}
.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
.header{background:linear-gradient(135deg,#1e40af,#1d4ed8);color:#fff;padding:28px;text-align:center}
.header h1{margin:0;font-size:20px;font-weight:700}
.header p{margin:6px 0 0;opacity:.8;font-size:13px}
.body{padding:28px;text-align:center}
.body h2{color:#1e293b;margin:0 0 12px;font-size:16px}
.body p{color:#64748b;font-size:14px;line-height:1.6;margin:0}
.icon{font-size:48px;margin-bottom:16px}
.footer{background:#f8fafc;padding:14px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}
</style></head><body>
<div class="card">
  <div class="header"><h1>Test Email</h1><p>Fingerprint Attendance System</p></div>
  <div class="body">
    <div class="icon">&#10004;</div>
    <h2>Koneksi SMTP Berhasil!</h2>
    <p>Email ini dikirim sebagai test dari Fingerprint Attendance System.<br>Jika Anda menerima email ini, konfigurasi SMTP sudah benar.</p>
  </div>
  <div class="footer">Fingerprint Attendance System &bull; ${new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}</div>
</div>
</body></html>`;

    await transporter.sendMail({
      from: from || user,
      to: test_to,
      subject: 'Test Email — Fingerprint Attendance System',
      html: testHtml,
    });

    res.json({ success: true, message: `Test email terkirim ke ${test_to}` });
  } catch (err) {
    console.error('[settings/test-email]', err);
    const message = err.message || 'Unknown error';
    let hint = '';
    if (message.includes('ENOTFOUND')) hint = 'Host SMTP tidak ditemukan. Periksa hostname.';
    else if (message.includes('EAUTH') || message.includes('authentication')) hint = 'Auth gagal. Gunakan App Password, bukan password biasa. Gmail → https://myaccount.google.com/apppasswords';
    else if (message.includes('ECONNREFUSED')) hint = 'Port diblokir firewall atau salah. Port 587 biasanya terbuka.';
    else if (message.includes('ETIMEDOUT')) hint = 'Koneksi timeout. Periksa hostname dan port.';
    res.status(500).json({ error: message, hint });
  }
}

// ─── POST /api/settings/test-report ────────────────────────────────────────────
export async function testReportEmail(req, res) {
  try {
    const { recipients, lang = 'id' } = req.body;
    if (!recipients) return res.status(400).json({ error: 'Penerima wajib diisi' });

    // Get yesterday range
    const WIB_MS = 7 * 60 * 60 * 1000;
    const now = new Date(Date.now() + WIB_MS);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const startDate = yesterday.toISOString().slice(0, 10);
    const endDate = startDate;

    const settings = await loadSettingsMap();

    // Konfigurasi SMTP dari Pengaturan dengan fallback env — konsisten
    // dengan jalur pengiriman laporan (reportController).
    const smtp = await resolveSmtpConfig(settings);
    if (!smtp.host || !smtp.user || !smtp.pass) {
      return res.status(400).json({ error: 'SMTP belum dikonfigurasi. Simpan pengaturan SMTP terlebih dahulu.' });
    }

    // Jam kerja, bahasa, dan deteksi terlambat mengikuti pengaturan sistem —
    // sebelumnya hardcoded '09:00'/'17:00'/true sehingga test report selalu
    // berbeda dari laporan yang_settings aktual.
    const workStart = settings.work_start || '09:00';
    const workEnd   = settings.work_end || '17:00';
    const detectLate = settingBool(settings, 'detect_late', true);
    const reportLang = settings.report_lang || lang;
    const companyName = settingStr(settings, 'company_name', '');
    // Branding: judul/subjudul/footer custom — supaya email uji menampilkan
    // PERSIS seperti laporan yang akan dikirim scheduler.
    const branding = {
      title:    settingStr(settings, 'report_title', ''),
      subtitle: settingStr(settings, 'report_subtitle', ''),
      footer:   settingStr(settings, 'report_footer', ''),
    };

    const { data, stats } = await fetchAttendanceData(startDate, endDate, workStart, workEnd);
    const { html, text, report } = buildDetailedReport(
      data, stats, reportLang, workStart, workEnd, detectLate, startDate, endDate, 0, companyName, branding,
    );

    const transporter = nodemailer.createTransport({
      host: smtp.host, port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    const recipientsList = recipients.split(',').map(r => r.trim()).filter(Boolean);
    // Use professional Indonesian date format
    //
    // Subjek memakai judul yang SAMA dengan isi laporan — sama seperti
    // `reportController.sendReportEmail()` dan scheduler.
    //
    // SEBELUMNYA: subjek selalu "Laporan Absensi — <company>" walau isi PDF-nya
    // titled custom ("Rekap Bulanan"). User melihat subjek generik padahal
    // sudah mengatur judul custom — persis kelas bug "field mati" yang
    // berulang di proyek ini.
    //
    // Perhatikan juga: `lang` (param request) YANG DIPAKAI untuk subjek,
    // sedangkan `reportLang` (setting `report_lang`) yang dipakai untuk isi
    // laporan. Keduanya bisa berbeda — subjek harus mengikuti ISI, jadi
    // subjek memakai `reportLang`.
    const titleText = reportTitle(
      reportLang, companyName,
      reportLang === 'id' ? 'Laporan Absensi' : 'Attendance Report',
      branding.title,
    );
    const subject = `${titleText} — TEST — ${fmtDateLong(startDate)}`;

    // ─── Lampiran PDF ───────────────────────────────────────────────────────
    //
    // Tombol "Kirim Laporan Uji" di Pengaturan sekarang juga mengirim PDF
    // laporan sebagai lampiran — sama seperti laporan yang sebenarnya
    // dikirim lewat scheduler / halaman Laporan.
    //
    // Ini penting supaya user bisa memverifikasi SEBELUM mengatur jadwal:
    // apakah email masuk, apakah PDF-nyaattach, apakah judulnya custom.
    const attachments = [];
    let attachmentWarning = null;
    try {
      const pdfBuffer = await pdfToBuffer(report, reportLang);
      attachments.push({
        filename: reportFileName(reportLang, startDate, startDate, 'test'),
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    } catch (pdfErr) {
      // Lampiran gagal → email tetap dikirim (HTML sudah lengkap).
      console.error('[settings/test-report] Gagal membuat lampiran PDF:', pdfErr.message);
      // PENTING: kegagalan ini HARUS sampai ke user, tidak cukup di log
      // server. Tanpa ini, response tetap `success: true` dan frontend
      // menampilkan "Laporan test terkirim!" — user mengira PDF ikut terkirim
      // padahal yang tiba hanya HTML.
      attachmentWarning =
        'Email terkirim TANPA lampiran PDF — pembuatan PDF gagal: ' + pdfErr.message;
    }

    await transporter.sendMail({
      from: smtp.from || smtp.user,
      to: recipientsList.join(', '),
      subject,
      html,
      text,
      attachments,
    });

    res.json({
      success: true,
      message: `Laporan test terkirim ke ${recipientsList.length} penerima`,
      attachments: attachments.map((a) => ({ filename: a.filename, size: a.content.length })),
      // Non-null HANYA kalau lampiran gagal dibuat (lihat catch di atas).
      attachmentWarning,
      stats,
    });
  } catch (err) {
    console.error('[settings/test-report]', err);
    res.status(500).json({ error: err.message });
  }
}
