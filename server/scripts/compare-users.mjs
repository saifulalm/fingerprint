// Perbandingan user DB vs kedua perangkat + uji Modify-upsert pada user yang hilang.
import axios from 'axios';
import crypto from 'crypto';

const DEVS = [
  { key: 'masuk', ip: '192.168.89.241', password: process.env.DEVICE_MASUK_PASS },
  { key: 'keluar', ip: '192.168.89.240', password: process.env.DEVICE_KELUAR_PASS },
];

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req(dev, { url, method = 'GET', data = null, timeout = 10000 }) {
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
    const ha1 = md5(`admin:${realm}:${dev.password}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="admin", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    auth += `, response="${resp}"`;
    return axios(build(auth));
  }
}

async function searchAll(dev) {
  const sid = 'cmp' + Date.now() + dev.key;
  const rr = await req(dev, {
    url: `http://${dev.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
    method: 'POST',
    data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 30 } },
  });
  const ui = rr.data.UserInfoSearch || {};
  const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
  return { list, total: ui.totalMatches };
}

const perDevice = {};
for (const dev of DEVS) {
  const { list, total } = await searchAll(dev);
  perDevice[dev.key] = list;
  console.log(`\n═══ ${dev.key.toUpperCase()} (${dev.ip}) total=${total} ═══`);
  for (const u of list) {
    console.log(`  empNo=${String(u.employeeNo).padEnd(4)} ${String(u.name).padEnd(16)} doorRight=${u.doorRight} plans=${JSON.stringify(u.RightPlan)}`);
  }
}

console.log('\n═══ PERBANDINGAN ═══');
const masukIds = new Set(perDevice.masuk.map(u => String(u.employeeNo)));
const keluarIds = new Set(perDevice.keluar.map(u => String(u.employeeNo)));
console.log('Hanya di MASUK :', [...masukIds].filter(x => !keluarIds.has(x)).join(', ') || '(tidak ada)');
console.log('Hanya di KELUAR:', [...keluarIds].filter(x => !masukIds.has(x)).join(', ') || '(tidak ada)');
console.log('Ada di keduanya:', [...masukIds].filter(x => keluarIds.has(x)).join(', '));
