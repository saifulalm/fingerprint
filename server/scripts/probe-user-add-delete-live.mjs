// Probe live: apakah perangkat benar-benar mendukung Add & Delete user?
//
// Metodologi: gunakan employeeNo uji yang JAUH dari data riil (900001).
// 1. Coba beberapa variasi endpoint/method untuk Add.
// 2. Verifikasi lewat UserInfo/Search apakah user benar-benar muncul.
// 3. Kalau Add berhasil, coba variasi Delete sampai user benar-benar hilang.
// 4. Kalau Add gagal, tidak ada yang perlu dihapus.
//
// Semua payload Add/Modify memakai field lengkap (doorRightList,
// rightPermission, privilege) — versi sebelumnya hanya gagal karena
// MessageParametersLack, bukan karena endpoint-nya tidak ada.
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

const UID = process.env.PROBE_UID || '900001';

function fullPayload(no, name) {
  const begin = '1970-01-01T08:00:00+08:00';
  const end = '2037-12-31T23:59:59+08:00';
  return {
    employeeNo: no, name, userType: 'normal', closeDelayEnabled: false,
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
}

async function searchAll() {
  const sid = 'v' + Date.now();
  const rr = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
    method: 'POST',
    data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 200 } },
  });
  const ui = rr.data.UserInfoSearch || {};
  const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
  return { list, total: ui.totalMatches };
}

function errInfo(e) {
  const d = e.response?.data;
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.slice(0, 90) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

console.log(`Perangkat uji: ${DEV.ip}  employeeNo uji: ${UID}\n`);

// ── 0. Pastikan user uji tidak ada sebelumnya ────────────────────────────────
{
  const { list, total } = await searchAll();
  const exists = list.find((u) => String(u.employeeNo) === UID);
  console.log(`[0] Prasyarat: total user di perangkat = ${total}, user uji ada? ${exists ? 'YA (perlu dibersihkan dulu)' : 'TIDAK'}`);
  if (exists) {
    console.log('    → ada user sisa dari probe sebelumnya, lanjut probe Delete dulu.');
  }
}

// ── 1. ADD ──────────────────────────────────────────────────────────────────
console.log('\n═══ 1. ADD user (payload LENGKAP) ═══');
const addAttempts = [
  ['POST json', 'POST', '/ISAPI/AccessControl/UserInfo/Add?format=json'],
  ['PUT json', 'PUT', '/ISAPI/AccessControl/UserInfo/Add?format=json'],
  ['POST no-format', 'POST', '/ISAPI/AccessControl/UserInfo/Add'],
  ['PUT no-format', 'PUT', '/ISAPI/AccessControl/UserInfo/Add'],
];
let added = false;
for (const [label, method, path] of addAttempts) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${path}`, method, data: { UserInfo: fullPayload(UID, 'PROBE_USER') } });
    console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 140)}`);
    added = true;
  } catch (e) {
    console.log(`  ❌ [${label}] → ${errInfo(e)}`);
  }
  await new Promise((r) => setTimeout(r, 900));
  const chk = await searchAll();
  if (chk.list.find((u) => String(u.employeeNo) === UID)) {
    console.log(`  → USER UJI TERDAFTAR DI PERANGKAT ✅ (total=${chk.total})`);
    added = true;
    break;
  }
}

if (!added) {
  console.log('\n  ⚠️  ADD GAGAL di semua variasi → perangkat ini tidak mendukung penambahan user.');
} else {
  // ── 2. DELETE ───────────────────────────────────────────────────────────
  console.log('\n═══ 2. DELETE user uji ═══');
  const delAttempts = [
    ['PUT full', 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: fullPayload(UID, 'PROBE_USER') }],
    ['PUT min', 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: UID } }],
    ['PUT no-format', 'PUT', '/ISAPI/AccessControl/UserInfo/Delete', { UserInfo: { employeeNo: UID } }],
    ['POST json', 'POST', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: UID } }],
    ['DELETE method', 'DELETE', `/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=${UID}`, null],
    ['PUT q-emp', 'PUT', `/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=${UID}`, { UserInfo: { employeeNo: UID } }],
  ];
  for (const [label, method, path, body] of delAttempts) {
    try {
      const rr = await req({ url: `http://${DEV.ip}${path}`, method, data: body });
      console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 100)}`);
    } catch (e) {
      console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    }
    await new Promise((r) => setTimeout(r, 1100));
    const chk = await searchAll();
    if (!chk.list.find((u) => String(u.employeeNo) === UID)) {
      console.log(`  → USER UJI TERHAPUS ✅ (total=${chk.total})`);
      break;
    }
    console.log(`     → masih ada (total=${chk.total})`);
  }
}

// ── 3. Ringkasan daftar user ───────────────────────────────────────────────
const final = await searchAll();
console.log('\n═══ 3. Daftar user akhir di perangkat ═══');
for (const u of final.list) console.log(`  empNo=${String(u.employeeNo).padEnd(6)} ${u.name}`);
console.log(`total=${final.total}`);
