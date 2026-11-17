// Probe kedalaman: endpoint biometrics, deploy, NTP, event delete.
// Semua GET/read-only.
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

const PATHS = [
  ['UserInfo/FingerPrint/capabilities', '/ISAPI/AccessControl/UserInfo/FingerPrint/capabilities?format=json'],
  ['UserInfo/FingerPrint/Search', '/ISAPI/AccessControl/UserInfo/FingerPrint/Search?format=json'],
  ['UserInfo/Card/capabilities', '/ISAPI/AccessControl/UserInfo/Card/capabilities?format=json'],
  ['UserInfo/Face/capabilities', '/ISAPI/AccessControl/UserInfo/Face/capabilities?format=json'],
  ['deployInfo', '/ISAPI/AccessControl/deployInfo?format=json'],
  ['AcsEvent/Delete/capabilities', '/ISAPI/AccessControl/AcsEvent/Delete/capabilities?format=json'],
  ['System/Time/ntpServers/capabilities', '/ISAPI/System/Time/ntpServers/capabilities?format=json'],
  ['System/Network/interfaces/1/capabilities', '/ISAPI/System/Network/interfaces/1/capabilities?format=json'],
  ['System/Network/interfaces/1/address', '/ISAPI/System/Network/interfaces/1/address?format=json'],
  ['System/Video/inputs/channels', '/ISAPI/System/Video/inputs/channels?format=json'],
];

for (const dev of DEVS) {
  console.log(`\n${'═'.repeat(64)}\n${dev.key.toUpperCase()} (${dev.ip})\n${'═'.repeat(64)}`);
  for (const [label, path] of PATHS) {
    try {
      const r = await req(dev, { url: `http://${dev.ip}${path}` });
      const body = typeof r.data === 'string' ? r.data.slice(0, 220) : JSON.stringify(r.data);
      console.log(`✅ ${label} → ${r.status} | ${body.slice(0, 300)}`);
    } catch (e) {
      const sub = e.response?.data?.subStatusCode
        || (typeof e.response?.data === 'string' ? e.response.data.slice(0, 70) : '')
        || e.response?.status || e.message;
      console.log(`❌ ${label} → ${sub}`);
    }
  }
}
