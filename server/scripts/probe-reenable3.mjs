// Debug 3: kenapa re-enable (Valid.enable=true) ditolak perangkat?
//
// Fakta yang sudah terverifikasi:
//   - enable=false  → 200 OK
//   - enable=true   → 400 badParameters
//   - enable=false tanpa field Valid → 200 OK
//   - timestamp tanpa offset → 400 timeFormatError (layout harus +08:00)
//
// User uji: employeeNo 11 (Brook) di device Keluar — sengaja dikunci disabled
// supaya tidak ada data riil yang rusak.
//
// Hipotesis yang diuji:
//   H1: perangkat menolak karena endTime sudah "membeku" di batas maksimum
//       representasinya (2038-01-01T07:59:59+08:00 = 2037-12-31T23:59:59Z).
//   H2: perangkat menolak karena beginTime 1970 dianggap kedaluwarsa.
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

const mk = (valid, over = {}) => ({
  employeeNo: NO,
  name: u.name,
  userType: u.userType || 'normal',
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
  ...over,
});

async function attempt(label, payload) {
  try {
    const rr = await req({
      url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
      method: 'PUT', data: { UserInfo: payload },
    });
    console.log(`  ✅ [${label}] → ${rr.status}`);
    await new Promise((r) => setTimeout(r, 1200));
    const now = await searchUser();
    console.log(`     → valid sekarang: ${JSON.stringify(now?.Valid)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    return false;
  }
}

console.log('\n═══ H1: endTime lebih dekat (2030) ═══');
await attempt('end 2030-12-31', mk({ enable: true, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2030-12-31T23:59:59+08:00' }));

console.log('\n═══ H2: beginTime sekarang (2026) ═══');
await attempt('begin 2026, end 2037', mk({ enable: true, timeType: 'UTC', beginTime: '2026-01-01T00:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' }));

console.log('\n═══ H3: timeType local, bukan UTC ═══');
await attempt('timeType local', mk({ enable: true, timeType: 'local', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' }));

console.log('\n═══ H4: tanpa field validEnd/firstTime/lastTime (hanya Valid) ═══');
{
  const p = mk({ enable: true, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' });
  delete p.validEnd; delete p.firstTime; delete p.lastTime;
  await attempt('tanpa validEnd/firstTime/lastTime', p);
}

console.log('\n═══ H5: tanpa Valid sama sekali (mungkin device auto-enable) ═══');
{
  const p = mk({ enable: false, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' });
  delete p.Valid;
  await attempt('tanpa Valid', p);
}

console.log('\n═══ H6: device AKTIF dulu dengan user lain untuk tes apakah enable=true pernah berhasil ═══');
console.log('   (user 10 = Ibu Christina, device keluar — hanya dibaca, tidak diubah)');
const other = await req({
  url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
  method: 'POST',
  data: { UserInfoSearchCond: { searchID: 'v' + Date.now(), searchResultPosition: 0, maxResults: 300 } },
});
const list = other.data.UserInfoSearch?.UserInfo;
const arr = Array.isArray(list) ? list : (list ? [list] : []);
const target = arr.find((x) => String(x.employeeNo) === '10');
console.log('   user 10 Valid:', JSON.stringify(target?.Valid));

const fin = await searchUser();
console.log(`\n=== FINAL user 11: valid = ${JSON.stringify(fin?.Valid)} ===`);
