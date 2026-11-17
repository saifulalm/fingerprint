// WhatsApp service — dual mode:
//  1. WhatsApp Web: QR scan via whatsapp-web.js (dev / when browser available)
//  2. Gateway API: HTTP API (Fonnte, WaBlast, etc.) for production
import WWebJS from 'whatsapp-web.js';
const { Client, LocalAuth } = WWebJS;
import QRCode from 'qrcode';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || path.join(__dirname, '../../sessions/whatsapp');
const sessionsDir = path.isAbsolute(SESSION_DIR) ? SESSION_DIR : path.join(__dirname, '../..', SESSION_DIR);
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

// ─── WhatsApp Web (QR scan) ───────────────────────────────────────────────────
let wwClient = null;
let currentQR = null;

function getWWClient() {
  if (wwClient) return wwClient;

  const puppeteerOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (process.platform === 'win32' && process.env.CHROME_PATH) {
    puppeteerOptions.executablePath = process.env.CHROME_PATH;
  }

  try {
    wwClient = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
      puppeteer: puppeteerOptions,
    });
  } catch (e) {
    console.error('[WhatsApp] Client create error:', e.message);
    wwClient = null;
    return null;
  }

  wwClient.on('qr', async (qr) => {
    try {
      currentQR = await QRCode.toDataURL(qr);
      console.log('[WhatsApp] QR ready — scan now!');
    } catch (err) {
      console.error('[WhatsApp] QR encode error:', err.message);
    }
  });

  wwClient.on('ready', () => {
    currentQR = null;
    console.log('[WhatsApp] Web client ready');
  });

  wwClient.on('disconnected', (reason) => {
    console.log('[WhatsApp] Web disconnected:', reason);
    currentQR = null;
    wwClient = null;
  });

  wwClient.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Auth failure:', msg);
    currentQR = null;
  });

  return wwClient;
}

// ─── Gateway API (Fonnte, WaBlast, etc.) ────────────────────────────────────
async function sendViaGateway(to, text) {
  const gatewayUrl = process.env.WA_GATEWAY_URL;
  const gatewayKey = process.env.WA_GATEWAY_KEY;
  if (!gatewayUrl) throw new Error('WA_GATEWAY_URL not configured');

  const phone = String(to).replace(/\D/g, '');
  const formatted = phone.startsWith('0') ? '62' + phone.slice(1) : phone;

  const gatewayType = process.env.WA_GATEWAY_TYPE || '';

  const headers = {
    'Content-Type': 'application/json',
    ...(gatewayKey ? { 'Authorization': gatewayKey } : {}),
  };

  let payload;
  if (gatewayType === 'fonnte' || gatewayUrl.includes('fonnte') || gatewayUrl.includes('smsgateway')) {
    payload = { target: formatted, message: text };
  } else {
    payload = { phone: formatted, message: text, key: gatewayKey };
  }

  const resp = await axios.post(gatewayUrl, payload, { headers, timeout: 15000 });
  return resp.data;
}

// ─── Public service ───────────────────────────────────────────────────────────
export const whatsappService = {

  async connect() {
    const existing = getWWClient();
    if (!existing) {
      return { status: 'error', message: 'WhatsApp Web browser not available. Use WA_GATEWAY_URL for gateway mode.' };
    }
    if (existing.info) return { status: 'connected', message: 'WhatsApp Web already connected' };
    if (currentQR) return { status: 'connecting', message: 'QR available', qr: currentQR };
    existing.initialize().catch(err => console.error('[WhatsApp] Init error:', err.message));
    return { status: 'connecting', message: 'Connection starting — get QR from /api/whatsapp/status' };
  },

  async disconnect() {
    if (wwClient) {
      try { await wwClient.logout(); } catch (_) { wwClient.destroy(); }
      wwClient = null;
      currentQR = null;
    }
    return { status: 'disconnected' };
  },

  getStatus() {
    if (!wwClient) return 'disconnected';
    if (wwClient.info) return 'connected';
    if (currentQR) return 'connecting';
    return 'disconnected';
  },

  getQR() { return currentQR; },

  async sendMessage(to, text) {
    // Try gateway if configured
    if (process.env.WA_GATEWAY_URL) {
      try {
        const result = await sendViaGateway(to, text);
        return { via: 'gateway', result, to, textLength: text.length };
      } catch (gwErr) {
        console.warn('[WhatsApp] Gateway failed, trying Web:', gwErr.message);
        if (wwClient?.info) {
          const formatted = String(to).replace(/\D/g, '');
          const chatId = formatted.includes('@c.us') ? formatted : `${formatted}@c.us`;
          const msg = await wwClient.sendMessage(chatId, text);
          return { via: 'web', result: msg, to, textLength: text.length };
        }
        throw gwErr;
      }
    }

    if (!wwClient?.info) {
      throw new Error('WhatsApp not connected. Scan QR via /api/whatsapp/connect, or set WA_GATEWAY_URL');
    }
    const formatted = String(to).replace(/\D/g, '');
    const chatId = formatted.includes('@c.us') ? formatted : `${formatted}@c.us`;
    const msg = await wwClient.sendMessage(chatId, text);
    return { via: 'web', result: msg, to, textLength: text.length };
  },

  isGatewayConfigured() { return !!(process.env.WA_GATEWAY_URL); },
};
