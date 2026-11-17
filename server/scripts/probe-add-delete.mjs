// Uji Add dengan payload lengkap, lalu Delete. Pakai employeeNo test yang tinggi.
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

const uid = '900001';
const FULL = {
  employeeNo: uid, name: 'PROBE_USER', userType: 'normal', closeDelayEnabled: false,
  Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' },
  password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
  maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
  faceIndex: 0, faceID: 0, cardIndex: 0, cardID: 0, fingerprintIndex: 0, fingerprintID: 0,
  faceUrl: '', cardNo: '', fingerprintUrl: '',
  validEnd: '2037-12-31T23:59:59+08:00', groupId: '1', invalidUserType: 'invalid',
  firstTime: '1970-01-01T08:00:00+08:00', lastTime: '2037-12-31T23:59:59+08:00',
};

async function searchAll() {
  const sid = 'v' + Date.now();
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
    method: 'POST',
    data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 30 } },
  });
  const ui = rr.data.UserInfoSearch || {};
  const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
  return { list, total: ui.totalMatches };
}

console.log('═══ 1. ADD user baru ═══');
for (const [m, p] of [['POST','/ISAPI/AccessControl/UserInfo/Add?format=json'], ['PUT','/ISAPI/AccessControl/UserInfo/Add?format=json']]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${p}`, method: m, data: { UserInfo: FULL } });
    console.log(`  ✅ ${m} Add → ${rr.status} ${JSON.stringify(rr.data).slice(0,120)}`);
    break;
  } catch (e) {
    console.log(`  ❌ ${m} Add → ${e.response?.status} ${e.response?.data?.subStatusCode||e.response?.data?.statusString||''}`);
  }
}
await new Promise(r => setTimeout(r, 1200));
let { list, total } = await searchAll();
console.log(`  total di perangkat sekarang: ${total}`);
const found = list.find(u => String(u.employeeNo) === uid);
console.log(`  user ${uid} ada? ${found ? '✅ YA — ' + found.name : '❌ TIDAK ADA'}`);

console.log('\n═══ 2. DELETE user test ═══');
for (const [m, p, body] of [
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: FULL }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: uid, name: 'PROBE_USER', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=' + uid, { UserInfo: { employeeNo: uid } }],
  ['PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: uid, doorRightList: [{ doorNo: 1, rightType: 'all' }], RightPlan: [{ doorNo: 1, planTemplateNo: '1' }], Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T08:00:00+08:00', endTime: '2037-12-31T23:59:59+08:00' } } }],
]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${p}`, method: m, data: body });
    console.log(`  ✅ ${m} Delete → ${rr.status} ${JSON.stringify(rr.data).slice(0,100)}`);
    await new Promise(r => setTimeout(r, 1000));
    const chk = await searchAll();
    const still = chk.list.find(u => String(u.employeeNo) === uid);
    if (!still) { console.log('  → USER TEST TERHAPUS ✅'); break; }
    console.log(`  → masih ada (total ${chk.total})`);
  } catch (e) {
    console.log(`  ❌ ${m} Delete → ${e.response?.status} ${e.response?.data?.subStatusCode||e.response?.data?.statusString||''}`);
  }
}

await new Promise(r => setTimeout(r, 1000));
({ list, total } = await searchAll());
console.log('\n=== FINAL: daftar user di perangkat ===');
for (const u of list) console.log(`  empNo=${String(u.employeeNo).padEnd(4)} ${u.name}`);
console.log(`total=${total}`);
