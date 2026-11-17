// Probe 7: endpoint yang balas `invalidID` wrecktuju ID di path.
//
// Temuan probe 6:
//   PUT /ISAPI/AccessControl/UserInfo/Delete/all?format=json      → invalidID
//   PUT /ISAPI/AccessControl/UserInfo/Modify/Delete?format=json   → invalidID
// `invalidID` berarti ENDPOINT DIKENAL dan justru menunggu parameter ID —
// jadi forms path-parameter (`/Delete/<employeeNo>`) tinggal dicoba.
//
// Uji memakai employeeNo 999999 (TIDAK ADA) supaya tidak ada data riil
// yang terhapus. Bentuk yang benar harus lewat ke "user tidak ditemukan",
// bukan kembali ke error parameter.
import axios from 'axios';
import crypto from 'crypto';

const DEV = {
  ip: process.env.DEVICE_MASUK_IP || '192.168.89.241',
  username: process.env.DEVICE_MASUK_USER || 'admin',
  password: process.env.DEVICE_MASUK_PASS || 'Hikvision12',
};

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

function errInfo(e) {
  const d = e.response?.data;
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 160) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

const MISS = '999999';
const begin = '1970-01-01T08:00:00+08:00';
const end = '2037-12-31T23:59:59+08:00';

const FULL = {
  employeeNo: MISS, name: 'PROBE', userType: 'normal', closeDelayEnabled: false,
  Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end },
  password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, cardIndex: 0, fingerprintIndex: 0,
  faceUrl: '', cardNo: '', fingerprintUrl: '',
  validEnd: end, groupId: '1', invalidUserType: 'invalid',
  firstTime: begin, lastTime: end,
};

async function tryIt(label, method, path, body) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${path}`, method, data: body });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 130)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    return false;
  }
}

console.log('═══ A. Path-parameter pada endpoint yang balas invalidID ═══');
await tryIt('Delete/<no>', 'PUT', `/ISAPI/AccessControl/UserInfo/Delete/${MISS}?format=json`, null);
await tryIt('Delete/<no> + body', 'PUT', `/ISAPI/AccessControl/UserInfo/Delete/${MISS}?format=json`, { UserInfo: FULL });
await tryIt('Modify/Delete/<no>', 'PUT', `/ISAPI/AccessControl/UserInfo/Modify/Delete/${MISS}?format=json`, null);
await tryIt('Modify/Delete/<no> + body', 'PUT', `/ISAPI/AccessControl/UserInfo/Modify/Delete/${MISS}?format=json`, { UserInfo: FULL });

console.log('\n═══ B. Bentuk lain yang umum di ISAPI ═══');
const variants = [
  ['PUT UserInfo/Delete/{no} body UserInfo', 'PUT', `/ISAPI/AccessControl/UserInfo/Delete/${MISS}?format=json`, { UserInfo: { employeeNo: MISS } }],
  ['PUT UserInfo/Delete?employeeNo={no}', 'PUT', `/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=${MISS}`, { UserInfo: FULL }],
  ['PUT UserInfo/{no}', 'PUT', `/ISAPI/AccessControl/UserInfo/${MISS}?format=json`, { UserInfo: FULL }],
  ['DELETE UserInfo/{no}', 'DELETE', `/ISAPI/AccessControl/UserInfo/${MISS}?format=json`, null],
  ['DELETE UserInfo/Delete/{no}', 'DELETE', `/ISAPI/AccessControl/UserInfo/Delete/${MISS}?format=json`, null],
  ['PUT UserInfoDetail/{no}', 'PUT', `/ISAPI/AccessControl/UserInfoDetail/${MISS}?format=json`, { UserInfoDetail: FULL }],
  ['DELETE UserInfoDetail/{no}', 'DELETE', `/ISAPI/AccessControl/UserInfoDetail/${MISS}?format=json`, null],
  ['PUT UserInfoDetail/Delete/{no}', 'PUT', `/ISAPI/AccessControl/UserInfoDetail/Delete/${MISS}?format=json`, { UserInfoDetail: FULL }],
  ['PUT FingerPrint/Delete/{no}', 'PUT', `/ISAPI/AccessControl/FingerPrint/Delete/${MISS}?format=json`, { UserInfo: FULL }],
  ['PUT FingerPrint/Delete body', 'PUT', '/ISAPI/AccessControl/FingerPrint/Delete?format=json', { UserInfo: { employeeNo: MISS } }],
];
for (const [label, m, p, b] of variants) await tryIt(label, m, p, b);

console.log('\n═══ C. "/Delete/all" — mungkin berarti hapus semua, butuh flag konfirmasi ═══');
for (const p of [
  '/ISAPI/AccessControl/UserInfo/Delete/all?format=json',
  '/ISAPI/AccessControl/UserInfo/Delete/all?format=json&employeeNo=' + MISS,
  '/ISAPI/AccessControl/UserInfo/Delete/all?format=json&deleteAll=true',
]) {
  await tryIt(`PUT ${p}`, 'PUT', p, { UserInfo: FULL });
}
