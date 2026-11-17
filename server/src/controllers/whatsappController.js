import { whatsappService } from '../services/whatsapp.js';

export async function connectWhatsApp(req, res) {
  try {
    // `fresh: true` dipakai tombol "Mulai Ulang Pairing" → sesi lama dihapus
    // sehingga Baileys membuat QR baru (bukan restore sesi yang sudah ada).
    const fresh = req.body?.fresh === true || req.query?.fresh === 'true';
    // Segarkan URL gateway supaya konfigurasi dari Pengaturan berlaku.
    await whatsappService.refreshGatewayUrl();
    const result = await whatsappService.connect(fresh);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Hapus sesi Baileys dan kembali ke kondisi "belum pairing" */
export async function resetWhatsAppSession(req, res) {
  try {
    const result = await whatsappService.resetSession();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function disconnectWhatsApp(req, res) {
  try {
    const result = await whatsappService.disconnect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getWhatsAppStatus(req, res) {
  try {
    // Segarkan URL gateway dari Pengaturan lebih dulu.
    //
    // `isGatewayConfigured()` bersifat SINKRON dan membaca nilai terakhir
    // yang diketahui — jadi nilainya harus di-refresh SETIAP status poll.
    // Tanpa ini, gateway yang dikonfigurasi lewat UI baru dikenali
    // setelah server restart.
    const gatewayUrl = await whatsappService.refreshGatewayUrl();

    const mode = whatsappService.getMode();
    const isConfigured = whatsappService.isGatewayConfigured();
    const hasSession = whatsappService.hasBaileysSession();
    let deviceInfo = null;
    let gatewayStatus = null;

    // Status sesi gateway dibaca polling (bukan dari state lokal), karena
    // engine OpenWA bisa berubah status di luar aplikasi ini (mis. user
    // memindai QR lewat dashboard OpenWA).
    if (isConfigured && (mode === 'gateway' || mode === 'baileys')) {
      try {
        gatewayStatus = await whatsappService.getGatewayStatus();
      } catch (e) {
        gatewayStatus = { connected: false, state: 'error', error: e.message };
      }
    }

    // Mode gateway: status sesi gateway yang menentukan tampilan, bukan
    // state lokal yang bisa basi.
    let status = whatsappService.getStatus();
    let effectiveMode = mode;

    // Sesi gateway yang hidup (ada sessionId) = aplikasi memakai jalur gateway,
    // walau `connect()` belum pernah dipanggil di proses ini (mis. setelah
    // restart server, atau user pairing lewat dashboard OpenWA).
    if (gatewayStatus?.sessionId) {
      effectiveMode = 'gateway';
    }

    if (isConfigured && gatewayStatus?.rawState && gatewayStatus.rawState !== 'unknown') {
      status = gatewayStatus.state;
    }

    try {
      deviceInfo = whatsappService.getDeviceInfo();
    } catch (e) {
      deviceInfo = null;
    }

    res.json({
      status,
      mode: effectiveMode,
      isGatewayConfigured: isConfigured,
      hasBaileysSession: hasSession,
      gatewayStatus,
      deviceInfo: deviceInfo || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function sendWhatsAppMessage(req, res) {
  try {
    const { to, text } = req.body;
    if (!to || !text) {
      return res.status(400).json({ error: 'Field "to" dan "text" wajib diisi' });
    }
    // Segarkan URL gateway supaya konfigurasi dari Pengaturan berlaku.
    await whatsappService.refreshGatewayUrl();
    const msg = await whatsappService.sendMessage(to, text);
    res.json({ success: true, messageId: msg?.messageId || msg?.key?.id || msg?.id?._serialized || null });
  } catch (err) {
    // Nomor WhatsApp tidak valid adalah kesalahan INPUT, bukan kegagalan
    // server — jawab 400 supaya UI menampilkan pesan yang tepat (bukan 500
    // yang terbaca sebagai "server error").
    if (/tidak valid/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
}

export async function getWhatsAppQR(req, res) {
  try {
    const mode = whatsappService.getMode();

    // Jalur gateway dipakai bila gateway dikonfigurasi — bukan hanya bila
    // state lokal `mode` sudah 'gateway'.
    //
    // MASALAH: `gatewayMode` hanya di-set true di dalam connect(). Setelah
    // restart server, atau ketika user pairing lewat dashboard OpenWA, state
    // lokal itu masih 'baileys' — sehingga endpoint /qr tidak pernah
    // mengambil QR dari gateway dan UI menampilkan "QR belum siap"
    // padahal gateway sudah punya QR.
    //
    // Solusi: kalau gateway dikonfigurasi, ALWAYS coba jalur gateway dulu.
    // Bila gateway tidak punya sesi/QR, fungsi mengembalikan null dengan
    // status yang jelas dan UI bisa jatuh ke jalur Baileys.
    //
    // URL di-refresh dulu supaya perubahan dari Pengaturan langsung berlaku
    // tanpa perlu restart server.
    await whatsappService.refreshGatewayUrl();
    const useGateway = whatsappService.isGatewayConfigured();
    if (useGateway) {
      const qr = await whatsappService.getQR();
      if (qr && qr.qr) {
        return res.json({ status: 'ready', qr: qr.qr, expiresIn: qr.expiresIn });
      }
      // Gateway sudah terhubung → tidak perlu QR.
      const status = await whatsappService.getGatewayStatus();
      if (status.connected) {
        return res.json({ status: 'connected', message: 'WhatsApp already connected' });
      }
      if (mode !== 'gateway') {
        // Gateway tidak siap DAN mode lokal bukan gateway → belum ada QR
        // yang bisa ditampilkan dari sumber mana pun.
        return res.json({ status: 'connecting', message: 'QR belum siap.' });
      }
      return res.json({ status: 'connecting', message: 'QR code being generated...' });
    }

    // Baileys mode - QR dibuat oleh Baileys dan di-encode jadi PNG
    const qr = await whatsappService.getQR();
    if (qr.qr) {
      return res.json({ status: 'ready', qr: qr.qr, expiresIn: qr.expiresIn });
    }
    if (qr.status === 'connected') {
      return res.json({ status: 'connected', message: 'WhatsApp already connected' });
    }
    return res.json({ status: 'connecting', message: 'QR belum siap. Klik "Mulai Pairing" untuk membuat QR baru.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
