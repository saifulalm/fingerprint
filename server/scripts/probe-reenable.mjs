// Debug: kenapa re-enable user yang SUDAH disabled ditolak perangkat?
//
// User uji: employeeNo 11 (Brook) di device Keluar — sengaja dikunci disabled
// supaya tidak ada data riil yang rusak.
//
// Hipotesis:
//   - `buildUserPayload()` membaca `user.valid` (kita saat ini false) lalu
//     payload override Valid.enable=true — mungkin ada field lain yang juga
//     ikut ter-disable (mis. privilege/rightPermission) sehingga perangkat
//     menolak.
//   - Mungkin perangkat butuh waktu setelah disable.
//   - Mungkin ada field yang harus保持 apa adanya.
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

const before = await searchUser();
console.log('=== User saat ini di perangkat ===');
console.log(JSON.stringify(before, null, 1));

const begin = before?.Valid?.beginTime || '1970-01-01T08:00:00+08:00';
const end = before?.Valid?.endTime || '2037-12-31T23:59:59+08:00';

const base = {
  employeeNo: NO, name: before.name || 'Brook', userType: before.userType || 'normal',
  closeDelayEnabled: false,
  Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end },
  password: '', doorRight: before.doorRight != null ? String(before.doorRight) : '1',
  RightPlan: Array.isArray(before.RightPlan) && before.RightPlan.length ? before.RightPlan : [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, cardIndex: 0, fingerprintIndex: 0,
  faceUrl: '', cardNo: before.cardNo || '', fingerprintUrl: '',
  validEnd: end, groupId: '1', invalidUserType: 'invalid',
  firstTime: begin, lastTime: end,
};

async function attempt(label, payload) {
  try {
    const rr = await req({
      url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
      method: 'PUT', data: { UserInfo: payload },
    });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 90)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    return false;
  }
}

console.log('\n═══ A. Coba re-enable dengan beberapa bentuk Valid ═══');
await attempt('Valid{enable:true, begin, end}', { ...base });
await attempt('Valid tanpa beginTime', { ...base, Valid: { enable: true, timeType: 'UTC', endTime: end } });
await attempt('Valid{enable:true} tanpa endTime', { ...base, Valid: { enable: true, timeType: 'UTC', beginTime: begin } });
await attempt('Valid{enable:"true"} string', { ...base, Valid: { enable: 'true', timeType: 'UTC', beginTime: begin, endTime: end } });
await attempt('tanpa field privilege/rightPermission', (() => {
  const p = { ...base };
  delete p.privilege; delete p.rightPermission;
  return p;
})());
await attempt('invalidUserType normal', { ...base, invalidUserType: 'normal' });
await attempt('localUIRight dari perangkat', { ...base, localUIRight: before.localUIRight ?? true });

await new Promise((r) => setTimeout(r, 1500));
const after = await searchUser();
console.log(`\n=== Sesudah: valid = ${JSON.stringify(after?.Valid)} ===`);
