// Probe mendalam: kapabilitas write pada DS-K1T8003MF.
// Tester: endpoint capabilities, variasi method, variasi payload, jalur alternatif.
import axios from 'axios';
import crypto from 'crypto';
import xml2js from 'xml2js';

const DEV = { ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS };

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req({ url, method = 'GET', data = null, timeout = 8000, headers = {} }) {
  const build = (auth) => {
    const cfg = { method, url, timeout, headers: { ...headers } };
    if (data !== null) {
      cfg.data = typeof data === 'string' ? data : JSON.stringify(data);
      cfg.headers['Content-Type'] = cfg.headers['Content-Type'] || 'application/json';
    }
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

async function probe(label, { method = 'GET', path, data = null, headers = {} }) {
  const url = `http://${DEV.ip}${path}`;
  try {
    const r = await req({ url, method, data, headers });
    let body = r.data;
    let preview;
    if (typeof body === 'string' && body.trim().startsWith('<')) {
      try { preview = JSON.stringify(await xml2js.parseStringPromise(body, { explicitArray: false })); }
      catch { preview = body.replace(/\s+/g, ' ').slice(0, 200); }
    } else {
      preview = JSON.stringify(body);
    }
    console.log(`  ✅ ${r.status} ${method} ${path}\n     ${String(preview).slice(0, 320)}`);
    return { ok: true, status: r.status, body };
  } catch (err) {
    const s = err.response?.status ?? err.code ?? 'ERR';
    let det = '';
    try {
      const d = err.response?.data;
      det = (typeof d === 'string' ? d : JSON.stringify(d)).replace(/\s+/g, ' ').slice(0, 200);
    } catch { det = (err.message || '').slice(0, 130); }
    console.log(`  ❌ ${s} ${method} ${path}\n     ${det}`);
    return { ok: false, status: s, detail: det };
  }
}

console.log('════════ 1. CAPABILITIES (apa yang didukung perangkat) ════════');
for (const p of [
  '/ISAPI/System/deviceInfo/capabilities',
  '/ISAPI/System/time/capabilities',
  '/ISAPI/System/Network/interfaces/capabilities',
  '/ISAPI/AccessControl/UserInfo/Search/capabilities',
  '/ISAPI/AccessControl/AcsEvent/capabilities',
  '/ISAPI/AccessControl/capabilities',
  '/ISAPI/System/capabilities',
  '/ISAPI/Security/capabilities',
]) await probe('cap', { path: p });

console.log('\n════════ 2. WRITE USER — variasi method & payload ════════');
const uid = '900001';
const fullUser = {
  UserInfo: {
    employeeNo: uid, name: 'PROBE WRITE', userType: 'normal',
    Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' },
  },
};
const minimalUser = { UserInfo: { employeeNo: uid, name: 'PROBE WRITE', userType: 'normal' } };
for (const [m, p, d] of [
  ['POST', '/ISAPI/AccessControl/UserInfo/Add', fullUser],
  ['POST', '/ISAPI/AccessControl/UserInfo/Add?format=json', fullUser],
  ['PUT',  '/ISAPI/AccessControl/UserInfo/Add?format=json', fullUser],
  ['POST', '/ISAPI/AccessControl/UserInfo/Add', minimalUser],
  ['POST', '/ISAPI/AccessControl/UserInfo/Add?format=json', minimalUser],
  ['POST', '/ISAPI/AccessControl/UserInfo/Modify?format=json', fullUser],
  ['PUT',  '/ISAPI/AccessControl/UserInfo/Modify?format=json', fullUser],
  ['POST', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: uid } }],
  ['DELETE', '/ISAPI/AccessControl/UserInfo?format=json&employeeNo=' + uid, null],
]) await probe('user', { method: m, path: p, data: d });

console.log('\n════════ 3. WRITE TIME / NETWORK ════════');
for (const [m, p, d] of [
  ['PUT',  '/ISAPI/System/time', { Time: { timeMode: 'manual', localTime: '2026-11-07T21:30:00+08:00', timeZone: 'CST-8:00:00' } }],
  ['PUT',  '/ISAPI/System/time?format=json', { Time: { timeMode: 'manual', localTime: '2026-11-07T21:30:00+08:00', timeZone: 'CST-8:00:00' } }],
  ['PUT',  '/ISAPI/System/Network/interfaces', { NetworkInterface: { id: '1' } }],
  ['POST', '/ISAPI/System/Network/interfaces/Modify?format=json', { NetworkInterface: { id: '1' } }],
]) await probe('sys', { method: m, path: p, data: d });

console.log('\n════════ 4. JALUR ALTERNATIF (v1 API / non-ISAPI) ════════');
for (const [m, p, d] of [
  ['POST', '/ISAPI/AccessControl/UserInfo/Add', null],
  ['GET',  '/ISAPI/AccessControl/UserInfo?format=json&employeeNo=' + uid, null],
  ['POST', '/ISAPI/AccessControl/AcsEvent?format=json', null],
  ['GET',  '/ISAPI/AccessControl/AcsEvent?format=json', null],
  ['POST', '/ISAPI/Smart/attendance/statistics?format=json', { AttendanceStatistic: { searchID: 's1', searchResultPosition: 0, maxResults: 5 } }],
  ['GET',  '/ISAPI/Smart/attendance/statistics?format=json', null],
  ['GET',  '/ISAPI/AccessControl/FaceParam?format=json', null],
  ['GET',  '/ISAPI/AccessControl/FaceData?format=json', null],
  ['GET',  '/ISAPI/IntelligentAnalysis/General/Event/capabilities', null],
  ['POST', '/ISAPI/IntelligentAnalysis/General/Event/notification?format=json', { EventDescription: { eventType: 'all' } }],
  ['GET',  '/ISAPI/Security/ONVIF/userList/capabilities', null],
  ['GET',  '/ISAPI/ContentMgmt/ServerInfo/capabilities', null],
  ['GET',  '/ISAPI/System/Backup/capabilities', null],
  ['GET',  '/ISAPI/Log/capabilities', null],
  ['GET',  '/ISAPI/System/Log/capabilities', null],
  ['GET',  '/ISAPI/AccessControl/AccessControlWorkingMode?format=json', null],
  ['GET',  '/ISAPI/AccessControl/UserInfo/Search?format=json&searchID=x', null],
]) await probe('alt', { method: m, path: p, data: d });

console.log('\n════════ 5. ROOT DISCOVERY ════════');
await probe('root', { path: '/ISAPI' });
await probe('root2', { path: '/ISAPI/System' });
await probe('root3', { path: '/ISAPI/AccessControl' });
