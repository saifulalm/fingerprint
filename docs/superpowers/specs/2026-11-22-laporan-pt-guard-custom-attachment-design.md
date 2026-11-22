# Laporan Absensi PT Guard — Custom Judul & Lampiran PDF (Email/WhatsApp)

**Tanggal:** 2026-11-22
**Proyek:** `D:\laragon\www\fingerprint` (Sistem Absensi Fingerprint / BioClock)
**Status:** Menunggu persetujuan

---

## 1. Intent & Why

Permintaan dari pengguna:

> "Laporan Absensi PT Guard Test — tolong terkait hal seperti ini dapat kita custom dan tolong
> pastikan juga kita attachment pdf di email atau whatsappnya bisakah kamu buatkan dan biarkan
> dari sisi saya yang test"

Dua kebutuhan inti:

1. **Customisasi laporan** — laporan absensi PT Guard Test tidak lagi generic "Laporan Absensi".
   Judul, subjudul, dan footer harus bisa diisi sendiri.
2. **Lampiran PDF** — laporan PDF harus ikut terkirim di email dan WhatsApp, bukan hanya teks/HTML.

**Konteks penting:** sebagian besar pekerjaan ini **sudah ada** di working tree (uncommitted, dari
sesi sebelumnya). Pekerjaan yang tersisa adalah menutup gap dan membuktikan hasilnya.

---

## 2. Kondisi Saat Ini (terverifikasi, bukan asumsi)

### Sudah selesai & teruji

| Area | Implementasi | Bukti |
|---|---|---|
| Judul dari `company_name` | `reportTitle()` di `reportService.js` | `check:report-attach` 27/27 hijau |
| `attach=pdf` email | `reportController.sendReportEmail` → `pdfToBuffer()` → `attachments[]` | assertion F |
| `attach=pdf` WhatsApp | `reportController.sendReportWhatsApp` → `whatsappService.sendDocument()` | assertion E/F |
| Scheduler lampiran | `schedulerService.executeSchedule` (email + WA) | assertion F |
| Tombol "Kirim Laporan Uji" | `settingsController.testReportEmail` | assertion F |
| Toggle checkbox UI | `ReportsPage.jsx` `attachPdf` / `attachPdfWa` | build hijau |
| Konsistensi antar format | `buildReportObject()` dipakai HTML/Text/Excel/PDF | assertion B/D |

**Status test:** `npm run check:report-attach` → 27/27 ✅
**Status build:** `cd web && npm run build` → ✅ 2143 modules, 12.52s
**Status guard:** `node scripts/check-settings-integrity.mjs .` → 16/16 PASS

### Gap yang masih ada (3, terverifikasi)

**GAP 1 — Dead setting (bug class 51: "form field yang tidak dibaca = bohong")**

`report_title`, `report_subtitle`, `report_footer` sudah terdaftar di `SETTINGS_KEYS`
(`settingsController.js:35-37`) sehingga API menerimanya, **tetapi**:

- Tidak ada di `FIELD_DEFS.general` (`SettingsPanel.jsx:45-53`) → user tidak bisa mengisinya
- Tidak pernah dibaca saat render → `reportTitle()` masih memakai `fallback` bawaan
- `reportTitle()` sudah menerima parameter `customTitle` (baris 1072) tapi **tidak ada call site
  yang mengisinya** — param itu mati

Dampak: setting yang tersimpan tapi tidak berefek = user mengisi form, klik Simpan, lihat
"sukses", lalu tidak ada yang berubah. Persis kelas bug yang sudah dikenal di proyek ini.

**GAP 2 — Fallback hardcoded di scheduler**

`schedulerService.js:148` → `const companyName = s.company_name || 'Fingerprint System';`

Kalau `company_name` kosong, judul laporan scheduler menjadi "… — FINGERPRINT SYSTEM" — bukan
judul bawaan "Laporan Absensi" yang dipakai halaman Laporan. Laporan dari dua sumber berbeda punya
judul berbeda.

**GAP 3 — Belum ada bukti end-to-end**

Test yang ada murni unit + static grep. Belum pernah terbukti bahwa:
- Email benar-benar sampai **dengan** attachment PDF (mock SMTP `parseMessage()` tidak
  mem-parse bagian attachment sama sekali — hanya text/html)
- WhatsApp menerima dokumen (mock OpenWA di `scripts/mock-openwa-gateway.mjs:188` hanya punya
  `send-text`, **tidak ada** `send-document`)

---

## 3. Goals / Non-Goals / Anti-Goals

### Goals
- G1. `report_title` bisa diisi di Pengaturan → Umum dan **berpengaruh nyata** di semua format
  (PDF, HTML, Excel, Teks, email, WhatsApp).
- G2. `report_subtitle` bisa diisi dan tampil di bawah judul.
- G3. `report_footer` bisa diisi dan menggantikan footer bawaan.
- G4. Semua setting ini **tidak boleh mati** — guard otomatis mendeteksi setting yang tidak dibaca.
- G5. Judul konsisten di semua jalur (halaman Laporan, email, WhatsApp, scheduler).
- G6. Bukti end-to-end: email terbukti sampai **dengan** PDF attached; WhatsApp terbukti
  menerima dokumen PDF.

### Non-Goals
- Logo perusahaan (upload gambar) — tidak ada infra upload di repo (`multer`/`formidable` tidak
  terpasang). Butuh perubahan arsitektur storage yang lebih besar dari yang diminta.
- Per-jadwal toggle "lampirkan PDF" di scheduler — satu sumber kebenaran global lebih sederhana
  dan tidak menambah field baru di `ReportSchedule`.
- Template/theme visual lain.

### Anti-Goals (jika salah satu terjadi →implementasi dianggap gagal)
- **A1.** Setting tersimpan tapi tidak berefek (bug class 51 terulang).
- **A2.** Format berbeda menampilkan judul berbeda.
- **A3.** Laporan jadi korup (PDF pagination rusak, Excel wrap salah, HTML escape salah).
- **A4.** Diklaim "email terkirim dengan PDF" tanpa bukti nyata.

---

## 4. Constraints

- **C1.** Kolom `SystemSetting.value` bertipe `String?` — semua nilai harus dinormalisasi ke
  string (bug class 50). Checkbox boolean → `'true'`/`'false'`.
- **C2.** `reportTitle()` punya 4 parameter dan sudah dipakai di 4 call site
  (`buildHtml`, `buildText`, `buildExcelExport`, `buildPdfExport`) — parameter baru **harus
  di-append di akhir** (bug class 54).
- **C3.** PDFKit `addPage()` harus selalu menyertakan `size` (bug class 40) dan footer di bawah
  `maxY` memicu halaman kosong (bug class 41).
- **C4.** Teks dari setting user masuk ke HTML/PDF/Excel → **harus di-escape** (XSS di preview
  HTML + injeksi di PDF).
- **C5.** `buildExportReport()` menerima 10 argumen posisional — argumen baru di-append terakhir.
- **C6.** Bahasa laporan (id/en) menentukan label; isi setting bebas (tidak diterjemahkan).

---

## 5. Approaches

### Approach A — "Tembak per-format" (DIBUANG)
Tambahkan pengaturan judul secara manual di `buildHtml`, `buildText`, `buildExcelExport`,
`buildPdfExport` masing-masing.

**Trade-off:** 4 tempat ubah, tinggi risiko tidak konsisten (A2), dan tidak ada satu sumber
kebenaran.

### Approach B — "Report branding object" (DIPILIH) ✅

Satu objek `branding` yang dihitung sekali di `buildReportObject()`, lalu dibaca semua format.

```
branding = { title, subtitle, footer, companyName }
```

- `reportTitle()` membaca `branding.title`; fallback ke `companyName`; fallback ke label bawaan.
- `branding.subtitle` opsional → kalau kosong, subtitle bawaan ("Periode: …") tetap tampil.
- `branding.footer` opsional → kalau kosong, footer bawaan ("Dibuat oleh Sistem Absensi…").
- Semua format memakai `branding` → judul dijamin identik (G5).

**Trade-off:** satu perubahan di `buildReportObject()` + penyesuaian di 4 builder format.
Lebih banyak file tersentuh, tapi perubahannya **mekanis dan seragam**, dan ini satu-satunya
cara memenuhi G5 tanpa menduplikasi logika.

### Approach C — "Render template terpisah" (DIBUANG)
Ganti PDFKit/HTML/ExcelJS dengan satu template engine yang sama untuk semua format.

**Trade-off:**_probs:利益 outweigh cost —amyur wrote 3 renderer berbeda (PDF landscape, HTML,
Excel) dengan requirement layout berbeda. Menyatukan = rewrite besar dengan risiko regresi tinggi
pada output yang sudah dipakai user.

### Keputusan: **Approach B**

---

## 6. Detail Implementasi

### 6.1 Server — `reportService.js`

**`reportTitle()`** —_signature_ diperluas (append di akhir, C2):

```js
export function reportTitle(lang, companyName, fallback, customTitle = '') {
  const base = String(customTitle || fallback || '').trim();
  const company = String(companyName || '').trim();
  if (customTitle && String(customTitle).trim()) return base;   // custom = authoritative
  if (!company) return base;
  return `${base} — ${company}`;
}
```
(Sudah ada — hanya perlu `customTitle` diisi dari `branding`.)

**`buildReportObject()`** — tambah parameter `brandingInput = {}` di akhir (C5), dan hitung:

```js
const branding = {
  companyName: String(companyName || '').trim(),
  title:       String(brandingInput.title || '').trim(),
  subtitle:    String(brandingInput.subtitle || '').trim(),
  footer:      String(brandingInput.footer || '').trim(),
};
```

`report.companyName` tetap dipertahankan (backward compat, sudah dipakai test).

**Escape helper** (C4) — untuk HTML & Excel & PDF text:

```js
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
```
HTML: pakai `escHtml(branding.title)` / `subtitle` / `footer`.
Excel: ExcelJS sudah escaping sel secara default (tidak perlu, tapi aman).
PDF: PDFKit aman untuk teks biasa; cukup `lineBreak: false` untuk header.

**`buildHtml()`** — di header:
```js
<h1>${escHtml(reportTitleText)}</h1>
${branding.subtitle ? `<p class="subtitle">${escHtml(branding.subtitle)}</p>` : ''}
<p>${period}: ${dLong(startDate)} — ${dLong(endDate)}</p>
```
Footer:
```js
<div class="footer">${escHtml(branding.footer || footer)}</div>
```
Tambah CSS `.subtitle { … }`.

**`buildText()`** — subtitle setelah baris judul (hanya bila ada), footer pakai `branding.footer`.

**`buildExcelExport()`** — A1 用 `branding.title`; A2 用 `branding.subtitle` bila ada;
footer di sheet terakhir pakai `branding.footer` bila ada.

**`buildPdfExport()`** — header: judul (bold 17), subtitle (bila ada, font 10, `y` digeser),
dan `headerH` dihitung dinamis (74 → 74 + 14 bila ada subtitle) supaya konten tidak tertimpa.
Footer: `branding.footer || lbl('footer')`.

> PENTING (C3): `headerH` dinamis berarti posisi kartu statistik (`cardY = headerH + 12`) ikut
> bergeser — itu otomatis karena `cardY` sudah dihitung dari `headerH`.

### 6.2 Server — pengambil setting

`resolveReportParams()` di `reportController.js` sudah mengembalikan `{ workStart, workEnd,
detectLate, toleranceMinutes, companyName, lang }`. Tambahkan:

```js
const reportTitle = settingStr(map, 'report_title', '');
const reportSubtitle = settingStr(map, 'report_subtitle', '');
const reportFooter = settingStr(map, 'report_footer', '');
return { workStart, workEnd, detectLate, toleranceMinutes, companyName, lang,
         reportTitle, reportSubtitle, reportFooter };
```

`buildDetailedReport()` & `buildExportReport()` menerima objek branding. Karena argumen posisional
sudah panjang (C5), **branding dikirim sebagai satu argumen objek di akhir**:

```js
buildDetailedReport(data, stats, lang, workStart, workEnd, detectLate,
                    startDate, endDate, toleranceMinutes, companyName, branding = {})
buildExportReport(data, stats, lang, format, workStart, workEnd, detectLate,
                   startDate, endDate, toleranceMinutes, companyName, branding = {})
```

### 6.3 Server — `schedulerService.js` (GAP 2)

```js
// SEBELUMNYA: s.company_name || 'Fingerprint System'  → judul jadi "… — FINGERPRINT SYSTEM"
// yang berbeda dari halaman Laporan ("Laporan Absensi").
const companyName = String(s.company_name || '').trim();   // kosong = pakai judul bawaan
const branding = {
  title:    String(s.report_title || '').trim(),
  subtitle: String(s.report_subtitle || '').trim(),
  footer:   String(s.report_footer || '').trim(),
};
```
Subject scheduler ikut memakai judul branding agar konsisten dengan isi.

### 6.4 Server — `settingsController.js`

`SETTINGS_KEYS` sudah punya 3 key baru (baris 35-37) — **tidak berubah**. Yang perlu:
`testReportEmail()` meneruskan branding.

### 6.5 Web — `SettingsPanel.jsx` (GAP 1)

Tambah 3 field ke `FIELD_DEFS.general`:

```js
{ key: 'report_title',    label: { id: 'Judul Laporan',  en: 'Report Title' },
  placeholder: 'Laporan Absensi', type: 'text',
  hint: { id: 'Judul utama di PDF/HTML/Excel. Kosong = pakai judul bawaan + nama perusahaan',
          en: 'Main title in PDF/HTML/Excel. Empty = default title + company name' } },
{ key: 'report_subtitle', label: { id: 'Subjudul Laporan', en: 'Report Subtitle' },
  placeholder: 'Rekap Absensi Karyawan', type: 'text',
  hint: { id: 'Teks kecil di bawah judul (opsional)', en: 'Small text under the title (optional)' } },
{ key: 'report_footer',   label: { id: 'Footer Laporan', en: 'Report Footer' },
  placeholder: 'Rahasia — hanya untuk internal', type: 'text',
  hint: { id: 'Teks kaki halaman laporan (opsional)', en: 'Report footer text (optional)' } },
```

### 6.6 Guard — `scripts/check-settings-integrity.mjs` (G4)

Guard sekarang mengecek field yang **ada di UI** tapi mati di server. Sekarang setting bisa **ada
di server tapi tidak ada di UI** — arah sebaliknya. Tambahkan cek simetris:

```
Setiap key di SETTINGS_KEYS (kecuali grup & internal) WAJIB muncul
di FIELD_DEFS SettingsPanel.jsx — kalau tidak, field itu mati (user tidak bisa mengisinya).
```

Kecuali: `smtp_pass`, `wa_gateway_url` (keduanya ada di UI), dan key grup (`email`,
`whatsapp`, `general`).

### 6.7 Test — `server/scripts/test-report-attachment.mjs`

Tambah seksi:
- **G.** Branding custom → judul dipakai di HTML/Text/Excel/PDF, subtitle muncul, footer
  menggantikan footer bawaan.
- **H.** Guard statis: `report_title`/`report_subtitle`/`report_footer` dibaca di server.
- **I.** `reportTitle()` dengan `customTitle` = authoritative (tidak ditimpa company name).

### 6.8 Bukti end-to-end (GAP 3)

**Mock SMTP** — `parseMessage()` sekarang hanya parsing text/html. Tambahkan parsing bagian
attachment:

```js
// Bagian dengan Content-Disposition: attachment → simpan ke array attachments
// { filename, contentType, size, content(base64) }
```
Lalu assertion: email yang dikirim `attach=pdf` punya **1 attachment**, `contentType`
`application/pdf`, `filename` `laporan-absensi-<start>-<end>.pdf`, dan isi начина dengan `%PDF`.

**Mock OpenWA** — tambahkan endpoint `POST /api/sessions/:id/messages/send-document` yang
mencatat payload (chatId, filename, mimetype, ukuran base64) dan mengembalikan
`{ success: true, messageId }`. Lalu assertion ke `whatsappService.sendDocument()`.

**Test runner** — `server/scripts/test-report-delivery.mjs` (baru):
1. Jalankan mock SMTP (port acak) + mock OpenWA (port acak)
2. Set settings DB sementara: `company_name`, `report_title`, `report_subtitle`,
   `report_footer`, `smtp_*` → mock
3. Panggil controller `sendReportEmail` dengan `attach=pdf` → assertion attachment
4. Panggil `whatsappService.sendDocument()` → assertion dokumen tercatat
5. **PENTING**: pulihkan settings DB ke kondisi semula (fixture asli dicatat sebelum diubah)
6. Exit code akurat (foreground, bukan background launcher)

---

## 7. Verifikasi (urutan)

1. `node --check` setiap file server yang disentuh (C3/bug class 43 — file 2251 baris bisa
   terpotong).
2. `cd server && npm run check:report-attach` → assertion G/H/I hijau.
3. `cd server && npm run check:report-attach` + `npm run check:report-names` +
   `npm run check:scheduler-email` → semua hijau.
4. `cd web && npm run verify` → token guard + i18n guard + build.
5. `node scripts/check-settings-integrity.mjs .` → cek baru (G4) hijau.
6. `cd server && npm run test:delivery` → bukti email + WhatsApp dengan PDF.
7. `cd server && npm run verify` → seluruh gate hijau.

## 8. Yang Dibiarkan ke Pengguna

- Pengisian kredensial SMTP & WhatsApp asli di tab Pengaturan.
- Verifikasi visual PDF di aplikasi viewer (isi tabel, posisi header saat subtitle ada).
- Uji kirim nyata ke email/nomor WhatsApp sungguhan.

## 10. Hasil Implementasi (terverifikasi)

Semua butir di bawah **diukur pada sesi ini**, bukan asumsi.

| Verifikasi | Hasil |
|---|---|
| `npm run check:report-attach` | 78/78 assertion hijau (sebelumnya 27) |
| `npm run test:delivery` | 26/26 assertion hijau — email & WhatsApp terbukti menerima PDF |
| `npm run verify` (server) | Semua gate hijau, termasuk `check:pdf-layout` (4 halaman, 0 tumpang tindih) |
| `npm run verify` (web) | Token guard + i18n guard + error-handling guard + build (2143 modul) |
| `node scripts/check-settings-integrity.mjs` | 18/18 PASS, termasuk cek baru "setting server punya field UI" |
| `node --check` 4 file server | Semua OK, `reportService.js` utuh (2383 baris) |
| UI browser (Pengaturan → Umum) | Field *Judul Laporan*, *Subjudul Laporan*, *Footer Laporan* tampil |
| Round-trip settings | Isi → Simpan → `GET /api/settings` → nilai identik |
| PDF via HTTP (`/api/report/export?format=pdf`) | 200, `application/pdf`, 42.011 bytes, magic `%PDF` |
| Teks PDF (stream di-inflate) | Mengandung judul, subjudul, nama perusahaan, dan footer custom |

### Bug tambahan yang ditemukan & diperbaiki saat implementasi

**B1. Baris Excel tertimpa (`summaryRowStart = 5` hardcoded).**
Pre-existing (terbukti juga ada di HEAD). Header "Mode Verifikasi" ditulis ke
baris 5 padahal baris 5 berisi "Karyawan Unik" → nilai "Karyawan Unik" hilang
dari laporan Excel. Diganti `ws1.rowCount + 1` (posisi dinamis).

**B2. Subjudul PDF overlap dengan baris periode.**
`headerH` hardcoded 74 dan posisi Y hardcoded (33/38) → subtitle (y 29.8–36.3)
menabrak baris periode (y 34.8–41.3). Terukur, lalu diperbaiki: `headerH` dan
posisi Y dihitung (`SUBTITLE_Y=28`, `PERIOD_Y=44`, `META_Y=61`).

**B3. Parser MIME mock hanya satu level.**
Email laporan punya 3 level multipart (mixed → alternative → pdf). Parser lama
memperlakukan `multipart/alternative` sebagai lampiran, sehingga PDF asli tidak
pernah terbaca. Parser ditulis ulang dua tahap (lampiran + teks).

**B4. Base64 attachment dirusak oleh decode UTF-8.**
`decodeBase64()` mengubah byte biner PDF jadi string UTF-8 → magic bytes `%PDF`
berubah jadi `<1~×`. Attachment kini di-decode langsung ke `Buffer`.

**B5. Jalur WhatsApp memakai parameter laporan hardcoded.**
`buildDetailedReport(..., '09:00', '17:00', true, 0, ...)` → PDF WhatsApp punya
angka berbeda dari email untuk periode yang sama. Sekarang memakai hasil
`resolveReportParams()`.

**B6. Pesan WhatsApp mengabaikan judul custom.**
`waTitle` selalu "LAPORAN ABSENSI". Sekarang memakai `reportTitle()` yang sama.

**B7. Mock OpenWA tidak punya endpoint `send-document`.**
Jalur kirim dokumen tidak pernah bisa dibuktikan bekerja. Endpoint ditambahkan
+ helper `GET /__mock/last-document` untuk inspeksi.

**B8. Overlap header PDF — ternyata PRE-EXISTING, ditemukan oleh gate yang diperluas.**
`npm run check:pdf-layout` hanya menguji PDF TANPA branding. Gate diperluas
untuk menguji varian branded juga — dan langsung menangkap overlap di header
(variant tanpa branding pun!). Semantics PDFKit terukur:

| Font | Y diberikan | bbox y0 terukur | Offset |
|---|---|---|---|
| 17 pt | 14 | 8.0 | −6.0 |
| 9 pt | 38 | 34.8 | −3.2 |
| 7.5 pt | 62 | 59.3 | −2.7 |

Koordinat Y PDFKit adalah **BASELINE**, bukan tepi atas kotak glyph — kotak
meluas ke ATAS sebesar ascent. `heightOfString` mengukur tinggi BARIS, bukan
kotak glyph, jadi jarak yang dihitung dari sana saja tetap menabrak.

Perbaikan: posisi Y dihitung dari tinggi terukur **+ ascent offset**
(`ASCENT_RATIO = 0.75`), dengan `headerH` turunannya.

**B9. Footer pesan WhatsApp masih hardcoded.**
`waFooter` selalu "Sistem Absensi Fingerprint" walau footer di PDF sudah custom
→ isi dan footer tidak konsisten antar kanal. Sekarang memakai `branding.footer`.

**B10. Bahasa default laporan berbeda antar kanal.**
`reportController` fallback `'en'`, scheduler `'id'` → laporan email bisa
berbahasa Inggris sementara WhatsApp berbahasa Indonesia untuk periode yang sama.
Sekarang konsisten `'id'` di kedua jalur.

### Keputusan yang diambil tanpa persetujuan eksplisit (clarify timeout)

Sesi `clarify` timeout tanpa jawaban, dan pesan pengguna mengizinkan jalan
("biarkan dari sisi saya yang test"). Keputusan:

1. **Scope** = Judul + Subjudul + Footer. Logo/upload **tidak** dikerjakan —
   tidak ada infra upload di repo dan itu perubahan arsitektur lebih besar.
2. **Bukti** = mock SMTP + mock OpenWA (otomatis), lalu kredensial asli
   dibiarkan ke pengguna.
3. **Scheduler** = satu sumber kebenaran global (tidak ada toggle per-jadwal).

## 11. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Header PDF tertimpa subtitle | `headerH` dihitung dinamis; `check:pdf-layout` dijalankan |
| Setting user merusak HTML (XSS) | `escHtml()` pada title/subtitle/footer |
| Excel/Text tidak sinkron dengan PDF | Semua format baca `branding` yang sama dari `buildReportObject()` |
| Test e2e mengotori settings DB | Snapshot settings sebelum test, pulihkan setelah (termasuk saat test gagal → `finally`) |
| Regresi pada test lama | `npm run verify` penuh dijalankan; baseline dibandingkan |
