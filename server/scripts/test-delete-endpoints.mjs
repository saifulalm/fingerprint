// Uji end-to-end: hapus karyawan & hapus jadwal lewat API.
//
// MASALAH YANG DISELESAIKAN:
//   Frontend memakai `api.del(...)` — alias yang TIDAK ADA di axios.
//   Panggilan itu melempar TypeError, tertangkap catch, lalu diterjemahkan
//   jadi toast generik. Akibatnya user menekan "Hapus" dan tidak terjadi
//   apa pun — atau melihat pesan gagal tanpa penjelasan.
//
// Script ini memakai endpoint DELETE yang BENAR dan memastikan datanya
// benar-benar hilang (bukan hanya balasan 200).
//
// Dijalankan: node scripts/test-delete-endpoints.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TEST_BASE_URL || 'http://localhost:6601';

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

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function req(method, url, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

console.log('\n=== UJI ENDPOINT HAPUS (Fingerprint Attendance) ===\n');

const login = await req('POST', '/api/auth/login', {
  body: { username: env.ADMIN_USER || 'admin', password: env.ADMIN_PASS || 'admin123' },
});
if (login.status !== 200 || !login.data?.token) {
  console.error('  ❌ Login gagal (status:', login.status, ')');
  process.exit(1);
}
const token = login.data.token;
check('Login admin berhasil', true);

// ─── Hapus karyawan ──────────────────────────────────────────────────────────
console.log('\n── DELETE /api/employees/:employeeNo ──');
const TEST_NO = '990001';
const created = await req('POST', '/api/employees', {
  token,
  body: { employeeNo: TEST_NO, name: 'Uji Hapus Sementara', deviceKey: 'masuk' },
});
check('karyawan uji dibuat', created.status === 200 || created.status === 201, `status=${created.status}`);

const before = await req('GET', '/api/employees', { token });
const rows = Array.isArray(before.data?.data) ? before.data.data : [];
check('karyawan uji ada sebelum dihapus', rows.some((r) => r.employeeNo === TEST_NO));

const del = await req('DELETE', `/api/employees/${TEST_NO}`, { token });
check('DELETE mengembalikan 200', del.status === 200, `status=${del.status}`);
check('  respons menandai soft-delete', del.data?.softDeleted === true, JSON.stringify(del.data));
check('  respons melaporkan jumlah baris', typeof del.data?.disabled === 'number', JSON.stringify(del.data));

const after = await req('GET', '/api/employees', { token });
const rowsAfter = Array.isArray(after.data?.data) ? after.data.data : [];
const row = rowsAfter.find((r) => r.employeeNo === TEST_NO);
// Baris TIDAK hilang fisik (soft-delete) tapi enabled=false.
check(
  'baris ditandai enabled=false (soft delete)',
  !row || row.enabled === false,
  row ? `enabled=${row.enabled}` : 'baris hilang',
);

// ─── Hapus jadwal ────────────────────────────────────────────────────────────
console.log('\n── DELETE /api/scheduler/:id ──');
const sched = await req('POST', '/api/scheduler', {
  token,
  body: { name: 'Uji Hapus Sementara', cronExpr: '0 9 * * *', channel: 'email', enabled: false },
});
check('jadwal uji dibuat', sched.status === 201, `status=${sched.status}`);
const schedId = sched.data?.id;

if (schedId) {
  const delSched = await req('DELETE', `/api/scheduler/${schedId}`, { token });
  check('DELETE jadwal mengembalikan 200', delSched.status === 200, `status=${delSched.status}`);

  const list = await req('GET', '/api/scheduler', { token });
  const schedList = Array.isArray(list.data) ? list.data : [];
  check('jadwal benar-benar hilang dari daftar', !schedList.some((s) => s.id === schedId));
} else {
  check('jadwal uji dibuat', false, 'tidak dapat membuat jadwal uji');
}

console.log(`\n=== HASIL: ${pass} lolos, ${fail} gagal ===\n`);
process.exit(fail > 0 ? 1 : 0);
