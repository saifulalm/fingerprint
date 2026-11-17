// Probe 2: kapabilitas DELETE user + dump mentah peta kapabilitas.
//
// Delete diuji dengan employeeNo yang TIDAK ADA (999999). Kalau endpoint-nya
// dikenali perangkat, jawabannya berbeda dari "user tidak ditemukan" —
// itu yang membuktikan endpoint Delete terdaftar di firmware.
//。接着 lalu dump JSON capabilities mentah supaya flag booleannya bisa
// dibaca (xml2js/axios bisa mengubah bentuknya).
import axios from 'axios';
import crypto from 'crypto';

const DEVS = [
  { key: 'masuk', ip: process.env.DEVICE_MASUK_IP || '192.168.89.241', username: process.env.DEVICE_MASUK_USER || 'admin', password: process.env.DEVICE_MASUK_PASS || 'Hikvision12' },
  { key: 'keluar', ip: process.env.DEVICE_KELUAR_IP || '192.168.89.240', username: process.env.DEVICE_KELUAR_USER || 'admin', password: process.env.DEVICE_KELUAR_PASS || 'Hikvision12' },
];

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

async function req(dev, { url, method = 'GET', data = null, timeout = 10000 }) {
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
    const ha1 = md5(`${dev.username}:${realm}:${dev.password}`);
    const ha2 = md5(`${method.toUpperCase()}:${uri}`);
    const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="${dev.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    auth += `, response="${resp}"`;
    return axios(build(auth));
  }
}

function errInfo(e) {
  const d = e.response?.data;
  const sub = d?.subStatusCode || d?.statusString || (typeof d === 'string' ? d.replace(/\s+/g, ' ').slice(0, 120) : '');
  return `${e.response?.status ?? 'ERR'} ${sub}`.trim();
}

const MISSING = '999999';

for (const dev of DEVS) {
  console.log(`\n══════════ ${dev.key} (${dev.ip}) ══════════`);

  console.log('— A. DELETE dengan employeeNo yang TIDAK ADA (999999) —');
  const attempts = [
    ['PUT UserInfo/Delete', 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: MISSING } }],
    ['PUT UserInfo/Delete +q', 'PUT', `/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=${MISSING}`, { UserInfo: { employeeNo: MISSING } }],
    ['POST UserInfo/Delete', 'POST', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfo: { employeeNo: MISSING } }],
    ['DELETE UserInfo/Delete', 'DELETE', `/ISAPI/AccessControl/UserInfo/Delete?format=json&employeeNo=${MISSING}`, null],
    ['PUT UserInfo/Detail/Delete', 'PUT', '/ISAPI/AccessControl/UserInfo/Detail/Delete?format=json', { UserInfo: { employeeNo: MISSING } }],
    ['POST UserInfo/Detail/Delete', 'POST', '/ISAPI/AccessControl/UserInfo/Detail/Delete?format=json', { UserInfo: { employeeNo: MISSING } }],
    ['PUT UserInfoDetail/Delete', 'PUT', '/ISAPI/AccessControl/UserInfoDetail/Delete?format=json', { UserInfo: { employeeNo: MISSING } }],
  ];
  for (const [label, method, path, body] of attempts) {
    try {
      const rr = await req(dev, { url: `http://${dev.ip}${path}`, method, data: body });
      console.log(`  ✅ [${label}] → ${rr.status} ${JSON.stringify(rr.data).slice(0, 120)}`);
    } catch (e) {
      console.log(`  ❌ [${label}] → ${errInfo(e)}`);
    }
  }

  console.log('\n— B. Flag kapabilitas mentah (AccessControl) —');
  try {
    const rr = await req(dev, { url: `http://${dev.ip}/ISAPI/AccessControl/capabilities?format=json` });
    console.log(JSON.stringify(rr.data, null, 1).slice(0, 3000));
  } catch (e) {
    console.log('  ERR', errInfo(e));
  }
}
