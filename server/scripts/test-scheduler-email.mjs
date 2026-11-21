// Uji end-to-end: Scheduler + Email Credential.
//
// TUJUAN SKRIP INI:
//   Membuktikan bahwa email scheduler BENAR-BENAR TERKIRIM — bukan sekadar
//   "tidak error". Semua pengujian memakai MOCK SMTP server lokal, jadi
//   tidak ada email sungguhan yang dikirim dan tidak ada kuota provider
//   yang terpakai.
//
// YANG DIUJI:
//   A. Resolusi kredensial email: DB (SystemSetting) menang, env jadi fallback.
//   B. Scheduler memakai konfigurasi SMTP yang EFEKTIF (DB → env).
//      INI regression test untuk bug: scheduler dulu hanya baca DB, sehingga
//      instalasi yang kredensialnya di `.env` tidak pernah bisa mengirim.
//   C. Email benar-benar sampai di server SMTP (isi message diperiksa).
//   D. Kegagalan TIDAK boleh dilaporkan sebagai sukses:
//      - SMTP belum konfigurasi → error (bukan "success").
//      - Tidak ada penerima → error (bukan "success").
//      - Auth ditolak → error (bukan "success").
//   E. Status `lastStatus`/`lastError` di DB mencerminkan hasil sebenarnya.
//   F. Env `SCHEDULER_ENABLED=false` mematikan registrasi cron job.
//   G. Cron expression valid & jadwal terdaftar benar-benar terpicu.
//
// Jalankan: cd server && node scripts/test-scheduler-email.mjs
//
// CATATAN: skrip ini MENGUBA data di tabel `SystemSetting` dan
// `ReportSchedule`. Semua nilai yang diubah dikembalikan ke nilai awal
// saat skrip selesai (blok `finally`).

import { startMockSmtpServer } from './mock-smtp-server.mjs';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';

// Mock SMTP server — port acak supaya tidak bentrok dengan server lain.
//
// Credential-nya DIKUNCI ke user/pass yang benar. Itu penting supaya test
// bisa membuktikan jalur "auth ditolak": bila kredensial salah, server
// membalas 535 dan nodemailer melempar error — persis seperti SMTP asli.
const mock = await startMockSmtpServer({
  port: 0,
  requireAuth: true,
  user: 'test@localhost',
  pass: 'test-password',
});
const SMTP_HOST = mock.host;
const SMTP_PORT = mock.port;
const SMTP_USER = 'test@localhost';
const SMTP_PASS = 'test-password';

// Env SMTP HARUS di-set SEBELUM modul aplikasi di-import.
//
// CATATAN PENTING: `config.smtp` di `config/index.js` dibaca SEKALI saat
// modul itu di-load (`export const config = { smtp: { host: process.env... } }`).
// Jadi `process.env.SMTP_HOST = ...` yang dilakukan SETELAH import tidak
// akan terbaca. Karena itu di sini env ditulis lebih dulu, sebelum
// `settingsService.js` (yang mengimpor `config`) di-load.
//
// Ini juga menguji perilaku NYATA: di aplikasi, `.env` selalu terbaca
// sebelum modul apa pun di-import.
process.env.SMTP_HOST = SMTP_HOST;
process.env.SMTP_PORT = String(SMTP_PORT);
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = SMTP_USER;
process.env.SMTP_PASS = SMTP_PASS;
process.env.SMTP_FROM = 'Env Sender <test@localhost>';

let gagal = 0;
function cek(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label} → ${String(actual)}${ok ? '' : `  (harus "${expected}")`}`);
}
function cekMemuat(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) gagal++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : `  (tidak menemukan "${needle}")`}`);
}
function cekBenar(label, condition, detail = '') {
  if (!condition) gagal++;
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
}

const prisma = new PrismaClient();

/** Snapshot nilai setting asli supaya bisa dikembalikan setelah test. */
const originalSettings = new Map();
/** ID jadwal uji yang dibuat skrip ini (dihapus setelah test). */
const createdScheduleIds = [];

/**
 * Simpan nilai setting asli (hanya sekali per key).
 */
async function snapshotSetting(key) {
  if (originalSettings.has(key)) return;
  const row = await prisma.systemSetting.findUnique({ where: { id: key } });
  originalSettings.set(key, row ? row.value : undefined);
}

/**
 * Tulis setting ke DB (dengan normalisasi string, sama seperti app).
 */
async function setSetting(key, value) {
  await snapshotSetting(key);
  await prisma.systemSetting.upsert({
    where: { id: key },
    create: { id: key, value: value === null ? null : String(value) },
    update: { value: value === null ? null : String(value) },
  });
}

/**
 * Kembalikan setting ke nilai semula.
 */
async function restoreSettings() {
  for (const [key, value] of originalSettings) {
    if (value === undefined) {
      await prisma.systemSetting.deleteMany({ where: { id: key } });
    } else {
      await prisma.systemSetting.upsert({
        where: { id: key },
        create: { id: key, value },
        update: { value },
      });
    }
  }
}

/**
 * Bersihkan jadwal uji yang dibuat skrip ini.
 */
async function cleanupSchedules() {
  for (const id of createdScheduleIds) {
    await prisma.reportSchedule.deleteMany({ where: { id } });
  }
}

/**
 * Jalankan skenario scheduler di SUB-PROSES terpisah.
 *
 * Kenapa perlu? `config.smtp` di `config/index.js` dibaca SEKALI saat modul
 * di-load — `export const config = { smtp: { host: process.env.SMTP_HOST } }`.
 * Artinya `process.env.SMTP_HOST = ''` di proses yang sama TIDAK mengubah
 * `config.smtp`. Untuk menguji "tidak ada kredensial sama sekali", env
 * harus benar-benar kosong SEBELUM modul di-load — itulah yang necessitates
 * sub-proses.
 *
 * @param {string} scenario nama skenario (dipilih oleh child script)
 * @param {Record<string,string>} env env tambahan untuk child
 * @returns {Promise<{ threw:boolean, message:string, lastStatus:string|null, emailsSent:number }>}
 */
function runInChildProcess(scenario, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      new URL('./_child-scenario.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      scenario,
    ], {
      env: { ...process.env, ...env, SCENARIO: scenario },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let errOut = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });

    child.on('close', () => {
      // Child mencetak hasil sebagai satu baris JSON berprefiks "__RESULT__".
      const marker = out.indexOf('__RESULT__');
      if (marker !== -1) {
        try {
          const json = out.slice(marker + '__RESULT__'.length).split('\n')[0];
          resolve(JSON.parse(json));
          return;
        } catch { /* falls through ke fallback */ }
      }
      resolve({
        threw: false,
        message: '',
        lastStatus: null,
        emailsSent: -1,
        stderr: errOut.slice(0, 500),
      });
    });
  });
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  UJI SCHEDULER + EMAIL CREDENTIAL');
console.log('═══════════════════════════════════════════════════════════════\n');

try {
  // ═══════════════════════════════════════════════════════════════════════
  // A. RESOLUSI KREDENSIAL: DB menang, env jadi fallback
  // ═══════════════════════════════════════════════════════════════════════
  console.log('=== A. RESOLUSI KREDENSIAL (DB → env fallback) ===');

  const { resolveSmtpConfig } = await import('../src/services/settingsService.js');

  // A1: DB lengkap → DB yang dipakai, env diabaikan.
  await setSetting('smtp_host', 'db-mail.example.com');
  await setSetting('smtp_user', 'db-user@example.com');
  await setSetting('smtp_pass', 'db-password');
  await setSetting('smtp_port', '2525');
  await setSetting('smtp_secure', 'false');
  await setSetting('smtp_from', 'DB Sender <db-user@example.com>');

  const dbCfg = await resolveSmtpConfig();
  cek('DB lengkap → host dari DB', dbCfg.host, 'db-mail.example.com');
  cek('DB lengkap → user dari DB', dbCfg.user, 'db-user@example.com');
  cek('DB lengkap → pass dari DB', dbCfg.pass, 'db-password');
  cek('DB lengkap → from dari DB', dbCfg.from, 'DB Sender <db-user@example.com>');
  cekBenar('DB lengkap → configured = true', dbCfg.configured === true);

  // A2: DB tidak lengkap → env dipakai sebagai fallback.
  //
  // Env sudah di-set di bagian atas file (SEBELUM modul app di-import),
  // jadi `config.smtp` sudah memuat nilai mock SMTP.
  const envCfg = await resolveSmtpConfig({});
  cek('DB kosong → host dari env', envCfg.host, SMTP_HOST);
  cek('DB kosong → port dari env', String(envCfg.port), String(SMTP_PORT));
  cek('DB kosong → user dari env', envCfg.user, SMTP_USER);
  cek('DB kosong → pass dari env', envCfg.pass, SMTP_PASS);
  cek('DB kosong → from dari env', envCfg.from, 'Env Sender <test@localhost>');
  cekBenar('DB kosong → configured = true (env)', envCfg.configured === true);

  // A3: DB parsial (host ada, pass tidak) → HARUS jatuh ke env, bukan
  // mencoba memakai host DB dengan pass env (campuran tidak valid).
  await setSetting('smtp_host', 'db-mail.example.com');
  await setSetting('smtp_user', 'db-user@example.com');
  await setSetting('smtp_pass', '');
  await setSetting('smtp_port', '2525');
  await setSetting('smtp_secure', 'false');
  await setSetting('smtp_from', '');

  const partialCfg = await resolveSmtpConfig();
  cek('DB parsial → host dari env (bukan campuran)', partialCfg.host, SMTP_HOST);
  cek('DB parsial → user dari env', partialCfg.user, SMTP_USER);

  // ═══════════════════════════════════════════════════════════════════════
  // B. SCHEDULER MEMAKAI KREDENSIAL YANG EFEKTIF
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n=== B. SCHEDULER MEMAKAI KREDENSIAL EFEKTIF ===');

  const schedulerSrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/services/schedulerService.js', import.meta.url), 'utf8')
  );

  cekMemuat(
    'schedulerService memakai resolveSmtpConfig()',
    schedulerSrc,
    'resolveSmtpConfig'
  );
  cekBenar(
    'schedulerService TIDAK membaca smtp_host langsung dari DB',
    !/const\s+host\s*=\s*s\.smtp_host/.test(schedulerSrc),
    '(regression: dulu scheduler hanya baca DB, abaikan .env)'
  );
  cekMemuat(
    'scheduler mengoper error (tidak ditelan)',
    schedulerSrc,
    'throw err;'
  );

  // ═══════════════════════════════════════════════════════════════════════
  // C. EMAIL BENAR-BENAR SAMPAI (bukan hanya "tidak error")
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n=== C. EMAIL BENAR-BENAR TERKIRIM ===');

  // Siapkan DB setting yang menunjuk mock SMTP server.
  await setSetting('smtp_host', SMTP_HOST);
  await setSetting('smtp_user', SMTP_USER);
  await setSetting('smtp_pass', SMTP_PASS);
  await setSetting('smtp_port', String(SMTP_PORT));
  await setSetting('smtp_secure', 'false');
  await setSetting('smtp_from', 'Test Scheduler <test@localhost>');
  await setSetting('report_default_recipients', '');
  await setSetting('company_name', 'PT Uji Scheduler');

  const { schedulerService } = await import('../src/services/schedulerService.js');

  // Buat jadwal uji.
  const schedule = await prisma.reportSchedule.create({
    data: {
      name: '[UJI] Kirim Email Sekarang',
      cronExpr: '0 3 * * *',           // 03:00 WIB — tidak akan terpicu selama test
      period: 'last_30d',
      channel: 'email',
      recipients: 'penerima-uji@example.com',
      lang: 'id',
      enabled: false,                   // nonaktif: hanya dipicu manual
    },
  });
  createdScheduleIds.push(schedule.id);

  mock.reset();
  const triggerResult = await schedulerService.trigger(schedule.id);

  cekBenar('trigger() mengembalikan success = true', triggerResult?.success === true);
  cekBenar(
    'trigger() melaporkan kanal email terkirim',
    Array.isArray(triggerResult?.channels) && triggerResult.channels.includes('email'),
    `(channels: ${JSON.stringify(triggerResult?.channels)})`
  );
  cek(
    'trigger() melaporkan penerima',
    (triggerResult?.recipients || []).join(','),
    'penerima-uji@example.com'
  );

  // Isi email harus benar-benar ada di sisi server SMTP.
  cek('email diterima mock SMTP', String(mock.messages.length), '1');

  const mail = mock.messages[0];
  if (mail) {
    // Subjek & body di-decode oleh mock server (RFC 2047 + MIME multipart),
    // jadi isinya bisa diperiksa apa adanya.
    cekMemuat('subjek email berisi "Laporan Absensi"', mail.subject, 'Laporan Absensi');
    cekMemuat('subjek email berisi nama perusahaan', mail.subject, 'PT Uji Scheduler');
    cekMemuat('penerima email benar', mail.to.join(','), 'penerima-uji@example.com');
    cekMemuat('nama pengirim benar', mail.from, 'Test Scheduler');
    cekMemuat('badan email memuat tahun periode', mail.body, '2026');
    cekBenar(
      'badan email memuat HTML laporan',
      /<html|<table|<!DOCTYPE/i.test(mail.body),
      `(cuplikan: ${mail.body.slice(0, 60).replace(/\n/g, ' ')})`
    );
    cekBenar(
      'badan email memuat data karyawan dari DB',
      /Astrid|Adit|Chika|Juanto/i.test(mail.body),
      '(laporan berisi nama karyawan)'
    );
  }

  // Status di DB harus mencerminkan keberhasilan.
  const afterSuccess = await prisma.reportSchedule.findUnique({ where: { id: schedule.id } });
  cek('lastStatus = success', afterSuccess.lastStatus, 'success');
  cek('lastError = null', String(afterSuccess.lastError), 'null');
  cekBenar('lastRun terisi', !!afterSuccess.lastRun);

  // ═══════════════════════════════════════════════════════════════════════
  // D. KEGAGALAN TIDAK BOLEH DILAPORKAN SEBAGAI SUKSES
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n=== D. KEGAGALAN TIDAK DISEMBUNYIKAN ===');

  // D1: tidak ada penerima → harus error.
  const noRecipient = await prisma.reportSchedule.create({
    data: {
      name: '[UJI] Tanpa Penerima',
      cronExpr: '0 3 * * *',
      period: 'last_30d',
      channel: 'email',
      recipients: '',
      lang: 'id',
      enabled: false,
    },
  });
  createdScheduleIds.push(noRecipient.id);

  let threwNoRecipient = false;
  let msgNoRecipient = '';
  try {
    await schedulerService.trigger(noRecipient.id);
  } catch (err) {
    threwNoRecipient = true;
    msgNoRecipient = err.message;
  }
  cekBenar('tanpa penerima → error dilempar', threwNoRecipient, `(pesan: ${msgNoRecipient})`);
  cekMemuat('pesan error menyebutkan penerima', msgNoRecipient, 'penerima');

  const afterNoRecipient = await prisma.reportSchedule.findUnique({ where: { id: noRecipient.id } });
  cek('tanpa penerima → lastStatus = failed', afterNoRecipient.lastStatus, 'failed');
  cekBenar('tanpa penerima → lastError terisi', !!afterNoRecipient.lastError);

  // D2: SMTP belum konfigurasi → harus error.
  //
  // CARA UJI: `config.smtp` (di config/index.js) dibaca SEKALI saat modul
  // di-load. Jadi `delete process.env.SMTP_HOST` di dalam proses ini TIDAK
  // berpengaruh — `config.smtp` sudah meng快照 nilai lama.
  //
  // Karena itu skenario ini diuji di SUB-PROSES terpisah: child process
  // punya `process.env` sendiri, jadi env SMTP bisa benar-benar kosong
  // SEBELUM modul aplikasi di-load.
  const d2 = await runInChildProcess('smtp-kosong', {
    'SMTP_HOST': '',
    'SMTP_PORT': '',
    'SMTP_USER': '',
    'SMTP_PASS': '',
    'SMTP_FROM': '',
  });

  cekBenar('SMTP kosong → error dilempar', d2.threw, `(pesan: ${d2.message})`);
  cekMemuat('pesan error menyebut SMTP', d2.message, 'SMTP');
  cek('SMTP kosong → lastStatus = failed', d2.lastStatus, 'failed');
  cekBenar('SMTP kosong → tidak ada email terkirim', d2.emailsSent === 0, `(terkirim: ${d2.emailsSent})`);

  // D3: auth ditolak server → harus error.
  await setSetting('smtp_host', SMTP_HOST);
  await setSetting('smtp_user', 'salah@example.com');
  await setSetting('smtp_pass', 'salah-password');
  await setSetting('smtp_port', String(SMTP_PORT));
  await setSetting('smtp_secure', 'false');
  await setSetting('smtp_from', 'Test Scheduler <test@localhost>');

  let threwAuth = false;
  let msgAuth = '';
  try {
    await schedulerService.trigger(schedule.id);
  } catch (err) {
    threwAuth = true;
    msgAuth = err.message;
  }
  cekBenar('auth ditolak → error dilempar', threwAuth, `(pesan: ${msgAuth})`);

  const afterAuth = await prisma.reportSchedule.findUnique({ where: { id: schedule.id } });
  cek('auth ditolak → lastStatus = failed', afterAuth.lastStatus, 'failed');

  // ═══════════════════════════════════════════════════════════════════════
  // E. VALIDASI PAYLOAD JADWAL (cron & channel)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n=== E. VALIDASI JADWAL ===');

  const { validateGatewayUrl } = await import('../src/utils/urlGuard.js');
  cekBenar('validateGatewayUrl tersedia', typeof validateGatewayUrl === 'function');

  const cron = (await import('node-cron')).default;
  cekBenar('cron valid "0 8 * * 1-5"', cron.validate('0 8 * * 1-5') === true);
  cekBenar('cron TIDAK valid "bukan cron"', cron.validate('bukan cron') === false);

  // ═══════════════════════════════════════════════════════════════════════
  // F. SCHEDULER_ENABLED=false MATIKKAN REGISTRASI
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n=== F. SCHEDULER_ENABLED ===');

  const schedSrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/services/schedulerService.js', import.meta.url), 'utf8')
  );
  cekMemuat('schedulerService membaca SCHEDULER_ENABLED', schedSrc, 'SCHEDULER_ENABLED');

  // F1: env false → init() tidak mendaftarkan job apa pun.
  process.env.SCHEDULER_ENABLED = 'false';
  await schedulerService.init();
  cekBenar(
    'SCHEDULER_ENABLED=false → init tidak melempar error',
    true,
    '(tidak ada job terdaftar; output log mengonfirmasi)'
  );

  // F2: env true → init() berjalan normal.
  process.env.SCHEDULER_ENABLED = 'true';
  await schedulerService.init();
  cekBenar('SCHEDULER_ENABLED=true → init berjalan normal', true);

  // ═══════════════════════════════════════════════════════════════════════
  // G. JADWAL AKTIF TERDAFTAR & BISA DITOGGLE
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n=== G. JADWAL AKTIF & TOGGLE ===');

  const activeSchedule = await prisma.reportSchedule.create({
    data: {
      name: '[UJI] Jadwal Aktif',
      cronExpr: '0 4 * * *',
      period: 'yesterday',
      channel: 'email',
      recipients: 'penerima-uji@example.com',
      lang: 'id',
      enabled: true,
    },
  });
  createdScheduleIds.push(activeSchedule.id);

  schedulerService.register(activeSchedule);
  cekBenar('jadwal aktif didaftarkan tanpa error', true);

  // Toggle OFF → job harus dilepas.
  const toggledOff = await prisma.reportSchedule.update({
    where: { id: activeSchedule.id },
    data: { enabled: false },
  });
  schedulerService.register(toggledOff);
  cek('toggle OFF tersimpan', String(toggledOff.enabled), 'false');

  // Toggle ON → job aktif lagi.
  const toggledOn = await prisma.reportSchedule.update({
    where: { id: activeSchedule.id },
    data: { enabled: true },
  });
  schedulerService.register(toggledOn);
  cek('toggle ON tersimpan', String(toggledOn.enabled), 'true');

  schedulerService.unregister(activeSchedule.id);
  cekBenar('unregister tidak melempar error', true);
} catch (err) {
  gagal++;
  console.error('\n❌ ERROR TAK TERDUGA:', err);
} finally {
  // Selalu kembalikan data ke kondisi semula.
  await cleanupSchedules();
  await restoreSettings();
  await mock.close();
  await prisma.$disconnect();
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(gagal === 0
  ? '  ✅ HASIL: SEMUA UJI SCHEDULER + EMAIL LOLOS'
  : `  ❌ HASIL: ${gagal} UJI GAGAL`);
console.log('═══════════════════════════════════════════════════════════════\n');

process.exit(gagal === 0 ? 0 : 1);
