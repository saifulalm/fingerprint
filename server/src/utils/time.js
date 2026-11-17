// Time utilities — all timestamps normalized to WIB (UTC+7)
// Hikvision devices report wall-clock time with +08:00 timezone tag,
// but the actual clock is WIB (+07:00). The +08:00 is a known Hikvision bug.
//
// TWO SEPARATE PATHS (no mixing):
//
//   DEVICE → DB (write path):
//     Hikvision sends: "2026-09-02T13:57:29+08:00"  (numbers = WIB clock)
//     Parse with parseDeviceTime() → JS Date "2026-09-02T06:57:29.000Z"  (UTC equivalent)
//     Store as: new Date(ev.time)  → Prisma stores "2026-09-02T06:57:29.000Z"
//
//   DB → FRONTEND (read path):
//     Stored as: "2026-09-02T06:57:29.000Z" (UTC)
//     Display with fmtTime(r.time)  → uses JS Date directly, no wallDate() call
//     JS Date.toString() in UTC+7 env → "Wed Sep 02 2026 13:57:29 GMT+0700"
//     → shows 13:57 WIB ✅

export const WIB_MS = 7 * 60 * 60 * 1000;

/** Convert UTC JS Date to WIB JS Date */
function toWIB(utcDate) {
  if (!utcDate || isNaN(utcDate)) return null;
  return new Date(utcDate.getTime() + WIB_MS);
}

/** Get WIB date components from UTC JS Date */
function wibParts(utcDate) {
  const w = toWIB(utcDate);
  if (!w) return null;
  return {
    year: w.getUTCFullYear(),
    month: w.getUTCMonth(),
    date: w.getUTCDate(),
    hours: w.getUTCHours(),
    minutes: w.getUTCMinutes(),
    seconds: w.getUTCSeconds(),
  };
}

// Indonesian month and day names - Professional format
export const MONTH_ID_FULL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
export const MONTH_ID_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];
export const DAY_NAMES_FULL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const DAY_NAMES_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export const pad = (n) => String(n).padStart(2, '0');

/** Parse a raw device ISO string (e.g. "2026-09-02T13:57:29+08:00") into a UTC JS Date.
 * The device clock is WIB (+07:00) but tagged as +08:00.
 * We extract the wall-clock numbers and subtract 7h to get the correct UTC equivalent.
 *
 * ONLY call this when parsing NEW events from Hikvision before storing to DB.
 */
export function parseDeviceTime(isoStr) {
  if (!isoStr) return null;
  const m = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    // The numbers ARE the wall-clock (WIB). Subtract 7h to get correct UTC.
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - WIB_MS);
  }
  return new Date(isoStr);
}

/** Format a JS Date object as Indonesian professional date format
 * Input: Date object or ISO string
 * Output: "01 Oktober 2026"
 */
export function fmtDateIndonesia(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const day = pad(d.getDate());
  const month = MONTH_ID_FULL[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/** Format a JS Date object as Indonesian short date
 * Input: Date object or ISO string
 * Output: "01 Okt 2026"
 */
export function fmtDateIndonesiaShort(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const day = pad(d.getDate());
  const month = MONTH_ID_SHORT[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/** Format a JS Date object as Indonesian datetime - Professional
 * Input: Date object or ISO string
 * Output: "01 Oktober 2026, 18:02"
 */
export function fmtDateTimeIndonesia(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const day = pad(d.getDate());
  const month = MONTH_ID_FULL[d.getMonth()];
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

/** Format a JS Date object as Indonesian datetime with seconds - Professional
 * Input: Date object or ISO string
 * Output: "01 Oktober 2026 18:02:34"
 */
export function fmtDateTimeIndonesiaFull(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const day = pad(d.getDate());
  const month = MONTH_ID_FULL[d.getMonth()];
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
}

/** Format date string (YYYY-MM-DD) to Indonesian long format
 * Input: "2026-10-01"
 * Output: "01 Oktober 2026"
 */
export function fmtDateLong(dateStr) {
  const s = dateStr == null ? '' : String(dateStr);
  const [y, m, d] = s.split('-');
  const monthIdx = parseInt(m) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '-';
  return `${d || ''} ${MONTH_ID_FULL[monthIdx] || ''} ${y}`;
}

/**
 * Validasi tanggal YYYY-MM-DD.
 *
 * MASALAH YANG DISELESAIKAN:
 *   Endpoint laporan hanya mengecek `startDate`/`endDate` ADA atau tidak.
 *   Nilai seperti "abc" lolos, lalu `wibRangeToUtc()` membentuk
 *   `new Date('abcT00:00:00.000+07:00')` → Invalid Date. Fallback-nya juga
 *   invalid, sehingga Prisma menerima rentang tidak valid dan hasilnya
 *   error HTTP 500 — pesan "Internal Server Error" yang tidak membantu.
 *
 * SEKARANG: format diperiksa lebih dulu, dan tanggal yang benar-benar ada
 * di kalender (mis. 2026-02-30) ditolak.
 *
 * @param {unknown} value kandidat tanggal
 * @returns {boolean} true bila format YYYY-MM-DD dan tanggalnya valid
 */
export function isValidDateStr(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d)) return false;
  // Tolak tanggal yang digeser otomatis oleh JS (2026-02-30 → 2026-03-02).
  return d.toISOString().slice(0, 10) === s;
}

/** Format date string (YYYY-MM-DD) to Indonesian short format
 * Input: "2026-10-01"
 * Output: "01 Okt 2026"
 */
export function fmtDateShort(dateOrStr) {
  const s = dateOrStr == null ? '' : String(dateOrStr);
  // If it's a full ISO string with time component, parse as Date first
  if (s.includes('T') || (dateOrStr instanceof Date)) {
    const d = dateOrStr instanceof Date ? dateOrStr : new Date(s);
    if (!isNaN(d)) {
      return `${pad(d.getDate())} ${MONTH_ID_SHORT[d.getMonth()]} ${d.getFullYear()}`;
    }
    return '-';
  }
  // Handle YYYY-MM-DD strings — pad day to 2 digits
  const [y, m, d] = s.split('-');
  const monthIdx = parseInt(m) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '-';
  return `${d.padStart(2, '0')} ${MONTH_ID_SHORT[monthIdx] || ''} ${y}`;
}

/** Format date string to full Indonesian datetime
 * Input: "2026-10-01" or ISO string
 * Output: "01 Oktober 2026, 18:02"
 */
export function fmtDateTimeLong(dateOrStr) {
  const s = dateOrStr == null ? '' : String(dateOrStr);
  // If it's a full ISO string with time
  if (s.includes('T')) {
    const d = new Date(s);
    if (isNaN(d)) return '-';
    return fmtDateTimeIndonesia(d);
  }
  // If it's just a date string YYYY-MM-DD
  const [y, m, day] = s.split('-');
  const monthIdx = parseInt(m) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '-';
  return `${day || ''} ${MONTH_ID_FULL[monthIdx] || ''} ${y}`;
}

/** Format date string to full Indonesian datetime with seconds
 * Input: "2026-10-01" or ISO string
 * Output: "01 Oktober 2026 18:02:34"
 */
export function fmtDateTimeFull(dateOrStr) {
  const s = dateOrStr == null ? '' : String(dateOrStr);
  // If it's a full ISO string with time
  if (s.includes('T')) {
    const d = new Date(s);
    if (isNaN(d)) return '-';
    return fmtDateTimeIndonesiaFull(d);
  }
  // If it's just a date string YYYY-MM-DD
  const [y, m, day] = s.split('-');
  const monthIdx = parseInt(m) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '-';
  return `${day || ''} ${MONTH_ID_FULL[monthIdx] || ''} ${y}`;
}

/** Legacy functions for compatibility - NOW using WIB explicitly */
export function fmtWIB(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const w = wibParts(d);
  if (!w) return '-';
  return `${pad(w.date)}/${pad(w.month + 1)}/${w.year} ${pad(w.hours)}:${pad(w.minutes)}:${pad(w.seconds)}`;
}

export function fmtWIBShort(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const w = wibParts(d);
  if (!w) return '-';
  return `${pad(w.date)}/${pad(w.month + 1)}/${w.year} ${pad(w.hours)}:${pad(w.minutes)}`;
}

export function fmtDate(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const w = wibParts(d);
  if (!w) return '-';
  return `${pad(w.date)}/${pad(w.month + 1)}/${w.year}`;
}

export function fmtTime(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const w = wibParts(d);
  if (!w) return '-';
  return `${pad(w.hours)}:${pad(w.minutes)}:${pad(w.seconds)}`;
}

export function dateKey(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '';
  const w = wibParts(d);
  if (!w) return '';
  return `${w.year}-${pad(w.month + 1)}-${pad(w.date)}`;
}

export function dayOfWeek(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const w = wibParts(d);
  if (!w) return '-';
  // Create a WIB date and get its day of week
  const wibDate = new Date(Date.UTC(w.year, w.month, w.date, 12, 0, 0));
  return DAY_NAMES_FULL[wibDate.getUTCDay()];
}

export function dayOfWeekShort(dateOrStr) {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const w = wibParts(d);
  if (!w) return '-';
  const wibDate = new Date(Date.UTC(w.year, w.month, w.date, 12, 0, 0));
  return DAY_NAMES_SHORT[wibDate.getUTCDay()];
}

// Current time in WIB - Professional format
export function nowWIB(fmt = 'full') {
  // Server may run in any timezone; use UTC + 7h offset
  const utcNow = new Date(Date.now());
  const wibMs = utcNow.getTime() + WIB_MS;
  const d = new Date(wibMs);
  const date = `${pad(d.getUTCDate())} ${MONTH_ID_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const timeShort = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (fmt === 'date') return date;
  if (fmt === 'time') return time;
  if (fmt === 'short') return `${date} ${timeShort}`;
  if (fmt === 'full') return `${date}, ${time}`;
  return `${date} ${time}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// BILINGUAL FORMATTERS (English / Indonesian)
//
// MASALAH YANG DISELESAIKAN:
//   `fmtDateLong`, `fmtDateShort`, `dayOfWeek`, `dayOfWeekShort` dan
//   `fmtDateTimeIndonesia` SEBELUMNYA selalu menghasilkan teks Indonesia
//   ("November", "Senin", "06 November 2026"). Laporan PDF/Excel berbahasa
//   English karena itu menampilkan "Period: 01 November 2026" — mencampur
//   label English dengan tanggal Indonesia.
//
//   Sekarang tersedia padanan English. Semua fungsi lama tetap apa adanya
//   (backward compatible) — pemanggil cukup menambahkan argumen `lang`.
// ═════════════════════════════════════════════════════════════════════════════

export const MONTH_EN_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_EN_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
export const DAY_NAMES_EN_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_NAMES_EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Normalisasi kode bahasa: 'id' | 'id-ID' → 'id', selain itu → 'en' */
export function normalizeLang(lang) {
  return (lang === 'id' || lang === 'id-ID' || lang === 'id_ID') ? 'id' : 'en';
}

/**
 * Format YYYY-MM-DD menjadi tanggal panjang sesuai bahasa.
 * id → "06 November 2026" | en → "06 November 2026" (bulan sama, tapi tetap dipisah agar
 *      locale berbeda di masa depan tidak merusak tampilan)
 */
export function fmtDateLongLang(dateStr, lang = 'id') {
  const s = dateStr == null ? '' : String(dateStr);
  const [y, m, d] = s.split('-');
  const monthIdx = parseInt(m) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '-';
  const months = normalizeLang(lang) === 'id' ? MONTH_ID_FULL : MONTH_EN_FULL;
  return `${d || ''} ${months[monthIdx] || ''} ${y}`;
}

/**
 * Format YYYY-MM-DD (atau ISO) menjadi tanggal pendek sesuai bahasa.
 * id → "06 Nov 2026" | en → "06 Nov 2026"
 */
export function fmtDateShortLang(dateOrStr, lang = 'id') {
  const s = dateOrStr == null ? '' : String(dateOrStr);
  if (s.includes('T') || (dateOrStr instanceof Date)) {
    const d = dateOrStr instanceof Date ? dateOrStr : new Date(s);
    if (!isNaN(d)) {
      const months = normalizeLang(lang) === 'id' ? MONTH_ID_SHORT : MONTH_EN_SHORT;
      return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    return '-';
  }
  const [y, m, d] = s.split('-');
  const monthIdx = parseInt(m) - 1;
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '-';
  const months = normalizeLang(lang) === 'id' ? MONTH_ID_SHORT : MONTH_EN_SHORT;
  return `${String(d || '').padStart(2, '0')} ${months[monthIdx] || ''} ${y}`;
}

/**
 * Nama hari sesuai bahasa.
 * id → "Senin" | en → "Monday"
 */
export function dayOfWeekLang(dateStr, lang = 'id') {
  if (!dateStr) return '-';
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (isNaN(d)) return '-';
  const names = normalizeLang(lang) === 'id' ? DAY_NAMES_FULL : DAY_NAMES_EN_FULL;
  return names[d.getUTCDay()];
}

/** Nama hari singkat sesuai bahasa: id → "Sen" | en → "Mon" */
export function dayOfWeekShortLang(dateStr, lang = 'id') {
  if (!dateStr) return '-';
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (isNaN(d)) return '-';
  const names = normalizeLang(lang) === 'id' ? DAY_NAMES_SHORT : DAY_NAMES_EN_SHORT;
  return names[d.getUTCDay()];
}

/**
 * Tanggal+waktu lengkap sesuai bahasa.
 * id → "06 November 2026, 14:05" | en → "06 November 2026, 14:05"
 */
export function fmtDateTimeLang(dateOrStr, lang = 'id') {
  const d = dateOrStr instanceof Date ? dateOrStr : (dateOrStr ? new Date(dateOrStr) : null);
  if (!d || isNaN(d)) return '-';
  const months = normalizeLang(lang) === 'id' ? MONTH_ID_FULL : MONTH_EN_FULL;
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Konversi rentang tanggal WIB (YYYY-MM-DD) menjadi batas UTC untuk query DB.
 *
 * MASALAH YANG DISELESAIKAN:
 *   Data absensi disimpan sebagai UTC yang setara jam WIB (jam dinding
 *   perangkat dikurangi 7 jam). Query lama memakai `new Date(startDate +
 *   'T00:00:00Z')` → batas UTC tengah malam, sehingga 7 jam pertama setiap
 *   hari WIB (00:00–07:00) terpotong dan 7 jam pertama hari berikutnya ikut
 *   terambil. Akibatnya laporan per hari kehilangan event pagi.
 *
 * SOLUSI:
 *   Batas bawah = WIB 00:00:00 pada startDate → `startDate T00:00:00+07:00`
 *   Batas atas  = WIB 23:59:59.999 pada endDate → `endDate T23:59:59.999+07:00`
 *   Keduanya dikonversi otomatis ke UTC oleh runtime JS.
 *
 * @param {string} startDate YYYY-MM-DD (WIB)
 * @param {string} endDate   YYYY-MM-DD (WIB)
 * @returns {{ gte: Date, lte: Date }}
 */
export function wibRangeToUtc(startDate, endDate) {
  const s = new Date(`${startDate}T00:00:00.000+07:00`);
  const e = new Date(`${endDate}T23:59:59.999+07:00`);
  return {
    gte: isNaN(s) ? new Date(`${startDate}T00:00:00Z`) : s,
    lte: isNaN(e) ? new Date(`${endDate}T23:59:59.999Z`) : e,
  };
}

/**
 * Tanggal YYYY-MM-DD + waktu (untuk tanggal statis seperti startDate).
 */
export function fmtDateTimeFromKeyLang(dateStr, timeStr, lang = 'id') {
  const date = fmtDateLongLang(dateStr, lang);
  if (date === '-') return '-';
  return `${date}, ${timeStr || ''}`;
}
