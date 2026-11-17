import axios from 'axios';
import crypto from 'crypto';
import { config } from '../src/config/index.js';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');
async function dr(dev, { url, method = 'GET', data = null }) {
  const cfg = { method, url, timeout: 15000, headers: {} };
  if (data) { cfg.data = data; cfg.headers['Content-Type'] = 'application/json'; }
  try { return await axios(cfg); }
  catch (err) {
    if (!err.response || err.response.status !== 401) throw err;
    const w = err.response.headers['www-authenticate'] || '';
    const realm = (w.match(/realm="([^"]+)"/) || [])[1] || '';
    const nonce = (w.match(/nonce="([^"]+)"/) || [])[1] || '';
    const u = new URL(url); const uri = u.pathname + u.search;
    const ha1 = md5(`${dev.username}:${realm}:${dev.password}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    const auth = `Digest username="${dev.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5, response="${md5(`${ha1}:${nonce}:${ha2}`)}"`;
    return axios({ ...cfg, headers: { ...cfg.headers, Authorization: auth } });
  }
}
const start = process.argv[2] || '2026-11-05';
const end = process.argv[3] || '2026-11-05';
const searchID = 'probe' + Date.now();
for (const key of ['masuk', 'keluar']) {
  const d = config.devices[key];
  let position = 0, total = null; const list = [];
  for (let page = 0; page < 20; page++) {
    const payload = { AcsEventCond: { searchID, searchResultPosition: position, maxResults: 30, major: 0, minor: 0, startTime: `${start}T00:00:00+07:00`, endTime: `${end}T23:59:59+07:00` } };
    const r = await dr(d, { url: `http://${d.ip}/ISAPI/AccessControl/AcsEvent?format=json`, method: 'POST', data: payload });
    const ev = r.data.AcsEvent || {};
    if (total === null) total = ev.totalMatches ?? ev.numOfMatches;
    const items = ev.InfoList || [];
    list.push(...items);
    if (!items.length) break;
    position += items.length;
    if (ev.responseStatusStrg !== 'MORE') break;
  }
  const noEmp = list.filter(e => !String(e.employeeNoString ?? '').trim());
  console.log(`${key}: total=${total} fetched=${list.length} tanpaEmployeeNo=${noEmp.length}`);
  console.log('  sample tanpa employeeNo:', JSON.stringify(noEmp.slice(0, 3)));
  const withEmp = list.filter(e => String(e.employeeNoString ?? '').trim());
  console.log('  distinct emp:', [...new Set(withEmp.map(e => e.employeeNoString))].join(','));
  console.log('  minor distribution:', JSON.stringify(list.reduce((a, e) => { a[e.minor] = (a[e.minor] || 0) + 1; return a; }, {})));
}
process.exit(0);
