// Probe ronde 2: endpoint ISAPI yang relevan untuk sinkron user ke perangkat.
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

const ENDPOINTS = [
  ['AccessControl/UserInfo/Search?format=json', 'POST', { UserInfoSearchCond: { searchID: 'p2', searchResultPosition: 0, maxResults: 1 } }],
  ['AccessControl/UserInfo/Add?format=json', 'POST', { UserInfo: { employeeNo: '900001', name: 'PROBE_TEST', userType: 'normal', Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' } } }],
  ['AccessControl/UserInfo/Modify?format=json', 'POST', { UserInfo: { employeeNo: '900001', name: 'PROBE_TEST', userType: 'normal', Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' } } }],
  ['AccessControl/UserInfo/Delete?format=json', 'POST', { UserInfo: { employeeNo: '900001' } }],
  ['AccessControl/DoorParam?format=json', 'GET', null],
  ['AccessControl/AcsDoor?format=json', 'GET', null],
  ['IntelligentAnalysis/Event/notification?format=json', 'POST', { EventDescription: { eventType: 'all' } }],
  ['System/Video/inputs/channels', 'GET', null],
  ['System/Network/interfaces', 'GET', null],
  ['Security/ONVIF/users', 'GET', null],
  ['ISAPI/Security/users', 'GET', null],
  ['AccessControl/UserInfoCap?format=json', 'GET', null],
  ['System/deviceInfo', 'GET', null],
];

async function probe(dev) {
  console.log(`\n===== ${dev.key} (${dev.ip}) =====`);
  for (const [path, method, data] of ENDPOINTS) {
    const url = `http://${dev.ip}/ISAPI/${path}`;
    try {
      const resp = await digestRequest({ url, method, data, username: dev.username, password: dev.password, timeout: 8000 });
      let body = resp.data;
      let preview;
      const ct = resp.headers['content-type'] || '';
      if (ct.includes('json')) {
        preview = JSON.stringify(body).slice(0, 200);
      } else {
        const parsed = await xml2js.parseStringPromise(body, { explicitArray: false });
        preview = JSON.stringify(parsed).slice(0, 200);
      }
      console.log(`  OK   ${resp.status} ${method} ${path}\n       ${preview}`);
    } catch (err) {
      const status = err.response?.status ?? (err.code || 'ERR');
      let detail = '';
      try {
        const d = err.response?.data;
        detail = typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 180) : JSON.stringify(d).slice(0, 180);
      } catch { detail = (err.message || '').slice(0, 120); }
      console.log(`  FAIL ${status} ${method} ${path}\n       ${detail}`);
    }
  }
}

for (const d of DEVICES) {
  if (!d.password) { console.log(`skip ${d.key}`); continue; }
  await probe(d);
  break; // cukup probe perangkat pertama dulu untuk hemat waktu
}
