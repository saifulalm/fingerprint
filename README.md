# BioClock — Fingerprint Attendance Management System v2.0

<p align="center">
  <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230F172A'/%3E%3Ccircle cx='16' cy='16' r='8' fill='none' stroke='%2306B6D4' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='4' fill='%2306B6D4'/%3E%3Cpath d='M16 8v4M16 20v4M8 16h4M20 16h4' stroke='%233B82F6' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E" width="48" />
</p>

<h1 align="center">BioClock Attendance</h1>
<p align="center">Sistem Manajemen Absensi Sidik Jari (Hikvision ISAPI) — React + Express + PostgreSQL</p>
<p align="center">

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js)
![Express](https://img.shields.io/badge/Express-4-000000?style=flat-square&logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-336791?style=flat-square&logo=postgresql)
![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?style=flat-square&logo=prisma)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

</p>

---

## 📑 Daftar Isi

1. [Fitur](#-fitur)
2. [Tech Stack](#-tech-stack)
3. [Instalasi (Step-by-step)](#-instalasi-step-by-step)
4. [Data Awal (Seed)](#-data-awal-seed)
5. [Menjalankan Aplikasi](#-menjalankan-aplikasi)
6. [Deployment Produksi](#-deployment-produksi)
7. [Perintah npm](#-perintah-npm-yang-tersedia)
8. [Struktur Proyek](#-struktur-proyek)
9. [API Reference](#-api-reference)
10. [Troubleshooting](#-troubleshooting)
11. [Keamanan](#-keamanan)

---

## ✨ Fitur

### 📊 Absensi & Pelaporan
- Rekap harian per karyawan (Masuk / Keluar, durasi kerja, deteksi keterlambatan)
- Laporan **HTML / Excel (XLSX) / PDF** — multi-bahasa (Indonesia / Inggris)
- **Judul laporan custom** — nama perusahaan, judul, subjudul, dan footer diatur di
  Pengaturan → Umum, berlaku seragam di PDF/HTML/Excel/Teks/Email/WhatsApp
- **Lampiran PDF di Email & WhatsApp** — laporan PDF ikut terkirim sebagai file
  (bukan hanya ringkasan teks), bisa diaktifkan per-klik atau otomatis via scheduler
- Analitik rekomendasi otomatis (keterlambatan, durasi kerja tidak wajar)
- Jadwal laporan otomatis (scheduler cron) → kirim via Email / WhatsApp
- Ekspor PDF/Excel + kirim laporan via Email & WhatsApp dalam satu klik

### 🖥️ Device Center (administrasi perangkat Hikvision)
- Identitas, status pintu, jam perangkat, jaringan, peta kapabilitas
- Daftar user per perangkat + status aktif (aplikasi **dan** perangkat)
- Konflik nomor ID antar perangkat + saran perbaikan otomatis
- Pemetaan ulang nomor ID (`employee_id_aliases`) — nomor employee immutable di perangkat
- Audit riwayat aksi perangkat

### 💬 WhatsApp
- Dua jalur integrasi:
  - **OpenWA Gateway** (HTTP API, multi-sesi, webhook registration)
  - **Baileys direct** (pairing QR di halaman web)
- Pengiriman laporan attendance via WhatsApp
- Webhook receiver dengan **idempotency key** (dedupe event at-least-once)

### 🎨 UI/UX
- **Glassmorphism dark theme**, design token terpusat (Tailwind v4 `@theme`)
- Responsive mobile-first + drawer navigation yang bisa ditutup
- **i18n penuh** (ID/EN) dengan fallback berlapis
- Dark/light theme toggle, skeleton loader, toast (Sonner-style)
- A11y: dialog focus-trap, `aria-label` pada icon-only button, `inert` pada drawer tertutup

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite 5, React Router 6, Tailwind CSS v4 |
| **State** | TanStack Query v5 (server state), React Context (Auth / Language / Toast) |
| **UI** | Radix UI primitives, Lucide React icons, Framer Motion 11 |
| **Charts** | Chart.js (built-in) + Recharts |
| **Backend** | Node.js 18+, Express 4 (ESM) |
| **ORM** | Prisma 5 → PostgreSQL 14+ |
| **Auth** | JWT Bearer token + express-session |
| **Report** | PDFKit (PDF), ExcelJS (XLSX), Nodemailer (email), Baileys / OpenWA (WhatsApp) |
| **Devices** | Hikvision ISAPI (Digest Auth) |

---

## 📦 Instalasi (Step-by-step)

### 0. Prasyarat

| Kebutuhan | Versi minimal | Cara cek |
|-----------|----------------|----------|
| **Node.js** | 18+ (LTS) | `node -v` |
| **npm** | 9+ | `npm -v` |
| **PostgreSQL** | 14+ | `psql --version` |

> **Windows:** unduh Node.js LTS dari <https://nodejs.org> dan PostgreSQL dari
> <https://www.postgresql.org/download/windows/>. Pastikan `psql` dan `node`
> sudah masuk `PATH`.

### 1. Clone repository

```bash
git clone git@github.com:saifulalm/fingerprint.git
cd fingerprint
```

### 2. Install dependency

Root repo hanya berisi runner; dependensi ada di dua sub-project (`server/`, `web/`).

```bash
# Cara cepat (install keduanya)
npm run install:all

# ATAU manual
cd server && npm install && cd ..
cd web    && npm install && cd ..
```

### 3. Siapkan database PostgreSQL

```bash
# Login sebagai postgres
psql -U postgres

# Buat database + user aplikasi
CREATE USER bioclock WITH PASSWORD 'ganti_password_kuat';
CREATE DATABASE bioclock OWNER bioclock;
\q
```

> Ganti password di atas dengan password kuat Anda sendiri.
> Database **wajib** memakai nama `bioclock` bila Anda mengikuti langkah seeding default.

### 4. Konfigurasi environment

```bash
cd server
cp .env.example .env      # Windows: copy .env.example .env
```

Edit `server/.env`:

```ini
# ─── WAJIB ──────────────────────────────────────────────
DATABASE_URL="postgresql://bioclock:ganti_password_kuat@127.0.0.1:5432/bioclock"
SESSION_SECRET="ubah-ke-string-acak-yang-panjang"

# ─── Admin login ───────────────────────────────────────
ADMIN_USER=admin
ADMIN_PASS=admin123

# ─── Server ────────────────────────────────────────────
PORT=6601
NODE_ENV=development

# ─── Perangkat Hikvision ───────────────────────────────
DEVICE_MASUK_IP=192.168.89.241
DEVICE_MASUK_USER=admin
DEVICE_MASUK_PASS=Hikvision12
DEVICE_KELUAR_IP=192.168.89.240
DEVICE_KELUAR_USER=admin
DEVICE_KELUAR_PASS=Hikvision12

# ─── Timezone (WIB = +07:00) ───────────────────────────
TZ_OFFSET=+07:00

# ─── Email (FALLBACK — sumber utama ada di UI Pengaturan) ──
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=email-anda@gmail.com
SMTP_PASS=app-password-16-karakter
SMTP_FROM=email-anda@gmail.com

# ─── Scheduler ─────────────────────────────────────────
SCHEDULER_ENABLED=true
```

> **`127.0.0.1` bukan `localhost`.** Di Windows, `localhost` sering di-resolve ke
> IPv6 `::1`, sedangkan PostgreSQL hanya listen di `127.0.0.1` → *Connection refused*.

#### Sumber kebenaran konfigurasi email

Ada **dua** sumber konfigurasi SMTP, dan yang di-DB menang:

| Prioritas | Sumber | Cara diisi | Catatan |
|:---------:|--------|------------|---------|
| 1 | Tabel `SystemSetting` (DB) | Tab **Pengaturan → Email/SMTP** | Sumber utama. Password tidak pernah dikirim balik ke browser |
| 2 | File `server/.env` | Edit manual | Dipakai **hanya** bila DB belum lengkap |

Aturan yang berlaku (`services/settingsService.js` → `resolveSmtpConfig()`):

- DB lengkap (`host` + `user` + `pass`) → dipakai apa adanya, env diabaikan.
- DB tidak lengkap → dipakai env (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`).
- Keduanya kosong → email/scheduler **tidak dapat mengirim**, dan aplikasi
  menampilkan pesan yang jelas — bukan diam-diam gagal.

> **Gmail wajib pakai App Password**, bukan password biasa:
> <https://myaccount.google.com/apppasswords>

#### Variabel `.env` lengkap

| Variabel | Wajib | Default | Keterangan |
|----------|:-----:|---------|------------|
| `DATABASE_URL` | ✅ | — | Connection string PostgreSQL |
| `SESSION_SECRET` | ✅ (production) | — | Kunci penandatangan JWT + cookie |
| `PORT` | — | `6601` | Port API Express |
| `NODE_ENV` | — | `development` | `production` mewajibkan `SESSION_SECRET` |
| `ADMIN_USER` / `ADMIN_PASS` | — | `admin` / `admin123` | Kredensial login dashboard |
| `DEVICE_MASUK_*` / `DEVICE_KELUAR_*` | — | lihat `.env.example` | Kredensial ISAPI Hikvision |
| `TZ_OFFSET` | — | `+07:00` | Offset waktu untuk logika absensi |
| `ALLOWED_ORIGINS` | — | — | Daftar origin CORS, dipisah koma. Kosong = same-origin only |
| `SMTP_HOST` | — | — | Hostname SMTP (tanpa `https://`, tanpa port) |
| `SMTP_PORT` | — | `587` | `587` (STARTTLS) atau `465` (SSL/TLS) |
| `SMTP_SECURE` | — | `false` | `true` **hanya** bila port `465` |
| `SMTP_USER` | — | — | Username/email pengirim (Gmail = alamat email lengkap) |
| `SMTP_PASS` | — | — | App Password (bukan password biasa) |
| `SMTP_FROM` | — | `SMTP_USER` | Alamat/nama pengirim yang tampil di inbox |
| `SCHEDULER_ENABLED` | — | `true` | `false`/`0`/`no`/`off` mematikan seluruh cron job |
| `WHATSAPP_SESSION_DIR` | — | `sessions/whatsapp` | Folder sesi Baileys/whatsapp-web.js |
| `WHATSAPP_BAILEYS_SESSION_DIR` | — | `sessions/baileys` | Folder sesi Baileys (pairing QR) |
| `WA_GATEWAY_URL` / `WA_GATEWAY_API_KEY` / `WA_GATEWAY_KEY` / `WA_GATEWAY_SESSION` | — | — | Integrasi OpenWA Gateway / Fonnte (opsional) |
| `WA_GATEWAY_TIMEOUT_MS` | — | `8000` | Timeout request ke gateway |
| `REPORT_DEFAULT_LANG` | — | `id` | Bahasa default laporan terjadwal |
| `REPORT_DEFAULT_RECIPIENTS` | — | — | Penerima default laporan terjadwal |
| `LATE_THRESHOLD_HOURS` | — | `09:00` | Jam kerja normal (fallback; UI Pengaturan lebih diprioritaskan) |

### 5. Push schema + generate Prisma Client

```bash
cd server
npm run db:push       # membuat tabel sesuai schema.prisma
npm run db:generate   # generate Prisma Client ke node_modules
```

### 6. Isi data awal (WAJIB untuk data saat ini)

```bash
cd server
npm run seed
```

Hasilnya:

```
[seed] Device "Fingerprint Masuk" (masuk) siap — ip=192.168.89.241
[seed] Device "Fingerprint Keluar" (keluar) siap — ip=192.168.89.240
[seed] systemSettings: 10
[seed] attendanceRecords: 1074
[seed] auditLogs: 58
[seed] deviceUsers: 21
[seed] employeeIdAliases: 3
[seed] reportSchedules: 0
[seed] syncJobs: 0
[seed] whatsappWebhookEvents: 45
[seed] whatsappWebhookRegistrations: 0
[seed] Selesai!
```

> Detail cara kerja seeding ada di bagian [Data Awal](#-data-awal-seed).

### 7. Jalankan aplikasi

```bash
# Dari folder root
npm run dev
```

| Layanan | URL |
|---------|-----|
| **API (Express)** | <http://localhost:6601> |
| **Web (Vite dev)** | <http://localhost:6602> — proxy `/api` → 6601 |
| **Login default** | `admin` / `admin123` |

---

## 📦 Data Awal (Seed)

### Konsep

Repository ini **menyertakan data operational saat ini** dalam bentuk fixture
JSON yang bisa di-commit:

```
server/prisma/fixtures/current-data.json
```

Fixture dibuat oleh script berbasis Prisma Client:

```bash
cd server
npm run export:data     # baca DB → tulis fixture JSON
```

### Kenapa JSON, bukan `pg_dump`?

`pg_dump` harus versinya **cocok dengan server** PostgreSQL. Pada mesin
development, versi client sering lebih tua (mis. client 16 vs server 18) sehingga
dump gagal dengan `server version mismatch`. Fixture JSON:

- dibuat memakai dependency project sendiri (Prisma Client) → jalan di mana saja
- bisa di-commit, di-review lewat diff, dan di-restore tanpa tooling DB tambahan
- **tidak memuat kredensial** (lihat tabel di bawah)

### Apa yang tersimpan

| Tabel | Jumlah | Keterangan |
|-------|-------:|------------|
| `AttendanceRecord` | 1.074 | Riwayat absensi lengkap |
| `AuditLog` | 58 | Jejak audit admin |
| `Device` | 2 | Konfigurasi perangkat masuk/keluar |
| `SystemSetting` | 10 | Pengaturan aplikasi |
| `device_users` | 21 | User per perangkat + status aktif |
| `employee_id_aliases` | 3 | Pemetaan nomor ID lintas perangkat |
| `whatsapp_webhook_events` | 45 | Riwayat event webhook |

### Sanitasi rahasia

Kolom sensitif **tidak pernah** ikut ke fixture dan diisi ulang dari `.env` saat seeding:

| Field | Perilaku di fixture | Sumber saat seeding |
|-------|--------------------|----------------------|
| `Device.password` | dikosongkan (`""`) | `DEVICE_*_PASS` |
| `WhatsAppWebhookRegistration.secret` | dikosongkan (`""`) | `WA_WEBHOOK_SECRET` |
| `SystemSetting.wa_gateway_url` | token di-redact → `?token=***` | diubah manual di UI |

### Idempotensi

Seed memakai `upsert` pada unique key tiap tabel → menjalankannya berulang kali
**tidak** menghasilkan baris duplikat. Aman untuk diulang pada server yang
sudah berisi data.

---

## 🚀 Menjalankan Aplikasi

### Mode Development

```bash
npm run dev          # server (6601) + web (6602) bersamaan
npm run dev:server   # hanya backend (nodemon)
npm run dev:web      # hanya frontend (vite)
```

Runner `scripts/dev.mjs` spawn kedua proses **tanpa shell** (`process.execPath`),
sehingga tidak bergantung pada `cmd.exe` maupun isi `PATH` — Windows-friendly.

### Mode Production

```bash
npm run build:web    # build SPA → web/dist
npm start            # build + jalankan Express di 6601 (menyServing web/dist)
```

Express menyajikan hasil build SPA dari `web/dist`, jadi **hanya satu port**
(6601) yang perlu dibuka di production.

---

## 🔗 Konflik Nomor Employee antar Perangkat

Nomor employee adalah kunci **LOKAL** tiap perangkat, jadi penomorannya
berbeda antar perangkat. Data nyata di instalasi ini:

```
Fingerprint In (masuk)          Fingerprint Out (keluar)
2  Saiful                        2  Saiful
3  Astrid                        3  Astrid
4  Chika                         4  Chika
5  Juanto                        5  Adit      ← nomor 5 = orang BERBEDA
6  Adit                          6  Chika     ← nomor 6 = orang BERBEDA
   (tidak ada)                   7  Juanto    ← hanya ada di Keluar
8  Cepi                          8  Cepi
9  Dian                          9  Dian
10 Ibu Christina                10 Ibu Christina
11 Brook                        11 Brook
```

Akibatnya laporan bisa **salah orang** kalau nomor dipakai sebagai identitas.
Aplikasi mengatasinya dengan tabel `employee_id_aliases` (nomor di satu
perangkat → nomor canonical di perangkat acuan `masuk`).

### Alat CLI

```bash
cd server

# Lihat roster per perangkat + hasil pencocokan berdasarkan NAMA
npm run match:roster -- check

# Sama, tapi memakai roster CACHE dari DB (untuk perangkat offline)
npm run match:roster -- check --from-db

# Tampilkan alias yang perlu dibuat
npm run match:roster -- suggest --from-db

# BUAT alias yang disarankan (yang belum ada)
npm run match:roster -- apply --from-db --yes

# Buat alias manual untuk satu nomor
npm run match:roster -- apply --device keluar --no 7 --to 5 \
  --note "Nomor 7 di Keluar sebenarnya Juanto"

# Audit: device_users vs attendance_records (nama yang tidak cocok)
npm run audit:device-users

# Perbaiki device_users dari attendance_records (aman, hanya yang tidak ambigu)
npm run audit:device-users:fix

# Audit: alias yang sudah tidak sesuai kondisi perangkat
npm run audit:id-aliases
```

### Aturan penting

- **Perangkat offline → TIDAK ada alias yang ditulis.** Roster yang tidak
  lengkap bisa menulis pemetaan yang keliru, jadi tool berhenti dan
  memberi tahu.
- **Alias yang sudah ada tidak pernah ditimpa** oleh tool. Kalau alias
  existing menunjuk nomor yang berbeda, hasilnya dilaporkan sebagai
  "bentrok" untuk ditinjau manual.
- **Nama dinormalisasi** sebelum pencocokan (spasi berlebih + huruf
  besar/kecil), jadi `"  ADIT  "` tetap cocok dengan `"Adit"`.
- **Nama yang sama di dua nomor pada satu perangkat** (mis. "Chika" di
  No.4 dan No.6 Keluar) ditangani: alias existing dipakai sebagai petunjuk
  untuk memilih pasangan yang benar.

### Riwayat perpindahan user

Nomor employee juga bisa **berubah** ketika HR memindahkan user. Contoh di
data repo ini (device "keluar"):

```
No.5 = Juanto (1–27 Okt)  →  Adit   (28 Okt–11 Nov)
No.6 = Adit   (1–27 Okt)  →  Chika  (28 Okt–11 Nov)
```

Ini **riwayat**, bukan data rusak. `npm run match:roster -- check --from-db`
memperlihkannya per periode.

---

## 🎨 Custom Judul & Lampiran PDF Laporan

Laporan absensi bisa di-branding sesuai perusahaan (contoh: **PT Guard Test**).

### A. Men customizing judul, subjudul, dan footer

Tab **Pengaturan → Umum** (buka dari halaman WhatsApp → tab *Pengaturan*):

| Field | Pengaturan DB | Efek |
|---|---|---|
| Nama Perusahaan | `company_name` | Ditambahkan ke judul bawaan → "Laporan Absensi — PT Guard Test" |
| Judul Laporan | `report_title` | Mengganti judul **sepenuhnya** (tidak ditambah nama perusahaan) |
| Subjudul Laporan | `report_subtitle` | Teks miring di bawah judul (PDF/HTML/Excel/Teks) |
| Footer Laporan | `report_footer` | Mengganti footer bawaan di kaki laporan |

**Aturan prioritas judul:**

```
report_title diisi   → dipakai utuh, nama perusahaan TIDAK ditambahkan
report_title kosong  → "Laporan Absensi" + " — " + company_name (bila ada)
```

Nilai yang hanya berisi spasi diperlakukan sebagai **kosong** — jadi mengetik
spasi di "Judul Laporan" tidak membuat judul jadi `" — PT Guard Test"`.

Judul/subjudul/footer berlaku **seragam** di semua format: PDF, HTML, Excel,
Teks, subjek email, ringkasan WhatsApp, dan jadwal otomatis (scheduler).
Bahasa laporan juga seragam: setelan `report_lang` di Pengaturan dipakai
oleh email **dan** WhatsApp (sebelumnya hanya email yang membacanya).

### B. Mengirim PDF sebagai lampiran

| Kanal | Cara |
|---|---|
| Email | Halaman **Laporan** → centang *Lampirkan PDF ke email* (default ON) → tombol **Email** |
| WhatsApp | Halaman **Laporan** → centang *Kirim PDF sebagai dokumen WhatsApp* → tombol **WhatsApp** |
| Jadwal otomatis | Selalu melampirkan PDF (email + WhatsApp) |
| Tombol *Kirim Laporan Uji* | Selalu melampirkan PDF — untuk verifikasi sebelum mengatur jadwal |

> **Catatan WhatsApp:** WhatsApp membatasi ukuran dokumen (±16 MB). Kalau PDF
> terlalu besar, ringkasan teks tetap terkirim dan hanya dokumennya yang gagal.

### C. Menguji tanpa kredensial asli

```bash
cd server
npm run test:delivery      # bukti email & WhatsApp benar-benar menerima file PDF
npm run check:report-attach # unit + wiring static
```

`npm run test:delivery` menjalankan mock SMTP + mock OpenWA gateway, mengirim
email dan dokumen WhatsApp sungguhan ke mock tersebut, lalu memeriksa:
nama file, content type, **magic bytes `%PDF`**, ukuran, dan isi PDF. Settings
DB dikembalikan ke kondisi semula setelah test (termasuk saat test gagal).

---

## 📧 Uji Email & Scheduler

Ada dua lapis alat uji. Keduanya memakai **mock SMTP server** lokal
(`scripts/mock-smtp-server.mjs`, tanpa dependensi tambahan) — jadi tidak ada
email sungguhan yang dikirim dan kuota provider tidak terpakai.

### 1. Uji otomatis (paling cepat)

```bash
cd server
npm run test:scheduler     # uji end-to-end scheduler + kredensial email
npm run test:email         # kirim 1 email uji & tampilkan isinya
```

`npm run test:scheduler` memverifikasi:

| Yang diuji | Arti |
|------------|------|
| Resolusi kredensial | DB (UI Pengaturan) menang, `.env` jadi fallback |
| Email benar-benar terkirim | Email **diterima** di server SMTP, bukan sekadar "tidak error" |
| Isi email benar | Subjek, penerima, pengirim, dan HTML laporan diperiksa |
| Kegagalan tidak disembunyikan | SMTP kosong / tanpa penerima / auth ditolak → **error**, bukan `success` |
| Status DB akurat | `lastStatus` = `success`/`failed`, `lastError` terisi saat gagal |
| `SCHEDULER_ENABLED` | `false` mematikan registrasi cron job |
| Toggle jadwal | Aktif ↔ nonaktif berfungsi |

Seluruh data uji dikembalikan ke kondisi semula saat skrip selesai.

### 2. Uji lewat UI (dengan mock SMTP aktif)

```bash
cd server
npm run test:smtp          # jalankan mock SMTP server (port 2525)
```

Lalu isi `server/.env` (atau tab **Pengaturan → Email/SMTP**) dengan nilai yang
ditampilkan, jalankan aplikasi, dan coba:

1. Tab **Pengaturan → Email/SMTP** → isi Host/Port/Email/App Password →
   klik **Test Email** → isi email tujuan → kirim.
2. Tab **Scheduler** → buat jadwal → klik **Kirim Sekarang** (trigger manual).
3. Email yang masuk akan **ditampilkan di terminal** tempat `npm run test:smtp`
   berjalan, dan disimpan ke `server/tmp/smtp-inbox.json`.

### 3. Uji dengan SMTP asli

Isi kredensial Gmail/Google Workspace di **Pengaturan → Email/SMTP**:

| Provider | Host | Port | Secure |
|----------|------|------|:------:|
| Gmail / Google Workspace | `smtp.gmail.com` | 587 | `false` |
| Outlook / Microsoft 365 | `smtp.office365.com` | 587 | `false` |
| Yahoo Mail | `smtp.mail.yahoo.com` | 587 | `false` |
| Zoho Mail | `smtp.zoho.com` | 587 | `false` |
| SendGrid | `smtp.sendgrid.net` | 587 | `false` |

> **Gmail/Google Workspace wajib pakai App Password**, bukan password biasa:
> <https://myaccount.google.com/apppasswords>

Klik **Test Email** untuk memastikan koneksi, lalu pakai **Kirim Sekarang** di
tab Scheduler untuk memastikan laporan lengkap terkirim.

### Troubleshooting

| Gejala | Penyebab & solusi |
|--------|-------------------|
| `SMTP belum dikonfigurasi` | Host/User/Password kosong di Pengaturan **dan** `.env` |
| `Invalid login: 535` | Password salah, atau pakai password biasa (harus App Password) |
| `Host SMTP tidak diizinkan` | Host menunjuk jaringan internal. Pakai hostname publik |
| `ECONNREFUSED` | Port salah atau diblokir firewall. Port 587 biasanya terbuka |
| `ETIMEDOUT` | Host tidak bisa dijangkau. Cek DNS & konektivitas |
| Email tidak terkirim though "sukses" | Fixed — scheduler kini **melempar error**, bukan menelan kegagalan |

> **Matikan scheduler sementara** (untuk uji tanpa email berulang):
> set `SCHEDULER_ENABLED=false` di `server/.env`, lalu restart server.

---

## 🏭 Deployment Produksi

### 1. Server

```bash
git clone git@github.com:saifulalm/fingerprint.git /var/www/fingerprint
cd /var/www/fingerprint

npm run install:all
cd server && cp .env.example .env && nano .env   # isi kredensial produksi
npm run db:push && npm run db:generate && npm run seed
cd ..

npm run build:web
```

### 2. systemd service

`/etc/systemd/system/bioclock.service`:

```ini
[Unit]
Description=BioClock Attendance Server
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/fingerprint
Environment=NODE_ENV=production
EnvironmentFile=/var/www/fingerprint/server/.env
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bioclock
sudo systemctl status bioclock
```

### 3. Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name fingerprint.domain.com;

    location / {
        proxy_pass http://127.0.0.1:6601;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> Set `ALLOWED_ORIGINS=https://fingerprint.domain.com` di `.env` agar CORS
> tidak menolak origin yang sama dengan domain production.

---

## 📋 Perintah npm yang Tersedia

### Root (`package.json`)

| Perintah | Fungsi |
|----------|--------|
| `npm run install:all` | Install dependency `server/` + `web/` |
| `npm run dev` | Jalankan server (6601) + web (6602) bersamaan |
| `npm run dev:server` | Jalankan hanya backend |
| `npm run dev:web` | Jalankan hanya frontend |
| `npm run build:web` | Build production SPA → `web/dist` |
| `npm start` | Build + jalankan server production |
| `npm run cleanup` | Kill proses yatim & bebaskan port dev |
| `npm run verify` | Gate penuh: audit API + verify server + verify web |
| `npm run audit:api` | Audit wiring frontend ↔ backend |
| `npm run test:openwa` | Integration test OpenWA gateway (mock) |
| `npm run test:ui:webhook` | Verifikasi UI webhook (headless) |
| `npm run test:ui:audit` | Verifikasi UI audit-clean (headless) |
| `npm run mock:openwa` | Jalankan mock OpenWA gateway saja |

### Backend (`server/`)

| Perintah | Fungsi |
|----------|--------|
| `npm start` | Jalankan API (port 6601) |
| `npm run dev` | Jalankan API dengan nodemon |
| `npm run db:push` | Sinkronkan schema ke database |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:studio` | Buka Prisma Studio |
| `npm run seed` | Seed device + muat fixture data saat ini |
| `npm run export:data` | Ekspor DB → `prisma/fixtures/current-data.json` |
| `npm run setup` | `db:push` + `db:generate` + `seed` (satu perintah) |
| `npm run test:scheduler` | Uji end-to-end scheduler + email (mock SMTP, tanpa email sungguhan) |
| `npm run test:email` | Kirim 1 email uji ke mock SMTP & tampilkan isinya |
| `npm run test:smtp` | Jalankan mock SMTP server (untuk pair dengan `.env`) |
| `npm run check:scheduler-email` | Guard regresi scheduler + kredensial email |
| `npm run check:report-attach` | Guard judul custom + lampiran PDF (unit + wiring) |
| `npm run test:delivery` | Bukti end-to-end: email & WhatsApp benar-benar menerima file PDF |
| `npm run verify` | Gate: prisma-ids + identity + async-handlers + scheduler-email + report-attach + pdf-layout + delivery |

### Frontend (`web/`)

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Vite dev server (6602) |
| `npm run build` | Build production → `web/dist` |
| `npm run preview` | Preview hasil build |
| `npm run check:tokens` | Guard design token (radius/warna) |
| `npm run check:i18n` | Guard kunci i18n yang hilang |
| `npm run check:settings` | Guard integritas settings |
| `npm run check:error-handling` | Guard penanganan error async |
| `npm run verify` | Semua guard + build |

---

## 📁 Struktur Proyek

```
fingerprint/
├── server/                       # Backend (Express ESM)
│   ├── prisma/
│   │   ├── schema.prisma         # Model PostgreSQL
│   │   ├── seed.js               # Seed device + fixture loader
│   │   └── fixtures/
│   │       └── current-data.json # ⭐ Data saat ini (aman di-commit)
│   ├── scripts/
│   │   ├── export-data.mjs       # Ekspor DB → fixture JSON
│   │   └── ...                   # probe/verify/check scripts
│   ├── src/
│   │   ├── config/               # Env loader & validasi
│   │   ├── controllers/          # HTTP layer
│   │   ├── routes/               # Express routers
│   │   ├── services/             # Business logic + integrasi
│   │   ├── middleware/           # auth, error handler, rate limit
│   │   └── index.js              # Entry point
│   └── .env                      # Kredensial (gitignored)
├── web/                          # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/           # UI + feature components
│   │   ├── context/              # Language / Toast context
│   │   ├── hooks/                # Custom hooks (useLang, useDialogA11y)
│   │   ├── lib/                  # i18n data, utils
│   │   ├── pages/                # Halaman per route
│   │   ├── services/api.js       # Axios instance + interceptor
│   │   └── index.css             # Design tokens (Tailwind v4 @theme)
│   ├── scripts/                  # Guard scripts
│   └── index.html
├── scripts/                      # Runner dev, cleanup, mock, audit, verify
├── .env.example                  # Contoh konfigurasi (root-level docs)
├── CLAUDE.md                     # Panduan arsitektur untuk AI/dev
└── README.md
```

---

## 🔌 API Reference

Semua endpoint diawali `/api`. Endpoint terproteksi butuh header
`Authorization: Bearer <token>` (didapat dari login).

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Login admin → JWT + session cookie |
| `GET` | `/api/auth/me` | Info user yang sedang login |
| `POST` | `/api/auth/logout` | Keluar / hapus cookie |

### Absensi & Device

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/devices` | Status perangkat |
| `POST` | `/api/attendance` | Log absensi (butuh `startDate`, `endDate`) |
| `POST` | `/api/attendance/db` | Ambil absensi dari database |
| `POST` | `/api/attendance/rekap` | Rekap absensi (butuh rentang tanggal) |

### Laporan

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/report/preview` | Preview laporan (HTML) |
| `GET` | `/api/report/export` | Export `?format=excel\|pdf\|html` |
| `GET` | `/api/report/email` | Kirim laporan via email (`?recipients=`) |
| `GET` | `/api/report/whatsapp` | Kirim ringkasan laporan via WhatsApp (`?recipients=`) |
| `POST` | `/api/export/excel` \| `/pdf` \| `/csv` | Export langsung dari AttendancePage |

### Device Center

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/device-center/overview` | Identitas, status pintu, jam, jaringan, kapabilitas |
| `GET` | `/api/device-center/users?device=` | Daftar user per perangkat |
| `GET` | `/api/device-center/conflicts` | Konflik nomor ID antar perangkat |
| `GET` | `/api/device-center/id-alias/suggestions` | Saran perbaikan nomor ID |
| `POST` / `DELETE` | `/api/device-center/id-alias` | Terapkan / hapus pemetaan nomor ID |
| `PUT` | `/api/device-center/users` | Ubah nama user di perangkat |
| `PUT` | `/api/device-center/users/status` | Aktifkan / nonaktifkan user |
| `DELETE` | `/api/device-center/users` | Hapus dari daftar aplikasi |
| `POST` | `/api/device-center/sync-name` | Samakan nama ke semua perangkat |
| `GET` | `/api/device-center/audit` | Riwayat aksi perangkat |

### Pengaturan, Admin & Integrasi

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` / `PUT` | `/api/settings` | System settings (secret di-strip saat read) |
| `GET/POST/PUT/DELETE` | `/api/scheduler` | Jadwal laporan otomatis |
| `GET` | `/api/admin/dashboard` | Ringkasan dashboard admin |
| `GET` | `/api/admin/stats` | Statistik agregat admin |
| `POST` | `/api/admin/audit` | Tulis audit log |
| `DELETE` | `/api/admin/audit` | Bersihkan audit log (`?days=30`) |
| `GET` | `/api/employees` | Daftar karyawan |
| `POST` | `/api/employees` | Tambah karyawan |
| `PUT` | `/api/employees/:employeeNo` | Ubah data karyawan |
| `PUT` | `/api/employees/:employeeNo/status` | Aktifkan / nonaktifkan karyawan |
| `POST` | `/api/employees/bulk` | Tambah karyawan massal (CSV) |
| `DELETE` | `/api/employees/:employeeNo` | Hapus karyawan |
| `GET` | `/api/whatsapp/status` | Status koneksi WhatsApp |
| `GET` | `/api/whatsapp/qr` | QR pairing (Baileys) |
| `POST` | `/api/whatsapp/connect` \| `/disconnect` \| `/reset` | Kelola sesi WhatsApp |
| `POST` | `/api/whatsapp/send` | Kirim pesan WhatsApp |
| `GET` | `/api/whatsapp/webhooks` | Daftar webhook registered |
| `POST` | `/api/whatsapp/webhooks` | Register webhook |
| `GET` | `/api/whatsapp/webhooks/history` \| `/stats` \| `/failures` | Riwayat webhook |
| `POST` | `/api/whatsapp/webhooks/:id/test` | Uji webhook |
| `POST` | `/api/whatsapp/webhooks/rotate-secret` | Rotasi secret webhook |
| `POST` | `/api/webhook/openwa` | Receiver webhook OpenWA |

> **Batasan firmware Hikvision.** Perangkat menolak penambahan user
> (`UserInfo/Add` → `notSupport`) dan hard-delete (`UserInfo/Delete` →
> `badParameters`). Maka "hapus" = **nonaktifkan** (`Valid.enable=false`), dan
> "tambah" = buat user dari layar perangkat lalu sinkronkan. Nomor employee
> immutable di sisi perangkat → perbaikan ID dilakukan via tabel
> `employee_id_aliases`.

---

## 🧹 Troubleshooting

### "Blocked request. This host (...) is not allowed."

Vite memblokir request yang `Host` header-nya bukan localhost/IP. Muncul saat
aplikasi diakses lewat domain publik (reverse proxy / tunnel → port 6602).

Host yang diizinkan terdaftar di `web/vite.config.js`:

```js
server: {
  host: true,          // listen di semua interface (IPv4 + IPv6)
  allowedHosts: [
    'fingerprint.educationpartnerships.net',
    '.educationpartnerships.net',   // seluruh subdomain
  ],
},
```

Tambahkan domain baru ke `allowedHosts` bila berubah. Entri berawalan `.` cocok
sebagai **suffix**, jadi cukup satu baris untuk semua subdomain.

> Untuk **produksi**, jangan pakai dev server. Jalankan `npm run build:web` lalu
> `npm start` — Express menyajikan `web/dist` di port 6601 dan seluruh reverse
> proxy diarahkan ke sana. Dev server di-port 6602 hanya untuk development dan
> kini dapat dijangkau dari jaringan lokal.

### "Tidak dapat terhubung ke server"

Penyebab: proses server/vite yang tertinggal masih memegang port.

```bash
npm run cleanup     # bunuh proses yatim + bebaskan port 6601/6602
npm run dev
```

### `EADDRINUSE: address already in use :::6601`

```bash
npm run cleanup
```

### `Error: Port 6602 is already in use`

Vite dikonfigurasi `strictPort: true` sehingga **tidak** akan diam-diam pindah
port (perilaku lama ini menyebabkan proxy menunjuk ke URL berbeda). Bersihkan dulu:

```bash
npm run cleanup
```

### `Error: spawn cmd.exe ENOENT` / PATH error

Runner dev memakai `scripts/dev.mjs` yang spawn proses via `process.execPath`
**tanpa shell**, sehingga tidak bergantung pada `cmd.exe` atau isi `PATH`.
Tidak perlu set PATH manual.

### `Can't reach database server at localhost:5432`

Ganti `localhost` menjadi `127.0.0.1` di `DATABASE_URL`. Di Windows, `localhost`
sering di-resolve ke IPv6 `::1`.

### `database "bioclock" does not exist`

```bash
psql -U postgres -c "CREATE DATABASE bioclock OWNER bioclock;"
```

### `Argument 'id' is missing` saat create

Semua model di `schema.prisma` sudah punya default id (`@default(uuid())`).
Bila Anda menambah model baru, pastikan `id` punya default. Guard:
`cd server && npm run check:prisma-ids`.

### Prisma `EPERM` saat `prisma generate` (Windows)

`prisma generate` tidak bisa men-rename `query_engine-windows.dll.node` selama
proses server masih memegang file-nya. Matikan dulu proses di port 6601:

```bash
npm run cleanup
cd server && npx prisma generate
```

### Tampilan belum berubah setelah edit frontend

SPA production disajikan dari `web/dist` → rebuild dulu:

```bash
npm run build:web
```

Lalu hard-refresh browser (`Ctrl+Shift+R`) karena bundel di-cache.

### WhatsApp: QR tidak muncul

- Jalur Baileys butuh logger pino (bukan object biasa) — sudah ditangani di
  `server/src/services/whatsapp.js`.
- Jalur OpenWA butuh `WA_GATEWAY_URL` + `WA_GATEWAY_API_KEY` terisi. Setelah
  restart server, `WA_GATEWAY_URL` **tetap** terdeteksi (tidak bergantung pada
  state lokal).
- Uji integrasi tanpa perangkat: `npm run test:openwa`.

---

## 🔐 Keamanan

- **JWT Bearer token** + `httpOnly` session cookie; token disimpan di
  `localStorage.fp_token` oleh SPA.
- **Password di-hash** (bcrypt) — jangan pernah simpan plaintext.
- **CORS dibatasi** ke `ALLOWED_ORIGINS`; default = same-origin only.
- **Helmet** untuk header keamanan.
- **Rate limiting** pada route autentikasi.
- **Input di-sanitize**; query memakai parameterized query (Prisma) → aman dari
  SQL injection.
- **Rahasia tidak pernah dikirim ke client**: `GET /api/settings` menghapus
  `smtp_pass`; nilai secret kosong saat write berarti "tidak diubah", bukan
  "hapus".
- **Audit log** untuk setiap aksi sensitif.
- `.env` di-gitignore — **jangan pernah** commit kredensial.
- Fixture `current-data.json` **sengaja tidak memuat** password perangkat,
  secret webhook, maupun token URL.

### Checklist sebelum production

- [ ] `SESSION_SECRET` diganti dengan string acak panjang
- [ ] `ADMIN_PASS` diganti dari `admin123`
- [ ] `NODE_ENV=production`
- [ ] `ALLOWED_ORIGINS` diisi dengan domain production
- [ ] PostgreSQL hanya listen di `127.0.0.1` (tidak expose ke publik)
- [ ] HTTPS aktif (reverse proxy / Let's Encrypt)
- [ ] `server/.env` permission `600`

---

## 📝 License

MIT — bebas digunakan untuk project apapun.
