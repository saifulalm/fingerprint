// Uji integrasi guard keamanan — dijalankan langsung ke server dev.
//
// Script ini membaca ADMIN_PASS dari .env (TIDAK pernah mencetaknya),
// login, lalu memeriksa bahwa guard benar-benar menolak payload berbahaya.
//
// Dijalankan: node scripts/test-security-guards.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TEST_BASE_URL || 'http://localhost:6601';

// ─── Baca kredensial dari .env tanpa mencetak password ───────────────────────
function readEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = readEnv();
const ADMIN_USER = env.ADMIN_USER || 'admin';
const ADMIN_PASS = env.ADMIN_PASS || 'admin123';

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(method, url, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

console.log('\n=== UJI GUARD KEAMANAN (Fingerprint Attendance) ===\n');

// ─── 1. Login ────────────────────────────────────────────────────────────────
const login = await req('POST', '/api/auth/login', {
  body: { username: ADMIN_USER, password: ADMIN_PASS },
});
if (login.status !== 200 || !login.data?.token) {
  console.error('  ❌ Login gagal — tidak bisa menguji guard yang butuh token.');
  console.error('     (status:', login.status, ')');
  process.exit(1);
}
const token = login.data.token;
check('Login admin berhasil', true);

console.log('\n── Guard 1: hapus log audit tanpa parameter "days" ──');
const auditNoDays = await req('DELETE', '/api/admin/audit', { token });
check(
  'DELETE /api/admin/audit tanpa days DITOLAK (400)',
  auditNoDays.status === 400,
  `status=${auditNoDays.status}`,
);
check(
  '  pesan menjelaskan parameter yang wajib',
  typeof auditNoDays.data?.error === 'string' && auditNoDays.data.error.includes('days'),
  JSON.stringify(auditNoDays.data),
);

console.log('\n── Guard 2: hapus log audit dengan days tidak valid ──');
const auditBadDays = await req('DELETE', '/api/admin/audit?days=abc', { token });
check('days="abc" DITOLAK (400)', auditBadDays.status === 400, `status=${auditBadDays.status}`);

const auditNegDays = await req('DELETE', '/api/admin/audit?days=-5', { token });
check('days=-5 DITOLAK (400)', auditNegDays.status === 400, `status=${auditNegDays.status}`);

console.log('\n── Guard 3: settings hanya menerima kunci yang dikenal ──');
const settingsBad = await req('PUT', '/api/settings', {
  token,
  body: { company_name: 'PT Guard Test', definitely_not_a_real_key: 'boom' },
});
check(
  'kunci tak dikenal DITOLAK',
  settingsBad.status === 200 && Array.isArray(settingsBad.data?.rejected),
  JSON.stringify(settingsBad.data),
);
check(
  '  kunci tak dikenal dilaporkan di `rejected`',
  settingsBad.data?.rejected?.includes('definitely_not_a_real_key'),
  JSON.stringify(settingsBad.data?.rejected),
);
check(
  '  kunci yang dikenal tetap tersimpan',
  settingsBad.data?.settings?.company_name === 'PT Guard Test',
  JSON.stringify(settingsBad.data?.settings?.company_name),
);

console.log('\n── Guard 4: schedule menolak field di luar daftar ──');
const schedBadChannel = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Guard Test', cronExpr: '0 9 * * *', channel: 'emial' },
});
check('channel="emial" DITOLAK (400)', schedBadChannel.status === 400, `status=${schedBadChannel.status}`);

const schedBadPeriod = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Guard Test', cronExpr: '0 9 * * *', period: 'lastyear' },
});
check('period="lastyear" DITOLAK (400)', schedBadPeriod.status === 400, `status=${schedBadPeriod.status}`);

const schedBadEnabled = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Guard Test', cronExpr: '0 9 * * *', enabled: 'false' },
});
check(
  'enabled="false" (string) DITOLAK (400)',
  schedBadEnabled.status === 400,
  `status=${schedBadEnabled.status}`,
);

console.log('\n── Guard 5: SSRF — gateway WA ke alamat internal ──');
const ssrfMeta = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Guard Test', cronExpr: '0 9 * * *', waGatewayUrl: 'http://169.254.169.254/latest/meta-data/' },
});
check('metadata cloud DITOLAK (400)', ssrfMeta.status === 400, `status=${ssrfMeta.status}`);

const ssrfLocal = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Guard Test', cronExpr: '0 9 * * *', waGatewayUrl: 'http://127.0.0.1:6601/api/settings' },
});
check('loopback DITOLAK (400)', ssrfLocal.status === 400, `status=${ssrfLocal.status}`);

const ssrfPriv = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Guard Test', cronExpr: '0 9 * * *', waGatewayUrl: 'http://192.168.89.240/' },
});
check('IP privat DITOLAK (400)', ssrfPriv.status === 400, `status=${ssrfPriv.status}`);

console.log('\n── Guard 6: employees menolak deviceKey tak dikenal ──');
const empBadDevice = await req('POST', '/api/employees', {
  token,
  body: { employeeNo: '999999', name: 'Guard Test', deviceKey: 'perangkat-hantu' },
});
check('deviceKey tak dikenal DITOLAK (400)', empBadDevice.status === 400, `status=${empBadDevice.status}`);

console.log('\n── Guard 7: pagination tidakival di-normalisasi ──');
const badPage = await req('POST', '/api/attendance/db', {
  token,
  body: { startDate: '2026-01-01', endDate: '2026-01-31', page: 'abc', pageSize: 'xyz' },
});
check(
  'page/pageSize non-numerik tidak menyebabkan 500',
  badPage.status === 200,
  `status=${badPage.status} ${JSON.stringify(badPage.data)?.slice(0, 120)}`,
);
check(
  '  page default ke 1',
  badPage.data?.page === 1,
  `page=${badPage.data?.page}`,
);
check(
  '  pageSize default ke 25',
  badPage.data?.pageSize === 25,
  `pageSize=${badPage.data?.pageSize}`,
);

const hugePage = await req('POST', '/api/attendance/db', {
  token,
  body: { startDate: '2026-01-01', endDate: '2026-01-31', pageSize: 100000 },
});
check(
  'pageSize dibatasi (tidak 100000)',
  hugePage.status === 200 && hugePage.data?.pageSize <= 500,
  `status=${hugePage.status} pageSize=${hugePage.data?.pageSize}`,
);

console.log('\n── Guard 8: auth middleware menolak path extend ──');
const bypass = await req('GET', '/api/auth/login/anything');
check(
  'GET /api/auth/login/anything tidak melewati auth (401)',
  bypass.status === 401,
  `status=${bypass.status}`,
);

console.log('\n── Guard 9: endpoint tervalidasi masih berfungsi ──');
const emps = await req('GET', '/api/employees', { token });
check('GET /api/employees tetap 200', emps.status === 200, `status=${emps.status}`);

const settings = await req('GET', '/api/settings', { token });
check('GET /api/settings tetap 200', settings.status === 200, `status=${settings.status}`);

console.log(`\n=== HASIL: ${pass} lolos, ${fail} gagal ===\n`);
process.exit(fail > 0 ? 1 : 0);
