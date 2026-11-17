// Ambil XML capabilities LENGKAP + endpoint read tambahan.
// Dipakai untuk membangun peta kapabilitas yang jujur (tidak menebak).
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

// Endpoint read tambahan yang berguna untuk flow "kelola perangkat"
const EXTRA = [
  ['AccessControl/Door/capabilities', '/ISAPI/AccessControl/Door/capabilities?format=json'],
  ['AccessControl/Door/Status', '/ISAPI/AccessControl/Door/Status?format=json'],
  ['AccessControl/holiday/capabilities', '/ISAPI/AccessControl/holiday/capabilities?format=json'],
  ['AccessControl/UserInfo/Groups', '/ISAPI/AccessControl/UserInfo/Groups?format=json'],
  ['AccessControl/UserInfo/SearchCap', '/ISAPI/AccessControl/UserInfo/SearchCap?format=json'],
  ['System/Video/inputs/capabilities', '/ISAPI/System/Video/inputs/capabilities?format=json'],
  ['System/deviceInfo', '/ISAPI/System/deviceInfo?format=json'],
  ['System/time', '/ISAPI/System/time?format=json'],
];

for (const dev of DEVS) {
  console.log(`\n${'═'.repeat(70)}\n${dev.key.toUpperCase()} (${dev.ip})\n${'═'.repeat(70)}`);

  for (const [label, path] of [
    ['System/capabilities', '/ISAPI/System/capabilities?format=json'],
    ['AccessControl/capabilities', '/ISAPI/AccessControl/capabilities?format=json'],
  ]) {
    try {
      const r = await req(dev, { url: `http://${dev.ip}${path}` });
      console.log(`\n──── ${label} ────`);
      console.log(String(r.data));
    } catch (e) {
      console.log(`\n──── ${label} → ${e.response?.status} ${e.response?.data?.subStatusCode || ''}`);
    }
  }

  console.log(`\n──── endpoint tambahan ────`);
  for (const [label, path] of EXTRA) {
    try {
      const r = await req(dev, { url: `http://${dev.ip}${path}` });
      const body = typeof r.data === 'string' ? r.data.slice(0, 150) : JSON.stringify(r.data);
      console.log(`✅ ${label} → ${r.status} | ${body.slice(0, 220)}`);
    } catch (e) {
      const sub = e.response?.data?.subStatusCode
        || (typeof e.response?.data === 'string' ? e.response.data.slice(0, 60) : '')
        || e.response?.status || e.message;
      console.log(`❌ ${label} → ${sub}`);
    }
  }
}
