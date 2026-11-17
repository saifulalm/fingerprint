// Probe 8: (a) field apa saja yang benar-benar ada pada user di perangkat,
//          (b) apakah user bisa di-DISABLE (Valid.enable=false) lewat Modify,
//          (c) apakah employeeNo bisa diubah.
//
// (b) adalah soft-delete: kalau hapus fisik tidak didukung firmware,
// disable adalah padanan terdekat yang bisa dilakukan dari aplikasi.
// Uji memakai user dengan NOL rekaman absensi (Brock, empNo 11 di device
// Keluar) lalu dikembalikan ke kondisi semula.
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

function errInfo(e) {
  const d = e.response?.data;
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 160) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

const DEV = config.devices.keluar;

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

console.log('═══ A. Struktur mentah satu user di device Keluar ═══');
{
  const { list } = await searchAll();
  const sample = list.find((u) => String(u.employeeNo) === '11') || list[0];
  console.log(JSON.stringify(sample, null, 1));
  console.log('\nSemua key yang tersedia di objek user:');
  console.log(' ', Object.keys(sample).join(', '));
}

console.log('\n═══ B. Uji DISABLE user empNo=11 (Brock, 0 rekaman absensi) ═══');
const before = (await searchAll()).list.find((u) => String(u.employeeNo) === '11');
const begin = before?.Valid?.beginTime || '1970-01-01T08:00:00+08:00';
const end = before?.Valid?.endTime || '2037-12-31T23:59:59+08:00';

const buildPayload = (emp) => ({
  UserInfo: {
    employeeNo: String(emp.employeeNo),
    name: emp.name || '',
    userType: emp.userType || 'normal',
    closeDelayEnabled: false,
    Valid: {
      enable: emp.Valid?.enable ?? true,
      timeType: 'UTC',
      beginTime: emp.Valid?.beginTime || begin,
      endTime: emp.Valid?.endTime || end,
    },
    password: '',
    doorRight: emp.doorRight != null ? String(emp.doorRight) : '1',
    RightPlan: Array.isArray(emp.RightPlan) && emp.RightPlan.length ? emp.RightPlan : [{ doorNo: 1, planTemplateNo: '1' }],
    maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
    doorRightList: [{ doorNo: 1, rightType: 'all' }],
    rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
    privilege: { card: [], face: [], fingerprint: [], keypad: [] },
    faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
    faceIndex: 0, cardIndex: 0, fingerprintIndex: 0,
    faceUrl: '', cardNo: emp.cardNo || '', fingerprintUrl: '',
    validEnd: emp.Valid?.endTime || end, groupId: '1', invalidUserType: 'invalid',
    firstTime: emp.Valid?.beginTime || begin, lastTime: emp.Valid?.endTime || end,
  },
});

const disabled = { ...before, Valid: { ...before.Valid, enable: false } };
try {
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
    method: 'PUT', data: buildPayload(disabled),
  });
  console.log(`  ✅ Modify Valid.enable=false → ${rr.status} ${JSON.stringify(rr.data).slice(0, 130)}`);
} catch (e) {
  console.log(`  ❌ Modify Valid.enable=false → ${errInfo(e)}`);
}
await new Promise((r) => setTimeout(r, 1300));
{
  const now = (await searchAll()).list.find((u) => String(u.employeeNo) === '11');
  console.log(`  → search: Valid.enable = ${now?.Valid?.enable} (sebelumnya ${before?.Valid?.enable})`);
}

console.log('\n═══ C. Kembalikan ke kondisi semula (enable=true) ═══');
try {
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
    method: 'PUT', data: buildPayload(before),
  });
  console.log(`  ✅ restore → ${rr.status}`);
} catch (e) {
  console.log(`  ❌ restore → ${errInfo(e)}`);
}
await new Promise((r) => setTimeout(r, 1300));
{
  const now = (await searchAll()).list.find((u) => String(u.employeeNo) === '11');
  console.log(`  → search: Valid.enable = ${now?.Valid?.enable}, nama = ${now?.name}`);
}

console.log('\n═══ D. Uji ubah employeeNo (empNo 11 → 111) di device Keluar ═══');
try {
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
    method: 'PUT', data: buildPayload({ ...before, employeeNo: '111' }),
  });
  console.log(`  ✅ Modify employeeNo 11→111 → ${rr.status} ${JSON.stringify(rr.data).slice(0, 130)}`);
} catch (e) {
  console.log(`  ❌ Modify employeeNo 11→111 → ${errInfo(e)}`);
}
await new Promise((r) => setTimeout(r, 1300));
{
  const { list, total } = await searchAll();
  console.log(`  → search total=${total}`);
  for (const u of list) console.log(`     empNo=${String(u.employeeNo).padEnd(6)} name=${u.name} enable=${u.Valid?.enable}`);
}
