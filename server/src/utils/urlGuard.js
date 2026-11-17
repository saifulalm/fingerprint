// Validasi URL gateway WhatsApp — proteksi SSRF.
//
// MASALAH YANG DISELESAIKAN:
//   `waGatewayUrl` berasal dari input user (Pengaturan & Jadwal) dan
//   kemudian di-`fetch()` oleh server di schedulerService.sendViaGateway().
//   Tanpa validasi, siapa pun yang sudah login bisa membuat server
//   melakukan POST ke alamat internal:
//
//     http://169.254.169.254/latest/meta-data/   (metadata cloud)
//     http://127.0.0.1:6601/api/settings           (loopback)
//     http://192.168.89.240/                      (perangkat jaringan)
//
//   Hasilnya: pemindaian jaringan internal dari dalam, dan data bisa
//   bocor lewat response gateway.
//
// ATURAN:
//   - Skema harus http: atau https:.
//   - Host TIDAK boleh loopback / link-local / private / metadata cloud.
//   - Host yang dikonfigurasi di .env (WA_GATEWAY_URL) tetap diizinkan
//     walau berada di jaringan internal — itu host yang sudah dipercaya.
//
// PENGECEKAN IP PRIVATE dilakukan pada hostname yang resolved ke IP.
// Ini akurat untuk IP literal; untuk hostname yang resolve ke IP internal
// (DNS rebinding) diperlukan resolusi DNS. Untuk instalasi lokal, cukup
// untuk memblokir kasus umum (IP literal, localhost, .local, .internal).

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Apakah host ini menunjuk ke jaringan internal?
 */
export function isBlockedHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;

  // Loopback & unspecified
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;

  // Hostname internal yang umum
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;

  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;   // cloud metadata
    if (a >= 224) return true;                 // multicast/reserved
    return false;
  }

  // IPv6 literal (sederhana: cek prefiks internal)
  if (h.includes(':')) {
    if (h.startsWith('fc') || h.startsWith('fd')) return true;   // unique-local
    if (h.startsWith('fe80')) return true;                        // link-local
    return false;
  }

  return false;
}

/**
 * Validasi URL gateway WhatsApp.
 *
 * @param {string} rawUrl URL dari input user
 * @param {string[]} trustedHosts Host yang boleh despite internal (dari .env)
 * @returns {{ ok: boolean, url?: string, reason?: string }}
 */
export function validateGatewayUrl(rawUrl, trustedHosts = []) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return { ok: true, url: '' };  // kosong = tidak dikonfigurasi (OK)

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'URL gateway tidak valid.' };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: 'Skema URL harus http atau https.' };
  }

  const hostname = parsed.hostname;
  const trusted = trustedHosts
    .map((h) => String(h || '').trim().toLowerCase())
    .filter(Boolean);

  const isTrusted = trusted.includes(hostname.toLowerCase());

  if (!isTrusted && isBlockedHost(hostname)) {
    return {
      ok: false,
      reason: `Host "${hostname}" menunjuk ke jaringan internal dan tidak diizinkan. Gunakan host publik.`,
    };
  }

  return { ok: true, url: raw };
}

/**
 * Mask URL sensitif untuk ditampilkan ke user.
 *
 * Gateway WhatsApp (Fonnte/WaBlas/OpenWA) putting API key atau token
 * sebagai query param, mis. `https://fonnte.com/api/send?token=SECRET`.
 * URL itu tampil apa adanya di UI bisa membocorkan token ke layar,
 * screenshot, atau log browser.
 *
 * Aturan:
 *   - Skema + host + path tetap terlihat (user perlu tahu gateway mana).
 *   - NILAI setiap query param diganti bullet — nama param tetap terlihat
 *     supaya user tahu ada token di situ.
 *   - String yang bukan URL valid ditampilkan penuh bullet.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function maskSensitiveUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // Bukan URL — bisa berupa token mentah. Jangan pernah tampil utuh.
    return '•'.repeat(8);
  }

  const params = parsed.searchParams.keys();
  let maskedQuery = '';
  const names = [...params];
  if (names.length) {
    maskedQuery = '?' + names.map((n) => `${n}=${'•'.repeat(6)}`).join('&');
  }

  return `${parsed.origin}${parsed.pathname}${maskedQuery}`;
}

/**
 * Cek URL gateway yang akan dipakai SEBELUM fetch (lapisan kedua).
 * Validasi saat input saja bisa dilewati bila URL diubah langsung
 * di database.
 *
 * `extraTrusted` berisi host tambahan yang dianggap tepercaya — mis. URL
 * gateway yang disimpan lewat Pengaturan di UI. Tanpa itu, gateway OpenWA
 * lokal (127.0.0.1) yang dikonfigurasi lewat UI akan ditolak sebagai SSRF.
 */
export function assertGatewayUrlAllowed(rawUrl, extraTrusted = []) {
  const trusted = [
    process.env.WA_GATEWAY_URL || '',
    ...extraTrusted,
  ].map((h) => {
    const raw = String(h || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      return '';
    }
  }).filter(Boolean);

  const result = validateGatewayUrl(rawUrl, trusted);
  if (!result.ok) {
    const err = new Error(result.reason);
    err.status = 400;
    throw err;
  }
  return result.url;
}
