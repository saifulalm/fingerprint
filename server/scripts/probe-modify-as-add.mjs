// Probe 4: apakah `Modify` bisa dipakai sebagai substitute `Add`?
//
//hipotesis: beberapa firmware menolak POST/PUT UserInfo/Add, tapi MENERIMA
// UserInfo/Modify dengan employeeNo yang belum ada → user baru otomatis
// dibuat. Kalau benar, ini jalur untuk "tambah user" tanpa endpoint Add.
//
// Uji memakai employeeNo uji 900001 dan memverifikasi lewat UserInfo/Search.
// Semua data uji memakai nomor 9xxxxx yang jelas bukan data riil.
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

const UID = process.env.PROBE_UID || '900001';
const begin = '1970-01-01T08:00:00+08:00';
const end = '2037-12-31T23:59:59+08:00';

const full = {
  employeeNo: UID, name: 'PROBE_USER', userType: 'normal', closeDelayEnabled: false,
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

console.log('═══ A. Modify dengan employeeNo BARU (900001) — apakah=user dibuat? ═══');
try {
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`,
    method: 'PUT', data: { UserInfo: full },
  });
  console.log(`  ✅ Modify → ${rr.status} ${JSON.stringify(rr.data).slice(0, 160)}`);
} catch (e) {
  console.log(`  ❌ Modify → ${errInfo(e)}`);
}
await new Promise((r) => setTimeout(r, 1200));
{
  const { list, total } = await searchAll();
  const found = list.find((u) => String(u.employeeNo) === UID);
  console.log(`  → search: total=${total}, user ${UID} ada? ${found ? `✅ YA (${found.name})` : '❌ TIDAK'}`);
}

console.log('\n═══ B. Kalau Modify gagal, coba endpoint UserInfo/Modify dengan /Create atau suffix ═══');
for (const p of [
  '/ISAPI/AccessControl/UserInfo/Modify?format=json',
  '/ISAPI/AccessControl/UserInfo/Create?format=json',
  '/ISAPI/AccessControl/UserInfo/Add?format=json',
]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${p}`, method: 'PUT', data: { UserInfo: full } });
    console.log(`  ✅ PUT ${p} → ${rr.status}`);
  } catch (e) {
    console.log(`  ❌ PUT ${p} → ${errInfo(e)}`);
  }
}
await new Promise((r) => setTimeout(r, 1200));
{
  const { list, total } = await searchAll();
  const found = list.find((u) => String(u.employeeNo) === UID);
  console.log(`  → search: total=${total}, user ${UID} ada? ${found ? `✅ YA (${found.name})` : '❌ TIDAK'}`);
}

console.log('\n═══ C. Uji Delete pada user uji yang MEMANG ADA (900001) — kalau ada ═══');
const { list: listNow, total: totalNow } = await searchAll();
const probe = listNow.find((u) => String(u.employeeNo) === UID);
if (!probe) {
  console.log('  User uji tidak ada → Delete tidak bisa diuji nyata.');
} else {
  const delShapes = [
    ['UserInfo/Delete {UserInfo:{employeeNo}}', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: UID } }],
    ['UserInfo/Delete {UserInfo:full}', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { ...full, name: probe.name } }],
    ['UserInfo/Delete {UserInfo:{employeeNo,Valid}}', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: UID, Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end } } }],
    ['UserInfoDetail/Delete {UserInfoDetail:{employeeNo}}', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json', { UserInfoDetail: { employeeNo: UID } }],
    ['UserInfoDetail/Delete {UserInfoDetail:{employeeNo,name,Valid}}', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json', { UserInfoDetail: { employeeNo: UID, name: probe.name, Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end } } }],
  ];
  for (const [label, path, body] of delShapes) {
    try {
      const rr = await req({ url: `http://${DEV.ip}${path}`, method: 'PUT', data: body });
      console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 100)}`);
    } catch (e) {
      console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    }
    await new Promise((r) => setTimeout(r, 1100));
    const chk = await searchAll();
    if (!chk.list.find((u) => String(u.employeeNo) === UID)) {
      console.log(`  → ✅ USER UJI TERHAPUS (total=${chk.total})`);
      break;
    }
    console.log(`     → masih ada (total=${chk.total})`);
  }
}

const fin = await searchAll();
console.log('\n═══ D. Daftar user akhir ═══');
for (const u of fin.list) console.log(`  empNo=${String(u.employeeNo).padEnd(6)} ${u.name}`);
console.log(`total=${fin.total}`);
