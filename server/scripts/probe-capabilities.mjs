// Probe KAPABILITAS perangkat Hikvision — READ ONLY.
// Tujuannya: endpoint mana yang didukung firmware ini, supaya
// service tidak menebak-nebak dan UI bisa menampilkan truthfully.
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

// Endpoint yang dicek (semua GET / read-only)
const ENDPOINTS = [
  ['System/capabilities', '/ISAPI/System/capabilities?format=json'],
  ['AccessControl/capabilities', '/ISAPI/AccessControl/capabilities?format=json'],
  ['AccessControl/UserInfo/SearchCap', '/ISAPI/AccessControl/UserInfo/SearchCap?format=json'],
  ['AccessControl/UserInfo/Cap', '/ISAPI/AccessControl/UserInfo/Cap?format=json'],
  ['AccessControl/UserInfo/Search', '/ISAPI/AccessControl/UserInfo/Search?format=json'],
  ['AccessControl/AcsWorkStatus', '/ISAPI/AccessControl/AcsWorkStatus?format=json'],
  ['AccessControl/AcsEvent/capabilities', '/ISAPI/AccessControl/AcsEvent/capabilities?format=json'],
  ['System/time/capabilities', '/ISAPI/System/time/capabilities?format=json'],
  ['System/Network/interfaces', '/ISAPI/System/Network/interfaces?format=json'],
  ['Security/userInfo', '/ISAPI/Security/userInfo?format=json'],
];

for (const dev of DEVS) {
  console.log(`\n${'═'.repeat(60)}\n${dev.key.toUpperCase()} (${dev.ip})\n${'═'.repeat(60)}`);
  for (const [label, path] of ENDPOINTS) {
    try {
      const r = await req(dev, { url: `http://${dev.ip}${path}` });
      const body = typeof r.data === 'string' ? r.data.slice(0, 120) : JSON.stringify(r.data);
      console.log(`✅ ${label} → ${r.status} | ${body.slice(0, 200)}`);
    } catch (e) {
      const sub = e.response?.data?.subStatusCode
        || (typeof e.response?.data === 'string' ? e.response.data.slice(0, 80) : '')
        || e.response?.status || e.message;
      console.log(`❌ ${label} → ${sub}`);
    }
  }
}
