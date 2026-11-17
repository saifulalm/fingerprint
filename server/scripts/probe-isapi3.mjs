// Probe ronde 3: konfirmasi write capability + inventaris user yang ada di perangkat.
import axios from 'axios';
import crypto from 'crypto';

const DEV = { ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS };

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req({ url, method = 'GET', data = null, timeout = 8000 }) {
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

// A) Inventaris user lengkap di perangkat
console.log('===== A) USER DI PERANGKAT =====');
const users = [];
let pos = 0, total = null, more = true, page = 0;
while (more && page < 20) {
  page++;
  const sid = 'inv' + Date.now();
  const r = await req({
    url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
    method: 'POST',
    data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: pos, maxResults: 30 } },
  });
  const ui = r.data.UserInfoSearch || {};
  if (total === null) total = parseInt(ui.totalMatches) || 0;
  const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
  users.push(...list);
  pos += list.length;
  more = ui.responseStatusStrg === 'MORE' && list.length > 0;
}
console.log(`total di perangkat: ${total}, terbaca: ${users.length}`);
for (const u of users) {
  console.log(`  empNo=${String(u.employeeNo).padEnd(6)} name=${(u.name||'').padEnd(22)} type=${u.userType} card=${u.cardNo||'-'} valid=${u.Valid?.enable} ${u.Valid?.endTime||''}`);
}

// B) Coba beberapa variasi write endpoint
console.log('\n===== B) UJI WRITE (variasi) =====');
const uid = '900001';
const body = { UserInfo: { employeeNo: uid, name: 'PROBE', userType: 'normal', Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' } } };
const attempts = [
  ['POST', '/ISAPI/AccessControl/UserInfo/Add', body],
  ['POST', '/ISAPI/AccessControl/UserInfo/Add', { UserInfo: { employeeNo: uid, name: 'PROBE', userType: 'normal' } }],
  ['PUT',  '/ISAPI/AccessControl/UserInfo/Add?format=json', body],
  ['POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', { UserInfoSearchCond: { searchID: 'w', searchResultPosition: 0, maxResults: 1 } }],
  ['POST', '/ISAPI/AccessControl/AcsEvent?format=json', { AcsEventCond: { searchID: 'w', searchResultPosition: 0, maxResults: 1, major: 0, minor: 0 } }],
  ['POST', '/ISAPI/System/Time', { Time: { timeMode: 'manual', localTime: '2026-11-07T21:30:00+08:00', timeZone: 'CST-8:00:00' } }],
  ['GET',  '/ISAPI/System/time/capabilities', null],
  ['GET',  '/ISAPI/System/Network/interfaces/capabilities', null],
  ['GET',  '/ISAPI/AccessControl/UserInfo/Search?format=json', null],
];
for (const [m, p, d] of attempts) {
  try {
    const r = await req({ url: `http://${DEV.ip}${p}`, method: m, data: d });
    console.log(`  OK   ${r.status} ${m} ${p}`);
  } catch (err) {
    const s = err.response?.status ?? err.code;
    let det = '';
    try { const x = err.response?.data; det = (typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g,' ').slice(0,150); } catch { det = (err.message||'').slice(0,100); }
    console.log(`  FAIL ${s} ${m} ${p} — ${det}`);
  }
}
