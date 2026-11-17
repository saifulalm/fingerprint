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
    const u = new URL(url);
    const uri = u.pathname + u.search;
    const ha1 = md5(`${dev.username}:${realm}:${dev.password}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    let auth = `Digest username="${dev.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5, response="${md5(`${ha1}:${nonce}:${ha2}`)}"`;
    return axios({ ...cfg, headers: { ...cfg.headers, Authorization: auth } });
  }
}

const start = process.argv[2] || '2026-11-05';
const end = process.argv[3] || '2026-11-05';

for (const key of ['masuk', 'keluar']) {
  const d = config.devices[key];
  const payload = { AcsEventCond: { searchID: '1', searchResultPosition: 0, maxResults: 1, major: 0, minor: 0, startTime: `${start}T00:00:00+07:00`, endTime: `${end}T23:59:59+07:00` } };
  const r = await dr(d, { url: `http://${d.ip}/ISAPI/AccessControl/AcsEvent?format=json`, method: 'POST', data: payload });
  const ev = r.data.AcsEvent || {};
  console.log(key, 'totalMatches=', ev.totalMatches, 'numOfMatches=', ev.numOfMatches, 'status=', ev.responseStatusStrg);
  const first = ev.InfoList?.[0];
  if (first) console.log('  sample:', JSON.stringify(first));
}
process.exit(0);
