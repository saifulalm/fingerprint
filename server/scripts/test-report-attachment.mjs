// Uji fitur: judul laporan custom + lampiran PDF (email & WhatsApp).
//
// Yang diuji:
//   A. `reportTitle()` — judul customized dari nama perusahaan.
//   B. PDF/HTML/Teks/Excel memakai judul yang sama (konsisten).
//   C. `pdfToBuffer()` menghasilkan PDF valid yang memuat judul custom.
//   D. `whatsappService.sendDocument()` ada & validasi input-nya benar.
//   E. Endpoint email menerima `attach=pdf` → email punya attachment PDF.
//
// Jalankan: node scripts/test-report-attachment.mjs

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let gagal = 0;
function cek(label, ok, detail = '') {
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

console.log('═══════════════════════════════════════════════════════');
console.log('  UJI JUDUL CUSTOM + LAMPIRAN PDF');
console.log('═══════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════════
// A. reportTitle() — logika judul
// ═══════════════════════════════════════════════════════════════════════════════
console.log('=== A. JUDUL LAPORAN CUSTOM ===');
const { reportTitle, buildDetailedReport, buildExportReport, pdfToBuffer } =
  await import('../src/services/reportService.js');

cek('tanpa nama perusahaan → judul default',
  reportTitle('id', '', 'Laporan Absensi') === 'Laporan Absensi');
cek('dengan nama perusahaan → judul pakai nama',
  reportTitle('id', 'PT Guard Test', 'Laporan Absensi') === 'Laporan Absensi — PT Guard Test');
cek('nama perusahaan spasi excess → tetap dipakai',
  reportTitle('id', '  PT Guard Test  ', 'Laporan Absensi') === 'Laporan Absensi — PT Guard Test');
cek('nama perusahaan kosong (spasi) → judul default',
  reportTitle('id', '   ', 'Laporan Absensi') === 'Laporan Absensi');
cek('judul English ikut pakai nama',
  reportTitle('en', 'PT Guard Test', 'Attendance Report') === 'Attendance Report — PT Guard Test');

// Judul custom yang HANYA spasi harus diperlakukan sebagai kosong.
//
// SEBELUMNYA: `String(customTitle || fallback || '')` — spasi itu truthy,
// jadi `fallback` tidak pernah dipakai dan judulnya jadi " — PT Guard
// Test" (memulai dengan tanda pisah). Reachability: `settingStr()`
// mengembalikan nilai DB mentah, jadi user yang mengetik spasi di field
// "Judul Laporan" cukup untuk memicu ini.
cek('judul custom spasi saja → pakai judul bawaan + nama',
  reportTitle('id', 'PT Guard Test', 'Laporan Absensi', '   ') === 'Laporan Absensi — PT Guard Test');
cek('judul custom spasi saja (tab/newline) → pakai judul bawaan',
  reportTitle('id', 'PT Guard Test', 'Laporan Absensi', '\t\n ') === 'Laporan Absensi — PT Guard Test');
cek('judul custom spasi saja tanpa nama perusahaan → judul bawaan',
  reportTitle('id', '', 'Laporan Absensi', '   ') === 'Laporan Absensi');
cek('judul custom authoritative — nama perusahaan TIDAK ditambahkan',
  reportTitle('id', 'PT Guard Test', 'Laporan Absensi', 'Rekap Bulanan') === 'Rekap Bulanan');

// ═══════════════════════════════════════════════════════════════════════════════
// B. Semua format memakai judul yang SAMA
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== B. KONSISTENSI JUDUL DI SEMUA FORMAT ===');

// Data sintetis — supaya test tidak bergantung pada isi database.
const fakeData = [
  { employeeNo: '5', name: 'Juanto', deviceKey: 'masuk', timeOnly: '08:30', dateKey: '2026-11-10', date: '10 Nov 2026', dayOfWeek: 'Selasa', userType: 'Normal', verifyMode: 'FP', cardNo: '-', doorNo: 1, deviceLabel: 'Masuk', deviceIP: '1.1.1.1', canonicalNo: '5', employeeName: 'Juanto', time: '2026-11-10T01:30:00.000Z', timeFormatted: '2026-11-10T01:30:00.000Z' },
  { employeeNo: '5', name: 'Juanto', deviceKey: 'keluar', timeOnly: '17:00', dateKey: '2026-11-10', date: '10 Nov 2026', dayOfWeek: 'Selasa', userType: 'Normal', verifyMode: 'FP', cardNo: '-', doorNo: 1, deviceLabel: 'Keluar', deviceIP: '1.1.1.2', canonicalNo: '5', employeeName: 'Juanto', time: '2026-11-10T10:00:00.000Z', timeFormatted: '2026-11-10T10:00:00.000Z' },
];
const fakeStats = { totalEvents: 2, totalMasuk: 1, totalKeluar: 1, uniqueUsers: 1, uniqueDays: 1 };

const COMPANY = 'PT Guard Test';
const { html, text, report } = buildDetailedReport(
  fakeData, fakeStats, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY,
);

cek('report.companyName terisi', report.companyName === COMPANY, `(dapat: "${report.companyName}")`);
cek('HTML <title> memakai nama perusahaan', html.includes(`<title>Laporan Absensi — ${COMPANY}`));
cek('HTML <h1> memakai nama perusahaan', html.includes(`<h1>Laporan Absensi — ${COMPANY}</h1>`));
cek('versi teks memakai nama perusahaan', text.includes(`Laporan Absensi — ${COMPANY}`));

// Tanpa nama perusahaan → judul harus kembali ke default.
const noCompany = buildDetailedReport(
  fakeData, fakeStats, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, '',
);
cek('tanpa nama perusahaan → HTML judul default',
  noCompany.html.includes('<h1>Laporan Absensi</h1>'));
cek('tanpa nama perusahaan → tidak ada "—" di judul',
  !noCompany.html.includes('<h1>Laporan Absensi —'));

// ═══════════════════════════════════════════════════════════════════════════════
// C. pdfToBuffer() → PDF valid dengan judul custom
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== C. PDF VALID DENGAN JUDUL CUSTOM ===');
const pdfBuffer = await pdfToBuffer(report, 'id');
cek('PDF buffer dibuat', Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 1000,
  `(ukuran: ${pdfBuffer?.length} bytes)`);
cek('PDF punya header %PDF', pdfBuffer.subarray(0, 4).toString('latin1') === '%PDF');

// Teks PDF bisa dikompresi, jadi untuk memastikan judul ada kita cek lewat
// file yang ditulis & di-ekstrak dengan pymupdf (kalau tersedia). Kalau
// tidak, cukup pastikan header PDF valid & ukuran wajar.
const tmpPdf = path.resolve('tmp', 'test-attach.pdf');
fs.mkdirSync(path.resolve('tmp'), { recursive: true });
fs.writeFileSync(tmpPdf, pdfBuffer);
cek('PDF ditulis ke disk', fs.existsSync(tmpPdf), `(${tmpPdf})`);

try {
  const { execFileSync } = await import('node:child_process');
  const py = execFileSync('python3', ['-c', `
import sys
try:
    import pymupdf
except ImportError:
    print('SKIP'); sys.exit(0)
doc = pymupdf.open(sys.argv[1])
print('\\n'.join(p.get_text() for p in doc))
`, tmpPdf], { encoding: 'utf8' });

  if (py.trim() === 'SKIP') {
    console.log('  ℹ️  pymupdf tidak tersedia — pengecekan teks PDF dilewati');
  } else {
    // PDF header memakai `.toUpperCase()`, jadi "PT Guard Test" tersimpan
    // sebagai "PT GUARD TEST". Pencocokan dilakukan case-insensitive.
    cek('PDF memuat judul custom (case-insensitive)', /PT GUARD TEST/i.test(py),
      /PT GUARD TEST/i.test(py) ? '' : `(tidak menemukan nama perusahaan)`);
    cek('PDF memuat judul "LAPORAN ABSENSI"', /LAPORAN ABSENSI/i.test(py));
  }
} catch (err) {
  console.log(`  ℹ️  pengecekan teks PDF dilewati: ${err.message.slice(0, 60)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. buildExportReport(format=pdf) juga memakai judul custom
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== D. EXPORT PDF/HTML/EXCEL KONSISTEN ===');
const expPdf = buildExportReport(fakeData, fakeStats, 'id', 'pdf', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY);
const expPdfChunks = [];
expPdf.on('data', (c) => expPdfChunks.push(c));
// doc.end() HARUS dipanggil sebelum iterasi — kalau tidak, stream tidak
// pernah selesai dan proses hang.
expPdf.end();
for await (const chunk of expPdf) expPdfChunks.push(chunk);
cek('buildExportReport(pdf) menghasilkan PDF',
  Buffer.concat(expPdfChunks).subarray(0, 4).toString('latin1') === '%PDF',
  `(ukuran: ${Buffer.concat(expPdfChunks).length} bytes)`);

const expHtml = buildExportReport(fakeData, fakeStats, 'id', 'html', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY);
cek('buildExportReport(html) memakai judul custom',
  expHtml.html.includes(`<h1>Laporan Absensi — ${COMPANY}</h1>`));

const expExcel = buildExportReport(fakeData, fakeStats, 'id', 'excel', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY);
const excelBuf = await expExcel.xlsx.writeBuffer();
cek('buildExportReport(excel) menghasilkan file', excelBuf.length > 1000,
  `(ukuran: ${excelBuf.length} bytes)`);

// ═══════════════════════════════════════════════════════════════════════════════
// E. whatsappService.sendDocument() tersedia & memvalidasi input
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== E. WHATSAPP sendDocument() ===');
const { whatsappService, invalidateGatewayUrlCache } = await import('../src/services/whatsapp.js');
cek('whatsappService.sendDocument ada', typeof whatsappService.sendDocument === 'function');

let errMsg = '';
try {
  await whatsappService.sendDocument('628123', Buffer.alloc(0), 'x.pdf');
} catch (err) { errMsg = err.message; }
cek('dokumen kosong ditolak', /kosong/i.test(errMsg), `(pesan: ${errMsg})`);

errMsg = '';
try {
  await whatsappService.sendDocument('628123', Buffer.from('x'), '');
} catch (err) { errMsg = err.message; }
cek('nama file kosong ditolak', /nama file/i.test(errMsg), `(pesan: ${errMsg})`);

// ─── E2. Bentuk media Baileys HARUS Buffer, bukan { url } ──────────────────────
//
// Baileys membaca `document: { url }` sebagai SUMBER BERKAS:
//   - string "data:"      → di-decode base64
//   - string "http(s)://" → di-stream
//   - selain itu          → dibaca sebagai PATH FILE di disk
//
// Buffer yang dipaksakan jadi string lewat `.toString()` menjadi path berisi
// isi PDF → `ENOENT: no such file or directory` → dokumen TIDAK PERNAH
// terkirim lewat jalur Baileys.
//
// Diuji terhadap baileys yang terpasang (getRawMediaUploadData):
//   { url: buffer } → ENOENT
//   buffer          → OK
// ─── E1b. Mock gateway: base64 yang kosong HARUS ditolak ─────────────────────
//
// SEBELUMNYA mock gateway menerima `base64` kalau `.length > 0`. String spasi
// saja lolos sebagai "ada" (truthy), padahal Node mengabaikannya saat decode
// sehingga hasilnya 0 byte — request dengan dokumen KOSONG diterima dengan
// status 201.
//
// Sekarang base64 didekode dulu, lalu panjang hasil decode-nya yang dicek.
console.log('\n=== E1b. MOCK GATEWAY: DOKUMEN KOSONG DITOLAK ===');
{
  const gwPort = 26000 + Math.floor(Math.random() * 2000);
  const { spawn } = await import('node:child_process');
  const gwProc = spawn(process.execPath, [
    path.resolve('..', 'scripts', 'mock-openwa-gateway.mjs'),
  ], {
    env: { ...process.env, MOCK_PORT: String(gwPort), MOCK_API_KEY: 'test-key' },
    stdio: 'ignore',
  });

  const gwPost = async (p, body, key = 'test-key') => {
    const res = await fetch(`http://127.0.0.1:${gwPort}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify(body),
    });
    return res.status;
  };

  // Tunggu mock siap.
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try {
      const h = await fetch(`http://127.0.0.1:${gwPort}/api/health`);
      ready = h.ok;
      if (!ready) await new Promise((r) => setTimeout(r, 150));
    } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  cek('mock gateway siap', ready, `(port ${gwPort})`);

  if (ready) {
    const created = await fetch(`http://127.0.0.1:${gwPort}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
      body: JSON.stringify({ name: 'default' }),
    }).then((r) => r.json());
    const sid = created?.id || 'session-1';
    const docPath = `/api/sessions/${sid}/messages/send-document`;
    const chat = '6281234567890@s.whatsapp.net';

    cek('base64 valid → 201',
      await gwPost(docPath, { chatId: chat, filename: 'x.pdf',
        base64: Buffer.from('%PDF-1.4 test').toString('base64') }) === 201);
    cek('base64 spasi saja → 400 (dokumen kosong)',
      await gwPost(docPath, { chatId: chat, filename: 'x.pdf', base64: '   ' }) === 400);
    cek('tanpa base64/url → 400',
      await gwPost(docPath, { chatId: chat, filename: 'x.pdf' }) === 400);
    cek('tanpa X-API-Key → ditolak',
      await gwPost(docPath, { chatId: chat, filename: 'x.pdf',
        base64: Buffer.from('x').toString('base64') }, '') !== 201);
  }
  gwProc.kill();
}

console.log('\n=== E2. BENTUK MEDIA BAILEYS ===');
const { getRawMediaUploadData } = await import('baileys');
let rawErr = '';
let rawLen = 0;
try {
  const r = await getRawMediaUploadData({ url: Buffer.from('%PDF-1.4 x') }, 'document', null);
  rawLen = r.fileLength;
} catch (err) { rawErr = err.message; }
cek('Baileys TIDAK bisa memproses { url: Buffer } (harus gagal)',
  rawErr !== '', `(error: ${rawErr.slice(0, 60)})`);

let rawErr2 = '';
try {
  const r2 = await getRawMediaUploadData(Buffer.from('%PDF-1.4 x'), 'document', null);
  rawLen = r2.fileLength;
} catch (err) { rawErr2 = err.message; }
cek('Baileys bisa memproses Buffer langsung',
  rawErr2 === '' && rawLen > 0, `(fileLength: ${rawLen}, error: ${rawErr2.slice(0, 60)})`);

// Kode produksi WAJIB memakai bentuk Buffer.
//
// Baris komentar DILEWATI dulu — penjelasan "SEBELUMNYA: `document: { url:
// buffer }`" ada di dalam komentar, bukan di kode yang berjalan.
const waSvcSrc = fs.readFileSync(path.resolve('src', 'services', 'whatsapp.js'), 'utf8');
const waSvcCode = waSvcSrc
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
cek('kode produksi memakai document: buffer (bukan { url: ... })',
  /document:\s*buffer\b/.test(waSvcCode) && !/document:\s*\{\s*url:\s*buffer/.test(waSvcCode));

// ─── E3. Fallback gateway: jangan kirim dua kali ──────────────────────────────
//
// Gateway yang MENOLAK eksplisit (HTTP 4xx/5xx) → pesan pasti belum
// terkirim → aman fallback ke transport lain.
//
// Gateway yang GAGAL JARINGAN (timeout / mati) → dokumen mungkin SUDAH
// terkirim lalu responsnya hilang. Fallback ke transport lain = terkirim
// DUA KALI ke penerima yang sama.
//
// `GatewayError` membawa `status`: > 0 = ditolak gateway, 0 = gagal jaringan.
//
// Uji ini memakai mock gateway HTTP lokal. Setting `wa_gateway_url` di DB
// sengaja dikosongkan sementara (dipulihkan di finally) karena setting DB
// punya prioritas lebih tinggi daripada env.
console.log('\n=== E3. FALLBACK GATEWAY ===');
const http = await import('node:http');

function startMockGateway(mode) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/api/health') { res.writeHead(200); res.end('{"status":"ok"}'); return; }
      if (req.method === 'GET' && req.url.startsWith('/api/sessions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 'sess-1', name: 'default' }]));
        return;
      }
      if (mode === 'hang') return; // tidak pernah menjawab → timeout
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'gateway menolak' }));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const gwSetting = await prisma.systemSetting.findUnique({ where: { id: 'wa_gateway_url' } });
const gwOriginal = gwSetting ? gwSetting.value : null;
try {
  // Kosongkan setting DB supaya env mock yang dipakai.
  await prisma.systemSetting.upsert({
    where: { id: 'wa_gateway_url' }, create: { id: 'wa_gateway_url', value: '' },
    update: { value: '' },
  });

  // S1 — gateway MENOLAK eksplisit (HTTP 500).
  {
    const { srv, port } = await startMockGateway('reject');
    process.env.WA_GATEWAY_URL = `http://127.0.0.1:${port}`;
    invalidateGatewayUrlCache();
    let err = '';
    try {
      await whatsappService.sendDocument('628123', Buffer.from('%PDF-1.4 x'), 'l.pdf', 'application/pdf', 'c');
    } catch (e) { err = e.message; }
    srv.close();
    // Tidak boleh dilempar sebagai "tidak dapat dipastikan" — kegagalan
    // eksplisit aman untuk fallback.
    cek('gateway menolak eksplisit → BUKAN "tidak dapat dipastikan"',
      !/tidak dapat dipastikan/i.test(err), `(pesan: ${err.slice(0, 70)})`);
    cek('pesan error menyebut gateway GAGAL (bukan "tidak dikonfigurasi" saja)',
      /gateway terkonfigurasi tapi gagal/i.test(err), `(pesan: ${err.slice(0, 70)})`);
  }

  // S2 — gateway GAGAL JARINGAN (timeout).
  {
    const { srv, port } = await startMockGateway('hang');
    process.env.WA_GATEWAY_URL = `http://127.0.0.1:${port}`;
    invalidateGatewayUrlCache();
    let err = '';
    try {
      await whatsappService.sendDocument('628123', Buffer.from('%PDF-1.4 x'), 'l.pdf', 'application/pdf', 'c');
    } catch (e) { err = e.message; }
    srv.close();
    cek('gateway gagal jaringan → TIDAK fallback (dokumen mungkin sudah terkirim)',
      /tidak dapat dipastikan/i.test(err), `(pesan: ${err.slice(0, 90)})`);
  }
} finally {
  // Pulihkan setting gateway seperti semula.
  //
  // PENTING: kalau row-nya belum ada sama sekali (gwOriginal === null),
  // row harus DIHAPUS — bukan dibuat dengan nilai kosong. Membuatnya dengan
  // nilai kosong berarti ada setting "terkonfigurasi tapi kosong", dan
  // `resolveGatewayUrl()` memperlakukannya sebagai "gateway belum
  // dikonfigurasi" — bukan berarti "dikosongkan user".
  if (gwOriginal === null) {
    await prisma.systemSetting.deleteMany({ where: { id: 'wa_gateway_url' } });
  } else {
    await prisma.systemSetting.upsert({
      where: { id: 'wa_gateway_url' },
      create: { id: 'wa_gateway_url', value: gwOriginal },
      update: { value: gwOriginal },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── F4. Toleransi keterlambatan sama di ketiga jalur laporan ──────────────────
//
// `buildDetailedReport()` menerima `toleranceMinutes` sebagai argumen ke-9.
// Tiga jalur memanggilnya:
//   - settingsController.testReportEmail()  → email uji
//   - reportController (laporan manual / preview / export)
//   - schedulerService.executeSchedule()    → jadwal otomatis
//
// SEBELUMNYA jalur email uji meng-hardcode `0` sementara dua jalur lain
// membaca setting `late_threshold_minutes`. Komentarnya sendiri menjanjikan
// "PERSIS seperti laporan yang akan dikirim scheduler" — jadi email uji dan
// laporan scheduler bisa menampilkan angka berbeda, dan user menganggap
// laporan yang benar salah.
//
// Terbukti memengaruhi hasil: tolerate 0 → baris "terlambat" (Tepat Waktu 0);
// toleransi 30 → "tepat waktu" (Tepat Waktu 1).
console.log('\n=== F4. TOLERANSI KETERLAMBATAN KONSISTEN ===');
{
  const read2 = (p) => fs.readFileSync(path.resolve('src', p), 'utf8');
  const setCtrl = read2('controllers/settingsController.js');
  const repCtrl = read2('controllers/reportController.js');
  const schedCtrl2 = read2('services/schedulerService.js');

  // Ketiganya harus membaca toleransi dari SETTINGS, bukan angka tetap.
  cek('email uji membaca toleransi dari Pengaturan',
    /settingInt\(settings, 'late_threshold_minutes'/.test(setCtrl));
  cek('email uji TIDAK lagi memakai toleransi hardcoded 0',
    !/endDate,\s*0,\s*companyName/.test(setCtrl) &&
    !/endDate,\s*0,\s*companyName,/.test(setCtrl));
  cek('laporan manual membaca toleransi dari Pengaturan',
    /settingInt\(map, 'late_threshold_minutes'/.test(repCtrl));
  cek('scheduler membaca toleransi dari Pengaturan',
    /late_threshold_minutes/.test(schedCtrl2));
}

// F. Guard statis: attachment wired di semua jalur
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== F. WIRING ATTACHMENT (statis) ===');
const read = (p) => fs.readFileSync(path.resolve('src', p), 'utf8');

const reportCtrl = read('controllers/reportController.js');
cek('email controller melampirkan PDF', /attachments/.test(reportCtrl) && /pdfToBuffer/.test(reportCtrl));
cek('email controller menghormati query attach', /req\.query\?\.attach/.test(reportCtrl));
cek('whatsapp controller menghormati query attach', /req\.query\?\.attach/.test(reportCtrl));
cek('whatsapp controller mengirim dokumen', /sendDocument/.test(reportCtrl));

const schedCtrl = read('services/schedulerService.js');
cek('scheduler melampirkan PDF ke email', /attachments/.test(schedCtrl) && /pdfToBuffer/.test(schedCtrl));
cek('scheduler mengirim dokumen WhatsApp', /sendDocument/.test(schedCtrl));

const waSvc = read('services/whatsapp.js');
cek('whatsapp service punya sendDocument', /async\s+sendDocument\s*\(/.test(waSvc));
cek('whatsapp service pakai endpoint send-document OpenWA', /messages\/send-document/.test(waSvc));

const settingsCtrl = read('controllers/settingsController.js');
cek('test-report email melampirkan PDF', /pdfToBuffer/.test(settingsCtrl));

// ═══════════════════════════════════════════════════════════════════════════════
// G. BRANDING CUSTOM: judul / subjudul / footer dari Pengaturan
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== G. BRANDING (JUDUL/SUBJUDUL/FOOTER) ===');

const BRAND = {
  title:    'Rekap Absensi Bulanan',
  subtitle: 'Rekap Absensi Karyawan PT Guard Test',
  footer:   'RAHASIA - Hanya Untuk Internal',
};

// ═══════════════════════════════════════════════════════════════════════════════
// F2. Freeze pane sheet Ringkasan ikut mengikuti subjudul
//
// `ySplit` menentukan berapa baris teratas yang DIBEKUKAN. Block judul
// sheet Ringkasan = judul + [subjudul] + periode.
//
// SEBELUMNYA `ySplit: 3` di-hardcode. Tanpa subjudul itu = judul + periode +
// baris KOSONG → satu baris terfreeze sia-sia, dan baris ringkasan ikut
// terpotong saat scroll. Dengan subjudul, 3 baris = judul + subjudul + periode
// (benar).
// ─── F3. Struktur sheet Excel: merge tidak overlap, label tidak hilang ────────
//
// Pertanyaan review yang belum dijawab: apakah `mergeCells` dipakai dengan
// benar (merge lalu tulis sel anchor), dan apakah SEMUA referensi baris
// bergeser konsisten saat subjudul ada.
//
// Diuji dengan MEMBANGUN workbook-nya (bukan membaca kode), lalu:
//   1. semua range merge dicek tidak saling overlap
//   2. semua label wajib (Total Kejadian … Jadwal Kerja) harus ada
//   3. urutan label harus sama di kedua varian (hanya bergeser 1 baris)
console.log('\n=== F3. STRUKTUR SHEET EXCEL ===');
{
  const parseRef = (ref) => {
    const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) return null;
    const colNum = (s) => s.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
    return { c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3]), r2: +m[4] };
  };
  const overlaps = (a, b) =>
    a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

  const wbX = buildExportReport(fakeData, fakeStats, 'id', 'excel', '09:00', '17:00', true,
    '2026-11-10', '2026-11-10', 0, COMPANY);
  const wbSub = buildExportReport(fakeData, fakeStats, 'id', 'excel', '09:00', '17:00', true,
    '2026-11-10', '2026-11-10', 0, COMPANY, BRAND);

  // 1. Merge tidak overlap (SEMUA sheet).
  let mergeBad = 0;
  for (const wb of [wbX, wbSub]) {
    for (const ws of wb.worksheets) {
      const merges = ws.model?.merges ? Array.from(ws.model.merges) : [];
      const parsed = merges.map(parseRef).filter(Boolean);
      for (let i = 0; i < parsed.length; i++) {
        for (let j = i + 1; j < parsed.length; j++) {
          if (overlaps(parsed[i], parsed[j])) {
            console.log(`    overlap di ${ws.name}: ${merges[i]} & ${merges[j]}`);
            mergeBad++;
          }
        }
      }
    }
  }
  cek('tidak ada merge yang saling overlap', mergeBad === 0, `(nilai: ${mergeBad})`);

  // 2. Semua label wajib ada di kedua varian.
  const WAJIB = ['Total Kejadian', 'Karyawan Unik', 'Hari Kerja', 'Mode Verifikasi',
                 'Terlambat', 'Tepat Waktu', 'Menit Terlambat', 'Jadwal Kerja'];
  const labelsOf = (wb) => {
    const ws = wb.getWorksheet('Ringkasan');
    const out = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const v = row.getCell(1).value;
      if (v !== null && v !== undefined && String(v).trim()) out.push(String(v));
    });
    return out;
  };
  const lx = labelsOf(wbX);
  const lb = labelsOf(wbSub);
  const hilang = WAJIB.filter((w) =>
    !lx.some((l) => l.includes(w)) || !lb.some((l) => l.includes(w)));
  cek('semua label wajib ada di kedua varian', hilang.length === 0,
    `(hilang: ${hilang.join(', ') || 'tidak ada'})`);

  // 3. Struktur BARIS sama di kedua varian.
  //
  // Yang dibandingkan adalah baris yang ISinyaLABEL DATA (bukan judul,
  // subjudul, atau periode — ketiganya memang berbeda isinya). Label data
  // harus PERSIS SAMA dan dalam urutan SAMA; hanya NOMOR barisnya yang
  // bergeser satu.
  const STRUKTUR = ['Total Kejadian', 'Karyawan Unik', 'Hari Kerja', 'Mode Verifikasi',
                    'Terlambat', 'Tepat Waktu', 'Menit Terlambat', 'Jadwal Kerja'];
  const struktur = (arr) => STRUKTUR.map((w) => {
    const idx = arr.findIndex((l) => l.includes(w));
    return idx === -1 ? '(hilang)' : w;
  });
  // urutan label data = urutan kemunculannya di sheet
  const urutanData = (arr) => arr
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => STRUKTUR.some((w) => l.includes(w)))
    .map(({ l }) => STRUKTUR.find((w) => l.includes(w)));

  const ordX = urutanData(lx);
  const ordB = urutanData(lb);
  cek('urutan label data sama di kedua varian',
    JSON.stringify(ordX) === JSON.stringify(ordB),
    `(tanpa: ${JSON.stringify(ordX).slice(0, 90)})`);
  cek('semua label data terdeteksi (tidak ada "(hilang)")',
    !struktur(lx).includes('(hilang)') && !struktur(lb).includes('(hilang)'),
    `(tanpa: ${struktur(lx).join(',')})`);

  // 4. Separator (baris kosong) harus tepat di depan tiap blok.
  //
  // Ini yang menjawab pertanyaan review: apakah `lateStart` melompati baris
  // atau bertumpuk? Dan apakah `footerRow = lateStart + 5` menimpa blok
  // late/ontime/menit/jadwal (yang occupy lateStart..lateStart+3)?
  //
  // Aturan: tepat sebelum tiap blok ada SATU baris kosong sebagai pemisah.
  // Kalau tidak, berarti ada baris yang terlewat atau tertimpa.
  const rowIndexOf = (wb, label) => {
    const ws = wb.getWorksheet('Ringkasan');
    let found = -1;
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const v = row.getCell(1).value;
      if (found === -1 && v !== null && v !== undefined && String(v).includes(label)) found = n;
    });
    return found;
  };
  const emptyAt = (wb, n) => {
    const ws = wb.getWorksheet('Ringkasan');
    const row = ws.getRow(n);
    let adaIsi = false;
    row.eachCell({ includeEmpty: true }, (c) => {
      if (c.value !== null && c.value !== undefined && String(c.value).trim()) adaIsi = true;
    });
    return !adaIsi;
  };

  for (const [nama, wb] of [['tanpa', wbX], ['dengan', wbSub]]) {
    const anchors = [
      ['Total Kejadian', 'Total Kejadian'],
      ['Terlambat', 'Terlambat'],
    ];
    const salah = [];
    for (const [, label] of anchors) {
      const r = rowIndexOf(wb, label);
      if (r < 2) { salah.push(`${label}(baris ${r})`); continue; }
      if (!emptyAt(wb, r - 1)) salah.push(`sebelum ${label}`);
    }
    // Footer: baris sebelum footer harus kosong.
    const footerRow = rowIndexOf(wb, wbSub === wb ? 'Dibuat oleh' : 'RAHASIA');
    if (footerRow >= 2 && !emptyAt(wb, footerRow - 1)) salah.push('sebelum footer');
    cek(`separator kosong tepat sebelum tiap blok (${nama})`,
      salah.length === 0, `(masalah: ${salah.join(', ') || 'tidak ada'})`);
  }
}

console.log('\n=== F2. FREEZE PANE SHEET RINGKASAN ===');
{
  const mk = (branding) => buildExportReport(
    fakeData, fakeStats, 'id', 'excel', '09:00', '17:00', true,
    '2026-11-10', '2026-11-10', 0, COMPANY, branding,
  ).getWorksheet('Ringkasan').views?.[0]?.ySplit;

  const yNoSub = mk({});
  const ySub = mk(BRAND);

  cek('tanpa subjudul → 2 baris terfreeze (judul + periode)',
    yNoSub === 2, `(ySplit: ${yNoSub})`);
  cek('dengan subjudul → 3 baris terfreeze (judul + subjudul + periode)',
    ySub === 3, `(ySplit: ${ySub})`);
}


const branded = buildDetailedReport(
  fakeData, fakeStats, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY, BRAND,
);

cek('branding.title dipakai sebagai judul (authoritative)', 
  branded.html.includes('<h1>Rekap Absensi Bulanan</h1>'),
  `(dapat: ${(branded.html.match(/<h1>(.*?)<\/h1>/) || [])[1]})`);
cek('branding.title TIDAK ditambah nama perusahaan lagi',
  !branded.html.includes('Rekap Absensi Bulanan — PT Guard Test'));
cek('branding.subtitle tampil di HTML',
  branded.html.includes('Rekap Absensi Karyawan PT Guard Test'));
cek('branding.subtitle tampil di versi teks',
  branded.text.includes('Rekap Absensi Karyawan PT Guard Test'));
cek('branding.footer menggantikan footer bawaan',
  branded.html.includes('RAHASIA - Hanya Untuk Internal'));
cek('footer bawaan TIDAK lagi muncul di HTML',
  !branded.html.includes('Dibuat oleh Sistem Absensi Fingerprint'));
cek('branding.footer menggantikan footer bawaan di teks',
  branded.text.includes('RAHASIA - Hanya Untuk Internal') &&
  !branded.text.includes('Dibuat oleh Sistem Absensi Fingerprint'));
cek('report.branding tersedia di objek report',
  branded.report.branding && branded.report.branding.title === BRAND.title &&
  branded.report.branding.subtitle === BRAND.subtitle &&
  branded.report.branding.footer === BRAND.footer);

// Tanpa branding → subtitle & footer bawaan tetap dipakai.
const plain = buildDetailedReport(
  fakeData, fakeStats, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY,
);
cek('tanpa branding → footer bawaan tetap dipakai',
  plain.html.includes('Dibuat oleh Sistem Absensi Fingerprint'));
cek('tanpa branding → tidak ada baris subtitle kosong',
  !plain.html.includes('class="subtitle"'));

// HTML di-escape (XSS dari input user).
const xss = buildDetailedReport(
  fakeData, fakeStats, 'id', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY,
  { title: '<script>alert(1)</script>', subtitle: '"><img src=x onerror=alert(1)>' },
);
cek('judul berisi HTML di-escape (tidak ada <script> mentah)',
  !xss.html.includes('<script>alert(1)</script>') &&
  xss.html.includes('&lt;script&gt;'));
cek('subjudul berisi HTML di-escape',
  !xss.html.includes('<img src=x onerror=alert(1)>'));

// Excel & PDF ikut memakai branding.
const brExcel = buildExportReport(fakeData, fakeStats, 'id', 'excel', '09:00', '17:00', true, '2026-11-10', '2026-11-10', 0, COMPANY, BRAND);
const brExcelBuf = await brExcel.xlsx.writeBuffer();
cek('Excel menghasilkan file dengan branding', brExcelBuf.length > 1000,
  `(ukuran: ${brExcelBuf.length} bytes)`);

// PDF dengan branding: judul custom + subjudul, tanpa overlap.
const brPdf = await pdfToBuffer(branded.report, 'id');
cek('PDF dengan branding valid', brPdf.subarray(0, 4).toString('latin1') === '%PDF',
  `(ukuran: ${brPdf.length} bytes)`);

// ═══════════════════════════════════════════════════════════════════════════════
// H. GUARD STATIS: branding wiring di semua jalur
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== H. WIRING BRANDING (statis) ===');
const svc = read('services/reportService.js');

cek('reportService punya buildBranding()', /export function buildBranding/.test(svc));
cek('reportService punya escHtml()', /function escHtml/.test(svc));
cek('buildReportObject menerima argumen branding',
  /function buildReportObject\([^)]*branding = \{\}/.test(svc));
cek('buildDetailedReport meneruskan branding',
  /buildDetailedReport\([^)]*branding = \{\}/.test(svc));
cek('buildExportReport meneruskan branding',
  /buildExportReport\([^)]*branding = \{\}/.test(svc));
cek('buildHtml memakai branding.subtitle', /br\.subtitle/.test(svc));
cek('buildText memakai branding.subtitle', /br\.subtitle/.test(svc));
cek('buildExcelExport memakai branding', /br\.companyName/.test(svc));
cek('buildPdfExport memakai branding', /br\.companyName/.test(svc));
// SEBELUMNYA: `const headerH = hasSubtitle ? 74 + SUBTITLE_H : 74`.
// Sekarang headerH dihitung dari tinggi baris yang SEBENARNYA diukur
// (`heightOfString`) + ascent offset — supaya subtitle tidak pernah
// menabrak judul/periode. Gate `check:pdf-layout` yang membuktikan.
cek('PDF headerH dihitung dinamis dari tinggi terukur',
  /const headerH\s*=\s*META_Y \+ metaH - META_ASCENT \+ HEADER_PAD_BOTTOM/.test(svc));
cek('PDF header tidak lagi memakai tinggi header hardcoded',
  !/const headerH = 74/.test(svc));

const rc = read('controllers/reportController.js');
cek('reportController membaca report_title', /'report_title'/.test(rc));
cek('reportController membaca report_subtitle', /'report_subtitle'/.test(rc));
cek('reportController membaca report_footer', /'report_footer'/.test(rc));

const sched = read('services/schedulerService.js');
cek('scheduler membaca report_title', /s\.report_title/.test(sched));
cek('scheduler membaca report_subtitle', /s\.report_subtitle/.test(sched));
cek('scheduler membaca report_footer', /s\.report_footer/.test(sched));
// PENTING: cek KODE, bukan komentar. Fallback lama masih TERSEBUT di
// komentar penjelas (dan itu memang bagus untuk dokumentasi), jadi assertion
// harus mengabaikan baris komentar.
const schedCode = sched
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');
cek('scheduler TIDAK lagi memakai fallback hardcoded "Fingerprint System"',
  !/company_name \|\| 'Fingerprint System'/.test(schedCode));
cek('scheduler memakai companyName kosong = judul bawaan',
  /const companyName = String\(s\.company_name \|\| ''\)\.trim\(\)/.test(sched));

// ═══════════════════════════════════════════════════════════════════════════════
// I. FORM UI: ketiga setting punya field di Pengaturan
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n=== I. FIELD PENGATURAN (UI) ===');
const panelPath = path.resolve('..', 'web', 'src', 'components', 'SettingsPanel.jsx');
const panel = fs.readFileSync(panelPath, 'utf8');
for (const key of ['report_title', 'report_subtitle', 'report_footer']) {
  cek(`SettingsPanel punya field "${key}"`, new RegExp(`key:\\s*'${key}'`).test(panel));
}

// Guard settings-integrity harus punya cek simetris (server -> UI).
const guardPath = path.resolve('..', 'scripts', 'check-settings-integrity.mjs');
const guard = fs.readFileSync(guardPath, 'utf8');
cek('guard settings punya cek "setting server tanpa field UI"',
  /setting server tanpa field UI/.test(guard));

// ═══════════════════════════════════════════════════════════════════════════════
// J. HEADER PDF: posisi Y harus memperhitungkan ASCENT font
// ═══════════════════════════════════════════════════════════════════════════════
//
// PDFKit memposisikan teks pada BASELINE, bukan tepi atas kotak glyph.
// Kotak yang dirender meluas ke ATAS sebesar `ascent + leading`.
//
// Terukur lewat probe: font 17pt di Y=14 → bbox y0=8.0 (offset -6.0).
// Kalau jarak antar-baris hanya menghitung `heightOfString`, baris
// berikutnya menabrak baris sebelumnya.
//
// Gate `check:pdf-layout` (bbox absolut PyMuPDF) yang menangkap ini —
// test di sini memastikan kodenya tetap memakai pola ascent-aware.
console.log('\n=== J. HEADER PDF ASCENT-AWARE ===');
const pdfSvc = read('services/reportService.js');

cek('header PDF menghitung ascent offset',
  /ASCENT_RATIO/.test(pdfSvc) && /ascentOf/.test(pdfSvc));
cek('posisi Y header dihitung dari tinggi terukur',
  /heightOfString/.test(pdfSvc));
cek('SUBTITLE_Y memakai SUBTITLE_ASCENT',
  /const SUBTITLE_Y = TITLE_Y \+ titleH \+ HEAD_GAP \+ SUBTITLE_ASCENT/.test(pdfSvc));
cek('PERIOD_Y memakai PERIOD_ASCENT',
  /PERIOD_Y\s*=\s*SUBTITLE_Y \+ subtitleH .*\+ PERIOD_ASCENT/.test(pdfSvc));
cek('META_Y memakai META_ASCENT',
  /META_Y\s*=\s*PERIOD_Y \+ periodH .*\+ META_ASCENT/.test(pdfSvc));
cek('headerH dihitung dari metaH - META_ASCENT',
  /headerH\s*=\s*META_Y \+ metaH - META_ASCENT/.test(pdfSvc));

// Gate layout PDF harus menguji varian TANPA dan DENGAN branding.
// `read()` relatif ke folder `src/`. File di `scripts/` dibaca lewat path
// dari root proyek.
const layoutProbe = fs.readFileSync(path.resolve('scripts', 'probe-pdf-layout.mjs'), 'utf8');
cek('probe layout PDF membangun varian branded',
  /buildPdf\(\s*\{/.test(layoutProbe) && /brandedOut/.test(layoutProbe));
cek('probe layout PDF memakai branding title+subtitle+footer',
  /subtitle:/.test(layoutProbe) && /footer:/.test(layoutProbe));

const layoutRunner = fs.readFileSync(path.resolve('scripts', 'run-pdf-layout-check.mjs'), 'utf8');
cek('runner layout PDF menerima lebih dari satu file',
  /process\.argv\.slice\(2\)/.test(layoutRunner));

await prisma.$disconnect();

console.log(gagal === 0
  ? '\n✅ SEMUA UJI JUDUL CUSTOM + LAMPIRAN PDF LOLOS'
  : `\n❌ HASIL: ${gagal} uji gagal`);
process.exit(gagal === 0 ? 0 : 1);
