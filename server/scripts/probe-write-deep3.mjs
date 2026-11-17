// Probe ronde 6: hak akses user admin + variasi method untuk Add/Delete/FP/Door.
import axios from 'axios';
import crypto from 'crypto';
import xml2js from 'xml2js';

const DEV = { ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS };

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req({ url, method = 'GET', data = null, timeout = 8000, ct = 'application/json' }) {
  const build = (auth) => {
    const cfg = { method, url, timeout, headers: {} };
    if (data !== null) { cfg.data = data; cfg.headers['Content-Type'] = ct; }
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

async function probe(label, method, path, data = null, ct = 'application/json') {
  try {
    const r = await req({ url: `http://${DEV.ip}${path}`, method, data, ct });
    let preview = typeof r.data === 'string' ? r.data.replace(/\s+/g,' ').slice(0,400) : JSON.stringify(r.data);
    console.log(`  ✅ ${r.status} ${method} ${path}  [${label}]\n     ${preview}`);
    return { ok: true, body: r.data };
  } catch (err) {
    const s = err.response?.status ?? err.code;
    let det = '';
    try { const d = err.response?.data; det = (typeof d === 'string' ? d : JSON.stringify(d)).replace(/\s+/g,' ').slice(0,260); }
    catch { det = (err.message||'').slice(0,140); }
    console.log(`  ❌ ${s} ${method} ${path}  [${label}]\n     ${det}`);
    return { ok: false, detail: det };
  }
}

console.log('════ A. USER AKUN PERANGKAT & HAK AKSES ════');
await probe('users list', 'GET', '/ISAPI/Security/users?format=json');
await probe('users list xml', 'GET', '/ISAPI/Security/users');
await probe('user self', 'GET', '/ISAPI/Security/users/1?format=json');
await probe('current user', 'GET', '/ISAPI/Security/users/current?format=json');

console.log('\n════ B. USERINFO ADD — semua method + content-type ════');
const uid = '900001';
const u = { UserInfo: { employeeNo: uid, name: 'PROBE', userType: 'normal',
  Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' } } };
await probe('POST json', 'POST', '/ISAPI/AccessControl/UserInfo/Add?format=json', u);
await probe('PUT json', 'PUT', '/ISAPI/AccessControl/UserInfo/Add?format=json', u);
await probe('POST json no-format', 'POST', '/ISAPI/AccessControl/UserInfo/Add', u);
await probe('PUT json no-format', 'PUT', '/ISAPI/AccessControl/UserInfo/Add', u);
await probe('POST xml ct', 'POST', '/ISAPI/AccessControl/UserInfo/Add?format=json', u, 'application/xml');
await probe('PUT xml ct', 'PUT', '/ISAPI/AccessControl/UserInfo/Add?format=json', u, 'application/xml');

console.log('\n════ C. USERINFO DELETE — semua method ════');
const d = { UserInfo: { employeeNo: uid } };
await probe('POST json', 'POST', '/ISAPI/AccessControl/UserInfo/Delete?format=json', d);
await probe('PUT json', 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', d);
await probe('DELETE json', 'DELETE', '/ISAPI/AccessControl/UserInfo/Delete?format=json', d);
await probe('POST no-format', 'POST', '/ISAPI/AccessControl/UserInfo/Delete', d);

console.log('\n════ D. DETAIL DELETE (capabilities: isSupportUserInfoDetailDelete) ════');
await probe('POST', 'POST', '/ISAPI/AccessControl/UserInfo/Detail/Delete?format=json', d);
await probe('POST detail', 'POST', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json', d);

console.log('\n════ E. FINGERPRINT / CARD CAPTURE (isSupportCaptureFingerPrint) ════');
await probe('GET fp cap', 'GET', '/ISAPI/AccessControl/FingerPrintConfig?format=json');
await probe('GET fp data', 'GET', '/ISAPI/AccessControl/FingerPrintData?format=json');
await probe('POST fp cap', 'POST', '/ISAPI/AccessControl/FingerPrintConfig/capabilities?format=json', {});
await probe('GET card cap', 'GET', '/ISAPI/AccessControl/CardInfo?format=json');
await probe('POST card cap', 'POST', '/ISAPI/AccessControl/CardInfo/capabilities?format=json', {});

console.log('\n════ F. EVENT TOTAL & ACS WORK STATUS ════');
await probe('GET total', 'GET', '/ISAPI/AccessControl/AcsEvent/TotalNum?format=json');
await probe('GET workstatus', 'GET', '/ISAPI/AccessControl/AcsWorkStatus?format=json');
await probe('GET clear events cap', 'GET', '/ISAPI/AccessControl/AcsEvent/capabilities');
await probe('GET deployinfo', 'GET', '/ISAPI/AccessControl/DeployInfo?format=json');
await probe('GET swversion', 'GET', '/ISAPI/AccessControl/SoftwareVersion?format=json');
