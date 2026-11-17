// Probe 6: cari payload Delete yang diterima.
//
// Metode: pakai payload yang SUDAH terbukti diterima perangkat (hasil
// `updateDeviceUser` → Modify OK), lalu salin persis bentuknya untuk
// endpoint Delete dengan akar `UserInfo` dan `UserInfoDetail`, dan coba
// menambah/menghapus field satu per satu sampai jawabannya berubah dari
// `badParameters`/`MessageParametersLack`.
//
// Uji memakai employeeNo TIDAK ADA (999999) → kalau bentuknya benar,
// perangkat akan bilang "tidak ditemukan" (bukan parameter error).
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
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 150) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

const MISS = '999999';
const begin = '1970-01-01T08:00:00+08:00';
const end = '2037-12-31T23:59:59+08:00';

// Payload yang PERSIS sama dengan buildUserPayload() di hikvisionAdmin.js
// (field yang terbukti diterima perangkat).
const KNOWN_GOOD = {
  employeeNo: MISS, name: 'PROBE', userType: 'normal', closeDelayEnabled: false,
  Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end },
  password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: {
    doorNo: [1],
    doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } },
  },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, faceIndex2: undefined, cardIndex: 0, fingerprintIndex: 0,
  faceUrl: '', cardNo: '', fingerprintUrl: '',
  validEnd: end, groupId: '1', invalidUserType: 'invalid',
  firstTime: begin, lastTime: end,
};
delete KNOWN_GOOD.faceIndex2;

const ENDPOINTS = [
  ['UserInfo/Delete', '/ISAPI/AccessControl/UserInfo/Delete?format=json'],
  ['UserInfoDetail/Delete', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json'],
];

async function tryIt(path, body, label) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${path}`, method: 'PUT', data: body });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 110)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    return false;
  }
}

console.log('═══ A. Akar UserInfo vs UserInfoDetail dengan payload known-good ═══');
for (const [epName, path] of ENDPOINTS) {
  await tryIt(path, { UserInfo: { ...KNOWN_GOOD } }, `${epName} akar=UserInfo`);
  await tryIt(path, { UserInfoDetail: { ...KNOWN_GOOD } }, `${epName} akar=UserInfoDetail`);
}

console.log('\n═══ B. Buang field satu per satu dari known-good (UserInfo/Delete) ═══');
const fields = Object.keys(KNOWN_GOOD);
for (const f of fields) {
  const body = { ...KNOWN_GOOD };
  delete body[f];
  await tryIt('/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: body }, `tanpa ${f}`);
}

console.log('\n═══ C. Endpoint lain yang mungkin (kapabilitas Detail/Delete) ═══');
for (const p of [
  '/ISAPI/AccessControl/UserInfo/Detail?format=json',
  '/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=' + MISS,
  '/ISAPI/AccessControl/UserInfo/Delete/all?format=json',
  '/ISAPI/AccessControl/UserInfo/DeleteAll?format=json',
  '/ISAPI/AccessControl/UserInfo/Clear?format=json',
  '/ISAPI/AccessControl/UserInfo/Modify/Delete?format=json',
]) {
  await tryIt(p, { UserInfo: { ...KNOWN_GOOD } }, `PUT ${p}`);
}

console.log('\n═══ D. Flag: apakah UserInfo/Search menerima SearchCond untuk filter + hapus? ═══');
console.log('  (cek endpoint lain yangź直到 possibility: FingerPrint delete)');
for (const p of [
  '/ISAPI/AccessControl/FingerPrint/Delete?format=json',
  '/ISAPI/AccessControl/UserInfo/FingerPrint/Delete?format=json',
]) {
  await tryIt(p, { UserInfo: { employeeNo: MISS } }, `PUT ${p}`);
}
