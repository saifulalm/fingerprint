// Hikvision ISAPI integration service — short timeout + demo fallback
import axios from 'axios';
import crypto from 'crypto';
import xml2js from 'xml2js';
import { config } from '../config/index.js';

// ─── Demo data (used when devices unreachable) ─────────────────────────────────────
export function getDemoEvents(deviceKey) {
  const now = new Date();
  const events = [];
  const names = [
    { name: 'Ahmad Fauzi', emp: '1001', mode: 38 },
    { name: 'Rina Kusuma', emp: '1002', mode: 35 },
    { name: 'Budi Santoso', emp: '1003', mode: 37 },
    { name: 'Siti Nurhaliza', emp: '1004', mode: 35 },
    { name: 'Dedi Kurniawan', emp: '1005', mode: 38 },
    { name: 'Wati Lestari', emp: '1006', mode: 72 },
    { name: 'Agus Prasetyo', emp: '1007', mode: 37 },
    { name: 'Dewi Safitri', emp: '1008', mode: 36 },
  ];
  const devs = Object.values(config.devices);
  for (let day = 6; day >= 0; day--) {
    const d = new Date(now);
    d.setDate(d.getDate() - day);
    for (const emp of names) {
      if (Math.random() > 0.2) {
        const hi = new Date(d); hi.setHours(7, Math.floor(Math.random() * 30) + 30, 0);
        events.push({ deviceKey: 'masuk', time: hi.toISOString(), major: 5, minor: emp.mode, employeeNoString: emp.emp, name: emp.name });
      }
      if (Math.random() > 0.3) {
        const ho = new Date(d); ho.setHours(17, Math.floor(Math.random() * 30) + 0, 0);
        events.push({ deviceKey: 'keluar', time: ho.toISOString(), major: 5, minor: emp.mode, employeeNoString: emp.emp, name: emp.name });
      }
    }
  }
  return events;
}

// ─── Minor → verify mode ──────────────────────────────────────────────────────────────
export const VERIFY_MODE_MAP = {
  1:'Normal', 35:'Kartu', 36:'Password', 37:'Fingerprint (Paksa)', 38:'Fingerprint',
  39:'FP + Kartu', 40:'FP + Password', 41:'Kartu + Password', 42:'FP + Kartu + PW',
  43:'Duress FP', 44:'Password Super', 72:'Wajah', 73:'Wajah + Kartu',
  74:'Wajah + PW', 75:'Wajah + FP', 76:'Kartu + FP', 77:'Wajah + Kartu + FP',
  78:'Wajah + Kartu + PW', 79:'Wajah + FP + PW', 80:'Wajah (Multi)',
  196:'Fingerprint', 255:'Akses',
};
export function getVerifyModeFromMinor(minor) {
  return VERIFY_MODE_MAP[parseInt(minor)] || (minor != null ? `Mode ${minor}` : '-');
}
export const MINOR_LABELS = {
  1:'Normal', 35:'Kartu', 36:'Password', 37:'Fingerprint', 38:'Fingerprint',
  39:'FP+Kartu', 40:'FP+PW', 41:'Kartu+PW', 42:'FP+Kartu+PW',
  43:'Duress FP', 44:'PW Super', 72:'Wajah', 73:'Wajah+Kartu',
  75:'Wajah+FP', 76:'Kartu+FP', 78:'Wajah+Kartu+PW', 80:'Wajah', 196:'Fingerprint', 255:'Akses',
};
export function getMinorLabel(minor) {
  return MINOR_LABELS[parseInt(minor)] || (minor != null ? `Mode ${minor}` : '-');
}

// ─── Digest auth ────────────────────────────────────────────────────────────────
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

// Ekspor digestRequest supaya service admin perangkat (hikvisionAdmin.js)
// memakai MEKANISME AUTENTIKASI YANG SAMA — bukan salinan terpisah.
// Dua implementasi digest yang berbeda pasti akan diverge suatu saat.
export async function digestRequest({ url, method='GET', data=null, username, password, timeout=3000, signal }) {
  const buildCfg = (auth) => {
    const cfg = { method, url, timeout: Math.min(timeout, 5000), headers: {}, signal };
    if (data !== null) { cfg.data = data; cfg.headers['Content-Type'] = 'application/json'; }
    if (auth) cfg.headers['Authorization'] = auth;
    return cfg;
  };
  try {
    return await axios(buildCfg(null));
  } catch (err) {
    if (!err.response || err.response.status !== 401) throw err;
    const w = err.response.headers['www-authenticate'] || '';
    const realm = (w.match(/realm="([^"]+)"/)||[])[1] || '';
    const nonce  = (w.match(/nonce="([^"]+)"/)||[])[1] || '';
    const qop   = (w.match(/qop="?([^",\s]+)"?/)||[])[1] || null;
    const urlObj = new URL(url);
    const uri   = urlObj.pathname + urlObj.search;
    const nc    = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1   = md5(`${username}:${realm}:${password}`);
    const ha2   = md5(`${method.toUpperCase()}:${uri}`);
    const resp  = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    auth += `, response="${resp}"`;
    return axios(buildCfg(auth));
  }
}

async function parseXML(xml) {
  return xml2js.parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false });
}

// ─── Device timezone cache (5 min) ───────────────────────────────────────────────
const _tzCache = {};
export async function getDeviceTz(dev) {
  const cached = _tzCache[dev.type];
  if (cached && Date.now() - cached.ts < 5*60*1000) return cached.offset;
  let offset = config.tzOffset;
  try {
    const resp = await digestRequest({ url: `http://${dev.ip}/ISAPI/System/time`, username: dev.username, password: dev.password, timeout: 3000 });
    const parsed = await parseXML(resp.data);
    const lt = parsed.Time?.localTime || '';
    const m = String(lt).match(/([+-]\d{2}:\d{2})$/);
    if (m) offset = m[1];
  } catch (_) { /* use fallback */ }
  _tzCache[dev.type] = { offset, ts: Date.now() };
  return offset;
}

// ─── Blacklist door sensor events ────────────────────────────────────────────────
const BLACKLIST_MINOR = new Set([18,19,20,21,22,23,24,25,26,27]);
export function isValidAccess(ev) {
  const empNo = String(ev.employeeNoString ?? ev.employeeNo ?? '').trim();
  if (!empNo || empNo === '0') return false;
  if (BLACKLIST_MINOR.has(parseInt(ev.minor))) return false;
  return true;
}
export function getEmpNo(ev) { return String(ev.employeeNoString ?? ev.employeeNo ?? '').trim(); }
export function normName(s) { return String(s||'').trim().replace(/\s+/g,' ').toLowerCase(); }

// ─── Fetch all users from device ────────────────────────────────────────────────
export async function fetchAllUsers(dev) {
  const users = [];
  let position = 0, total = null, more = true;
  const searchID = String(Date.now());
  const MAX_PAGES = 200, pageSize = 30;
  let page = 0;
  do {
    page++;
    try {
      const payload = { UserInfoSearchCond: { searchID, searchResultPosition: position, maxResults: pageSize } };
      const resp = await digestRequest({ url: `http://${dev.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`, method:'POST', data: payload, username: dev.username, password: dev.password, timeout: 5000 });
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
    } catch (_) { break; }
  } while (more && page < MAX_PAGES);
  return users;
}

// ─── Fetch all events (Hikvision AcsEvent — JSON format) ─────────────────────────────
//
// PERBAIKAN PENTING (bug laporan kosong):
//   Sebelumnya `MAX_PAGES = 3` dengan `PAGE_SIZE = 30`, padahal perangkat
//   Hikvision membalas HANYA 10 event per halaman (meski maxResults=30).
//   Akibatnya satu sync hanya menarik ~30 event terbaru per perangkat, dan
//   untuk rentang beberapa hari event hari-hari sebelumnya HILANG — laporan
//   periode panjang selalu kosong/tidak lengkap.
//
//   Perbaikan: pagination berlanjut sampai perangkat benar-benar habis
//   (`responseStatusStrg !== 'MORE'`), dengan batas keras supaya tidak
//   menggantung: MAX_PAGES 200 halaman × 10 event = 2000 event per perangkat.
//
//   Catatan: `searchID` harus SAMA untuk seluruh halaman satu proses.
//   Mengganti searchID antar halaman membuat perangkat mengulang halaman
//   pertama (hasil duplikat), bukan melanjutkan.
export async function fetchAllEvents(dev, startDate, endDate) {
  const events = [];
  const seen = new Set();
  let position = 0;
  const MAX_PAGES = 200; // batas keras: 200 × 10 = 2000 event per perangkat
  const PAGE_SIZE = 30;   // perangkat membalas max 10 event per halaman
  const searchID = `fp${Date.now()}`;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const payload = {
        AcsEventCond: {
          searchID,
          searchResultPosition: position,
          maxResults: PAGE_SIZE,
          major: 0,
          minor: 0,
          startTime: `${startDate}T00:00:00+07:00`,
          endTime:   `${endDate}T23:59:59+07:00`,
        },
      };
      const resp = await digestRequest({
        url: `http://${dev.ip}/ISAPI/AccessControl/AcsEvent?format=json`,
        method: 'POST',
        data: payload,
        username: dev.username,
        password: dev.password,
        timeout: 15000,
      });
      const body = resp.data;
      const evData = body?.AcsEvent || {};
      if (evData.responseStatusStrg === 'NO MATCH' || evData.responseStatusStrg === 'BAD REQUEST') break;

      const rawList = evData.InfoList;
      let list = [];
      if (rawList) {
        if (Array.isArray(rawList)) list = rawList;
        else if (rawList) list = [rawList];
      }
      if (list.length === 0) break;

      list.forEach(e => {
        const sig = e.serialNo != null ? `s${e.serialNo}` : `${e.time}|${getEmpNo(e)}|${e.minor}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        events.push({
          time:              e.time || '',
          major:             e.major ?? 5,
          minor:             e.minor ?? 38,
          employeeNoString:  String(e.employeeNoString ?? e.employeeNo ?? ''),
          name:              e.name || '',
          cardNo:            e.cardNo || '',
          doorNo:            e.doorNo ?? null,
          cardReaderNo:      e.cardReaderNo ?? null,
          cardType:          e.cardType ?? null,
          serialNo:          e.serialNo ?? null,
          deviceKey:         dev.type,
          deviceLabel:       dev.label,
          deviceIP:          dev.ip,
        });
      });

      position += list.length;
      const more = evData.responseStatusStrg === 'MORE';
      if (!more) break;

      // Penjaga tambahan: jika perangkat mengembalikan halaman kosong di tengah,
      // hentikan agar tidak loop tak terbatas.
      if (list.length === 0) break;
    } catch (_err) {
      console.warn(`[Events] ${dev.label}: page ${page} failed — ${_err.message}`);
      break;
    }
  }
  console.log(`[Events] ${dev.label}: ${events.length} events (${startDate}..${endDate})`);
  return events;
}

// ─── Get device info ────────────────────────────────────────────────────────────
export async function getDeviceInfo(dev, signal) {
  try {
    const resp = await digestRequest({ url: `http://${dev.ip}/ISAPI/System/deviceInfo`, username: dev.username, password: dev.password, timeout: 3000, signal });
    const info = (await parseXML(resp.data)).DeviceInfo || {};
    return { label: dev.label, ip: dev.ip, deviceName: info.deviceName||'-', model: info.model||'-', serialNumber: info.serialNumber||'-', firmwareVersion: info.firmwareVersion||'-', hardwareVersion: info.hardwareVersion||'-', status: 'online' };
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'CanceledError') {
      return { label: dev.label, ip: dev.ip, status: 'offline', error: 'Request timed out' };
    }
    return { label: dev.label, ip: dev.ip, status: 'offline', error: err.message };
  }
}
