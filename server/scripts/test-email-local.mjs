// Alat uji email lokal — mock SMTP server + pengiriman email uji otomatis.
//
// CARA PAKAI (untuk user):
//   1. Jalankan:  cd server && npm run test:smtp
//   2. Salin nilai SMTP yang ditampilkan ke `server/.env` (atau isi tab
//      "Pengaturan" di aplikasi).
//   3. Jalankan lagi: cd server && npm run test:smtp -- --send
//      → email uji benar-benar terkirim ke mock server dan ditampilkan di
//        terminal ini.
//
// ATAU cara paling cepat (tidak perlu ubah .env):
//   cd server && npm run test:email
//   → menjalankan mock server + mengirim email uji dari scheduler dalam
//     satu proses, lalu menampilkan hasilnya.
//
// CATATAN: tidak ada email sungguhan yang dikirim ke internet. Semua
// percakapan SMTP terjadi di localhost.

import { startMockSmtpServer } from './mock-smtp-server.mjs';
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const wantSend = args.includes('--send');
const outFile = getArg('out', 'tmp/smtp-inbox.json');

console.log('');
console.log('  ┌──────────────────────────────────────────────────────────────┐');
console.log('  │  ALAT UJI EMAIL LOKAL (mock SMTP)                           │');
console.log('  └──────────────────────────────────────────────────────────────┘');
console.log('');

// ─── Mode 1: hanya nyalakan mock server (untuk di-pair dengan .env) ──────────
if (!wantSend) {
  const port = parseInt(getArg('port', '2525'), 10);
  const mock = await startMockSmtpServer({
    port,
    requireAuth: true,
    user: getArg('user', 'test@localhost') || null,
    pass: getArg('pass', 'test') || null,
  });

  console.log('  ✅ Mock SMTP server aktif. Isi `server/.env` dengan:');
  console.log('');
  console.log(`     SMTP_HOST=${mock.host}`);
  console.log(`     SMTP_PORT=${mock.port}`);
  console.log('     SMTP_USER=test@localhost');
  console.log('     SMTP_PASS=test');
  console.log('     SMTP_FROM=test@localhost');
  console.log('');
  console.log('  👉 Sekarang jalankan server (`npm run dev`) dan coba fitur');
  console.log('     "Test Email" di tab Pengaturan. Email akan muncul di sini.');
  console.log('');
  console.log('  📄 Inbox juga ditulis ke: ' + path.resolve(outFile));
  console.log('  ⛔ Ctrl+C untuk berhenti.');
  console.log('');

  const abs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const write = () => fs.writeFileSync(abs, JSON.stringify(mock.messages, null, 2));
  setInterval(write, 1000).unref();
  process.on('SIGINT', () => { write(); process.exit(0); });
  process.on('SIGTERM', () => { write(); process.exit(0); });

  // Tidak pernah resolve — proses berjalan sampai Ctrl+C.
  await new Promise(() => {});
}

// ─── Mode 2: kirim email uji otomatis lewat scheduler ───────────────────────
const mock = await startMockSmtpServer({
  port: 0,
  requireAuth: true,
  user: 'test@localhost',
  pass: 'test-password',
});

const to = getArg('to', 'penerima-uji@example.com');

console.log(`  📮 Mengirim email uji ke: ${to}\n`);

try {
  const transporter = nodemailer.createTransport({
    host: mock.host,
    port: mock.port,
    secure: false,
    auth: { user: 'test@localhost', pass: 'test-password' },
  });

  await transporter.verify();
  console.log('  ✅ Verifikasi koneksi SMTP: BERHASIL');

  const info = await transporter.sendMail({
    from: 'Fingerprint Attendance System <test@localhost>',
    to,
    subject: 'Test Email — Fingerprint Attendance System',
    html: '<!DOCTYPE html><html><body style="font-family:Arial"><h2>Koneksi SMTP Berhasil!</h2>' +
          '<p>Email ini dikirim sebagai test dari Fingerprint Attendance System.</p></body></html>',
    text: 'Koneksi SMTP Berhasil! Email ini dikirim sebagai test.',
  });

  console.log(`  ✅ Email terkirim (messageId: ${info.messageId})`);

  // Tunggu sedikit supaya server sempat memproses DATA.
  await new Promise((r) => setTimeout(r, 300));

  const received = mock.messages[0];
  if (!received) {
    console.log('  ❌ Email TIDAK diterima di sisi server SMTP.');
    process.exit(1);
  }

  console.log('');
  console.log('  📬 ISI EMAIL YANG DITERIMA:');
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log(`  │  Dari     : ${received.from}`);
  console.log(`  │  Ke       : ${received.to.join(', ')}`);
  console.log(`  │  Subjek   : ${received.subject}`);
  console.log(`  │  Waktu    : ${received.receivedAt}`);
  console.log(`  │  Panjang  : ${received.body.length} karakter`);
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ✅ TEST EMAIL BERHASIL — email benar-benar terkirim & diterima.');
  console.log('');

  const abs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(mock.messages, null, 2));
  console.log(`  📄 Inbox disimpan ke: ${abs}`);
  console.log('');

  await mock.close();
  process.exit(0);
} catch (err) {
  console.error('  ❌ TEST EMAIL GAGAL:', err.message);
  console.error('');
  await mock.close();
  process.exit(1);
}
