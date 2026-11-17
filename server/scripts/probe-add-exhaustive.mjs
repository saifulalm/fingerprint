// Probe 10: upeti terakhir untuk "TAMBAH USER" ke perangkat.
//
// Hipotesis yang belum diuji:
//   1. Format XML (firmware lawas menerima XML, JSON ditolak).
//   2. Endpoint UserInfo/Add dengan path-param /suffix lain.
//   3. endpoint-level "resource" terpisah (AccessControl/UserInfo/Search
//      memang jalan, jadi mungkin ada UserInfo/Register atau Capture).
//
// Semua uji memakai employeeNo 900001 (pasti tidak ada) lalu diverifikasi
// lewat UserInfo/Search. Tidak ada data riil yang tersentuh.
import axios from 'axios';
import crypto from 'crypto';
import xml2js from 'xml2js';

const DEV = {
  ip: process.env.DEVICE_MASUK_IP || '192.168.89.241',
  username: process.env.DEVICE_MASUK_USER || 'admin',
  password: process.env.DEVICE_MASUK_PASS || 'Hikvision12',
};

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req({ url, method = 'GET', data = null, timeout = 12000, contentType }) {
  const build = (auth) => {
    const cfg = { method, url, timeout, headers: {} };
    if (data !== null) {
      cfg.data = data;
      cfg.headers['Content-Type'] = contentType || 'application/json';
    }
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

async function describe(e) {
  const d = e.response?.data;
  if (typeof d === 'string' && d.trimStart().startsWith('<')) {
    try {
      const p = await xml2js.parseStringPromise(d, { explicitArray: false, mergeAttrs: true });
      const rs = p.ResponseStatus || {};
      return `${e.response.status} ${rs.subStatusCode || rs.statusString || 'xml'}`;
    } catch { return `${e.response.status} xml`; }
  }
  const sub = d?.subStatusCode || d?.statusString || '';
  return `${e.response?.status ?? 'ERR'} ${sub}`;
}

const UID = '900001';
const begin = '1970-01-01T08:00:00+08:00';
const end = '2037-12-31T23:59:59+08:00';

const JSON_PAYLOAD = {
  UserInfo: {
    employeeNo: UID, name: 'PROBE_USER', userType: 'normal', closeDelayEnabled: false,
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
  },
};

const XML_PAYLOAD = `<?xml version="1.0" encoding="UTF-8"?>
<UserInfo>
  <employeeNo>${UID}</employeeNo>
  <name>PROBE_USER</name>
  <userType>normal</userType>
  <Valid><enable>true</enable><timeType>UTC</timeType><beginTime>${begin}</beginTime><endTime>${end}</endTime></Valid>
  <password></password>
  <doorRight>1</doorRight>
  <RightPlan><doorNo>1</doorNo><planTemplateNo>1</planTemplateNo></RightPlan>
  <doorRightList><doorNo>1</doorNo><rightType>all</rightType></doorRightList>
  <rightPermission><doorNo>1</doorNo><doorRight><door><privilege><card>false</card><face>false</face><fingerprint>false</fingerprint><keypad>false</keypad></privilege></door></doorRight></rightPermission>
  <privilege><card></card><face></face><fingerprint></fingerprint><keypad></keypad></privilege>
  <validEnd>${end}</validEnd>
  <groupId>1</groupId>
  <invalidUserType>invalid</invalidUserType>
  <firstTime>${begin}</firstTime>
  <lastTime>${end}</lastTime>
</UserInfo>`;

async function searchAll() {
  const sid = 'v' + Date.now();
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
    method: 'POST',
    data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 300 } },
  });
  const ui = rr.data.UserInfoSearch || {};
  const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
  return { list, total: ui.totalMatches };
}

const ATTEMPTS = [
  ['POST Add XML', 'POST', '/ISAPI/AccessControl/UserInfo/Add?format=xml', XML_PAYLOAD, 'application/xml'],
  ['PUT Add XML', 'PUT', '/ISAPI/AccessControl/UserInfo/Add?format=xml', XML_PAYLOAD, 'application/xml'],
  ['POST Add XML no-format', 'POST', '/ISAPI/AccessControl/UserInfo/Add', XML_PAYLOAD, 'application/xml'],
  ['POST Add JSON root=UserInfo', 'POST', '/ISAPI/AccessControl/UserInfo/Add?format=json', JSON_PAYLOAD, 'application/json'],
  ['POST Add JSON root=UserInfo w/o Valid', 'POST', '/ISAPI/AccessControl/UserInfo/Add?format=json', { UserInfo: { employeeNo: UID, name: 'PROBE_USER', userType: 'normal', Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end } } }, 'application/json'],
  ['POST Register', 'POST', '/ISAPI/AccessControl/UserInfo/Register?format=json', JSON_PAYLOAD, 'application/json'],
  ['POST Add/Users', 'POST', '/ISAPI/AccessControl/UserInfo/Add/Users?format=json', JSON_PAYLOAD, 'application/json'],
  ['PUT Add w/ path', 'PUT', `/ISAPI/AccessControl/UserInfo/Add/${UID}?format=json`, JSON_PAYLOAD, 'application/json'],
  ['POST AccessControl/User/Add', 'POST', '/ISAPI/AccessControl/User/Add?format=json', JSON_PAYLOAD, 'application/json'],
  ['POST AccessControl/Person/Add', 'POST', '/ISAPI/AccessControl/Person/Add?format=json', JSON_PAYLOAD, 'application/json'],
  ['POST AccessControl/UserInfo/Modify?d', 'POST', '/ISAPI/AccessControl/UserInfo/Modify?format=json', JSON_PAYLOAD, 'application/json'],
  ['PUT UserInfo/Capture/FaceInfo', 'PUT', '/ISAPI/AccessControl/UserInfo/Capture/FaceInfo?format=json', JSON_PAYLOAD, 'application/json'],
];

console.log('═══ Uji Add (semua memakai employeeNo 900001) ═══');
for (const [label, method, path, body, ct] of ATTEMPTS) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${path}`, method, data: body, contentType: ct });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 120)}`);
  } catch (e) {
    console.log(`  ❌ [${label}] → ${await describe(e)}`);
  }
  await new Promise((r) => setTimeout(r, 800));
  const { list, total } = await searchAll();
  if (list.find((u) => String(u.employeeNo) === UID)) {
    console.log(`  → ✅✅ USER 900001 MUNCUL DI PERANGKAT (total=${total}) — ADD BERHASIL!`);
    break;
  }
}

const { list, total } = await searchAll();
console.log(`\nTotal user di perangkat: ${total}`);
console.log('Daftar:', list.map((u) => `${u.employeeNo}=${u.name}`).join(', '));
