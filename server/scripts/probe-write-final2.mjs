// Probe final 2: pencarian parameter sistematis untuk Modify/Delete.
// Dimulai dari payload user asli, lalu ditambah field satu per satu.
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

const BASE = {
  employeeNo: '2', name: 'UJI_WRITE', userType: 'normal', closeDelayEnabled: false,
  Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' },
  password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
};

// Kandidat field tambahan yang sering diwajibkan ISAPI
const EXTRA = {
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, faceID: 0, cardIndex: 0, cardID: 0, fingerprintIndex: 0, fingerprintID: 0,
  faceUrl: '', cardNo: '', fingerprintUrl: '',
  invalidUserType: 'invalid', privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  validEnd: '2037-12-31T23:59:59+08:00',
  groupId: '1', groupName: '1',
  firstTime: '1970-01-01T08:00:00+08:00',
  lastTime: '2037-12-31T23:59:59+08:00',
};

async function tryPut(label, body, urlPath = '/ISAPI/AccessControl/UserInfo/Modify?format=json') {
  try {
    const rr = await req({ url: `http://${DEV.ip}${urlPath}`, method: 'PUT', data: { UserInfo: body } });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0,140)}`);
    return true;
  } catch (e) {
    const sub = e.response?.data?.subStatusCode || e.response?.data?.statusString || (e.response?.data||'').toString().slice(0,60);
    console.log(`  ❌ [${label}] → ${e.response?.status} ${sub}`);
    return false;
  }
}

console.log('═══ 1. TAMBAHKAN FIELD SATU PER SATU ═══');
let current = { ...BASE };
const order = [
  ['doorRightList', EXTRA.doorRightList], ['rightPermission', EXTRA.rightPermission],
  ['privilege', EXTRA.privilege], ['faceEnabled', EXTRA.faceEnabled],
  ['cardEnabled', EXTRA.cardEnabled], ['fingerprintEnabled', EXTRA.fingerprintEnabled],
  ['faceIndex', EXTRA.faceIndex], ['cardIndex', EXTRA.cardIndex], ['fingerprintIndex', EXTRA.fingerprintIndex],
  ['cardNo', EXTRA.cardNo], ['faceUrl', EXTRA.faceUrl], ['fingerprintUrl', EXTRA.fingerprintUrl],
  ['validEnd', EXTRA.validEnd], ['groupId', EXTRA.groupId],
  ['invalidUserType', EXTRA.invalidUserType], ['firstTime', EXTRA.firstTime], ['lastTime', EXTRA.lastTime],
];
for (const [key, val] of order) {
  const before = { ...current };
  current[key] = val;
  const ok = await tryPut(`+${key}`, current);
  if (!ok) current = before; // rollback kalau tidak membantu
  else console.log(`     → ${key} diterima, lanjut`);
}

console.log('\n═══ 2. VARIASI URL (employeeNo di query/path) ═══');
for (const p of [
  '/ISAPI/AccessControl/UserInfo/Modify?format=json&employeeNo=2',
  '/ISAPI/AccessControl/UserInfo/Modify/2?format=json',
  '/ISAPI/AccessControl/UserInfo/Modify?format=json&userID=2',
  '/ISAPI/AccessControl/UserInfo/Modify?format=xml',
  '/ISAPI/AccessControl/UserInfo/Modify',
]) await tryPut(`url ${p}`, current, p);

console.log('\n═══ 3. DELETE — variasi payload & URL ═══');
for (const [m, p, body] of [
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: '2' } }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: '2', name: 'x' } }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: '2', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: '2', deleteAll: true } }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=2', { UserInfo: { employeeNo: '2' } }],
  ['DELETE', '/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=2', null],
]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${p}`, method: m, data: body });
    console.log(`  ✅ ${m} ${p} → ${rr.status}`);
  } catch (e) {
    const sub = e.response?.data?.subStatusCode || e.response?.data?.statusString || '';
    console.log(`  ❌ ${m} ${p} → ${e.response?.status} ${sub}`);
  }
}
