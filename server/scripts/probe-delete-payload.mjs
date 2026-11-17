// Probe 3: cari PAYLOAD yang tepat untuk hapus user.
//
// Peta kapabilitas menunjukkan `isSupportUserInfoDetailDelete = true`, jadi
// hapus user kemungkinan BISA dilakukan. Endpoint yang tadi membalas
// `badParameters` / `MessageParametersLack`-artinya endpoint-nya DIKENAL,
// hanya bentuk payload-nya yang salah.
//
// Semua uji memakai employeeNo TIDAK ADA (999999) supaya tidak ada data
// riil yang terhapus. Kalau bentuk payload benar, perangkat akan
// membalas "user tidak ditemukan" (bukan badParameters) — itu sinyal
// bahwa payload kita sudah forms yang benar.
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
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 130) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

const MISS = '999999';
const begin = '1970-01-01T08:00:00+08:00';
const end = '2037-12-31T23:59:59+08:00';

const full = {
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
  faceIndex: 0, faceID: 0, cardIndex: 0, cardID: 0, fingerprintIndex: 0, fingerprintID: 0,
  faceUrl: '', cardNo: '', fingerprintUrl: '',
  validEnd: end, groupId: '1', invalidUserType: 'invalid',
  firstTime: begin, lastTime: end,
};

console.log('═══ A. Bentuk payload untuk PUT /ISAPI/AccessControl/UserInfo/Delete ═══');
const aShapes = [
  ['{UserInfo:{employeeNo}}', { UserInfo: { employeeNo: MISS } }],
  ['{UserInfo:{employeeNo,name}}', { UserInfo: { employeeNo: MISS, name: 'PROBE' } }],
  ['{UserInfo:full}', { UserInfo: full }],
  ['{UserInfo:{employeeNo,password}}', { UserInfo: { employeeNo: MISS, password: '' } }],
  ['{UserInfo:{employeeNo,doorRight,RightPlan}}', { UserInfo: { employeeNo: MISS, doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } }],
  ['{UserInfo:{employeeNo,Valid}}', { UserInfo: { employeeNo: MISS, Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end } } }],
  ['{UserInfo:{employeeNo,name,userType,Valid,password,doorRight,RightPlan}}', { UserInfo: { employeeNo: MISS, name: 'PROBE', userType: 'normal', Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end }, password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } }],
  ['{UserInfo:{employeeNo,deleteAll:true}}', { UserInfo: { employeeNo: MISS, deleteAll: true } }],
  ['{UserInfo:{employeeNo,deleteUser:true}}', { UserInfo: { employeeNo: MISS, deleteUser: true } }],
  ['{UserInfoDetail:{employeeNo}}', { UserInfoDetail: { employeeNo: MISS } }],
  ['{UserInfoDetail:{employeeNo,deleteAll}}', { UserInfoDetail: { employeeNo: MISS, deleteAll: true } }],
];
for (const [label, body] of aShapes) {
  try {
    const rr = await req({ url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Delete?format=json`, method: 'PUT', data: body });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 100)}`);
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
  }
}

console.log('\n═══ B. Bentuk payload untuk PUT /ISAPI/AccessControl/UserInfoDetail/Delete ═══');
const bShapes = [
  ['{UserInfoDetail:{employeeNo}}', { UserInfoDetail: { employeeNo: MISS } }],
  ['{UserInfoDetail:{employeeNo,deleteAll:true}}', { UserInfoDetail: { employeeNo: MISS, deleteAll: true } }],
  ['{UserInfo:{employeeNo}}', { UserInfo: { employeeNo: MISS } }],
  ['{UserInfoDetail:{employeeNo,userType}}', { UserInfoDetail: { employeeNo: MISS, userType: 'normal' } }],
  ['{UserInfoDetail:{employeeNo,Valid}}', { UserInfoDetail: { employeeNo: MISS, Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end } } }],
  ['{UserInfoDetail:full}', { UserInfoDetail: full }],
];
for (const [label, body] of bShapes) {
  try {
    const rr = await req({ url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfoDetail/Delete?format=json`, method: 'PUT', data: body });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 100)}`);
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
  }
}

console.log('\n═══ C. Bentuk XML (beberapa firmware lawas hanya menerima XML) ═══');
const xmlBodies = [
  ['UserInfo/Delete', 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=xml',
    `<?xml version="1.0" encoding="UTF-8"?><UserInfo><employeeNo>${MISS}</employeeNo></UserInfo>`],
  ['UserInfoDetail/Delete', 'PUT', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=xml',
    `<?xml version="1.0" encoding="UTF-8"?><UserInfoDetail><employeeNo>${MISS}</employeeNo></UserInfoDetail>`],
];
for (const [label, method, path, body] of xmlBodies) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${path}`, method, data: body });
    console.log(`  ✅ [${label}] → ${rr.status}`);
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
  }
}

console.log('\n═══ D. Opsi lain: disable user via Modify (Valid.enable=false) ═══');
console.log('  (dicek apakah perangkat menerima disable user — alternatif soft-delete)');
try {
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
    method: 'PUT',
    data: { UserInfo: { ...full, Valid: { enable: false, timeType: 'UTC', beginTime: begin, endTime: end } } },
  });
  console.log(`  ✅ Modify dengan Valid.enable=false → ${rr.status}`);
} catch (e) {
  console.log(`  ❌ → ${errInfo(e)}`);
}
