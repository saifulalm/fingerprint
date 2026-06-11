require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios   = require('axios');
const crypto  = require('crypto');
const xml2js  = require('xml2js');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const nodemailer  = require('nodemailer');
const dayjs  = require('dayjs');
const path   = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fp-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 jam
}));

// ─── Device Config ────────────────────────────────────────────────────────────
const DEVICES = {
  masuk: {
    ip:       process.env.DEVICE_MASUK_IP   || '192.168.89.241',
    username: process.env.DEVICE_MASUK_USER || 'admin',
    password: process.env.DEVICE_MASUK_PASS || 'Hikvision12',
    label:    'Fingerprint Masuk',
    type:     'masuk',
    direction:'Masuk'
  },
  keluar: {
    ip:       process.env.DEVICE_KELUAR_IP   || '192.168.89.240',
    username: process.env.DEVICE_KELUAR_USER || 'admin',
    password: process.env.DEVICE_KELUAR_PASS || 'Hikvision12',
    label:    'Fingerprint Keluar',
    type:     'keluar',
    direction:'Keluar'
  }
};
const TZ = process.env.TZ_OFFSET || '+07:00';

// ─── WIB Timezone (UTC+7) — Explicit, server-timezone-independent ─────────────
const WIB_MS  = 7 * 60 * 60 * 1000; // 7 jam dalam ms
const WIB_TAG = '(WIB)';
const DAY_NAMES = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const pad = n => String(n).padStart(2, '0');

function wibDate(isoStr) {
  if (!isoStr) return null;
  return new Date(new Date(isoStr).getTime() + WIB_MS);
}
// ── Wall-clock parse untuk timestamp dari DEVICE ──────────────────────────────
// DS-K1T8003MF di lapangan: jam dinding device disetel WIB, tapi timezone device
// berlabel GMT+8 (default Hikvision). Angka jam yang tertera = jam WIB yang benar,
// labelnya yang salah. Maka jam event TIDAK boleh dikonversi via offset — ambil
// angka tanggal+jam apa adanya (wall clock) dari string ISO device.
function wallDate(isoStr) {
  if (!isoStr) return null;
  const m = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
  return new Date(new Date(isoStr).getTime() + WIB_MS);
}
// Format: DD/MM/YYYY HH:mm:ss
function fmtWIB(isoStr)      { const d = wallDate(isoStr); if (!d) return '-'; return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
// Format: DD/MM/YYYY HH:mm
function fmtWIBShort(isoStr) { const d = wallDate(isoStr); if (!d) return '-'; return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
// Format: DD/MM/YYYY
function fmtDate(isoStr)     { const d = wallDate(isoStr); if (!d) return '-'; return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`; }
// Format: HH:mm:ss
function fmtTime(isoStr)     { const d = wallDate(isoStr); if (!d) return '-'; return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
// Sortable key: YYYY-MM-DD (wall clock device)
function dateKey(isoStr)     { const d = wallDate(isoStr); if (!d) return ''; return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
// Day of week (wall clock device)
function dayOfWeek(isoStr)   { const d = wallDate(isoStr); return d ? DAY_NAMES[d.getUTCDay()] : '-'; }
// Current WIB time formatted
function nowWIB(fmt = 'full') {
  const d = wibDate(new Date().toISOString());
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const short = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (fmt === 'date')  return date;
  if (fmt === 'time')  return time;
  if (fmt === 'short') return `${date} ${short}`;
  return `${date} ${time}`;
}
// Format: D MMMM YYYY (Indonesian month name) from YYYY-MM-DD string
const MONTH_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function fmtDateLong(dateStr) { const [y, m, d2] = dateStr.split('-'); return `${parseInt(d2)} ${MONTH_ID[parseInt(m)-1]} ${y}`; }
// Format: DD/MM/YYYY from YYYY-MM-DD string
function fmtDateShort(dateStr) { const [y, m, d2] = dateStr.split('-'); return `${d2}/${m}/${y}`; }
// ── Deteksi offset timezone tiap device (cache 1 jam) ─────────────────────────
// Rentang query HARUS memakai offset milik device (bukan asumsi WIB) agar batas
// hari 00:00–23:59 pas dengan jam dinding device. Contoh: device berlabel +08:00
// → query "2026-06-01T00:00:00+08:00" = tepat jam 00:00 di jam dinding device.
const _tzCache = {};
async function getDeviceTz(dev) {
  const c = _tzCache[dev.type];
  if (c && (Date.now() - c.ts) < 60 * 60 * 1000) return c.offset;
  let offset = TZ; // fallback dari .env bila device tak terjangkau
  try {
    const resp   = await digestRequest({ url: `http://${dev.ip}/ISAPI/System/time`, username: dev.username, password: dev.password });
    const parsed = await parseXML(resp.data);
    const lt     = parsed.Time?.localTime || '';
    const m      = String(lt).match(/([+-]\d{2}:\d{2})$/);
    if (m) offset = m[1];
  } catch (_) { /* pakai fallback */ }
  _tzCache[dev.type] = { offset, ts: Date.now() };
  console.log(`[TZ] ${dev.label}: offset device = ${offset}`);
  return offset;
}

// ─── Valid Access Event Filter ────────────────────────────────────────────────
// Pendekatan BLACKLIST: sertakan semua event yang punya employeeNo valid.
// Hanya buang event door-sensor/alarm yang memang tidak punya karyawan.
// (Whitelist minor code sebelumnya terlalu ketat — beda firmware bisa beda kode)
//
// Event door sensor / alarm biasanya: minor 18-27, major≥5, atau employeeNo kosong/"0"
const BLACKLIST_MINOR = new Set([18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);

// Firmware lama (mis. DS-K1T8003MF) kadang kirim employeeNo numerik, bukan employeeNoString
function getEmpNo(ev) {
  return String(ev.employeeNoString ?? ev.employeeNo ?? '').trim();
}

// Kunci pencocokan nama lintas device: employeeNo BERBEDA di tiap device,
// jadi penggabungan dilakukan berdasarkan nama yang dinormalisasi
// (case-insensitive, spasi ganda/tepi dihapus) agar "Budi " dan "budi" = 1 orang.
function normName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isValidAccess(ev) {
  const empNo = getEmpNo(ev);
  if (!empNo || empNo === '0') return false; // tidak ada karyawan = door sensor / alarm
  if (BLACKLIST_MINOR.has(parseInt(ev.minor))) return false; // event door bukan akses orang
  return true;
}

// Helper: deskripsi minor code untuk ditampilkan (inklusif semua kode diketahui)
function getMinorLabel(minor) {
  const m = parseInt(minor);
  const labels = {
    1:'Normal',   // beberapa firmware lama
    35:'Kartu', 36:'Password', 37:'Fingerprint', 38:'Fingerprint',
    39:'FP+Kartu', 40:'FP+PW', 41:'Kartu+PW', 42:'FP+Kartu+PW',
    43:'Duress FP', 44:'PW Super', 72:'Wajah', 73:'Wajah+Kartu',
    75:'Wajah+FP', 76:'Kartu+FP', 78:'Wajah+Kartu+PW', 80:'Wajah',
    196:'Fingerprint', 255:'Akses'
  };
  return labels[m] || (minor != null ? `Mode ${minor}` : '-');
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesi habis, silakan login kembali' });
  res.redirect('/login');
}

// ─── Digest Auth ─────────────────────────────────────────────────────────────
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function digestRequest({ url, method = 'GET', data = null, username, password, timeout = 15000 }) {
  const buildCfg = (auth) => {
    const cfg = { method, url, timeout, headers: {} };
    if (data !== null) { cfg.data = data; cfg.headers['Content-Type'] = 'application/json'; }
    if (auth) cfg.headers['Authorization'] = auth;
    return cfg;
  };
  try {
    return await axios(buildCfg(null));
  } catch (err) {
    if (!err.response || err.response.status !== 401) throw err;
    const w = err.response.headers['www-authenticate'] || '';
    const realm  = (w.match(/realm="([^"]+)"/)     || [])[1] || '';
    const nonce  = (w.match(/nonce="([^"]+)"/)     || [])[1] || '';
    const qop    = (w.match(/qop="?([^",\s]+)"?/)  || [])[1] || null;
    const urlObj = new URL(url);
    const uri    = urlObj.pathname + urlObj.search;
    const nc     = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1    = md5(`${username}:${realm}:${password}`);
    const ha2    = md5(`${method.toUpperCase()}:${uri}`);
    const resp   = qop
      ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    auth += `, response="${resp}"`;
    return axios(buildCfg(auth));
  }
}

async function parseXML(xml) {
  return xml2js.parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false });
}

// ─── Hikvision minor code → verify mode (inklusif semua kode diketahui) ───────
function getVerifyModeFromMinor(minor) {
  const m = {
    1:  'Normal',
    35: 'Kartu',
    36: 'Password',
    37: 'Fingerprint (Paksa)',
    38: 'Fingerprint',
    39: 'FP + Kartu',
    40: 'FP + Password',
    41: 'Kartu + Password',
    42: 'FP + Kartu + PW',
    43: 'Duress FP',
    44: 'Password Super',
    72: 'Wajah',
    73: 'Wajah + Kartu',
    74: 'Wajah + PW',
    75: 'Wajah + FP',
    76: 'Kartu + FP',
    77: 'Wajah + Kartu + FP',
    78: 'Wajah + Kartu + PW',
    79: 'Wajah + FP + PW',
    80: 'Wajah (Multi)',
    196:'Fingerprint',
    255:'Akses'
  };
  return m[parseInt(minor)] || (minor != null ? `Mode ${minor}` : '-');
}

// ─── Fetch All Users from a device ───────────────────────────────────────────
async function fetchAllUsers(dev) {
  const users = [];
  let position = 0, total = null, more = true;
  // searchID numerik & konsisten untuk satu sesi pencarian (lihat catatan di fetchAllEvents)
  const searchID = String(Date.now());
  const MAX_PAGES = 200;
  let page = 0;
  do {
    page++;
    const payload = {
      UserInfoSearchCond: {
        searchID,
        searchResultPosition: position,
        maxResults: 30   // DS-K1T8003 series cap 30 per response
      }
    };
    const resp = await digestRequest({
      url: `http://${dev.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
      method: 'POST', data: payload,
      username: dev.username, password: dev.password
    });
    const body = resp.data;
    const ui = body.UserInfoSearch || body.UserInfo || {};
    if (total === null) total = parseInt(ui.totalMatches ?? ui.numOfMatches) || 0;
    if (ui.responseStatusStrg === 'NO MATCH') break;
    const raw = ui.UserInfo || [];
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    users.push(...list);
    position += list.length;
    if (list.length === 0) break;
    more = ui.responseStatusStrg === 'MORE' || position < total;
  } while (more && page < MAX_PAGES);
  return users;
}

// ─── User Cache (per-device map + cross-device name map) ─────────────────────
let _userCache = { data: null, ts: null };
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 menit

async function getUserCache(force = false) {
  if (!force && _userCache.data && _userCache.ts && (Date.now() - _userCache.ts) < USER_CACHE_TTL) {
    return _userCache.data;
  }
  // Map: deviceKey → Map<employeeNo, userObject>
  const devMaps = {};
  // Master name map: normName(name) → gabungan info user lintas device
  // { name, userType, ids: { masuk: empNo|null, keluar: empNo|null }, valid }
  const nameMap = new Map();

  for (const [key, dev] of Object.entries(DEVICES)) {
    devMaps[key] = new Map();
    try {
      const users = await fetchAllUsers(dev);
      users.forEach(u => {
        const empNo = String(u.employeeNo ?? u.employeeNoString ?? '').trim();
        devMaps[key].set(empNo, u);
        const display = (u.name || '').trim();
        if (display) {
          const k = normName(display);
          if (!nameMap.has(k)) {
            nameMap.set(k, { name: display, userType: u.userType || 'normal', ids: {}, valid: u.Valid || null });
          }
          const m = nameMap.get(k);
          m.ids[key] = empNo;                       // simpan ID per device (ID beda tiap device)
          if (!m.valid && u.Valid) m.valid = u.Valid;
          if (m.userType === 'normal' && u.userType && u.userType !== 'normal') m.userType = u.userType;
        }
      });
      console.log(`[UserCache] ${dev.label}: ${users.length} user dimuat`);
    } catch (err) {
      console.error(`[UserCache] Gagal ambil user dari ${dev.label}: ${err.message}`);
    }
  }

  _userCache.data = { devMaps, nameMap };
  _userCache.ts   = Date.now();
  return _userCache.data;
}

// ─── Fetch All Events (auto-paginate) ────────────────────────────────────────
async function fetchAllEvents(dev, startDate, endDate) {
  // Rentang dibangun dengan offset timezone DEVICE (lihat getDeviceTz)
  const tz = await getDeviceTz(dev);
  const startISO = `${startDate}T00:00:00${tz}`;
  const endISO   = `${endDate}T23:59:59${tz}`;

  const events = [];
  const seenSerial = new Set();   // dedupe antar halaman (proteksi firmware lama)
  let position = 0, total = null, more = true;
  // DS-K1T8003MF (V1.4.1): device mengembalikan max 10 event per response,
  // berapapun maxResults yang diminta — pagination yang menutupi sisanya.
  const MAX_PER_PAGE = 30;
  const MAX_PAGES    = 2000; // Safety cap
  let page = 0;
  // PENTING (hasil tes ke device asli):
  // 1. searchID harus NUMERIK — firmware V1.4.1 menolak UUID dengan 400 badParameters.
  // 2. searchID harus SAMA untuk semua halaman dalam satu sesi pencarian
  //    (Hikvision meng-cache sesi pencarian per searchID).
  const searchID = String(Date.now());

  do {
    page++;
    const payload = {
      AcsEventCond: {
        searchID,
        searchResultPosition: position,
        maxResults:           MAX_PER_PAGE,
        major:                0,   // 0 = semua major (akses, alarm, dll) — ambil maksimal, filter di server
        minor:                0,   // 0 = semua minor
        startTime:            startISO,
        endTime:              endISO
      }
    };
    const resp = await digestRequest({
      url: `http://${dev.ip}/ISAPI/AccessControl/AcsEvent?format=json`,
      method: 'POST', data: payload,
      username: dev.username, password: dev.password,
      timeout: 30000
    });
    const body = resp.data;
    const ev = body.AcsEvent || {};

    // totalMatches = total keseluruhan; numOfMatches = jumlah di response INI saja.
    // (Firmware lama kadang hanya mengisi numOfMatches — fallback.)
    if (total === null) total = parseInt(ev.totalMatches ?? ev.numOfMatches) || 0;

    // Tidak ada event
    if (ev.responseStatusStrg === 'NO MATCH') break;

    const raw  = ev.InfoList || [];
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    list.forEach(e => {
      const sig = e.serialNo != null ? `s${e.serialNo}` : `${e.time}|${getEmpNo(e)}|${e.minor}`;
      if (seenSerial.has(sig)) return;
      seenSerial.add(sig);
      events.push({ ...e, deviceKey: dev.type, deviceLabel: dev.label, deviceIP: dev.ip });
    });

    position += list.length;

    // Stop jika halaman kosong (proteksi dari loop tak terbatas)
    if (list.length === 0) break;

    // 'MORE' = masih ada halaman berikutnya; 'OK' = sudah habis
    more = ev.responseStatusStrg === 'MORE' || position < total;

    if (page % 20 === 0) console.log(`[Events] ${dev.label}: halaman ${page}, posisi ${position}/${total} (${ev.responseStatusStrg})`);

  } while (more && page < MAX_PAGES);

  console.log(`[Events] ${dev.label}: total ${events.length} event diambil (totalMatches=${total})`);
  return events;
}

// ─── Enrich events with user names + explicit WIB times ──────────────────────
function enrichEvent(ev, devMaps) {
  const devMap = devMaps[ev.deviceKey] || new Map();
  const empNo  = getEmpNo(ev);
  const user   = devMap.get(empNo) || {};

  const name = (user.name && user.name.trim()) ? user.name.trim()
             : (ev.name   && ev.name.trim())    ? ev.name.trim()
             : `ID ${empNo || '?'}`;
  // Kunci gabung lintas device: nama ternormalisasi. Event tanpa nama (hanya ID)
  // tidak boleh tergabung antar device karena ID berbeda per device.
  const hasRealName = (user.name && user.name.trim()) || (ev.name && ev.name.trim());
  const nameKey = hasRealName ? normName(name) : `#${ev.deviceKey}:${empNo}`;

  const verifyMode  = getVerifyModeFromMinor(ev.minor);
  const direction   = ev.deviceKey === 'masuk' ? 'Masuk' : 'Keluar';
  const rawUserType = user.userType || ev.userType || 'normal';
  const userType    = rawUserType === 'administrator' ? 'Administrator'
                    : rawUserType === 'visitor'       ? 'Tamu' : 'Normal';

  return {
    // Identitas
    employeeNo:  empNo || '-',
    name,
    nameKey,
    userType,
    // Waktu — semua dalam WIB (UTC+7)
    time:          ev.time,                  // ISO original
    timeFormatted: fmtWIB(ev.time),          // DD/MM/YYYY HH:mm:ss WIB
    date:          fmtDate(ev.time),         // DD/MM/YYYY WIB
    dateKey:       dateKey(ev.time),         // YYYY-MM-DD WIB (untuk sorting)
    timeOnly:      fmtTime(ev.time),         // HH:mm:ss WIB
    dayOfWeek:     dayOfWeek(ev.time),       // Nama hari WIB
    // Akses
    direction,
    verifyMode,
    cardNo:      ev.cardNo || '-',
    doorNo:      ev.doorNo != null ? ev.doorNo : 1,
    cardReaderNo: ev.cardReaderNo || 1,
    // Raw event info (untuk keperluan debug/detail)
    major:       ev.major,
    minor:       ev.minor,
    serialNo:    ev.serialNo,
    verifyNo:    ev.verifyNo ?? null,
    cardType:    ev.cardType ?? null,
    attendanceStatus: (ev.attendanceStatus && ev.attendanceStatus !== 'undefined') ? ev.attendanceStatus : null,
    // Device
    deviceKey:   ev.deviceKey,
    deviceLabel: ev.deviceLabel,
    deviceIP:    ev.deviceIP,
    // User validity
    validEnd: user.Valid?.endTime ? fmtDate(user.Valid.endTime) : '-',
    pictureURL: ev.pictureURL || null
  };
}

// ─── Login / Logout ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASS || 'admin123';
  if (username === validUser && password === validPass) {
    req.session.user = { username, loginAt: new Date().toISOString() };
    return res.json({ success: true, username });
  }
  res.status(401).json({ error: 'Username atau password salah' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session?.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated' });
});

// Protect all other routes
app.use(requireAuth);

// ─── Device Info ─────────────────────────────────────────────────────────────
app.get('/api/devices', async (req, res) => {
  const results = {};
  await Promise.all(Object.entries(DEVICES).map(async ([key, dev]) => {
    try {
      const resp   = await digestRequest({ url: `http://${dev.ip}/ISAPI/System/deviceInfo`, username: dev.username, password: dev.password });
      const parsed = await parseXML(resp.data);
      const info   = parsed.DeviceInfo || {};
      results[key] = {
        label: dev.label, ip: dev.ip,
        deviceName: info.deviceName || '-',
        model:      info.model      || '-',
        serialNumber: info.serialNumber || '-',
        firmwareVersion: info.firmwareVersion || '-',
        hardwareVersion: info.hardwareVersion || '-',
        status: 'online'
      };
    } catch (err) {
      results[key] = { label: dev.label, ip: dev.ip, status: 'offline', error: err.message };
    }
  }));
  res.json(results);
});

// ─── Debug: Raw Events (untuk diagnosa data hilang) ──────────────────────────
app.post('/api/debug/events', async (req, res) => {
  try {
    const { startDate, endDate, device = 'all' } = req.body;
    const targets = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);
    const summary = {};
    for (const dev of targets) {
      try {
        const events = await fetchAllEvents(dev, startDate, endDate);
        const minorCounts = {};
        events.forEach(ev => {
          const k = `${ev.minor}`;
          minorCounts[k] = (minorCounts[k] || 0) + 1;
        });
        const valid   = events.filter(ev => isValidAccess(ev));
        const invalid = events.filter(ev => !isValidAccess(ev));
        summary[dev.type] = {
          label:        dev.label,
          totalRaw:     events.length,
          totalValid:   valid.length,
          totalInvalid: invalid.length,
          minorBreakdown: minorCounts,
          sampleValid:  valid.slice(0,3).map(e => ({ empNo: getEmpNo(e), minor: e.minor, time: e.time })),
          sampleInvalid:invalid.slice(0,3).map(e => ({ empNo: getEmpNo(e), minor: e.minor, time: e.time }))
        };
      } catch (err) {
        summary[dev.type] = { label: dev.label, error: err.message };
      }
    }
    res.json({ startDate, endDate, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User List ────────────────────────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
  try {
    const cache = await getUserCache(req.query.refresh === '1');
    const result = [];
    // User bernama: sudah digabung lintas device via nameMap (key = nama ternormalisasi)
    for (const m of cache.nameMap.values()) {
      result.push({
        name:        m.name,
        userType:    m.userType,
        devMasukId:  m.ids.masuk  || '-',
        devKeluarId: m.ids.keluar || '-',
        validEnd:    m.valid?.endTime ? fmtDate(m.valid.endTime) : '-'
      });
    }
    // User tanpa nama: tampilkan per device (tidak bisa digabung — ID beda tiap device)
    for (const [key, devMap] of Object.entries(cache.devMaps)) {
      for (const [empNo, user] of devMap.entries()) {
        if (user.name?.trim()) continue;
        result.push({
          name:        `ID ${empNo} (${DEVICES[key]?.label || key})`,
          userType:    user.userType || 'normal',
          devMasukId:  key === 'masuk'  ? empNo : '-',
          devKeluarId: key === 'keluar' ? empNo : '-',
          validEnd:    user.Valid?.endTime ? fmtDate(user.Valid.endTime) : '-'
        });
      }
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: result, total: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Attendance Events ────────────────────────────────────────────────────────
app.post('/api/attendance', async (req, res) => {
  try {
    const { startDate, endDate, device = 'all', page = 1, pageSize = 25, filterName = '' } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });


    const targets = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);

    // Fetch user cache + events in parallel
    const [cache, ...eventResults] = await Promise.all([
      getUserCache(),
      ...targets.map(dev => fetchAllEvents(dev, startDate, endDate).catch(err => {
        console.error(`[Events] ${dev.label}: ${err.message}`);
        return [];
      }))
    ]);

    // Filter hanya event autentikasi valid (bukan door sensor minor 21/22)
    const raw = eventResults.flat().filter(ev => isValidAccess(ev));
    let allEvents = raw.map(ev => enrichEvent(ev, cache.devMaps));
    allEvents.sort((a, b) => `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`));

    // Filter by name if provided
    if (filterName) {
      const q = filterName.toLowerCase();
      allEvents = allEvents.filter(e => e.name.toLowerCase().includes(q));
    }

    // Stats
    const stats = {
      totalEvents: allEvents.length,
      totalMasuk:  allEvents.filter(e => e.deviceKey === 'masuk').length,
      totalKeluar: allEvents.filter(e => e.deviceKey === 'keluar').length,
      uniqueUsers: [...new Set(allEvents.map(e => e.nameKey))].length,
      uniqueDays:  [...new Set(allEvents.map(e => e.date))].length
    };

    // Paginate
    const total    = allEvents.length;
    const startIdx = (page - 1) * pageSize;
    const paged    = allEvents.slice(startIdx, startIdx + pageSize);

    res.json({ data: paged, total, page, pageSize, totalPages: Math.ceil(total / pageSize), stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Rekap per Karyawan ───────────────────────────────────────────────────────
app.post('/api/rekap', async (req, res) => {
  try {
    const { startDate, endDate, device = 'all' } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'Rentang tanggal wajib diisi' });

    const targets  = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);

    const [cache, ...eventResults] = await Promise.all([
      getUserCache(),
      ...targets.map(dev => fetchAllEvents(dev, startDate, endDate).catch(() => []))
    ]);

    // Filter: hanya event autentikasi valid (bukan door sensor minor 21/22)
    const allEvents = eventResults.flat()
      .filter(ev => isValidAccess(ev))
      .map(ev => enrichEvent(ev, cache.devMaps));
    allEvents.sort((a, b) => `${a.dateKey}T${a.timeOnly}`.localeCompare(`${b.dateKey}T${b.timeOnly}`));

    // Group lintas device berdasarkan nama ternormalisasi (ID beda tiap device)
    const grouped = new Map();
    allEvents.forEach(ev => {
      const key = ev.nameKey || normName(ev.name);
      if (!grouped.has(key)) {
        grouped.set(key, {
          name:          ev.name,
          userType:      ev.userType,
          ids:           { masuk: new Set(), keluar: new Set() },  // ID karyawan per device
          totalMasuk:    0,
          totalKeluar:   0,
          days:          new Set(),   // YYYY-MM-DD untuk sort benar
          firstMasukISO: null,
          lastKeluarISO: null,
          events:        []
        });
      }
      const g = grouped.get(key);
      if (ev.employeeNo && ev.employeeNo !== '-') g.ids[ev.deviceKey]?.add(ev.employeeNo);
      if (ev.deviceKey === 'masuk') {
        g.totalMasuk++;
        if (!g.firstMasukISO || new Date(ev.time) < new Date(g.firstMasukISO)) g.firstMasukISO = ev.time;
      } else {
        g.totalKeluar++;
        if (!g.lastKeluarISO || new Date(ev.time) > new Date(g.lastKeluarISO)) g.lastKeluarISO = ev.time;
      }
      g.days.add(ev.dateKey);   // pakai YYYY-MM-DD agar sort benar
      g.events.push(ev);
    });

    const result = [...grouped.values()].map(g => {
      const daysSorted = [...g.days].sort(); // YYYY-MM-DD sort benar lintas bulan
      // Konversi ke DD/MM/YYYY untuk display
      const daysDisplay = daysSorted.map(dk => {
        const [y, m, d2] = dk.split('-');
        return `${d2}/${m}/${y}`;
      });
      return {
        name:        g.name,
        userType:    g.userType,
        idMasuk:     [...g.ids.masuk].join(', ')  || '-',
        idKeluar:    [...g.ids.keluar].join(', ') || '-',
        totalEvents: g.totalMasuk + g.totalKeluar,
        totalMasuk:  g.totalMasuk,
        totalKeluar: g.totalKeluar,
        hariHadir:   g.days.size,
        days:        daysDisplay,          // DD/MM/YYYY untuk display
        daysKey:     daysSorted,           // YYYY-MM-DD untuk referensi
        firstMasuk:  g.firstMasukISO ? fmtWIBShort(g.firstMasukISO) : '-',
        lastKeluar:  g.lastKeluarISO  ? fmtWIBShort(g.lastKeluarISO) : '-',
        perHari:     computePerHari(g.events)
      };
    });

    result.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: result, total: result.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function computePerHari(events) {
  const byDay = {};
  events.forEach(ev => {
    const key     = ev.dateKey || ev.date;   // YYYY-MM-DD — sortable
    const display = ev.date;                  // DD/MM/YYYY — tampil
    if (!byDay[key]) {
      byDay[key] = {
        dateKey:    key,
        date:       display,
        dayOfWeek:  ev.dayOfWeek,
        masukList:  [],
        keluarList: []
      };
    }
    if (ev.deviceKey === 'masuk') byDay[key].masukList.push(ev.timeOnly);
    else                           byDay[key].keluarList.push(ev.timeOnly);
  });

  return Object.values(byDay)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))  // sort YYYY-MM-DD benar lintas bulan
    .map(d => {
      const masukSorted  = [...d.masukList].sort();
      const keluarSorted = [...d.keluarList].sort();
      // Durasi kasar: jam masuk pertama → jam keluar terakhir
      const durMenit = (() => {
        if (!masukSorted.length || !keluarSorted.length) return null;
        const [hm, mm, sm] = masukSorted[0].split(':').map(Number);
        const [hk, mk, sk] = keluarSorted[keluarSorted.length-1].split(':').map(Number);
        const diff = (hk*60+mk) - (hm*60+mm);
        return diff > 0 ? diff : null;
      })();
      return {
        dateKey:     d.dateKey,
        date:        d.date,
        dayOfWeek:   d.dayOfWeek,
        jamMasuk:    masukSorted[0]                        || '-',
        jamKeluar:   keluarSorted[keluarSorted.length - 1] || '-',
        semuaMasuk:  masukSorted,
        semuaKeluar: keluarSorted,
        totalMasuk:  masukSorted.length,
        totalKeluar: keluarSorted.length,
        totalAkses:  masukSorted.length + keluarSorted.length,
        durasi:      durMenit ? `${Math.floor(durMenit/60)}j ${durMenit%60}m` : '-'
      };
    });
}

// ─── Export Excel ─────────────────────────────────────────────────────────────
app.post('/api/export/excel', async (req, res) => {
  try {
    const { startDate, endDate, device = 'all', filterName = '' } = req.body;
    const targets  = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);

    const [cache, ...evResults] = await Promise.all([
      getUserCache(),
      ...targets.map(dev => fetchAllEvents(dev, startDate, endDate).catch(() => []))
    ]);
    let allEvents = evResults.flat()
      .filter(ev => isValidAccess(ev))
      .map(ev => enrichEvent(ev, cache.devMaps));
    allEvents.sort((a, b) => `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`));
    if (filterName) {
      const q = filterName.toLowerCase();
      allEvents = allEvents.filter(e => e.name.toLowerCase().includes(q));
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Fingerprint System';
    wb.created = new Date();

    // ── Sheet 1: Detail ──
    const ws = wb.addWorksheet('Detail Absensi', { pageSetup: { paperSize: 9, orientation: 'landscape' } });

    const titleStyle = { font: { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }, alignment: { horizontal: 'center', vertical: 'middle' } };
    const subStyle   = { font: { italic: true, size: 10, color: { argb: 'FF475569' } }, alignment: { horizontal: 'center' } };
    const headStyle  = { font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: { top:{style:'thin',color:{argb:'FF93C5FD'}}, bottom:{style:'thin',color:{argb:'FF93C5FD'}}, left:{style:'thin',color:{argb:'FF93C5FD'}}, right:{style:'thin',color:{argb:'FF93C5FD'}} } };
    const borderLight = { bottom:{style:'hair',color:{argb:'FFE2E8F0'}}, left:{style:'thin',color:{argb:'FFE2E8F0'}}, right:{style:'thin',color:{argb:'FFE2E8F0'}} };

    ws.mergeCells('A1:K1'); Object.assign(ws.getCell('A1'), { value: 'LAPORAN DETAIL ABSENSI FINGERPRINT', ...titleStyle }); ws.getRow(1).height = 36;
    ws.mergeCells('A2:K2'); Object.assign(ws.getCell('A2'), { value: `Periode: ${fmtDateLong(startDate)} — ${fmtDateLong(endDate)} | Total: ${allEvents.length} record | Dicetak: ${nowWIB('short')}`, ...subStyle }); ws.getRow(2).height = 20;
    ws.getRow(3).height = 5;

    const heads = ['No', 'Nama Karyawan', 'Tipe', 'Tanggal', 'Hari', 'Jam', 'Arah', 'Mode Verifikasi', 'No. Pintu', 'ID (Masuk)', 'Device'];
    const headerRow = ws.addRow(heads);
    headerRow.height = 28;
    headerRow.eachCell(cell => Object.assign(cell, headStyle));

    allEvents.forEach((ev, idx) => {
      const isEven   = idx % 2 === 0;
      const isMasuk  = ev.deviceKey === 'masuk';
      const row = ws.addRow([
        idx + 1,
        ev.name,
        ev.userType,
        ev.date,
        ev.dayOfWeek,
        ev.timeOnly,
        ev.direction,
        ev.verifyMode,
        ev.doorNo,
        ev.employeeNo,
        ev.deviceLabel
      ]);
      row.height = 22;
      row.eachCell((cell, col) => {
        cell.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'center' : 'left' };
        cell.font    = { size: 10 };
        cell.border  = borderLight;
      });
      // Color: nama bold, direction colored
      row.getCell(2).font  = { bold: true, size: 10 };
      row.getCell(7).font  = { bold: true, size: 10, color: { argb: isMasuk ? 'FF16A34A' : 'FFDC2626' } };
      row.getCell(11).font = { bold: true, size: 10, color: { argb: isMasuk ? 'FF16A34A' : 'FFDC2626' } };
    });

    [5, 22, 14, 14, 10, 10, 10, 20, 10, 12, 22].forEach((w, i) => ws.getColumn(i + 1).width = w);

    // ── Sheet 2: Rekap per Karyawan ──
    const wsR = wb.addWorksheet('Rekap Karyawan');
    wsR.mergeCells('A1:H1'); Object.assign(wsR.getCell('A1'), { value: 'REKAP ABSENSI PER KARYAWAN', ...titleStyle }); wsR.getRow(1).height = 30;
    wsR.mergeCells('A2:H2'); Object.assign(wsR.getCell('A2'), { value: `Periode: ${fmtDateShort(startDate)} — ${fmtDateShort(endDate)}`, ...subStyle }); wsR.getRow(2).height = 18;
    wsR.getRow(3).height = 5;

    const headsR = ['No','Nama Karyawan','Tipe','Hari Hadir','Total Masuk','Total Keluar','Pertama Masuk','Terakhir Keluar'];
    const hrRow  = wsR.addRow(headsR);
    hrRow.height = 26; hrRow.eachCell(cell => Object.assign(cell, headStyle));

    // Group for rekap — lintas device berdasarkan nama ternormalisasi
    const grouped = new Map();
    allEvents.forEach(ev => {
      const key = ev.nameKey || normName(ev.name);
      if (!grouped.has(key)) grouped.set(key, { name: ev.name, userType: ev.userType, masuk:[], keluar:[], days: new Set() });
      const g = grouped.get(key);
      if (ev.deviceKey === 'masuk') g.masuk.push(ev.time); else g.keluar.push(ev.time);
      g.days.add(ev.date);
    });
    [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name)).forEach((g, i) => {
      const masukSorted  = g.masuk.sort();
      const keluarSorted = g.keluar.sort();
      const row = wsR.addRow([
        i + 1, g.name, g.userType, g.days.size,
        g.masuk.length, g.keluar.length,
        masukSorted[0]  ? fmtWIBShort(masukSorted[0])  : '-',
        keluarSorted[keluarSorted.length-1] ? fmtWIBShort(keluarSorted[keluarSorted.length-1]) : '-'
      ]);
      row.height = 22;
      const isEven = i % 2 === 0;
      row.eachCell((cell, col) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: col <= 3 || col >= 7 ? 'left' : 'center' };
        cell.font  = { size: 10 };
        cell.border = borderLight;
      });
      row.getCell(2).font = { bold: true, size: 10 };
    });
    [5,22,12,12,13,13,20,20].forEach((w,i) => wsR.getColumn(i+1).width = w);

    // ── Sheet 3: Ringkasan ──
    const wsS = wb.addWorksheet('Ringkasan');
    wsS.getColumn(1).width = 30; wsS.getColumn(2).width = 25;
    wsS.mergeCells('A1:B1'); Object.assign(wsS.getCell('A1'), { value: 'RINGKASAN', ...titleStyle }); wsS.getRow(1).height = 28;
    const masukCount  = allEvents.filter(e => e.deviceKey === 'masuk').length;
    const keluarCount = allEvents.filter(e => e.deviceKey === 'keluar').length;
    const uniqNames   = [...new Set(allEvents.map(e => e.nameKey))].length;
    [
      ['Periode', `${fmtDateShort(startDate)} — ${fmtDateShort(endDate)}`],
      ['Total Semua Absensi', allEvents.length],
      ['Total Masuk', masukCount],
      ['Total Keluar', keluarCount],
      ['Karyawan Unik', uniqNames],
      ['Hari Kerja Unik', [...new Set(allEvents.map(e => e.date))].length],
      ['Dicetak Pada', nowWIB()]
    ].forEach(([label, val]) => {
      const r = wsS.addRow([label, val]);
      r.getCell(1).font = { bold: true, size: 11 };
      r.getCell(2).font = { size: 11 };
      r.height = 24;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${startDate}-${endDate}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Export PDF ───────────────────────────────────────────────────────────────
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { startDate, endDate, device = 'all', filterName = '' } = req.body;
    const targets  = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);

    const [cache, ...evResults] = await Promise.all([
      getUserCache(),
      ...targets.map(dev => fetchAllEvents(dev, startDate, endDate).catch(() => []))
    ]);
    let allEvents = evResults.flat()
      .filter(ev => isValidAccess(ev))
      .map(ev => enrichEvent(ev, cache.devMaps));
    allEvents.sort((a, b) => `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`));
    if (filterName) { const q = filterName.toLowerCase(); allEvents = allEvents.filter(e => e.name.toLowerCase().includes(q)); }

    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${startDate}-${endDate}.pdf"`);
    doc.pipe(res);

    const W = doc.page.width, M = 36;

    // Header
    doc.rect(0, 0, W, 72).fill('#1E40AF');
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold')
      .text('LAPORAN ABSENSI FINGERPRINT', M, 16, { align: 'center', width: W - M * 2 });
    doc.fontSize(9).font('Helvetica')
      .text(`Periode: ${fmtDateLong(startDate)} — ${fmtDateLong(endDate)}  |  Dicetak: ${nowWIB('short')}`, M, 44, { align: 'center', width: W - M * 2 });

    // Stats
    const masukC  = allEvents.filter(e => e.deviceKey === 'masuk').length;
    const keluarC = allEvents.filter(e => e.deviceKey === 'keluar').length;
    const uniqC   = [...new Set(allEvents.map(e => e.nameKey))].length;
    let sy = 84;
    [
      { label:'Total Absensi', value: allEvents.length, color:'#1D4ED8' },
      { label:'Total Masuk',   value: masukC,           color:'#15803D' },
      { label:'Total Keluar',  value: keluarC,          color:'#B91C1C' },
      { label:'Karyawan Unik', value: uniqC,            color:'#7C3AED' }
    ].forEach((s, i) => {
      const x = M + i * 172;
      doc.roundedRect(x, sy, 160, 44, 6).fill(s.color);
      doc.fillColor('white').fontSize(20).font('Helvetica-Bold').text(String(s.value), x, sy + 4, { width: 160, align: 'center' });
      doc.fontSize(8).font('Helvetica').text(s.label, x, sy + 28, { width: 160, align: 'center' });
    });

    // Table
    let ty = sy + 56;
    const cols = [28, 110, 60, 66, 50, 50, 42, 88, 28, 100];
    const headsTxt = ['No', 'Nama Karyawan', 'Tipe', 'Tanggal', 'Hari', 'Jam', 'Arah', 'Verifikasi', 'Pintu', 'Device'];
    const tableW = cols.reduce((a, b) => a + b, 0);

    const drawTableHeader = (y) => {
      doc.rect(M, y, tableW, 20).fill('#1E3A8A');
      let cx = M;
      headsTxt.forEach((h, i) => {
        doc.fillColor('white').fontSize(7.5).font('Helvetica-Bold').text(h, cx + 2, y + 5, { width: cols[i] - 4, align: 'center' });
        cx += cols[i];
      });
      return y + 20;
    };

    ty = drawTableHeader(ty);

    allEvents.forEach((ev, idx) => {
      if (ty > doc.page.height - 48) {
        doc.addPage({ layout: 'landscape' });
        ty = 36;
        ty = drawTableHeader(ty);
      }
      const rowH = 16;
      doc.rect(M, ty, tableW, rowH).fill(idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF');
      const isMasuk = ev.deviceKey === 'masuk';
      const cells = [idx+1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly, ev.direction, ev.verifyMode, ev.doorNo, ev.deviceLabel];
      let cx = M;
      cells.forEach((val, i) => {
        const isMasukC = i === 6 || i === 9;
        doc.fillColor(isMasukC ? (isMasuk ? '#15803D' : '#B91C1C') : '#0F172A')
          .fontSize(7).font(i === 1 || isMasukC ? 'Helvetica-Bold' : 'Helvetica')
          .text(String(val), cx + 2, ty + 4, { width: cols[i] - 4, align: i === 0 || i === 8 ? 'center' : 'left', ellipsis: true });
        cx += cols[i];
      });
      doc.rect(M, ty, tableW, rowH).stroke('#E2E8F0');
      ty += rowH;
    });

    doc.fillColor('#94A3B8').fontSize(7).font('Helvetica')
      .text(`Fingerprint Attendance System — ${nowWIB()} WIB`, M, doc.page.height - 24, { align: 'center', width: W - M * 2 });
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Export CSV ───────────────────────────────────────────────────────────────
app.post('/api/export/csv', async (req, res) => {
  try {
    const { startDate, endDate, device = 'all', filterName = '' } = req.body;
    const targets  = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);

    const [cache, ...evResults] = await Promise.all([
      getUserCache(),
      ...targets.map(dev => fetchAllEvents(dev, startDate, endDate).catch(() => []))
    ]);
    let allEvents = evResults.flat()
      .filter(ev => isValidAccess(ev))
      .map(ev => enrichEvent(ev, cache.devMaps));
    allEvents.sort((a, b) => `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`));
    if (filterName) { const q = filterName.toLowerCase(); allEvents = allEvents.filter(e => e.name.toLowerCase().includes(q)); }

    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const heads = ['No','Nama Karyawan','Tipe Karyawan','Tanggal','Hari','Jam','Arah','Mode Verifikasi','No. Pintu','ID di Device','Device','IP Device'];
    const lines = [heads.map(esc).join(',')];
    allEvents.forEach((ev, i) => lines.push([
      i+1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly,
      ev.direction, ev.verifyMode, ev.doorNo, ev.employeeNo, ev.deviceLabel, ev.deviceIP
    ].map(esc).join(',')));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${startDate}-${endDate}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Send Email ───────────────────────────────────────────────────────────────
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, message, startDate, endDate, device = 'all', includeExcel = true } = req.body;
    if (!to) return res.status(400).json({ error: 'Alamat email tujuan wajib diisi' });
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
      return res.status(400).json({ error: 'Konfigurasi SMTP belum diisi di file .env' });

    const targets  = device === 'all' ? Object.values(DEVICES) : [DEVICES[device]].filter(Boolean);

    const [cache, ...evResults] = await Promise.all([
      getUserCache(),
      ...targets.map(dev => fetchAllEvents(dev, startDate, endDate).catch(() => []))
    ]);
    const allEvents = evResults.flat()
      .filter(ev => isValidAccess(ev))
      .map(ev => enrichEvent(ev, cache.devMaps));
    allEvents.sort((a, b) => `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`));

    const masukC  = allEvents.filter(e => e.deviceKey === 'masuk').length;
    const keluarC = allEvents.filter(e => e.deviceKey === 'keluar').length;
    const uniqC   = [...new Set(allEvents.map(e => e.nameKey))].length;

    const attachments = [];
    if (includeExcel) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Absensi');
      ws.addRow(['No','Nama Karyawan','Tipe','Tanggal','Hari','Jam','Arah','Verifikasi','Pintu','Device']);
      allEvents.forEach((ev, i) => ws.addRow([i+1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly, ev.direction, ev.verifyMode, ev.doorNo, ev.deviceLabel]));
      [5,22,12,14,10,10,10,20,8,22].forEach((w,i) => ws.getColumn(i+1).width = w);
      const buf = await wb.xlsx.writeBuffer();
      attachments.push({ filename: `absensi-${startDate}-${endDate}.xlsx`, content: buf, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT)||587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:20px}
.c{max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)}
.h{background:#1e40af;color:#fff;padding:28px;text-align:center}
.h h1{margin:0;font-size:20px}.h p{margin:6px 0 0;opacity:.8;font-size:13px}
.s{display:flex;gap:10px;padding:20px;background:#f1f5f9}
.sc{flex:1;background:#fff;border-radius:8px;padding:14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.sc .n{font-size:26px;font-weight:700;color:#1e40af}.sc .l{font-size:11px;color:#64748b;margin-top:3px}
.b{padding:20px}.b p{color:#374151;line-height:1.6;font-size:14px}
.f{background:#f8fafc;padding:14px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}
</style></head><body><div class="c">
<div class="h"><h1>Laporan Absensi Fingerprint</h1><p>Periode: ${fmtDateLong(startDate)} — ${fmtDateLong(endDate)}</p></div>
<div class="s">
<div class="sc"><div class="n">${allEvents.length}</div><div class="l">Total Absensi</div></div>
<div class="sc"><div class="n">${masukC}</div><div class="l">Total Masuk</div></div>
<div class="sc"><div class="n">${keluarC}</div><div class="l">Total Keluar</div></div>
<div class="sc"><div class="n">${uniqC}</div><div class="l">Karyawan Unik</div></div>
</div>
<div class="b"><p>${message||'Terlampir laporan absensi fingerprint untuk periode yang dimaksud.'}</p>${attachments.length?'<p>📎 File Excel terlampir.</p>':''}</div>
<div class="f">Dikirim otomatis oleh Fingerprint Attendance System • ${nowWIB('short')} WIB</div>
</div></body></html>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, to,
      subject: subject || `Laporan Absensi ${fmtDateShort(startDate)} — ${fmtDateShort(endDate)}`,
      html, attachments
    });

    res.json({ success: true, message: `Email berhasil dikirim ke ${to}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ✦ Fingerprint Attendance System`);
  console.log(`  ✦ http://localhost:${PORT}`);
  console.log(`  ✦ Login: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASS || 'admin123'}`);
  console.log(`  ✦ Masuk : ${DEVICES.masuk.ip}`);
  console.log(`  ✦ Keluar: ${DEVICES.keluar.ip}\n`);
});
