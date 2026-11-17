// Debug 2: re-enable user yang sudah disabled.
//
// Temuan probe sebelumnya: setelah disable, perangkat MENGUBAH endTime dari
// "2037-12-31T23:59:59+08:00" menjadi "2038-01-01T07:59:59+08:00".
// Payloads sebelumnya memakai endTime dari DB cache (nilai lama), bukan nilai
// yang baru dibaca dari perangkat.
//
// Uji apakah(endTime persis dari perangkat) memperbaiki masalah.
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

const mk = (over = {}) => ({
  employeeNo: NO,
  name: u.name,
  userType: u.userType || 'normal',
  closeDelayEnabled: u.closeDelayEnabled ?? false,
  Valid: { enable: true, timeType: 'UTC', beginTime: u.Valid.beginTime, endTime: u.Valid.endTime },
  password: '', doorRight: String(u.doorRight ?? '1'),
  RightPlan: u.RightPlan?.length ? u.RightPlan : [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: u.localUIRight ?? true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, cardIndex: 0, fingerprintIndex: 0,
  faceUrl: '', cardNo: u.cardNo || '', fingerprintUrl: '',
  validEnd: u.Valid.endTime, groupId: '1', invalidUserType: 'invalid',
  firstTime: u.Valid.beginTime, lastTime: u.Valid.endTime,
  ...over,
});

console.log('\n═══ A. enable=true dengan endTime PERSIS dari perangkat ═══');
await attempt('endTime dari perangkat', mk());

console.log('\n═══ B. Nonaktifkan lagi (idempoten) untuk cek apakah Modify jalan sama sekali ═══');
await attempt('enable=false (tidak berubah)', mk({ Valid: { enable: false, timeType: 'UTC', beginTime: u.Valid.beginTime, endTime: u.Valid.endTime } }));

console.log('\n═══ C. Ubah NAMA saja pada user disabled ═══');
await attempt('nama berbeda, enable tetap false', mk({ name: u.name + 'X', Valid: { enable: false, timeType: 'UTC', beginTime: u.Valid.beginTime, endTime: u.Valid.endTime } }));

console.log('\n═══ D. Kirim payload TANPA field Valid sama sekali ═══');
{
  const p = mk();
  delete p.Valid;
  await attempt('tanpa Valid', p);
}

console.log('\n═══ E. Kirim field validEnd/lastTime/firstTime tanpa offset (format UTC murni) ═══');
await attempt('timestamp tanpa +08:00', mk({
  Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2038-01-01T00:00:00Z' },
  validEnd: '2038-01-01T00:00:00Z', firstTime: '1970-01-01T00:00:00Z', lastTime: '2038-01-01T00:00:00Z',
}));

const fin = await searchUser();
console.log(`\n=== FINAL valid = ${JSON.stringify(fin?.Valid)} name=${fin?.name} ===`);
