// Utilitas lokalisasi data absensi di sisi frontend.
//
// MASALAH YANG DISELESAIKAN:
//   Backend mengirim `dayOfWeek` ("Jumat"), `direction` ("Masuk"/"Keluar") dan
//   `date` ("06/11/2026") dalam format Bahasa Indonesia. Ketika UI diganti ke
//   English, field-field tersebut TETAP menampilkan teks Indonesia — header
//   tabel berubah tetapi isi selnya tidak.
//
// ATURAN:
//   field yang membawa bahasa HARUS di-derive ulang dari kunci netral
//   (`dateKey` = YYYY-MM-DD, `deviceKey` = masuk|keluar), bukan dari field
//   terformat. Ini persis aturan yang sudah dipakai di server
//   (`evDateShort`, `evDayName`, `evDirection`).

const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ubah 'id'/'en' apa pun menjadi 'id' atau 'en'. */
export function normalizeLang(lang) {
  return (lang === 'id' || lang === 'id-ID' || lang === 'id_ID') ? 'id' : 'en';
}

/**
 * Tanggal pendek sesuai bahasa.
 * id → "06 Nov 2026" | en → "06 Nov 2026"
 * Menerima YYYY-MM-DD (dateKey), ISO string, atau Date.
 */
export function fmtDateShort(dateOrStr, lang = 'id') {
  if (!dateOrStr) return '-';
  const parts = parseYmd(dateOrStr);
  if (!parts) return String(dateOrStr);
  const months = normalizeLang(lang) === 'id' ? MONTH_SHORT_ID : MONTH_SHORT_EN;
  return `${String(parts.d).padStart(2, '0')} ${months[parts.m - 1]} ${parts.y}`;
}

/**
 * Nama hari sesuai bahasa.
 * WAJIB memakai `dateKey` (YYYY-MM-DD) sebagai sumber, bukan string tanggal
 * terformat — parsing "06/11/2026" ambigu (DD/MM vs MM/DD).
 */
export function dayName(dateKey, lang = 'id') {
  if (!dateKey) return '-';
  const parts = parseYmd(dateKey);
  if (!parts) return '-';
  // new Date(YYYY-MM-DD) = tengah malam UTC → getUTCDay() adalah hari yg benar.
  const d = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  const names = normalizeLang(lang) === 'id' ? DAY_NAMES_ID : DAY_NAMES_EN;
  return names[d.getUTCDay()];
}

/**
 * Arah absensi sesuai bahasa.
 * Sumber: `deviceKey` ('masuk'|'keluar') — netral terhadap bahasa.
 * Fallback ke `direction` hanya bila deviceKey tidak ada.
 */
export function directionLabel(event, lang = 'id') {
  const key = event?.deviceKey;
  const isMasuk = key === 'masuk' || (key == null && event?.direction === 'Masuk');
  if (normalizeLang(lang) === 'id') return isMasuk ? 'Masuk' : 'Keluar';
  return isMasuk ? 'Check In' : 'Check Out';
}

/** Varian singkat dengan panah, untuk badge. */
export function directionLabelShort(event, lang = 'id') {
  const key = event?.deviceKey;
  const isMasuk = key === 'masuk' || (key == null && event?.direction === 'Masuk');
  if (normalizeLang(lang) === 'id') return isMasuk ? '↑ Masuk' : '↓ Keluar';
  return isMasuk ? '↑ Check In' : '↓ Check Out';
}

/**
 * Tipe user sesuai bahasa.
 * Sumber: nilai netral dari server ('Normal'|'Administrator'|'Tamu'|'Visitor').
 */
export function userTypeLabel(userType, lang = 'id') {
  const raw = String(userType || 'Normal').trim();
  const isAdmin = /^administrator$/i.test(raw);
  const isVisitor = /^(visitor|tamu)$/i.test(raw);
  if (normalizeLang(lang) === 'id') {
    if (isAdmin) return 'Administrator';
    if (isVisitor) return 'Tamu';
    return 'Normal';
  }
  if (isAdmin) return 'Administrator';
  if (isVisitor) return 'Visitor';
  return 'Normal';
}

/**
 * Ambil Y/M/D dari berbagai format tanggal.
 * - "2026-11-06" → { y:2026, m:11, d:6 } (netral, selalu Y-M-D)
 * - "2026-11-06T09:38:04.000Z" → ambil portion sebelum 'T'
 * - Date object → pakai UTC (data disimpan sebagai UTC yang setara WIB)
 */
function parseYmd(input) {
  if (input instanceof Date) {
    if (isNaN(input)) return null;
    return { y: input.getUTCFullYear(), m: input.getUTCMonth() + 1, d: input.getUTCDate() };
  }
  const s = String(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  return { y, m: mo, d };
}
