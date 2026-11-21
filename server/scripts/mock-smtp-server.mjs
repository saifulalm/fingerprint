// Mock SMTP server — untuk menguji pengiriman email tanpa provider asli.
//
// TUJUAN:
//   1. Menguji apakah scheduler benar-benar MENGIRIM email (bukan hanya
//      "tidak error"). Email yang terkirim bisa dibaca dari `messages`.
//   2. Memberi user cara menjalankan "kirim email uji" di mesin sendiri,
//      tanpa membakar kuota Gmail/Mailgun.
//   3. Menguji jalur kegagalan (auth gagal, SMTP menolak) secara deterministik.
//
// IMPLEMENTASI:
//   SMTP server minimal di atas `node:net` — TANPA dependensi
//   tambahan. Mendukung: EHLO/HELO, AUTH PLAIN, AUTH LOGIN, MAIL FROM,
//   RCPT TO, DATA, RSET, NOOP, QUIT.
//
// CARA PAKAI SEBAGAI CLI (servermock untuk user):
//   node scripts/mock-smtp-server.mjs --port 2525 --out ./tmp/smtp.json
//
//   Lalu di server/.env isi:
//     SMTP_HOST=127.0.0.1
//     SMTP_PORT=2525
//     SMTP_USER=test@localhost
//     SMTP_PASS=test
//
// CARA PAKAI SEBAGAI MODUL (dipakai script test):
//   import { startMockSmtpServer } from './mock-smtp-server.mjs';
//   const mock = await startMockSmtpServer({ port: 0 });
//   // mock.port, mock.messages, await mock.close()

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Decode payload base64 dengan fallback ke string biasa.
 * Email header bisa berisi karakter non-ASCII yang di-encode UTF-8.
 */
function decodeBase64(value) {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

/**
 * Decode satu encoded-word MIME (RFC 2047), mis.
 *   =?UTF-8?Q?Laporan_Absensi?=
 *   =?UTF-8?B?TGFiYXNzYXNz?=
 *
 * B_Q encoded-word boleh berurutan dan dipisah whitespace (line folding).
 * Hasil digabung lalu whitespace di-decode sebagai spasi.
 */
function decodeEncodedWords(value) {
  if (!value) return '';

  // RFC 2047: dua encoded-word yang berdekatan dipisahkan whitespace
  // (line folding) — whitespace itu HARUS dihapus sebelum decode.
  //
  //   Subject: =?UTF-8?Q?Test_Email_=E2=80=94_Fingerprint_Attenda?=
  //            =?UTF-8?Q?nce_System?=
  //
  // SEBELUMNYA whitespace itu ikut ter-decode menjadi spasi, hasilnya
  // "Attenda nce" (kata terpotong) alih-alih "Attendance".
  //
  // Karena itu pola "?= =?" (encoded-word → whitespace → encoded-word)
  // disatukan lebih dulu.
  const normalized = String(value).replace(/\?=\s+=\?/g, '?==?');

  const re = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
  let out = '';
  let last = 0;
  let match;

  while ((match = re.exec(normalized)) !== null) {
    out += normalized.slice(last, match.index);
    const [, charset, encoding, payload] = match;

    let decoded = '';
    if (encoding.toUpperCase() === 'B') {
      decoded = decodeBase64(payload);
    } else {
      // Quoted-printable: "=" → hex, "_" → spasi.
      decoded = payload
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/_/g, ' ');
    }

    // Charset utf-8 → bytes. Charset lain diabaikan (asumsi UTF-8).
    try {
      decoded = Buffer.from(decoded, 'binary').toString('utf8');
    } catch { /* biarkan string apa adanya */ }

    out += decoded;
    last = match.index + match[0].length;
  }

  out += normalized.slice(last);

  // Lipat line folding yang tersisa (newline + whitespace) menjadi spasi.
  return out.replace(/\r?\n[ \t]+/g, ' ').trim();
}

/**
 * Decode quoted-printable (soft line break "=" di akhir baris).
 */
function decodeQuotedPrintable(value) {
  return value
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Decode base64 (dengan toleransi whitespace).
 */
function decodeBase64Text(value) {
  return decodeBase64(value.replace(/\s+/g, ''));
}

/**
 * Pisahkan isi email menjadi header dan body, lalu decode isinya.
 *
 * Email modern = MIME multipart: ada bagian text/plain dan text/html.
 * Agar assertion bisa memeriksa isi yang DIMAKSUDKAN, kedua bagian itu
 * digabung (dipilih html kalau ada, kalau tidak pakai text).
 *
 * @param {string} raw
 * @returns {{ headers: Record<string,string>, subject: string, from: string, to: string[], body: string, text: string, html: string }}
 */
export function parseMessage(raw) {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');

  // Pisahkan header dari body pada baris kosong pertama.
  const parts = normalized.split(/\n[ \t]*\n/);
  const head = parts.shift() || '';
  const bodyRaw = parts.join('\n\n');

  const headers = {};
  let lastHeaderKey = null;
  const headerLines = head.split('\n');
  for (let i = 0; i < headerLines.length; i++) {
    const line = headerLines[i];

    // Header continuation (RFC 5322): baris berikutnya dimulai dengan
    // whitespace →Continuation dari header sebelumnya.
    //
    // PENTING: tanpa penanganan ini, header `Content-Type` yang di-fold
    // menjadi 2 baris akan terparse sebagai 2 header terpisah, dan nilai
    // `boundary=` ikut terpotong.
    if (/^[ \t]/.test(line) && Object.keys(headers).length) {
      const lastKey = lastHeaderKey;
      if (lastKey) headers[lastKey] = `${headers[lastKey]} ${line.trim()}`;
      continue;
    }

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
    lastHeaderKey = key;
  }

  const contentType = headers['content-type'] || '';

  let text = '';
  let html = '';

  if (/multipart/i.test(contentType)) {
    // Ambil setiap bagian MIME berdasarkan boundary.
    const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
    // PENTING: beberapa SMTP server (termasuk nodemailer) menulis boundary
    // DENGAN awalan "--" di dalam nilai yang diapit tanda kutip:
    //     boundary="--_NmP-fb9564bae182996e-Part_1"
    // sedangkan pemisah di badan email adalah:
    //     ----_NmP-fb9564bae182996e-Part_1
    //
    // SEBELUMNYA boundary dipakai apa adanya → `split('--' + boundary)`
    // menjadi `split('----_NmP-...')` → TIDAK KENA → body kosong.
    //
    // Karena itu awalan "--" pada nilai boundary dibuang lebih dulu.
    let boundary = boundaryMatch ? boundaryMatch[1].trim() : null;
    if (boundary && boundary.startsWith('--')) boundary = boundary.slice(2);

    if (boundary) {
      const chunks = bodyRaw.split(`--${boundary}`);
      for (const chunk of chunks) {
        // Penutup boundary dimulai dengan "--" → lewati.
        if (/^--/.test(chunk.trim())) continue;

        const chunkParts = chunk.split(/\n[ \t]*\n/);
        const chunkHead = chunkParts.shift() || '';
        let chunkBody = chunkParts.join('\n\n');

        // Buang sisa penanda boundary di akhir bagian.
        chunkBody = chunkBody.replace(/\n--\s*$/, '').trimEnd();

        const chunkType = (chunkHead.match(/Content-Type:\s*([^\n;]+)/i) || [])[1] || '';
        const chunkEncoding = (chunkHead.match(/Content-Transfer-Encoding:\s*([^\n]+)/i) || [])[1] || '';

        let decoded = chunkBody;
        if (/quoted-printable/i.test(chunkEncoding)) decoded = decodeQuotedPrintable(chunkBody);
        else if (/base64/i.test(chunkEncoding)) decoded = decodeBase64Text(chunkBody);

        if (/text\/html/i.test(chunkType)) html = decoded;
        else if (/text\/plain/i.test(chunkType)) text = decoded;
      }
    }
  } else {
    // Bukan multipart: decode sesuai encoding yang dinyatakan.
    const encoding = headers['content-transfer-encoding'] || '';
    if (/quoted-printable/i.test(encoding)) text = decodeQuotedPrintable(bodyRaw);
    else if (/base64/i.test(encoding)) text = decodeBase64Text(bodyRaw);
    else text = bodyRaw;

    if (/text\/html/i.test(contentType)) html = text;
  }

  return {
    headers,
    subject: decodeEncodedWords(headers.subject || ''),
    from: decodeEncodedWords(headers.from || ''),
    to: decodeEncodedWords(headers.to || '').split(',').map((t) => t.trim()).filter(Boolean),
    body: html || text,
    text,
    html,
  };
}

/**
 * Jalankan mock SMTP server.
 *
 * @param {object} [options]
 * @param {number} [options.port]      Port (0 = port acak, berguna untuk test).
 * @param {string} [options.host]      Host bind (default 127.0.0.1).
 * @param {boolean} [options.requireAuth] Tolak bila AUTH tidak dikirim.
 * @param {string} [options.user]      Username yang WAJIB benar (opsional).
 *                                       Bila diisi, credential lain DITOLAK —
 *                                       dipakai untuk menguji jalur "auth gagal".
 * @param {string} [options.pass]      Password yang WAJIB benar (opsional).
 * @returns {Promise<{ port:number, host:string, messages:object[], close:()=>Promise<void>, reset:()=>void }>}
 */
export function startMockSmtpServer(options = {}) {
  const {
    port = 0,
    host = '127.0.0.1',
    requireAuth = true,
    user: expectedUser = null,
    pass: expectedPass = null,
  } = options;

  /** @type {object[]} */
  const messages = [];
  /** @type {import('node:net').Socket[]} */
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');

    // State per-koneksi (satu koneksi = satu percakapan SMTP).
    let authenticated = !requireAuth;
    let mailFrom = '';
    let rcptTo = [];
    let inData = false;
    let dataBuffer = '';

    // Tantangan AUTH LOGIN: 'user' = menunggu username, 'pass' = menunggu
    // password, null = tidak ada tantangan aktif.
    let authChallenge = null;
    // Username yang baru saja diterima (dipakai saat tantangan password).
    let user = '';

    // Buffer baris: data TCP bisa datang terpotong di tengah baris.
    // Tanpa buffer, baris terakhir tiap chunk akan hilang — dan perintah
    // seperti "EHLO localhost" bisa sampai ke server dalam keadaan rusak.
    let lineBuffer = '';

    const send = (line) => socket.write(`${line}\r\n`);

    send('220 mock-smtp.local ESMTP FingerprintTestServer');

    /**
     * Tangani satu baris perintah SMTP.
     * @param {string} line baris tanpa akhir baris
     */
    const handleLine = (line) => {
      if (line === undefined) return;

      if (inData) {
        // Baris ".\r\n" menandai akhir badan email.
        if (line === '.') {
          inData = false;
          const raw = dataBuffer;
          dataBuffer = '';

          const parsed = parseMessage(raw);
          const record = {
            receivedAt: new Date().toISOString(),
            mailFrom,
            rcptTo: [...rcptTo],
            raw,
            subject: parsed.subject,
            from: parsed.from,
            to: parsed.to,
            body: parsed.body,
            text: parsed.text,
            html: parsed.html,
            headers: parsed.headers,
          };
          messages.push(record);
          console.log(`[mock-smtp] ✉  email diterima: "${parsed.subject}" → ${parsed.to.join(', ')}`);

          send('250 2.0.0 Ok: message queued');
          mailFrom = '';
          rcptTo = [];
        } else {
          // Baris yang diawali ".." adalah escape untuk titik di awal baris.
          dataBuffer += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        }
        return;
      }

      // Baris kosong di luar mode DATA = perintah kosong → abaikan.
      if (line === '') return;

      // PENTING: perintah = token PERTAMA saja. "EHLO localhost" harus
      // dicocokkan ke case 'EHLO', bukan ke "EHLO LOCALHOST".
      //
      // SEBELUMNYA: `switch (upper)` memakai SELURUH baris yang sudah
      // di-uppercase → tidak pernah cocok dengan case manapun → server
      // membalas "502 Command not implemented" untuk semua perintah.
      const [cmd, ...args] = line.trim().split(/\s+/);
      const command = (cmd || '').toUpperCase();
      const arg = args.join(' ');

      switch (command) {
        case 'EHLO':
          send('250-mock-smtp.local greets you');
          send('250-AUTH PLAIN LOGIN');
          send('250-SIZE 10485760');
          send('250 8BITMIME');
          break;

        case 'HELO':
          send('250 mock-smtp.local');
          break;

        case 'AUTH': {
          const mode = (args[0] || '').toUpperCase();

          if (mode === 'PLAIN') {
            // Format: AUTH PLAIN <base64>  (base64 = \0user\0pass)
            const payload = args[1];
            if (!payload) {
              send('334 ');
              break;
            }
            const decoded = decodeBase64(payload);
            const parts = decoded.split('\0');
            const user = parts[1] || '';
            const pass = parts[2] || '';
            // Credential harus COCOK bila server dikonfigurasi dengan
            // user/pass tertentu. Bila tidak, server menerima apa saja.
            const userOk = !expectedUser || user === expectedUser;
            const passOk = !expectedPass || pass === expectedPass;
            authenticated = userOk && passOk && !!user;
            console.log(`[mock-smtp] AUTH PLAIN user="${user}" pass="${pass ? '***' : '(kosong)'}" → ${authenticated ? 'OK' : 'DITOLAK'}`);
            send(authenticated ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid');
            break;
          }

          if (mode === 'LOGIN') {
            // Format: AUTH LOGIN → 334 VXNlcm5hbWU6 → 334 UGFzc3dvcmQ6
            // Balasan & credential berikutnya datang di baris BERIKUTNYA,
            // jadi penanda `authChallenge` dipakai untuk tahu konteks.
            authChallenge = 'user';
            send('334 VXNlcm5hbWU6');
            break;
          }

          send('504 5.5.4 Unrecognized authentication type');
          break;
        }

        case 'MAIL': {
          if (requireAuth && !authenticated) {
            send('530 5.7.0 Authentication required');
            break;
          }
          const m = arg.match(/FROM:\s*<([^>]*)>/i);
          mailFrom = m ? m[1] : '';
          send('250 2.1.0 Ok');
          break;
        }

        case 'RCPT': {
          if (requireAuth && !authenticated) {
            send('530 5.7.0 Authentication required');
            break;
          }
          const m = arg.match(/TO:\s*<([^>]*)>/i);
          rcptTo.push(m ? m[1] : '');
          send('250 2.1.5 Ok');
          break;
        }

        case 'DATA':
          if (requireAuth && !authenticated) {
            send('530 5.7.0 Authentication required');
            break;
          }
          inData = true;
          dataBuffer = '';
          send('354 End data with <CR><LF>.<CR><LF>');
          break;

        case 'RSET':
          mailFrom = '';
          rcptTo = [];
          send('250 2.0.0 Ok');
          break;

        case 'NOOP':
          send('250 2.0.0 Ok');
          break;

        case 'VRFY':
          send('252 2.5.2 Cannot VRFY user');
          break;

        case 'QUIT':
          send('221 2.0.0 Bye');
          socket.end();
          break;

        default:
          send('502 5.5.2 Command not implemented');
      }
    };

    socket.on('data', (chunk) => {
      lineBuffer += chunk;

      // Pisahkan buffer menjadi baris lengkap; sisakan sisa untuk chunk
      // berikutnya.
      let idx;
      while ((idx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, idx).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(idx + 1);

        // Tantangan AUTH LOGIN: baris berikut berisi credential, bukan
        // perintah SMTP biasa.
        if (authChallenge === 'user') {
          authChallenge = 'pass';
          const user = decodeBase64(line.trim());
          send('334 UGFzc3dvcmQ6');
          continue;
        }
        if (authChallenge === 'pass') {
          authChallenge = null;
          const pass = decodeBase64(line.trim());
          const userOk = !expectedUser || user === expectedUser;
          const passOk = !expectedPass || pass === expectedPass;
          authenticated = userOk && passOk && !!user;
          console.log(`[mock-smtp] AUTH LOGIN user="${user}" pass="${pass ? '***' : '(kosong)'}" → ${authenticated ? 'OK' : 'DITOLAK'}`);
          send(authenticated ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid');
          continue;
        }

        handleLine(line);
      }
    });

    socket.on('error', () => { /* koneksi diputus — biarkan */ });
    socket.on('close', () => { sockets.delete(socket); });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      console.log(`[mock-smtp] 📬 listening on ${host}:${actualPort} (auth wajib: ${requireAuth ? 'ya' : 'tidak'})`);

      resolve({
        port: actualPort,
        host,
        messages,
        reset() { messages.length = 0; },
        close() {
          return new Promise((done) => {
            for (const s of sockets) { try { s.destroy(); } catch { /* abaikan */ } }
            server.close(() => done());
          });
        },
      });
    });
  });
}

// ─── Mode CLI ────────────────────────────────────────────────────────────────
const isCli = process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;

if (isCli) {
  const args = process.argv.slice(2);
  const getArg = (name, fallback = '') => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  const hasArg = (name) => args.includes(`--${name}`);

  const port = parseInt(getArg('port', '2525'), 10);
  const outFile = getArg('out', '');

  // Opsi credential:
  //   --user <name>  --pass <secret>  → hanya credential itu yang diterima.
  //   --no-auth                       → auth dilewati sepenuhnya.
  //   (tanpa opsi)                     → auth wajib, tapi user/pass bebas.
  //
  // Default "user bebas" sengaja dipakai supaya mode CLI mudah dipakai
  // untuk mencoba email — TIDAK untuk menguji jalur auth gagal. Untuk itu
  // gunakan --user/--pass supaya credential yang salah benar-benar ditolak.
  const noAuth = hasArg('no-auth');
  const lockedUser = getArg('user', '');
  const lockedPass = getArg('pass', '');

  const mock = await startMockSmtpServer({
    port,
    requireAuth: !noAuth,
    user: lockedUser || null,
    pass: lockedPass || null,
  });

  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log('  │  MOCK SMTP SERVER AKTIF                                    │');
  console.log('  ├──────────────────────────────────────────────────────────────┤');
  console.log(`  │  Host : ${mock.host}`);
  console.log(`  │  Port : ${mock.port}`);
  console.log(`  │  Auth : ${noAuth ? 'dimatikan' : (lockedUser ? `wajib (user: ${lockedUser})` : 'wajib (user bebas)')}`);
  console.log('  │                                                              │');
  console.log('  │  Isi server/.env dengan:                                   │');
  console.log(`  │    SMTP_HOST=${mock.host}`);
  console.log(`  │    SMTP_PORT=${mock.port}`);
  console.log(`  │    SMTP_USER=${lockedUser || 'test@localhost'}`);
  console.log(`  │    SMTP_PASS=${lockedPass || 'test'}`);
  console.log(`  │    SMTP_FROM=${lockedUser || 'test'}@localhost`);
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Email yang masuk akan ditampilkan di sini. Ctrl+C untuk berhenti.');
  console.log('');

  // Tulis email yang masuk ke file bila --out diisi (berguna untuk dibaca user).
  if (outFile) {
    const abs = path.resolve(outFile);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const write = () => {
      fs.writeFileSync(abs, JSON.stringify(mock.messages, null, 2));
    };
    setInterval(write, 1000).unref();
    process.on('SIGINT', () => { write(); process.exit(0); });
    process.on('SIGTERM', () => { write(); process.exit(0); });
    console.log(`  📄 Email juga ditulis ke: ${abs}`);
    console.log('');
  }
}
