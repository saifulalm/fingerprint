// Probe endpoint ISAPI Hikvision untuk melihat fitur yang tersedia.
// Dijalankan sekali untuk audit, tidak dipakai di produksi.
import axios from 'axios';
import crypto from 'crypto';
import xml2js from 'xml2js';

const DEVICES = [
  { key: 'masuk', ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS },
  { key: 'keluar', ip: '192.168.89.240', username: 'admin', password: process.env.DEVICE_KELUAR_PASS },
];

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function digestRequest({ url, method = 'GET', data = null, username, password, timeout = 5000 }) {
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
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    auth += `, response="${resp}"`;
    return axios(build(auth));
  }
}

// Endpoint yang akan diuji
const ENDPOINTS = [
  ['System/deviceInfo',        'GET',  null],
  ['System/time',              'GET',  null],
  ['System/status',            'GET',  null],
  ['System/Network/interfaces','GET',  null],
  ['System/Storage',           'GET',  null],
  ['System/cpu',               'GET',  null],
  ['System/memory',            'GET',  null],
  ['Security/ONVIF/userList',  'GET',  null],
  ['AccessControl/UserInfo/Search?format=json', 'POST', { UserInfoSearchCond: { searchID: 'probe1', searchResultPosition: 0, maxResults: 5 } }],
  ['AccessControl/AcsEvent?format=json', 'POST', { AcsEventCond: { searchID: 'probe1', searchResultPosition: 0, maxResults: 5, major: 0, minor: 0 } }],
  ['AccessControl/DoorParam',  'GET',  null],
  ['AccessControl/UserInfo/Modify?format=json', 'POST', null],
  ['System/Network/NetworkInterfaces', 'GET', null],
  ['ContentMgmt/ServerInfo',   'GET',  null],
  ['System/Backup',            'GET',  null],
  ['System/Log',               'GET',  null],
];

async function probe(dev) {
  console.log(`\n${'='.repeat(70)}\nDEVICE ${dev.key} (${dev.ip})\n${'='.repeat(70)}`);
  for (const [path, method, data] of ENDPOINTS) {
    const url = `http://${dev.ip}/ISAPI/${path}`;
    try {
      const resp = await digestRequest({ url, method, data, username: dev.username, password: dev.password, timeout: 6000 });
      let preview = '';
      const ct = resp.headers['content-type'] || '';
      if (ct.includes('json')) {
        const s = JSON.stringify(resp.data);
        preview = s.length > 260 ? s.slice(0, 260) + '…' : s;
      } else if (ct.includes('xml')) {
        const parsed = await xml2js.parseStringPromise(resp.data, { explicitArray: false });
        const s = JSON.stringify(parsed).slice(0, 260);
        preview = s + '…';
      } else {
        preview = `[${ct}] ${String(resp.data).slice(0, 120)}`;
      }
      console.log(`  OK   ${resp.status} ${method} ${path}\n         ${preview.replace(/\n/g, ' ')}`);
    } catch (err) {
      const status = err.response?.status ?? (err.code || 'ERR');
      console.log(`  FAIL ${status} ${method} ${path} — ${(err.response?.data || err.message || '').toString().slice(0, 110)}`);
    }
  }
}

for (const d of DEVICES) {
  if (!d.password) { console.log(`skip ${d.key}: tanpa password`); continue; }
  await probe(d);
}
