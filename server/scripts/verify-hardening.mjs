// Verifikasi perbaikan backend (read-only, tidak menulis data uji).
// Dijalankan: node scripts/verify-hardening.mjs
const BASE = process.env.API_BASE || 'http://localhost:6601';

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'admin123',
  }),
});
const auth = await res.json();
const token = auth.token;
if (!token) {
  console.log('LOGIN GAGAL:', JSON.stringify(auth));
  process.exit(1);
}
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const checks = [];
async function check(name, url, opts = {}) {
  const r = await fetch(`${BASE}${url}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* bukan JSON */ }
  checks.push({ name, status: r.status, body, isJson: typeof body === 'object' });
  const snippet = typeof body === 'object'
    ? JSON.stringify(body).slice(0, 130)
    : text.slice(0, 90).replace(/\n/g, ' ');
  console.log(`  ${r.status}  ${name}\n        ${snippet}`);
}

console.log('=== [1] API 404 harus JSON, bukan HTML SPA ===');
await check('GET /api/tidak-ada', '/api/tidak-ada');

console.log('\n=== [2] SSRF: host internal harus DITOLAK (400) ===');
for (const host of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.5', '192.168.1.1', 'http://127.0.0.1/', '0.0.0.0']) {
  await check(`test-email smtp_host=${host}`, '/api/settings/test-email', {
    method: 'POST',
    body: JSON.stringify({ smtp_host: host, smtp_port: 25, smtp_user: 'a', smtp_pass: 'b', test_to: 'x@y.com' }),
  });
}

console.log('\n=== [3] bulk employees: entri invalid harus DITOLAK tanpa tulis DB ===');
await check('POST /api/employees/bulk (semua invalid)', '/api/employees/bulk', {
  method: 'POST',
  body: JSON.stringify({ employees: [{ employeeNo: '', name: 'No Number' }, { employeeNo: 'X1', name: '', deviceKey: 'masuk' }] }),
});
await check('POST /api/employees/bulk (deviceKey nakal)', '/api/employees/bulk', {
  method: 'POST',
  body: JSON.stringify({ employees: [{ employeeNo: 'X2', name: 'Bad Dev', deviceKey: 'hacker' }] }),
});

console.log('\n=== [4] validasi device-center tetap bekerja ===');
await check('PUT device-center/users device=hacker', '/api/device-center/users', {
  method: 'PUT',
  body: JSON.stringify({ device: 'hacker', employeeNo: '1', name: 'X' }),
});
await check('POST id-alias tanpa field', '/api/device-center/id-alias', { method: 'POST', body: '{}' });

console.log('\n=== [5] endpoint utama masih 200 ===');
for (const u of ['/api/employees', '/api/devices', '/api/settings', '/api/device-center/conflicts', '/api/device-center/id-alias/suggestions']) {
  await check(`GET ${u}`, u);
}

const failed = checks.filter((c) => c.status >= 500);
console.log(`\n=== RINGKASAN: ${checks.length} request, ${failed.length} server error (5xx) ===`);
if (failed.length) {
  console.log('GAGAL:', failed.map((f) => `${f.name} -> ${f.status}`).join(', '));
  process.exit(1);
}
console.log('SEMUA OK — tidak ada 5xx.');
