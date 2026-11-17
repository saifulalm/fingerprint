// Probe final: ambil struktur user existing persis dari perangkat, lalu PUT balik
// dengan nama diubah. Ini cara kanonik untuk write ISAPI.
import axios from 'axios';
import crypto from 'crypto';

const DEV = { ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS };

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

// 1) Ambil user existing
const sid = 'final' + Date.now();
const r = await req({
  url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Search?format=json`,
  method: 'POST',
  data: { UserInfoSearchCond: { searchID: sid, searchResultPosition: 0, maxResults: 3 } },
});
const ui = r.data.UserInfoSearch || {};
const list = Array.isArray(ui.UserInfo) ? ui.UserInfo : (ui.UserInfo ? [ui.UserInfo] : []);
console.log('═══ STRUKTUR USER PERTAMA DARI PERANGKAT ═══');
console.log(JSON.stringify(list[0], null, 1));
const target = list[0];
if (!target) { console.log('TIDAK ADA USER'); process.exit(0); }

// 2) Try search by employeeNo (endpoint read by id)
for (const p of [
  `/ISAPI/AccessControl/UserInfo/Search?format=json&employeeNo=${target.employeeNo}`,
  `/ISAPI/AccessControl/UserInfo/Search?format=json&searchID=${sid}&searchResultPosition=0`,
]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${p}`, method: 'GET' });
    console.log(`✅ GET ${p} → ${JSON.stringify(rr.data).slice(0, 200)}`);
  } catch (e) {
    console.log(`❌ GET ${p} → ${(e.response?.status)} ${(e.response?.data?.subStatusCode||'')}`);
  }
}

// 3) PUT balik user existing dengan nama UJI (restore setelahnya)
const clone = JSON.parse(JSON.stringify(target));
clone.name = 'UJI_WRITE';
console.log('\n═══ PUT Modify user EXISTING dengan nama diubah ═══');
for (const [label, body] of [
  ['payload asli + name', clone],
  ['payload asli tanpa key kosong', Object.fromEntries(Object.entries(clone).filter(([,v]) => v !== '' && v != null))],
]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}/ISAPI/AccessControl/UserInfo/Modify?format=json`, method: 'PUT', data: body });
    console.log(`✅ [${label}] PUT → ${rr.status} ${JSON.stringify(rr.data).slice(0,160)}`);
  } catch (e) {
    console.log(`❌ [${label}] PUT → ${e.response?.status} ${JSON.stringify(e.response?.data||e.message).slice(0,160)}`);
  }
}

// 4) DELETE user existing (dengan payload)
for (const [m, p] of [['PUT','/ISAPI/AccessControl/UserInfo/Delete?format=json'], ['POST','/ISAPI/AccessControl/UserInfo/Delete?format=json']]) {
  try {
    const rr = await req({ url: `http://${DEV.ip}${p}`, method: m, data: { UserInfo: { employeeNo: target.employeeNo } } });
    console.log(`✅ ${m} Delete → ${rr.status}`);
  } catch (e) {
    console.log(`❌ ${m} Delete → ${e.response?.status} ${JSON.stringify(e.response?.data||e.message).slice(0,140)}`);
  }
}
