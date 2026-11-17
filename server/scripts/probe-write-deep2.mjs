// Probe ronde 5: cari payload yang benar untuk Modify, dan endpoint door/remote control.
import axios from 'axios';
import crypto from 'crypto';
import xml2js from 'xml2js';

const DEV = { ip: '192.168.89.241', username: 'admin', password: process.env.DEVICE_MASUK_PASS };

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req({ url, method = 'GET', data = null, timeout = 8000, raw = false }) {
  const build = (auth) => {
    const cfg = { method, url, timeout, headers: {} };
    if (data !== null) {
      if (raw) { cfg.data = data; cfg.headers['Content-Type'] = 'application/xml'; }
      else { cfg.data = data; cfg.headers['Content-Type'] = 'application/json'; }
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

async function probe(method, path, data = null, opts = {}) {
  try {
    const r = await req({ url: `http://${DEV.ip}${path}`, method, data, raw: opts.raw });
    let preview = typeof r.data === 'string' ? r.data.replace(/\s+/g,' ').slice(0,200) : JSON.stringify(r.data);
    console.log(`  ✅ ${r.status} ${method} ${path}\n     ${preview}`);
    return { ok: true, body: r.data };
  } catch (err) {
    const s = err.response?.status ?? err.code;
    let det = '';
    try { const d = err.response?.data; det = (typeof d === 'string' ? d : JSON.stringify(d)).replace(/\s+/g,' ').slice(0,220); }
    catch { det = (err.message||'').slice(0,140); }
    console.log(`  ❌ ${s} ${method} ${path}\n     ${det}`);
    return { ok: false, detail: det };
  }
}

console.log('════ A. CAPABILITIES LENGKAP (tidak dipotong) ════');
for (const p of ['/ISAPI/AccessControl/capabilities', '/ISAPI/System/capabilities']) {
  const r = await probe('GET', p);
  if (r.ok) console.log('  FULL:', JSON.stringify(r.body, null, 1).slice(0, 2500));
}

console.log('\n════ B. USERINFO/MODIFY — cari payload yang diterima ════');
const uid = '900001';
const variants = [
  ['JSON lengkap', { UserInfo: {
    employeeNo: uid, name: 'PROBE', userType: 'normal', password: '',
    Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' },
    faceUrl: '', cardNo: '', faceEnabled: false, cardEnabled: false, fingerprintUrl: '',
    doorNo: [1], faceIndex: 1, faceID: 1, cardIndex: 1, cardID: 1, fingerprintIndex: 1, fingerprintID: 1,
  } }],
  ['JSON + rightPermission', { UserInfo: {
    employeeNo: uid, name: 'PROBE', userType: 'normal',
    Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' },
    rightPermission: { doorNo: [1], doorRight: { door: { privilege: { card: false, face: false, fingerprint: false, keypad: false } } } },
  } }],
  ['JSON + privilege', { UserInfo: {
    employeeNo: uid, name: 'PROBE', userType: 'normal',
    Valid: { enable: true, timeType: 'UTC', beginTime: '1970-01-01T00:00:00Z', endTime: '2037-01-01T00:00:00Z' },
    privilege: { card: [], face: [], fingerprint: [], keypad: [] },
  } }],
  ['JSON minimal + employeeNo string', { UserInfo: { employeeNo: uid, name: 'PROBE', userType: 'normal' } }],
  ['JSON tanpa Valid', { UserInfo: { employeeNo: uid, name: 'PROBE', userType: 'normal', cardNo: '' } }],
];
for (const [label, body] of variants) {
  console.log(` -- ${label}`);
  await probe('PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', body);
}

console.log('\n════ C. XML payload untuk Modify ════');
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<UserInfo>
  <employeeNo>${uid}</employeeNo>
  <name>PROBE</name>
  <userType>normal</userType>
  <Valid><enable>true</enable><timeType>UTC</timeType><beginTime>1970-01-01T00:00:00Z</beginTime><endTime>2037-01-01T00:00:00Z</endTime></Valid>
</UserInfo>`;
await probe('PUT', '/ISAPI/AccessControl/UserInfo/Modify', xml, { raw: true });
await probe('POST', '/ISAPI/AccessControl/UserInfo/Modify', xml, { raw: true });
await probe('PUT', '/ISAPI/AccessControl/UserInfo/Add', xml, { raw: true });
await probe('POST', '/ISAPI/AccessControl/UserInfo/Add', xml, { raw: true });

console.log('\n════ D. DOOR / REMOTE CONTROL (capabilities bilang support) ════');
for (const [m, p, d] of [
  ['GET',  '/ISAPI/AccessControl/Door?format=json', null],
  ['GET',  '/ISAPI/AccessControl/AcsDoor/config?format=json', null],
  ['GET',  '/ISAPI/AccessControl/Door/config?format=json', null],
  ['GET',  '/ISAPI/AccessControl/RemoteControl?format=json', null],
  ['POST', '/ISAPI/AccessControl/RemoteControl/door?format=json', { cmd: 'open', doorNo: 1 }],
  ['POST', '/ISAPI/AccessControl/AcsDoor/remote?format=json', { doorNo: 1 }],
  ['GET',  '/ISAPI/AccessControl/DoorStatus?format=json', null],
  ['GET',  '/ISAPI/AccessControl/Door/Status?format=json', null],
  ['POST', '/ISAPI/AccessControl/Door/remoteControl?format=json', { doorNo: 1, command: 'open' }],
  ['GET',  '/ISAPI/IntelligentAnalysis/General/Event/notification?format=json', null],
  ['POST', '/ISAPI/Event/notification?format=json', { EventDescription: { eventType: 'all' } }],
]) await probe(m, p, d);

console.log('\n════ E. EVENT STREAM (subscribe) ════');
for (const [m, p, d] of [
  ['GET',  '/ISAPI/Event/capabilities', null],
  ['GET',  '/ISAPI/Event/notification/capabilities', null],
  ['POST', '/ISAPI/Event/notification?format=json', { EventDescription: { eventType: 'all' } }],
  ['GET',  '/ISAPI/Streaming/channels', null],
  ['GET',  '/ISAPI/Smart/SpeedStar/channels', null],
  ['GET',  '/ISAPI/Smart/Other/capabilities', null],
  ['GET',  '/ISAPI/Smart/Other?format=json', null],
]) await probe(m, p, d);
