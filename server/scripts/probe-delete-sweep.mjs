// Probe 9: sapuan payload LUAS untuk endpoint Delete.
//
// Semua uji memakai employeeNo 999999 (TIDAK ADA di perangkat) sehingga
// tidak ada data riil yang bisa terhapus. Yang dicari: endpoint mana yang
// menjawab dengan error BERBEDA dari badParameters/MessageParametersLack —
// itu menandakan bentuk payload-nya sudah benar dan perangkat tinggal
// mencari user-nya.
//
// Kesimpulan probe ini menentukan apakah fitur "Hapus User" bisa dibangun
// di Device Center atau harus diwujudkan sebagai soft-disable.
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

const base = {
  employeeNo: MISS, name: 'PROBE', userType: 'normal',
  Valid: { enable: true, timeType: 'UTC', beginTime: begin, endTime: end },
  password: '', doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
  doorRightList: [{ doorNo: 1, rightType: 'all' }],
  rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  cardNo: '', validEnd: end, groupId: '1', invalidUserType: 'invalid',
};

const ROOTS = ['UserInfo', 'UserInfoDetail', 'UserInfoDelete', 'Delete'];
const PATHS = [
  '/ISAPI/AccessControl/UserInfo/Delete?format=json',
  '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json',
];

// Kombinasi field tambahan yang dicoba pada tiap akar.
const VARIANTS = [
  ['min', (r) => ({ [r]: { employeeNo: MISS } })],
  ['min+name', (r) => ({ [r]: { employeeNo: MISS, name: 'PROBE' } })],
  ['min+type', (r) => ({ [r]: { employeeNo: MISS, userType: 'normal' } })],
  ['min+Valid', (r) => ({ [r]: { employeeNo: MISS, Valid: base.Valid } })],
  ['min+Valid+type', (r) => ({ [r]: { employeeNo: MISS, userType: 'normal', Valid: base.Valid } })],
  ['min+Valid+type+name', (r) => ({ [r]: { employeeNo: MISS, name: 'PROBE', userType: 'normal', Valid: base.Valid } })],
  ['min+deleteAll', (r) => ({ [r]: { employeeNo: MISS, deleteAll: true } })],
  ['min+Valid+deleteAll', (r) => ({ [r]: { employeeNo: MISS, Valid: base.Valid, deleteAll: true } })],
  ['min+Valid+type+deleteAll', (r) => ({ [r]: { employeeNo: MISS, userType: 'normal', Valid: base.Valid, deleteAll: true } })],
  ['min+Valid+type+name+deleteAll', (r) => ({ [r]: { employeeNo: MISS, name: 'PROBE', userType: 'normal', Valid: base.Valid, deleteAll: true } })],
  ['min+right', (r) => ({ [r]: { employeeNo: MISS, doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } })],
  ['min+Valid+right', (r) => ({ [r]: { employeeNo: MISS, Valid: base.Valid, doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } })],
  ['min+Valid+type+right', (r) => ({ [r]: { employeeNo: MISS, userType: 'normal', Valid: base.Valid, doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }] } })],
  ['full', (r) => ({ [r]: { ...base } })],
  ['full+deleteAll', (r) => ({ [r]: { ...base, deleteAll: true } })],
];

// Error " foreseeable" — kalau muncul salah satu dari ini, bentuk payload
// SUDAH benar dan kita menemukan jawabannya.
const INTERESTING = new Set(['noExist', 'noSuchUser', 'userNotExist', 'invalidUserType', 'userNoExist', 'notExistUser']);

const seen = new Map();
let hits = 0;

for (const path of PATHS) {
  for (const root of ROOTS) {
    for (const [vlabel, build] of VARIANTS) {
      const body = build(root);
      let line;
      try {
        const rr = await req({ url: `http://${DEV.ip}${path}`, method: 'PUT', data: body });
        line = `✅ ${rr.status} ${JSON.stringify(rr.data).slice(0, 110)}`;
        hits++;
      } catch (e) {
        line = `❌ ${errInfo(e)}`;
      }
      const key = `${path.split('?')[0].split('/').pop()}/${root}/${vlabel}`;
      seen.set(key, line);
      if (!line.includes('badParameters') && !line.includes('MessageParametersLack') && !line.includes('notSupport')) {
        console.log(`  ★ TENTANG [${key}] ${line}`);
      }
    }
  }
}

console.log('\n═══ Ringkasan jawaban unik ═══');
const byAns = new Map();
for (const [k, v] of seen) {
  const ans = v.replace(/^[^ ]+ /, '');
  if (!byAns.has(ans)) byAns.set(ans, []);
  byAns.get(ans).push(k);
}
for (const [ans, keys] of byAns) {
  console.log(`\n  ${ans}   (${keys.length} kombinasi)`);
  for (const k of keys.slice(0, 6)) console.log(`     - ${k}`);
  if (keys.length > 6) console.log(`     … +${keys.length - 6} lainnya`);
}
console.log(`\nTotal kombinasi diuji: ${seen.size}, yang sukses HTTP: ${hits}`);
