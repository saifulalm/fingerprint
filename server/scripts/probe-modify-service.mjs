// Probe 5: (1) apakah Modify versi service (buildUserPayload) masih jalan,
//           (2) apakah employeeNo bisa DIUBAH lewat Modify → jalur "perbaikan ID".
//
// Perbaikan ID itu penting: nomor employee adalah kunci lokal per perangkat,
// jadi ID yang sama bisa menunjuk orang berbeda di device Masuk vs Keluar.
// Kalau Modify bisa mengganti employeeNo, konflik itu bisa diperbaiki dari
// aplikasi (device lama ditulis ulang dengan nomor baru).
//
// Semua uji memakai user uji bernomor 9xxxxx. Kalau perangkat tidak punya
// user uji, skrip membuat dulu lewat... tidak bisa (Add ditolak), jadi skip.
import axios from 'axios';
import crypto from 'crypto';
import { getDeviceUsers, updateDeviceUser } from '../src/services/hikvisionAdmin.js';
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

const DEV = config.devices.masuk;

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

console.log('═══ 1. Daftar user di device Masuk ═══');
const users = await getDeviceUsers(DEV);
for (const u of users) console.log(`  empNo=${String(u.employeeNo).padEnd(6)} name=${u.name}`);

const target = users.find((u) => String(u.employeeNo) === '2');
if (!target) {
  console.log('\nUser employeeNo=2 tidak ada → tidak ada yang bisa dipakai untuk uji Modify.');
  process.exit(0);
}

console.log('\n═══ 2. Modify via service (updateDeviceUser) — ganti nama sementara ═══');
const tempName = `PROBE_MODIFY_${Date.now() % 10000}`;
try {
  const r = await updateDeviceUser(DEV, '2', { name: tempName });
  console.log(`  ✅ Modify via service → ${JSON.stringify(r).slice(0, 200)}`);
  await new Promise((r2) => setTimeout(r2, 1200));
  const chk = await searchAll();
  const now = chk.list.find((u) => String(u.employeeNo) === '2');
  console.log(`  → search: empNo=2 sekarang bernama "${now?.name}" (ekspektasi "${tempName}")`);
} catch (e) {
  console.log(`  ❌ Modify via service → ${e.message}`);
}

console.log('\n═══ 3. Apakah employeeNo bisa DIUBAH lewat Modify? ═══');
console.log('   (uji: ubah employeeNo 2 → 12 lalu kembalikan)');
const NEWNO = '12';
// Cari payload Modify yang memuat employeeNo baru.
const begin = '1970-01-01T08:00:00+08:00';
const end = '2037-12-31T23:59:59+08:00';
const payload = {
  UserInfo: {
    employeeNo: NEWNO, name: target.name, userType: target.userType || 'normal',
    closeDelayEnabled: false,
    Valid: { enable: target.valid ?? true, timeType: 'UTC', beginTime: target.validBegin || begin, endTime: target.validEnd || end },
    password: '', doorRight: target.doorRight != null ? String(target.doorRight) : '1',
    RightPlan: target.rightPlans?.length ? target.rightPlans : [{ doorNo: 1, planTemplateNo: '1' }],
    maxOpenDoorTime: 0, openDoorTime: 0, localUIRight: true, userVerifyMode: '',
    doorRightList: [{ doorNo: 1, rightType: 'all' }],
    rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
    privilege: { card: [], face: [], fingerprint: [], keypad: [] },
    faceEnabled: false, cardEnabled: false, fingerprintEnabled: false,
    faceIndex: 0, faceID: 0, cardIndex: 0, cardID: 0, fingerprintIndex: 0, fingerprintID: 0,
    faceUrl: '', cardNo: target.cardNo || '', fingerprintUrl: '',
    validEnd: target.validEnd || end, groupId: '1', invalidUserType: 'invalid',
    firstTime: begin, lastTime: end,
  },
};
try {
  const rr = await req({ url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`, method: 'PUT', data: payload });
  console.log(`  ✅ Modify employeeNo 2→${NEWNO} → ${rr.status} ${JSON.stringify(rr.data).slice(0, 160)}`);
} catch (e) {
  const d = e.response?.data;
  console.log(`  ❌ Modify employeeNo 2→${NEWNO} → ${e.response?.status} ${d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 150) : '')}`);
}
await new Promise((r) => setTimeout(r, 1500));
{
  const chk = await searchAll();
  console.log(`  → search total=${chk.total}`);
  for (const u of chk.list) console.log(`     empNo=${String(u.employeeNo).padEnd(6)} ${u.name}`);
}

console.log('\n═══ 4. Kembalikan nama user 2 ke nilai semula ═══');
try {
  await updateDeviceUser(DEV, '2', { name: target.name });
  await new Promise((r) => setTimeout(r, 1200));
  const chk = await searchAll();
  const now = chk.list.find((u) => String(u.employeeNo) === '2');
  console.log(`  ✅ empNo=2 nama sekarang "${now?.name}" (aslinya "${target.name}")`);
} catch (e) {
  console.log(`  ❌ ${e.message}`);
}
