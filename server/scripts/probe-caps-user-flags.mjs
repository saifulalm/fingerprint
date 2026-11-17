// Baca peta kapabilitas AccessControl untuk mencari flag resmi soal
// Add / Delete user. Ini NON-MUTATING — hanya GET capabilities.
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

const rr = await req({ url: `http://${DEV.ip}/ISAPI/AccessControl/capabilities?format=json` });
const caps = rr.data?.AccessControl || {};

const flat = [];
const walk = (node, prefix = '') => {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'boolean') flat.push([name, v]);
    else if (typeof v === 'string' && (v === 'true' || v === 'false')) flat.push([name, v === 'true']);
    else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, name);
  }
};
walk(caps);

const RE = /(user|delete|add|modify|person|group)/i;
console.log(`Total flag kapabilitas: ${flat.length}\n`);
console.log('— Flag yang berhubungan dengan user/delete/add/modify —');
for (const [name, val] of flat) {
  if (RE.test(name)) console.log(`  ${val ? '✅ true ' : '❌ false'}  ${name}`);
}
