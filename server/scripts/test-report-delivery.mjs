// Uji end-to-end pengiriman laporan + lampiran PDF.
//
// TUJUAN: membuktikan bahwa email dan WhatsApp benar-benar MENERIMA FILE PDF,
// bukan hanya teks/HTML. Test sebelumnya (test-report-attachment.mjs) hanya
// memeriksa kode secara statis — belum pernah membuktikan file-nya sampai.
//
// Yang diuji:
//   A. Email  → mock SMTP menerima email DENGAN 1 attachment PDF
//      - filename benar
//      - contentType application/pdf
//      - magic bytes "%PDF" (bukan teks)
//      - isi PDF memuat judul custom
//   B. WhatsApp → mock OpenWA menerima dokumen PDF
//      - chatId valid
//      - filename + mimetype benar
//      - magic bytes "%PDF"
//   C. Branding dari Pengaturan terpakai di email & dokumen WhatsApp
//
// CARA JALAN: cd server && node scripts/test-report-delivery.mjs
//
// CATATAN PENTING: test ini mengubah settings di DB sementara. Settings
// ASLI dicatat dulu lalu dipulihkan di blok `finally` — termasuk kalau test
// gagal di tengah jalan.

import { startMockSmtpServer } from './mock-smtp-server.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import prisma from '../src/db.js';
import { reportFileName } from '../src/services/reportService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let gagal = 0;
function cek(label, ok, detail = '') {
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

// ─── Mock OpenWA gateway sebagai child process ────────────────────────────────
//
// Gateway mock adalah file terpisah yang listen di port tetap, jadi harus
// dijalankan sebagai proses anak. Port acak dipakai lewat env MOCK_PORT.
const MOCK_PORT = 24000 + Math.floor(Math.random() * 2000);
const mockGateway = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-openwa-gateway.mjs')], {
  env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_API_KEY: 'test-key' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
mockGateway.stderr.on('data', (d) => console.error('[mock-gateway]', String(d).trim()));

async function waitForGateway(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ── Snapshot settings asli supaya bisa dipulihkan ───────────────────────────
const BACKUP_KEYS = [
  'company_name', 'report_title', 'report_subtitle', 'report_footer',
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  'wa_gateway_url',
];

async function snapshotSettings() {
  const rows = await prisma.systemSetting.findMany({ where: { id: { in: BACKUP_KEYS } } });
  const map = {};
  for (const r of rows) map[r.id] = r.value;
  return map;
}

async function restoreSettings(snapshot) {
  for (const key of BACKUP_KEYS) {
    const had = Object.prototype.hasOwnProperty.call(snapshot, key);
    const val = snapshot[key];
    if (!had) {
      await prisma.systemSetting.deleteMany({ where: { id: key } });
    } else {
      await prisma.systemSetting.upsert({
        where: { id: key },
        create: { id: key, value: val },
        update: { value: val },
      });
    }
  }
}

async function putSetting(key, value) {
  await prisma.systemSetting.upsert({
    where: { id: key },
    create: { id: key, value },
    update: { value },
  });
}

// API key gateway WAJIB diset SEBELUM modul `whatsapp.js` di-import —
// konstanta `WA_GATEWAY_API_KEY` dibaca sekali saat module load.
// Kalau tidak, gateway membalas "Missing or invalid API key".
process.env.WA_GATEWAY_API_KEY = 'test-key';

/**
 * Ekstrak teks dari PDF dengan inflate zlib pada content stream-nya.
 *
 * PDFKit memampatkan stream teks, jadi isi mentah tidak bisa di-search
 * sebagai string biasa. Setiap stream di-inflate, lalu potongan hex
 * (&lt;...&gt;) dikonversi ke teks UTF-16LE.
 *
 * @param {Buffer} buf isi file PDF
 * @returns {string} teks yang bisa dibaca
 */
function inflatePdfText(buf) {
  let out = '';
  const raw = buf.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    let data;
    try {
      data = zlib.inflateSync(Buffer.from(m[1], 'latin1'));
    } catch {
      continue; // stream bukan zlib (mis. font) → lewati
    }
    const text = data.toString('latin1');
    // Potongan hex <52454b41...> = teks dengan font standar (Helvetica).
    //
    // PENTING: PDFKit menulis string sebagai SATU byte per karakter
    // (WinAnsiEncoding), lalu menyandikannya sebagai hex. Jadi hex-nya
    // adalah ASCII biasa — bukan UTF-16.
    //
    // Dua percobaan yang SALAH dan menghasilkan mojibake:
    //   - `toString('utf16le')` → "REKAP ABSENSI" jadi "䕒䅋⁐䉁䕓华⁉"
    //   - `swap16()`           → teks jadi "啌䅎䅎慮⁐吠䝵慲搠敲"
    //
    // Yang benar: decode hex → Buffer → latin1 (satu byte = satu karakter).
    for (const hex of text.matchAll(/<([0-9A-Fa-f]+)>/g)) {
      const h = hex[1];
      if (h.length % 2 !== 0) continue; // pasangan byte genap saja
      try {
        out += Buffer.from(h, 'hex').toString('latin1');
      } catch { /* bukan hex valid → lewati */ }
    }
    // Teks literal ( ... ) Tj — lebih jarang, tapi tetap dicoba.
    for (const lit of text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      out += lit[1].replace(/\\([()\\])/g, '$1');
    }
  }
  return out;
}

let snapshot = {};
let smtp = null;

try {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  UJI END-TO-END: EMAIL & WHATSAPP DENGAN LAMPIRAN PDF');
  console.log('═══════════════════════════════════════════════════════\n');

  snapshot = await snapshotSettings();

  // ── Mock SMTP ─────────────────────────────────────────────────────────────
  smtp = await startMockSmtpServer({ port: 0, host: '127.0.0.1', requireAuth: false });
  console.log(`  Mock SMTP siap di 127.0.0.1:${smtp.port}`);

  const gatewayReady = await waitForGateway(MOCK_PORT);
  cek('mock OpenWA gateway siap', gatewayReady, `(port ${MOCK_PORT})`);
  if (!gatewayReady) throw new Error('Mock gateway tidak siap dalam 15 detik');

  // ── Settings sementara ─────────────────────────────────────────────────────
  const COMPANY = 'PT Guard Test';
  const TITLE = 'Rekap Absensi Bulanan';
  const SUBTITLE = 'Rekap Absensi Karyawan PT Guard Test';
  const FOOTER = 'RAHASIA - Hanya Untuk Internal';

  await putSetting('company_name', COMPANY);
  await putSetting('report_title', TITLE);
  await putSetting('report_subtitle', SUBTITLE);
  await putSetting('report_footer', FOOTER);
  await putSetting('smtp_host', '127.0.0.1');
  await putSetting('smtp_port', String(smtp.port));
  await putSetting('smtp_secure', 'false');
  await putSetting('smtp_user', 'test@localhost');
  await putSetting('smtp_pass', 'test');
  await putSetting('smtp_from', 'Fingerprint Test <test@localhost>');
  await putSetting('wa_gateway_url', `http://127.0.0.1:${MOCK_PORT}`);

  // ─── A. EMAIL dengan lampiran PDF ──────────────────────────────────────────
  console.log('\n=== A. EMAIL DENGAN LAMPIRAN PDF ===');

  const { sendReportEmail } = await import('../src/controllers/reportController.js');

  const emailReq = {
    query: {
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      lang: 'id',
      recipients: 'hrd@ptguard.test',
      attach: 'pdf',
    },
  };
  const emailRes = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this._json = payload; return this; },
    setHeader() { return this; },
    send() { return this; },
  };

  await sendReportEmail(emailReq, emailRes);

  cek('email controller merespons sukses', emailRes.statusCode === 200,
    `(status: ${emailRes.statusCode}${emailRes._json?.error ? `, error: ${emailRes._json.error}` : ''})`);

  const emailSent = smtp.messages.at(-1);
  cek('mock SMTP menerima 1 email', smtp.messages.length === 1,
    `(jumlah: ${smtp.messages.length})`);

  if (!emailSent) throw new Error('Tidak ada email yang diterima mock SMTP');

  // `record` sudah flattened (subject/html/attachments di level atas).
  const parsed = emailSent;
  cek('email punya subjek dengan judul custom',
    (parsed.subject || '').includes(TITLE), `(subjek: "${parsed.subject}")`);

  cek('email punya 1 lampiran', (parsed.attachments || []).length === 1,
    `(jumlah: ${(parsed.attachments || []).length})`);

  const att = (parsed.attachments || [])[0];
  if (att) {
    cek('nama lampiran benar',
      att.filename === reportFileName('id', '2026-11-01', '2026-11-07'), `(nama: "${att.filename}")`);
    cek('contentType lampiran application/pdf',
      att.contentType === 'application/pdf', `(tipe: "${att.contentType}")`);
    cek('isi lampiran adalah PDF biner (magic bytes %PDF)',
      att.content.subarray(0, 4).toString('latin1') === '%PDF',
      `(magic: "${att.content.subarray(0, 4).toString('latin1')}")`);
    cek('ukuran lampiran wajar (> 1 KB)', att.size > 1024, `(ukuran: ${att.size} bytes)`);

    // Isi PDF harus memuat judul custom.
    //
    // PENTING: isi PDF di-stream zlib-compress, jadi teks mentah TIDAK bisa
    // searched langsung. Stream-nya harus di-inflate dulu.
    //
    // (bug class dari skill: "pdftotext -layout LIES about PDF column
    //  alignment" — untuk TEKS, cara yang benar adalah baca content stream
    //  dan inflate zlib-nya.)
    const pdfText = inflatePdfText(att.content);
    cek('isi PDF memuat judul custom',
      /REKAP ABSENSI BULANAN/i.test(pdfText) || /Rekap Absensi Bulanan/i.test(pdfText),
      pdfText.length ? `(teks PDF: ${pdfText.length} karakter)` : '(stream tidak ter-inflate)');
  } else {
    cek('isi lampiran bisa diperiksa', false, '(tidak ada lampiran)');
  }

  // ─── B. WHATSAPP dengan dokumen PDF ────────────────────────────────────────
  console.log('\n=== B. WHATSAPP DENGAN DOKUMEN PDF ===');

  // Sesi gateway harus dibuat dengan NAMA yang sama dengan yang dipakai
  // `whatsappService` — kalau tidak, `ensureGatewaySession()` tidak
  // menemukan sesi dan membuat sesi BARU (yang tidak pernah ditandai
  // ready), lalu pengiriman document gagal.
  //
  // Nama sesi default di whatsapp.js: 'default'.
  const SESSION_NAME = 'default';
  const sessRes = await fetch(`http://127.0.0.1:${MOCK_PORT}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ name: SESSION_NAME }),
  });
  const sess = await sessRes.json();
  cek('sesi gateway dibuat', !!sess.id, `(id: ${sess.id}, nama: ${SESSION_NAME})`);

  await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ id: sess.id }),
  });

  const { whatsappService } = await import('../src/services/whatsapp.js');
  const { buildDetailedReport, pdfToBuffer } = await import('../src/services/reportService.js');

  // Data sintetis supaya test tidak bergantung pada isi database.
  const fakeData = [
    { employeeNo: '5', name: 'Juanto', deviceKey: 'masuk', timeOnly: '08:30', dateKey: '2026-11-10', date: '10 Nov 2026', dayOfWeek: 'Selasa', userType: 'Normal', verifyMode: 'FP', cardNo: '-', doorNo: 1, deviceLabel: 'Masuk', deviceIP: '1.1.1.1', canonicalNo: '5', employeeName: 'Juanto', time: '2026-11-10T01:30:00.000Z', timeFormatted: '2026-11-10T01:30:00.000Z' },
  ];
  const fakeStats = { totalEvents: 1, totalMasuk: 1, totalKeluar: 0, uniqueUsers: 1, uniqueDays: 1 };

  const { report } = buildDetailedReport(
    fakeData, fakeStats, 'id', '09:00', '17:00', true, '2026-11-01', '2026-11-07', 0,
    COMPANY, { title: TITLE, subtitle: SUBTITLE, footer: FOOTER },
  );
  const pdfBuf = await pdfToBuffer(report, 'id');
  cek('PDF untuk WhatsApp valid', pdfBuf.subarray(0, 4).toString('latin1') === '%PDF',
    `(ukuran: ${pdfBuf.length} bytes)`);

  const filename = reportFileName('id', '2026-11-01', '2026-11-07');
  const sendResult = await whatsappService.sendDocument(
    '6281234567890', pdfBuf, filename, 'application/pdf',
    'Laporan absensi 1 November 2026 s/d 7 November 2026',
  );
  cek('sendDocument() mengembalikan hasil', !!sendResult,
    `(messageId: ${sendResult?.messageId || sendResult?.id || '-'})`);

  // Mock gateway mewajibkan header X-API-Key untuk semua route (kecuali
  // /api/health) — termasuk route helper /__mock/*.
  const docRes = await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/last-document`, {
    headers: { 'X-API-Key': 'test-key' },
  });
  const lastDoc = await docRes.json();
  cek('mock gateway menerima dokumen', !!lastDoc.filename, `(filename: "${lastDoc.filename}")`);
  cek('chatId dokumen valid (localpart@host)',
    /^[^\s@]+@[^\s@]+$/.test(lastDoc.chatId || ''), `(chatId: "${lastDoc.chatId}")`);
  cek('filename dokumen benar', lastDoc.filename === filename, `(nama: "${lastDoc.filename}")`);
  cek('mimetype dokumen application/pdf',
    lastDoc.mimetype === 'application/pdf', `(tipe: "${lastDoc.mimetype}")`);
  cek('dokumen berisi PDF biner (magic bytes %PDF)',
    lastDoc.magic === '%PDF', `(magic: "${lastDoc.magic}")`);
  cek('ukuran dokumen sesuai PDF yang dikirim',
    lastDoc.size === pdfBuf.length, `(terkirim: ${lastDoc.size}, dikirim: ${pdfBuf.length})`);

  // ─── C. Branding konsisten di kedua kanal ──────────────────────────────────
  console.log('\n=== C. KONSISTENSI BRANDING ===');

  cek('judul custom ada di body email',
    (parsed.html || '').includes(TITLE), '');
  cek('subjudul custom ada di body email',
    (parsed.html || '').includes(SUBTITLE), '');
  cek('footer custom ada di body email',
    (parsed.html || '').includes(FOOTER), '');

  const { sendReportWhatsApp } = await import('../src/controllers/reportController.js');
  const waReq = { query: { startDate: '2026-11-01', endDate: '2026-11-07', lang: 'id', recipients: '6281234567890' } };
  const waRes = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this._json = payload; return this; },
    setHeader() { return this; },
    send() { return this; },
  };
  await sendReportWhatsApp(waReq, waRes);
  cek('endpoint whatsapp merespons sukses', waRes.statusCode === 200,
    `(status: ${waRes.statusCode}${waRes._json?.error ? `, error: ${waRes._json.error}` : ''})`);
  cek('pesan WhatsApp memuat judul custom',
    new RegExp(TITLE, 'i').test(waRes._json?.message || ''),
    `(pesan: ${(waRes._json?.message || '').split('\n')[0]})`);
  cek('pesan WhatsApp memuat footer custom',
    new RegExp(FOOTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(waRes._json?.message || ''),
    `(footer: ${(waRes._json?.message || '').split('\n').slice(-2).join(' | ')})`);
} catch (err) {
  gagal++;
  console.error('\n  ❌ ERROR:', err.message);
  console.error(err.stack?.split('\n').slice(0, 6).join('\n'));
} finally {
  // ── Pulihkan settings ──────────────────────────────────────────────────────
  try {
    await restoreSettings(snapshot);
    console.log('\n  Settings DB dipulihkan ke kondisi semula.');
  } catch (err) {
    console.error('  ❌ Gagal memulihkan settings:', err.message);
    gagal++;
  }

  if (smtp) {
    try { await smtp.close(); } catch { /* noop */ }
  }
  try { mockGateway.kill(); } catch { /* noop */ }
  try { await prisma.$disconnect(); } catch { /* noop */ }
}

console.log(gagal === 0
  ? '\n✅ SEMUA UJI END-TO-END LOLOS'
  : `\n❌ HASIL: ${gagal} uji gagal`);
process.exit(gagal === 0 ? 0 : 1);
