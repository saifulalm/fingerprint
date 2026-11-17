// RESTORE: kembalikan nama user "2" ke "Saiful" dan verifikasi.
import axios from 'axios';
import crypto from 'crypto';

const DEV = { ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS };

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

const FULL = {
  employeeNo: '2', name: 'Saiful', userType: 'normal', closeDelayEnabled: false,
  Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' },
  password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, faceID: 0, cardIndex: 0, cardID: 0, fingerprintIndex: 0, fingerprintID: 0,
  faceUrl: '', cardNo: '', fingerprintUrl: '',
  validEnd: '2037-12-31T23:59:59+08:00', groupId: '1',
  invalidUserType: 'invalid',
  firstTime: '1970-01-01T08:00:00+08:00', lastTime: '2037-12-31T23:59:59+08:00',
};

const r = await req({
  url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
  method: 'PUT',
  data: { UserInfo: FULL },
});
console.log('RESTORE →', r.status, JSON.stringify(r.data));

// Verifikasi dengan baca ulang
await new Promise(res => setTimeout(res, 1200));
const sid = 'verify' + Date.now();
const rr = await req({
  url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
  method: 'POST',
  data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 5 } },
});
const ui = rr.data.UserInfoSearch || {};
const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
console.log('\n=== USER DI PERANGKAT SETELAH RESTORE ===');
for (const u of list) {
  console.log(`  empNo=${String(u.employeeNo).padEnd(4)} name=${u.name} type=${u.userType} valid=${u.Valid?.enable}`);
}
const saiful = list.find(u => String(u.employeeNo) === '2');
console.log('\nHASIL:', saiful?.name === 'Saiful' ? '✅ RESTORE BERHASIL' : `❌ MASIH "${saiful?.name}"`);
