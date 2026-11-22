// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp service — DUA mode:
//
//   1. Baileys direct (default) — QR pairing langsung dari aplikasi ini.
//      Cocok untuk pairing satu perangkat tanpa Docker/OpenWA.
//   2. OpenWA Gateway (opsional) — dipakai bila WA_GATEWAY_URL di-set di .env.
//
// PERBAIKAN PENTING (bug "pairing WhatsApp tidak bisa dilakukan"):
//   1. Baileys v7 membutuhkan logger bertipe PINO (punya method `.child()`).
//      Kode lama mengoper `{ level: 'warn' }` → crash dengan
//      "TypeError: logger.child is not a function" saat membuat socket,
//      sehingga TIDAK PERNAH ada QR yang muncul. Diperbaiki dengan memakai
//      DefaultLogger bawaan Baileys (node_modules/baileys/lib/Utils/logger.js).
//   2. Event QR diambil dari `connection.update` (field `qr`), lalu di-encode
//      menjadi data-URL PNG memakai paket `qrcode` yang sudah terpasang.
//   3. `connect()` sekarang benar-benar membuat sesi BARU (bukan hanya restore
//      sesi lama), sehingga QR bisa dipindai.
//
// CATATAN PATH SESI:
//   Folder `sessions/whatsapp/session/` milik whatsapp-web.js DAN folder
//   `sessions/baileys/` milik service ini DIPISAH, supaya keduanya tidak
//   saling menimpa. Pairing yang berhasil disimpan di `sessions/baileys/`.
// ─────────────────────────────────────────────────────────────────────────────

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'baileys';
import DefaultLogger from 'baileys/lib/Utils/logger.js';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveGatewayUrl } from './settingsService.js';
import { maskSensitiveUrl } from '../utils/urlGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');

// Folder sesi Baileys — TERPISAH dari folder sesi whatsapp-web.js.
const SESSION_DIR = process.env.WHATSAPP_BAILEYS_SESSION_DIR
  ? path.isAbsolute(process.env.WHATSAPP_BAILEYS_SESSION_DIR)
    ? process.env.WHATSAPP_BAILEYS_SESSION_DIR
    : path.join(SERVER_ROOT, process.env.WHATSAPP_BAILEYS_SESSION_DIR)
  : path.join(SERVER_ROOT, 'sessions/baileys');

// ─── Configuration ────────────────────────────────────────────────────────────
//
// URL gateway TIDAK lagi dibaca hanya dari env. Sumber kebenaran adalah
// helper `resolveGatewayUrl()` di settingsService — ia mengambil setting
// `wa_gateway_url` (diisi lewat UI Pengaturan) lebih dulu, lalu env
// sebagai fallback.
//
// SEBELUMNYA: `const WA_GATEWAY_URL = process.env.WA_GATEWAY_URL` — dibaca
// SEKALI saat modul di-load. Akibatnya:
//   1. URL yang disimpan lewat UI Pengaturan TIDAK PERNAH dipakai —
//      field form itu mati (user isi, klik Simpan, "sukses", nol efek).
//   2. Nilai dari env tidak bisa berubah tanpa restart server.
//
// Karena URL kini bisa berubah saat runtime, semua pembacaan WA_GATEWAY_URL
// diganti dengan `getGatewayUrl()` yang async dan membaca nilai terbaru.
const WA_GATEWAY_API_KEY = process.env.WA_GATEWAY_API_KEY || null;
const WA_GATEWAY_SESSION = process.env.WA_GATEWAY_SESSION || 'default';

// Nama sesi OpenWA dibersihkan SEKALI di sini, lalu dipakai PADA.lookup
// maupun saat create.
//
// PENTING: bila lookup memakai nama mentah sedangkan create memakai nama
// yang sudah disanitasi,polling 5 detik akan gagal menemukan sesi yang
// baru dibuat dan membuat sesi DUPLIKAT setiap kali. Karena itu keduanya
// WAJIB memakai variabel yang sama.
const GATEWAY_SESSION_NAME = (WA_GATEWAY_SESSION.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50) || 'bioclock');

// Batas waktu tiap panggilan ke gateway. Halaman WhatsApp mem-polling status
// tiap 5 detik, jadi gateway yang tidak merespons harus gagal CEPAT — bukan
// menggantung sampai connection timeout bawaan Node ( jauh lebih lama).
const GATEWAY_TIMEOUT_MS = parseInt(process.env.WA_GATEWAY_TIMEOUT_MS || '8000', 10);

// Logger Baileys: WAJIB tipe pino karena Baileys memanggil `logger.child()`
// di beberapa modul internal (noise-handler, event-buffer, signal repository).
const baileysLogger = DefaultLogger.child({ class: 'bioclock-wa' }, { level: 'warn' });

// ─── State ────────────────────────────────────────────────────────────────────
let sock = null;
let connectionState = 'disconnected';
let gatewayMode = false;
let gatewaySessionId = null;  // UUID sesi OpenWA (path API memakai UUID, bukan nama)
let gatewaySessionPromise = null; // mutex pembuatan sesi (hindari sesi ganda)
let currentQR = null;      // string QR mentah dari Baileys
let currentQRImage = null; // data-URL PNG siap tampil di UI
let qrExpiresAt = 0;       // timestamp kedaluwarsa QR
let reconnectTimer = null;
let isShuttingDown = false;

// ─── OpenWA Gateway Helpers ──────────────────────────────────────────────────
//
// Kontrak mengikuti spesifikasi resmi OpenWA (docs/06-api-specification.md):
//   - Semua route di-mount di bawah prefix global `/api`.
//   - Autentikasi lewat header `X-API-Key` (API key TIDAK boleh di URL).
//   - Respons TANPA envelope: resource route mengembalikan objek apa adanya,
//     list route mengembalikan array JSON polos.
//   - `status` sesi memakai nilai lowercase:
//     created | initializing | qr_ready | authenticating | ready |
//     disconnected | action_required | failed
//   - `chatId` WAJIB bentuk `localpart@host` (mis. `6281234567890@c.us`).
//     Nomor polos akan dijawab 400 "chatId must be a valid chat JID".
//   - `GET /api/sessions/:sessionId/qr` mengembalikan `{ qrCode, status }`
//     dengan `qrCode` berupa PNG data-URL.
//
// PENTING: path session memakai **UUID** sesi, bukan nama sesi. Nama hanya
// dipakai saat membuat sesi dan saat mencari UUID-nya lewat
// `GET /api/sessions?name=<nama>` (mengembalikan array polos).
const GATEWAY_STATUS_MAP = {
  ready: 'connected',
  qr_ready: 'connecting',
  initializing: 'connecting',
  created: 'connecting',
  authenticating: 'connecting',
  disconnected: 'disconnected',
  failed: 'error',
  action_required: 'error',
};

/** Error dari gateway yang membawa HTTP status untuk pengambilan keputusan. */
class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

/**
 * Cache URL gateway singkat.
 *
 * Halaman WhatsApp mem-poll status tiap 5 detik; membaca DB tiap poll
 * menambah beban kecil tapi tidak perlu. Cache 2 detik cukup agar
 * perubahan dari UI Pengaturan terasa hampir seketika, sementara polling
 * tetap ringan.
 *
 * Nilai disimpan di variabel modul (bukan hanya di cache) supaya
 * `isGatewayConfigured()` tetap bisa bersifat SINKRON — method itu
 * dipanggil dari banyak tempat, termasuk `whatsappController` yang
 * tidak bisa menunggu Promise.
 */
let gatewayUrlCache = { value: null, at: 0 };
const GATEWAY_URL_CACHE_MS = 2000;

// Nilai gateway yang terakhir diketahui (sinkron, selalu siap dibaca).
let currentGatewayUrl = '';

/**
 * Ambil URL gateway WhatsApp yang efektif (settings > env).
 * Menghapus trailing slash agar path relatif bisa dirangkai dengan aman.
 * @returns {Promise<string>} '' bila gateway tidak dikonfigurasi
 */
async function getGatewayUrl() {
  const now = Date.now();
  if (gatewayUrlCache.value !== null && (now - gatewayUrlCache.at) < GATEWAY_URL_CACHE_MS) {
    return gatewayUrlCache.value;
  }
  const url = await resolveGatewayUrl();
  gatewayUrlCache = { value: url, at: now };
  currentGatewayUrl = url;
  return url;
}

/**
 * Segarkan nilai gateway dari DB. Dipanggil oleh scheduler refresh
 * berkala dan setelah Pengaturan disimpan.
 * @returns {Promise<string>} URL gateway terbaru
 */
export async function refreshGatewayUrl() {
  gatewayUrlCache = { value: null, at: 0 };
  return getGatewayUrl();
}

/** Kosongkan cache URL gateway — dipanggil setelah Pengaturan disimpan. */
export function invalidateGatewayUrlCache() {
  gatewayUrlCache = { value: null, at: 0 };
}

/**
 * Panggil endpoint gateway.
 * @param {string} method  HTTP method
 * @param {string} endpoint Path relatif terhadap base URL gateway (tanpa prefix `/api`).
 * @param {object|null} body Payload JSON (opsional).
 * @returns {Promise<any>} Body respons (bisa array).
 */
async function gatewayRequest(method, endpoint, body = null) {
  const base = await getGatewayUrl();
  if (!base) throw new GatewayError('OpenWA gateway not configured', 0);

  const url = base + endpoint;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  // API key hanya lewat header — jangan pernah ditaruh di URL (bocor ke access log).
  if (WA_GATEWAY_API_KEY) {
    headers['X-API-Key'] = WA_GATEWAY_API_KEY;
  }

  const options = {
    method,
    headers,
    // Timeout WAJIB: halaman WhatsApp mem-polling status tiap 5 detik. Tanpa
    // batas waktu, gateway yang mati/tidak terjangkau membuat fetch menggantung
    // dan seluruh polling ikut tersendat.
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  };
  if (body !== null && body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // Jaringan gagal (gateway mati / tidak terjangkau / timeout) — bedakan
    // dari error HTTP. AbortError = timeout.
    const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    // URL gateway DISAMAR di pesan error. URL asli bisa mengandung token
    // API sebagai query param (mis. `?token=RAHASIA`) — pesan error ini
    // sampai ke browser dan ke log server, jadi tidak boleh memuat
    // kredensial apa adanya.
    const safeUrl = maskSensitiveUrl(url);
    throw new GatewayError(
      timedOut
        ? `OpenWA gateway tidak merespons dalam ${GATEWAY_TIMEOUT_MS / 1000} detik (${safeUrl})`
        : `Tidak dapat menghubungi OpenWA gateway (${safeUrl}): ${err.message}`,
      0,
    );
  }

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || ('Gateway error: ' + res.status);
    throw new GatewayError(scrubGatewayUrl(msg, url), res.status);
  }

  return data;
}

/**
 * Buang URL gateway apa adanya dari sebuah pesan.
 *
 * Gateway boleh memantulkan URL yang dipanggilnya di dalam pesan error
 * (mis. "failed to POST https://host/api?token=RAHASIA"). Pesan itu
 * diteruskan ke browser dan ditulis ke log server, jadi URL mentah harus
 * diganti versi tersamar.
 *
 * @param {string} message
 * @param {string} rawUrl URL gateway yang sedang dipanggil
 * @returns {string}
 */
function scrubGatewayUrl(message, rawUrl) {
  const msg = String(message || '');
  const raw = String(rawUrl || '');
  if (!raw) return msg;
  const safe = maskSensitiveUrl(raw);
  // Ganti semua kemunculan URL mentah (dan varian tanpa trailing slash).
  return msg.split(raw).join(safe).split(raw.replace(/\/$/, '')).join(safe);
}

/**
 * Cari UUID sesi berdasarkan nama sesi.
 * `GET /api/sessions?name=<nama>` mengembalikan ARRAY POLOS (bukan envelope).
 * @returns {Promise<string|null>} UUID sesi, atau null bila belum ada.
 */
async function findGatewaySessionId() {
  const list = await gatewayRequest('GET', '/api/sessions?name=' + encodeURIComponent(GATEWAY_SESSION_NAME));
  const arr = Array.isArray(list) ? list : (list?.sessions || []);
  const found = arr.find((s) => s && (s.name === GATEWAY_SESSION_NAME || s.id === WA_GATEWAY_SESSION));
  return found?.id || null;
}

/**
 * Pastikan sesi gateway ada dan mengembalikan UUID-nya.
 * Bila belum ada, sesi dibuat lewat `POST /api/sessions { name }`.
 */
async function ensureGatewaySession() {
  if (gatewaySessionId) return gatewaySessionId;

  // Mutex sederhana: pemanggilan paralel (polling 5 detik + klik tombol)
  // menunggu hasil yang sama, bukan membuat dua sesi sekaligus.
  if (gatewaySessionPromise) return gatewaySessionPromise;

  gatewaySessionPromise = (async () => {
    const existing = await findGatewaySessionId();
    if (existing) {
      gatewaySessionId = existing;
      return existing;
    }

    // Nama sesi punya aturan: 3-50 karakter, hanya huruf/angka/hyphen.
    const created = await gatewayRequest('POST', '/api/sessions', { name: GATEWAY_SESSION_NAME });
    const id = created?.id;
    if (!id) throw new GatewayError('Gateway tidak mengembalikan id sesi', 502);
    gatewaySessionId = id;
    console.log('[WhatsApp] Sesi OpenWA dibuat:', id, '(nama:', GATEWAY_SESSION_NAME + ')');
    return id;
  })();

  try {
    return await gatewaySessionPromise;
  } finally {
    gatewaySessionPromise = null;
  }
}

// ─── Nomor telepon → JID WhatsApp ────────────────────────────────────────────
//
// MASALAH YANG DISELESAIKAN:
//   Jalur gateway (OpenWA) sebelumnya hanya menghapus karakter non-digit dan
//   menempelkan '@s.whatsapp.net'. Jadi nomor Indonesia "08123456789"
//   menjadi "08123456789@s.whatsapp.net" — leading nol TIDAK dihapus.
//   Nomor itu tidak ada di WhatsApp, sehingga pesan gagal terkirim tanpa
//   error yang jelas. Jalur Baileys sudah benar (0 → 62), tapi gateway tidak.
//
//   SEKARANG: satu helper dipakai kedua jalur, dengan aturan:
//     - "628123456789"  → "628123456789@s.whatsapp.net"
//     - "08123456789"    → "628123456789@s.whatsapp.net"  (leading 0 → 62)
//     - "+62 812-3456"  → "628123456789@s.whatsapp.net"
//     - "628123@c.us"    → "628123@c.us"  (grup, format OpenWA)
//
export function toWhatsAppJid(to) {
  const raw = String(to || '').trim();

  // Sudah berupa JID (grup @c.us atau kontak @s.whatsapp.net) → pakai apa adanya.
  if (raw.includes('@')) return raw;

  // Buang semua non-digit (spasi, tanda hubung, kurung, "+").
  let phone = raw.replace(/\D/g, '');
  if (!phone) throw new Error('Nomor WhatsApp tidak valid');

  // Nomor Indonesia: format lokal "08xx" → format internasional "62xx".
  if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
  }

  return phone + '@s.whatsapp.net';
}

// ─── Session directory helpers ───────────────────────────────────────────────
function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/** Apakah ada kredensial sesi Baileys tersimpan */
function sessionExists() {
  try {
    return fs.existsSync(path.join(SESSION_DIR, 'creds.json'));
  } catch {
    return false;
  }
}

/**
 * Hapus seluruh data sesi Baileys (dipakai saat "Mulai Ulang Pairing").
 * Folder `sessions/whatsapp/` milik whatsapp-web.js TIDAK ikut terhapus.
 */
function clearSession() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
    ensureSessionDir();
    return true;
  } catch (err) {
    console.error('[WhatsApp] Gagal menghapus sesi:', err.message);
    return false;
  }
}

// ─── Create Baileys socket ────────────────────────────────────────────────────
async function createSock({ fresh = false } = {}) {
  ensureSessionDir();

  if (fresh) {
    // Mulai dari nol: hapus kredensial lama supaya QR baru dibuat
    try {
      const creds = path.join(SESSION_DIR, 'creds.json');
      if (fs.existsSync(creds)) fs.rmSync(creds, { force: true });
    } catch (err) {
      console.error('[WhatsApp] Gagal mereset kredensial:', err.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  sock = makeWASocket({
    auth: state,
    // Baileys v7 sudah DEPRECATED printQRInTerminal — QR diambil dari event
    logger: baileysLogger,
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 60000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    // QR baru siap untuk dipindai
    if (qr) {
      currentQR = qr;
      qrExpiresAt = Date.now() + 60000;
      try {
        currentQRImage = await QRCode.toDataURL(qr);
        console.log('[WhatsApp] QR siap dipindai (kadaluarsa 60 detik)');
      } catch (err) {
        console.error('[WhatsApp] Gagal encode QR:', err.message);
      }
    }

    if (connection === 'open') {
      connectionState = 'connected';
      currentQR = null;
      currentQRImage = null;
      qrExpiresAt = 0;
      console.log('[WhatsApp] Baileys terhubung');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : null;

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[WhatsApp] Baileys logout — sesi dihapus, perlu pairing ulang');
        sock = null;
        connectionState = 'disconnected';
        currentQR = null;
        currentQRImage = null;
        // Hapus sesi supaya QR baru bisa dibuat tanpa restart server
        try {
          const creds = path.join(SESSION_DIR, 'creds.json');
          if (fs.existsSync(creds)) fs.rmSync(creds, { force: true });
        } catch { /* abaikan */ }
      } else if (!isShuttingDown) {
        console.log('[WhatsApp] Koneksi terputus — mencoba sambung ulang...');
        connectionState = 'connecting';
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          createSock().catch(err => {
            console.error('[WhatsApp] Gagal sambung ulang:', err.message);
            connectionState = 'disconnected';
          });
        }, 3000);
      }
    }
  });

  return sock;
}

// ─── Public API ─────────────────────────────────────────────────────────────
export const whatsappService = {
  /** Get connection mode info */
  getMode() {
    return gatewayMode ? 'gateway' : 'baileys';
  },

  /** Check if gateway is configured */
  isGatewayConfigured() {
    // Sinkron: membaca nilai terakhir yang diketahui. Nilai di-refresh
    // lewat `refreshGatewayUrl()` (dipanggil dari polling status) dan
    // setiap kali Pengaturan disimpan.
    return !!currentGatewayUrl;
  },

  /** Refresh nilai gateway dari DB (async). */
  async refreshGatewayUrl() {
    return refreshGatewayUrl();
  },

  /** Check if Baileys session exists */
  hasBaileysSession() {
    return sessionExists();
  },

  /**
   * Connect: coba gateway dulu (kalau dikonfigurasi), lalu Baileys.
   * @param {boolean} fresh  true → hapus sesi lama & buat QR baru
   */
  async connect(fresh = false) {
    // Segarkan URL gateway dari Pengaturan (UI) — nilai bisa berubah saat
    // runtime, jadi tidak boleh relying pada cache modul saja.
    await refreshGatewayUrl();

    // Sudah terhubung via gateway
    if (gatewayMode && connectionState === 'connected') {
      return { status: 'connected', message: 'Sudah terhubung via OpenWA Gateway' };
    }

    // Sudah terhubung via Baileys
    if (!gatewayMode && connectionState === 'connected') {
      return { status: 'connected', message: 'WhatsApp sudah terhubung', mode: 'baileys' };
    }

    // Try OpenWA gateway first
    if (this.isGatewayConfigured()) {
      try {
        gatewayMode = true;

        // Pastikan sesi ada di gateway lalu jalankan (start) supaya engine
        // terinisialisasi dan QR dihasilkan.
        const id = await ensureGatewaySession();
        try {
          await gatewayRequest('POST', '/api/sessions/' + id + '/start');
        } catch (e) {
          // 400 "already started" / 409 "running on another node" — abaikan.
          console.warn('[WhatsApp] Start sesi OpenWA:', e.message);
        }

        const status = await this.getGatewayStatus();
        if (status.connected) {
          connectionState = 'connected';
          return {
            status: 'connected',
            message: 'Terhubung via OpenWA Gateway',
            mode: 'gateway',
            device: status.device
          };
        }

        // Belum siap — coba ambil QR supaya user bisa memindai.
        const qrImage = await this.getGatewayQR();

        return {
          status: qrImage ? 'connecting' : 'gateway_ready',
          message: qrImage
            ? 'QR siap dipindai. Scan dengan WhatsApp di ponsel.'
            : 'OpenWA Gateway dikonfigurasi. Sesi sedang disiapkan.',
          mode: 'gateway',
          gatewayUrl: maskSensitiveUrl(currentGatewayUrl),
          sessionId: id,
          qr: qrImage,
          expiresIn: qrImage ? 60 : 0,
        };
      } catch (err) {
        console.warn('[WhatsApp] Cek gateway gagal:', err.message);
        gatewayMode = false;
      }
    }

    // ─── Baileys direct ──────────────────────────────────────────────────────
    connectionState = 'connecting';

    // Putuskan socket lama (bila ada) sebelum membuat yang baru
    if (sock) {
      try {
        sock.ev.removeAllListeners('connection.update');
        await sock.logout().catch(() => {});
      } catch { /* abaikan */ }
      sock = null;
    }

    try {
      await createSock({ fresh });
    } catch (err) {
      console.error('[WhatsApp] Gagal membuat socket:', err.message);
      connectionState = 'disconnected';
      return {
        status: 'error',
        message: 'Gagal membuat koneksi WhatsApp: ' + err.message,
        mode: 'baileys'
      };
    }

    // Tunggu QR muncul (maks 20 detik)
    const qr = await this.waitForQR(20000);

    if (qr) {
      return {
        status: 'connecting',
        message: 'QR siap dipindai. Scan dengan WhatsApp di ponsel.',
        mode: 'baileys',
        qr: currentQRImage,
        expiresIn: Math.max(0, Math.round((qrExpiresAt - Date.now()) / 1000))
      };
    }

    // Tidak ada QR → mungkin sudah terkoneksi (sesi lama dipulihkan)
    if (connectionState === 'connected') {
      return { status: 'connected', message: 'Sesi WhatsApp dipulihkan', mode: 'baileys' };
    }

    return {
      status: 'connecting',
      message: 'Menyiapkan QR… klik Refresh QR bila belum muncul.',
      mode: 'baileys'
    };
  },

  /**
   * Tunggu QR dibuat oleh Baileys.
   * @returns {Promise<string|null>} string QR mentah
   */
  async waitForQR(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (currentQR) return currentQR;
      if (connectionState === 'connected') return null;
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  },

  /** Get OpenWA gateway status */
  async getGatewayStatus() {
    // Segarkan URL gateway — konfigurasi dari Pengaturan bisa berubah.
    await refreshGatewayUrl();
    if (!this.isGatewayConfigured()) {
      throw new GatewayError('Gateway not configured', 0);
    }
    try {
      const id = await ensureGatewaySession();
      const session = await gatewayRequest('GET', '/api/sessions/' + id);

      // Status wire OpenWA memakai nilai lowercase; petakan ke status UI app.
      const rawState = session?.status || 'unknown';
      const mapped = GATEWAY_STATUS_MAP[rawState] || 'connecting';

      return {
        connected: rawState === 'ready',
        state: mapped,
        rawState,
        sessionId: id,
        // URL gateway ikut dikembalikan agar frontend bisa menampilkannya
        // (sebelumnya field ini tidak pernah diisi sehingga UI tidak pernah
        //  menampilkan blok "OpenWA Gateway").
        // URL DISAMAR — bisa mengandung token API sebagai query param.
        gateway: maskSensitiveUrl(currentGatewayUrl),
        device: session?.phone
          ? { name: session.pushName || session.phone, phone: session.phone }
          : null,
        lastError: session?.lastError || null,
      };
    } catch (err) {
      return {
        connected: false,
        state: 'error',
        rawState: 'error',
        gateway: maskSensitiveUrl(currentGatewayUrl),
        error: err.message
      };
    }
  },

  /** Get QR code from OpenWA gateway */
  async getGatewayQR() {
    if (!this.isGatewayConfigured()) return null;
    try {
      const id = await ensureGatewaySession();

      // Bila sesi belum running, start dulu supaya engine terinisialisasi
      // dan QR muncul. Sesi yang sudah running akan dijawab 400 — diabaikan.
      const status = await gatewayRequest('GET', '/api/sessions/' + id);
      if (!status?.engineLoaded && status?.status !== 'qr_ready') {
        try {
          await gatewayRequest('POST', '/api/sessions/' + id + '/start');
        } catch (e) {
          // 400 "already started" / 409 "session running on another node" — abaikan.
          console.warn('[WhatsApp] Start sesi OpenWA:', e.message);
        }
      }

      // Field QR bernama `qrCode` (PNG data-URL), BUKAN `qr`.
      const qr = await gatewayRequest('GET', '/api/sessions/' + id + '/qr');
      return qr?.qrCode || qr?.qr || null;
    } catch (err) {
      // 400 = QR belum siap / sesi belum start; 404 = sesi tidak ada.
      console.error('[WhatsApp] Gateway QR error:', err.message);
      return null;
    }
  },

  async disconnect() {
    isShuttingDown = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    gatewayMode = false;
    if (sock) {
      try {
        sock.ev.removeAllListeners('connection.update');
        await sock.logout();
      } catch (_) { /* abaikan */ }
      sock = null;
    }
    connectionState = 'disconnected';
    currentQR = null;
    currentQRImage = null;
    isShuttingDown = false;
    return { status: 'disconnected' };
  },

  /** Hapus sesi tersimpan dan mulai pairing baru dari nol */
  async resetSession() {
    await this.disconnect();
    clearSession();
    console.log('[WhatsApp] Sesi dihapus — QR baru bisa dibuat');
    return { status: 'disconnected', message: 'Sesi dihapus. Klik "Mulai Pairing" untuk QR baru.' };
  },

  getStatus() {
    return connectionState;
  },

  /**
   * Ambil QR (data-URL PNG).
   * Mengembalikan objek: { status, qr, expiresIn }
   */
  async getQR() {
    // Segarkan URL gateway — konfigurasi dari Pengaturan bisa berubah.
    await refreshGatewayUrl();

    // Gateway mode
    //
    // Gateway dicek bila gateway DIKONFIGURASI, bukan hanya bila state
    // lokal `gatewayMode` sudah true. State lokal hanya berubah setelah
    // connect() dipanggil — sehingga setelah restart server, QR dari
    // gateway tidak akan pernah diambil.
    if (this.isGatewayConfigured()) {
      const raw = await this.getGatewayQR();
      if (raw) {
        // Gateway bisa mengembalikan string QR mentah → encode jadi PNG
        try {
          const image = raw.startsWith('data:') ? raw : await QRCode.toDataURL(raw);
          return { status: 'ready', qr: image, expiresIn: 60 };
        } catch {
          return { status: 'ready', qr: raw, expiresIn: 60 };
        }
      }
      const status = await this.getGatewayStatus();
      if (status.connected) {
        return { status: 'connected', qr: null, expiresIn: 0 };
      }
      return { status: 'connecting', qr: null, expiresIn: 0 };
    }

    // Baileys mode
    if (currentQRImage) {
      return {
        status: 'ready',
        qr: currentQRImage,
        expiresIn: Math.max(0, Math.round((qrExpiresAt - Date.now()) / 1000))
      };
    }
    if (connectionState === 'connected') {
      return { status: 'connected', qr: null, expiresIn: 0 };
    }
    return { status: 'connecting', qr: null, expiresIn: 0 };
  },

  async sendMessage(to, text) {
    // Segarkan URL gateway dari Pengaturan (UI).
    await refreshGatewayUrl();

    // Validasi nomor dilakukan DI LUAR blok gateway.
    //
    // SEBELUMNYA toWhatsAppJid() dipanggil di dalam try/catch gateway. Kalau
    // nomornya tidak valid, error-nya tertangkap fallback dan hilang — user
    // melihat "WhatsApp belum terhubung" padahal masalahnya input-nya.
    // Memvalidasi di sini membuat pesan error yang jujur sampai ke user.
    const chatId = toWhatsAppJid(to);

    // Try gateway first
    if (this.isGatewayConfigured()) {
      try {
        const id = await ensureGatewaySession();
        const result = await gatewayRequest('POST', '/api/sessions/' + id + '/messages/send-text', {
          chatId: chatId,
          text: text
        });
        return result;
      } catch (err) {
        console.error('[WhatsApp] Gateway send error:', err.message);
        // Fall through to Baileys
      }
    }

    // Baileys direct
    if (!sock || connectionState !== 'connected') {
      throw new Error('WhatsApp belum terhubung. Scan QR di halaman WhatsApp terlebih dahulu.');
    }
    try {
      const msg = await sock.sendMessage(chatId, { text });
      return msg;
    } catch (err) {
      console.error('[WhatsApp] Baileys send error:', err.message);
      throw err;
    }
  },

  /**
   * Kirim dokumen (PDF laporan) ke satu penerima.
   *
   * Mendukung dua jalur:
   *   1. OpenWA gateway — `POST /api/sessions/:id/messages/send-document`
   *      dengan `base64` (dokumen dikirim langsung, tanpa perlu URL publik).
   *   2. Baileys langsung — `sock.sendMessage(chatId, { document: buffer })`
   *      dengan Buffer (bukan `{ url }` — `url` dibaca Baileys sebagai PATH FILE).
   *
   * @param {string} to nomor WhatsApp
   * @param {Buffer} buffer isi file
   * @param {string} filename nama file yang dilihat penerima
   * @param {string} mimetype tipe MIME (default application/pdf)
   * @param {string} [caption] keterangan singkat (opsional)
   * @returns {Promise<object>} hasil pengiriman
   */
  async sendDocument(to, buffer, filename, mimetype = 'application/pdf', caption = '') {
    if (!buffer || !buffer.length) {
      throw new Error('Isi dokumen kosong — tidak ada yang bisa dikirim.');
    }
    if (!filename) throw new Error('Nama file dokumen wajib diisi.');

    await refreshGatewayUrl();

    const chatId = toWhatsAppJid(to);

    // ── 1. OpenWA gateway ────────────────────────────────────────────────────
    //
    // Endpoint `send-document` menerima `base64` — jadi PDF bisa dikirim
    // tanpa harus diekspos lewat URL publik. Field `base64` diprioritaskan
    // over `url` bila keduanya ada (perilaku gateway).
    if (this.isGatewayConfigured()) {
      try {
        const id = await ensureGatewaySession();
        const payload = {
          chatId,
          base64: Buffer.from(buffer).toString('base64'),
          mimetype,
          filename,
        };
        if (caption) payload.caption = caption;

        const result = await gatewayRequest(
          'POST', '/api/sessions/' + id + '/messages/send-document', payload,
        );
        return result;
      } catch (err) {
        console.error('[WhatsApp] Gateway send-document error:', err.message);
        // Fall through ke Baileys
      }
    }

    // ── 2. Baileys langsung ──────────────────────────────────────────────────
    if (!sock || connectionState !== 'connected') {
      throw new Error(
        'WhatsApp belum terhubung dan gateway tidak dikonfigurasi. ' +
        'Scan QR di halaman WhatsApp atau set URL gateway di tab Pengaturan.',
      );
    }
    try {
      // Bentuk media WAJIB: `document` diisi Buffer LANGSUNG.
      //
      // SEBELUMNYA: `document: { url: buffer }` — SALAH. Baileys
      // memperlakukan `url` sebagai sumber BERKAS: string `data:` di-decode
      // base64, `http(s)://` di-stream, dan SELAIN itu dibaca sebagai PATH
      // FILE di disk. Buffer yang dipaksakan jadi string lewat `.toString()`
      // → path berisi isi PDF → `ENOENT: no such file or directory`.
      //
      // Bukti (diuji terhadap baileys 7.0.0-rc14 yang terpasang):
      //   getRawMediaUploadData({ url: buffer }) → ENOENT (path = isi PDF)
      //   getRawMediaUploadData(buffer)        → OK, fileLength = ukuran PDF
      //
      // Buffer langsung adalah bentuk yang didukung `WAMediaUpload`
      // (Buffer | WAMediaPayloadStream | WAMediaPayloadURL).
      const msg = await sock.sendMessage(chatId, {
        document: buffer,
        fileName: filename,
        mimetype,
        ...(caption ? { caption } : {}),
      });
      return msg;
    } catch (err) {
      console.error('[WhatsApp] Baileys send-document error:', err.message);
      throw err;
    }
  },

  getDeviceInfo() {
    // Bila gateway dikonfigurasi dan sesi gateway sudah ada, tampilkan info
    // gateway — bahkan kalau `connect()` belum pernah dipanggil di proses ini
    // (setelah restart server, atau pairing lewat dashboard OpenWA).
    if (this.isGatewayConfigured() && (gatewayMode || gatewaySessionId)) {
      return {
        mode: 'gateway',
        gateway: maskSensitiveUrl(currentGatewayUrl),
        session: WA_GATEWAY_SESSION,
        sessionId: gatewaySessionId,
      };
    }
    if (!sock || connectionState !== 'connected') return null;
    return {
      mode: 'baileys',
      name: sock.user?.name || sock.user?.pushName || null,
      platform: sock.authState?.creds?.deviceName || 'Unknown',
      wid: sock.user?.id || null,
    };
  },

  isConnected() {
    return connectionState === 'connected';
  },

  /** Check if ready to send (gateway or Baileys connected) */
  isReady() {
    return connectionState === 'connected' || (this.isGatewayConfigured() && connectionState !== 'disconnected');
  },
};

// ─── Helper untuk modul lain (webhook service) ───────────────────────────────
//
// Alasan diekspor: manajemen webhook OpenWA (register/list/test/delete)
// memakai route yang DI-SCOPE per sesi dan butuh UUID sesi + pemanggilan
// API gateway. Menyalin logika `gatewayRequest` ke modul lain pasti
// menyimpang — header auth dan timeout harus sama persis.
//
// CATATAN: yang diekspor adalah FUNGSI BUKAN state internal. `ensureGatewaySession()`
// mengembalikan UUID sesi yang sama setiap kali (memoized), jadi pemanggil
// tidak perlu tahu detail caching-nya.
//
// `gatewayUrl` TIDAK lagi diekspor sebagai konstanta — nilainya bisa berubah
// saat runtime (diisi lewat UI Pengaturan). Konsumen memakai
// `resolveGatewayUrl()` atau `getGatewayUrl()` yang async.
export {
  gatewayRequest,
  findGatewaySessionId,
  ensureGatewaySession,
  GATEWAY_SESSION_NAME as gatewaySessionName,
  getGatewayUrl,
};
