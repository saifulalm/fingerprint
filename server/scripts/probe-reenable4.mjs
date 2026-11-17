// Debug 4 — konfirmasi root cause re-enable.
//
// Hipotesis: yang DITOLAK bukan `enable=true`, melainkan `Valid.endTime`.
//
// Bukti yang sudah terkumpul:
//   enable=true + endTime 2038-01-01T07:59:59+08:00 → badParameters
//   enable=true + endTime 2037-12-31T23:59:59+08:00 → 200 OK
//   enable=true + endTime 2030-12-31T23:59:59+08:00 → 200 OK
//   enable=false + endTime 2038-01-01T07:59:59+08:00 → 200 OK
//
// Kesimpulan sementara: endTime 2038-01-01T07:59:59+08:00 (= 2037-12-31T23:59:59Z)
// adalah batas maksimum representasi 32-bit yang dipakai perangkat. Saat user
// dinonaktifkan, perangkat MEMBATAS endTime ke batas itu. Mengirim ulang batas
// itu dengan enable=true ditolak.
//
// Uji konfirmasi: dengan user 11 sekarang AKTIF (enable=true), kirim
// endTime batas itu dan lihat apakah ditolak — kalau ditolak, root cause
// terkonfirmasi ada di endTime, bukan di flag enable.
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../src/config/index.js';

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req({ url, method = 'GET', data = null, timeout = 10000 }) {
  const build = (auth) => {
    const cfg = { method, url, timeout, headers: {} };
    if (data !== null) { cfg.data = data; cfg.headers['Content-Type'] = 'application/json'; }
    if (auth) cfg.headers['Authorization'] = auth;
    return cfg;
  };
  try { return await axios(build(null)); }
  catch (err) {
    if (!err.response || err.response.status !== 401) throw err;
    const w = err.response.headers['www-authenticate'] || '';
    const realm = (w.match(/realm="([^"]+)"/) || [])[1] || '';
    const nonce = (w.match(/nonce="([^"]+)"/) || [])[1] || '';
    const qop = (w.match(/qop="?([^",\s]+)"?/) || [])[1] || null;
    const urlObj = new URL(url);
    const uri = urlObj.pathname + urlObj.search;
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${DEV.username}:${realm}:${DEV.password}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="${DEV.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    auth += `, response="${resp}"`;
    return axios(build(auth));
  }
}

const DEV = config.devices.keluar;
const NO = '11';

async function searchUser() {
  const sid = 'v' + Date.now();
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
    method: 'POST',
    data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 300 } },
  });
  const ui = rr.data.UserInfoSearch || {};
  const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
  return list.find((u) => String(u.employeeNo) === NO);
}

function errInfo(e) {
  const d = e.response?.data;
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 150) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

const u = await searchUser();
console.log('User saat ini:', JSON.stringify(u.Valid));

const mk = (valid) => ({
  employeeNo: NO, name: u.name, userType: u.userType || 'normal',
  closeDelayEnabled: u.closeDelayEnabled ?? false,
  Valid: valid,
  password: '', doorRight: String(u.doorRight ?? '1'),
  RightPlan: u.RightPlan?.length ? u.RightPlan : [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: u.localUIRight ?? true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, cardIndex: 0, fingerprintIndex: 0,
  faceUrl: '', cardNo: u.cardNo || '', fingerprintUrl: '',
  validEnd: valid.endTime, groupId: '1', invalidUserType: 'invalid',
  firstTime: valid.beginTime, lastTime: valid.endTime,
});

async function attempt(label, valid) {
  try {
    const rr = await req({
      url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
      method: 'PUT', data: { UserInfo: mk(valid) },
    });
    console.log(`  ✅ [${label}] → ${rr.status}`);
    await new Promise((r) => setTimeout(r, 1200));
    console.log(`     → valid sekarang: ${JSON.stringify((await searchUser())?.Valid)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    return false;
  }
}

const B = '1970-01-01T08:00:00+08:00';

console.log('\n═══ Konfirmasi: endTime batas vs endTime aman (enable=true) ═══');
await attempt('enable=true + endTime BATAS 2038-01-01T07:59:59+08:00',
  { enable: true, timeType: 'UTC', beginTime: B, endTime: '2038-01-01T07:59:59+08:00' });
await attempt('enable=true + endTime AMAN 2037-12-31T23:59:59+08:00',
  { enable: true, timeType: 'UTC', beginTime: B, endTime: '2037-12-31T23:59:59+08:00' });

console.log('\n═══ Konfirmasi: endTime batas dengan enable=false ═══');
await attempt('enable=false + endTime BATAS',
  { enable: false, timeType: 'UTC', beginTime: B, endTime: '2038-01-01T07:59:59+08:00' });

console.log('\n═══ Kembalikan ke kondisi semula: enable=true, endTime 2037-12-31 ═══');
await attempt('FINAL enable=true + endTime 2037-12-31T23:59:59+08:00',
  { enable: true, timeType: 'UTC', beginTime: B, endTime: '2037-12-31T23:59:59+08:00' });

const fin = await searchUser();
console.log(`\n=== FINAL user 11: ${JSON.stringify(fin?.Valid)} name=${fin?.name} ===`);
