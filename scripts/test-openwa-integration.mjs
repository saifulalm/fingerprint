// Uji integrasi OpenWA end-to-end terhadap API BioClock.
// Menjalankan alur: login → status → connect → QR → send → report/whatsapp.

const API = process.env.TEST_API || 'http://localhost:6699';
const MOCK = process.env.MOCK_API || 'http://localhost:2785';
const MOCK_KEY = 'test-key';

const log = (...a) => console.log(...a);
const ok = (c) => (c ? '✓' : '✗');

async function json(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  log(`${ok(pass)} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ── 1. Login ──────────────────────────────────────────────────────────────
  const login = await json(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const token = login.body?.accessToken || login.body?.data?.accessToken || login.body?.token;
  check('Login berhasil', login.status === 200 && !!token, `status=${login.status}`);
  if (!token) { log(JSON.stringify(login.body)); process.exit(1); }

  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── 2. Status awal ────────────────────────────────────────────────────────
  const st = await json(`${API}/api/whatsapp/status`, { headers: H });
  check(
    'Status melaporkan gateway terkonfigurasi',
    st.body?.isGatewayConfigured === true,
    `mode=${st.body?.mode} status=${st.body?.status}`,
  );
  check(
    'Status mengembalikan URL gateway',
    typeof st.body?.gatewayStatus?.gateway === 'string',
    st.body?.gatewayStatus?.gateway,
  );
  check(
    'Status memetakan status OpenWA (lowercase)',
    typeof st.body?.gatewayStatus?.rawState === 'string',
    `rawState=${st.body?.gatewayStatus?.rawState}`,
  );

  // ── 3. Sesi dibuat otomatis + hanya SATU sesi ─────────────────────────────
  const count1 = await json(`${MOCK}/__mock/count`, { headers: { 'X-API-Key': MOCK_KEY } });
  check(
    'Sesi OpenWA dibuat otomatis',
    count1.body?.count === 1,
    `count=${count1.body?.count} ids=${JSON.stringify(count1.body?.ids)}`,
  );

  // ── 4. Connect → sesi di-start + QR dikembalikan ──────────────────────────
  const conn = await json(`${API}/api/whatsapp/connect`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ fresh: false }),
  });
  check(
    'Connect mengembalikan mode gateway',
    conn.body?.mode === 'gateway',
    `status=${conn.body?.status} msg=${conn.body?.message}`,
  );
  check(
    'Connect mengembalikan QR (PNG data-URL)',
    typeof conn.body?.qr === 'string' && conn.body.qr.startsWith('data:image/png'),
    (conn.body?.qr || '').slice(0, 30),
  );
  check(
    'Connect mengembalikan sessionId (UUID)',
    typeof conn.body?.sessionId === 'string' && conn.body.sessionId.length > 0,
    conn.body?.sessionId,
  );

  // ── 5. Tidak ada sesi duplikat setelah polling berkali-kali ──────────────
  for (let i = 0; i < 3; i++) await json(`${API}/api/whatsapp/status`, { headers: H });
  const count2 = await json(`${MOCK}/__mock/count`, { headers: { 'X-API-Key': MOCK_KEY } });
  check(
    'Polling tidak membuat sesi duplikat',
    count2.body?.count === 1,
    `count=${count2.body?.count}`,
  );

  // ── 6. Tandai sesi ready, lalu status harus "connected" ──────────────────
  const sid = conn.body?.sessionId;
  await json(`${MOCK}/__mock/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': MOCK_KEY },
    body: JSON.stringify({ id: sid }),
  });
  const st2 = await json(`${API}/api/whatsapp/status`, { headers: H });
  check(
    'Status "ready" dipetakan ke connected',
    st2.body?.status === 'connected',
    `status=${st2.body?.status} raw=${st2.body?.gatewayStatus?.rawState}`,
  );

  // ── 7. Kirim pesan dengan nomor Indonesia format lokal ───────────────────
  const send = await json(`${API}/api/whatsapp/send`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ to: '08123456789', text: 'Halo dari BioClock' }),
  });
  check(
    'Kirim pesan sukses (nomor 08xx → 62xx)',
    send.status === 200 && send.body?.success === true,
    `status=${send.status} messageId=${send.body?.messageId}`,
  );

  // ── 8. chatId yang dipakai harus JID valid (bukan nomor polos) ────────────
  const sent = await json(`${MOCK}/__mock/last-send`, { headers: { 'X-API-Key': MOCK_KEY } });
  check(
    'chatId dikirim sebagai JID (localpart@host)',
    typeof sent.body?.chatId === 'string' && sent.body.chatId.includes('@'),
    sent.body?.chatId,
  );
  check(
    'Nomor Indonesia dinormalisasi leading 0 → 62',
    String(sent.body?.chatId || '').startsWith('628123456789@'),
    sent.body?.chatId,
  );

  // ── 9. report/whatsapp benar-benar MENGIRIM (bukan hanya bikin teks) ────
  const rep = await json(
    `${API}/api/report/whatsapp?startDate=2026-11-01&endDate=2026-11-07&lang=id&recipients=08123456789,628999888777`,
    { headers: H },
  );
  check(
    'report/whatsapp mengirim ke semua penerima',
    rep.body?.sentCount === 2 && rep.body?.failedCount === 0,
    `sent=${rep.body?.sentCount} failed=${rep.body?.failedCount}`,
  );
  check(
    'report/whatsapp mengembalikan hasil per-penerima',
    Array.isArray(rep.body?.results) && rep.body.results.length === 2,
    JSON.stringify(rep.body?.results?.map(r => r.to)),
  );

  // ── 10. Error chatId invalid harus ditolak gateway (bukan crash) ──────────
  const bad = await json(`${API}/api/whatsapp/send`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ to: 'bukan-nomor', text: 'x' }),
  });
  check(
    'Nomor tidak valid ditolak dengan pesan jelas',
    bad.status >= 400 && /tidak valid|valid/i.test(JSON.stringify(bad.body || '')),
    `status=${bad.status} body=${JSON.stringify(bad.body).slice(0, 120)}`,
  );

  // ── 11. Gateway mati tidak boleh menggantung (timeout) ───────────────────
  // Halaman WhatsApp mem-polling tiap 5 detik — gateway yang tidak merespons
  // harus gagal CEPAT, bukan membekukan polling.
  const t0 = Date.now();
  const down = await json(`${API}/api/whatsapp/status`, {
    headers: { ...H },
    signal: AbortSignal.timeout(20000),
  });
  const elapsed = Date.now() - t0;
  check(
    'Status tetap merespons (< 20 detik) walau gateway lambat',
    elapsed < 20000,
    `elapsed=${elapsed}ms status=${down.status}`,
  );

  // ── Ringkasan ─────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.pass);
  log('\n' + '─'.repeat(64));
  log(`TOTAL: ${results.length}  LULUS: ${results.length - failed.length}  GAGAL: ${failed.length}`);
  if (failed.length) {
    log('\nGAGAL:');
    failed.forEach(f => log(`  ✗ ${f.name} — ${f.detail || ''}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
