// Uji integrasi webhook OpenWA end-to-end.
//
// Alur yang diuji:
//   1. Receiver webhook PUBLIK (tanpa JWT) menerima event.
//   2. Signature HMAC valid → 200 dan event tercatat.
//   3. Signature HMAC TIDAK valid → 401 (payload palsu ditolak).
//   4. Delivery ulang dengan idempotencyKey yang sama → 200 duplicate,
//      dan TIDAK diproses dua kali.
//   5. Registrasi webhook ke gateway (POST /api/whatsapp/webhooks).
//   6. Daftar webhook, detail, test delivery, update, delete.
//   7. Delivery nyata dari mock gateway → aplikasi membalas (round-trip).
//   8. Riwayat event + statistik.
//
// Exit code 0 = semua lulus.

const API = process.env.TEST_API || 'http://localhost:6699';
const MOCK = process.env.MOCK_API || 'http://localhost:2785';
const MOCK_KEY = 'test-key';
const SECRET = 'test-secret-1234567890-abcdef';

const log = (...a) => console.log(...a);
const ok = (c) => (c ? '✓' : '✗');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  log(`${ok(pass)} ${name}${detail ? ' — ' + detail : ''}`);
}

async function json(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  }
}

async function main() {
  // ── 1. Login (untuk endpoint management) ─────────────────────────────────
  const login = await json(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const token = login.body?.accessToken || login.body?.data?.accessToken || login.body?.token;
  check('Login berhasil', login.status === 200 && !!token, `status=${login.status}`);
  if (!token) { log(JSON.stringify(login.body)); process.exit(1); }

  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── 2. Receiver PUBLIK: tanpa token harus tetap menerima ────────────────
  const noAuth = await json(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'message.received',
      timestamp: new Date().toISOString(),
      sessionId: 'sess-public-test',
      idempotencyKey: `pub_${Date.now()}`,
      deliveryId: 'dlv_pub',
      data: { from: '628123456789@c.us', body: 'hai' },
    }),
  });
  check(
    'Receiver webhook menerima tanpa JWT (publik)',
    noAuth.status === 200 && noAuth.body?.success === true,
    `status=${noAuth.status} body=${JSON.stringify(noAuth.body).slice(0, 140)}`,
  );

  // ── 3. Payload rusak harus ditolak 400 ───────────────────────────────────
  const badJson = await fetch(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bukan json',
  });
  check('Payload JSON rusak ditolak 400', badJson.status === 400, `status=${badJson.status}`);

  // ── 4. Daftarkan webhook ke gateway ──────────────────────────────────────
  const webhookUrl = `${API}/api/webhooks/openwa`;
  const reg = await json(`${API}/api/whatsapp/webhooks`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      url: webhookUrl,
      events: ['message.received', 'session.status'],
      secret: SECRET,
      retryCount: 3,
    }),
  });
  check(
    'Registrasi webhook ke gateway berhasil',
    reg.status === 201 && !!reg.body?.webhook?.id,
    `status=${reg.status} id=${reg.body?.webhook?.id} err=${reg.body?.error || ''}`,
  );
  const whId = reg.body?.webhook?.id;
  if (!whId) { log('Registrasi gagal — uji dihentikan.'); process.exit(1); }

  check(
    'Secret TIDAK dikembalikan ke frontend',
    reg.body?.webhook?.secret === undefined && reg.body?.webhook?.hasSecret === true,
    `hasSecret=${reg.body?.webhook?.hasSecret}`,
  );

  // ── 5. Webhook benar-benar terdaftar di gateway ──────────────────────────
  const mockHooks = await json(`${MOCK}/__mock/webhooks`, { headers: { 'X-API-Key': MOCK_KEY } });
  check(
    'Webhook tercatat di sisi gateway',
    mockHooks.body?.webhooks?.some((w) => w.id === whId),
    `count=${mockHooks.body?.count}`,
  );
  check(
    'Secret tidak dikembalikan gateway (write-only)',
    mockHooks.body?.webhooks?.every((w) => w.secret === undefined),
    'secret tidak boleh muncul di list',
  );

  // ── 6. Event tidak dikenal harus ditolak dengan pesan jelas ──────────────
  const badEvent = await json(`${API}/api/whatsapp/webhooks`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ url: webhookUrl, events: ['event.tidak.ada'] }),
  });
  check(
    'Event tidak dikenal ditolak 400',
    badEvent.status === 400 && /tidak dikenal/i.test(badEvent.body?.error || ''),
    `status=${badEvent.status} err=${(badEvent.body?.error || '').slice(0, 90)}`,
  );

  // ── 7. URL tidak valid ditolak ───────────────────────────────────────────
  const badUrl = await json(`${API}/api/whatsapp/webhooks`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ url: 'bukan-url' }),
  });
  check('URL tidak valid ditolak 400', badUrl.status === 400, `status=${badUrl.status}`);

  // ── 8. Secret terlalu pendek ditolak ────────────────────────────────────
  const shortSecret = await json(`${API}/api/whatsapp/webhooks`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ url: webhookUrl, secret: 'pendek' }),
  });
  check(
    'Secret < 16 karakter ditolak 400',
    shortSecret.status === 400 && /16 karakter/i.test(shortSecret.body?.error || ''),
    `status=${shortSecret.status} err=${(shortSecret.body?.error || '').slice(0, 90)}`,
  );

  // ── 9. Katalog event ─────────────────────────────────────────────────────
  const catalog = await json(`${API}/api/whatsapp/webhooks/events`, { headers: H });
  check(
    'Katalog event memuat message.received',
    Array.isArray(catalog.body?.events) && catalog.body.events.includes('message.received'),
    `jumlah=${catalog.body?.events?.length}`,
  );

  // ── 10. Delivery nyata dari mock gateway (round-trip) ───────────────────
  const sessionId = (await json(`${API}/api/whatsapp/status`, { headers: H })).body?.gatewayStatus?.sessionId;
  check('UUID sesi OpenWA tersedia', !!sessionId, sessionId);

  const emit = await json(`${MOCK}/__mock/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': MOCK_KEY },
    body: JSON.stringify({
      sessionId,
      event: 'message.received',
      idempotencyKey: `rt_${Date.now()}`,
      data: {
        id: `true_628123456789@c.us_${Date.now()}`,
        from: '628123456789@c.us',
        to: '628999888777@c.us',
        chatId: '628123456789@c.us',
        body: 'absen',
        type: 'text',
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: false,
        isGroup: false,
        kind: 'individual',
      },
    }),
  });
  check(
    'Mock gateway mengirim delivery ke aplikasi',
    emit.body?.delivered === 1 && emit.body?.results?.[0]?.status === 200,
    `delivered=${emit.body?.delivered} status=${emit.body?.results?.[0]?.status} err=${JSON.stringify(emit.body?.results?.[0]).slice(0, 120)}`,
  );

  // ── 11. Delivery ulang dengan kunci yang sama → duplikat ────────────────
  //
  // CATATAN: webhook sudah terdaftar dengan `secret`, jadi delivery WAJIB
  // membawa header X-OpenWA-Signature yang valid. Delivery tanpa signature
  // memang harus ditolak 401 (diuji terpisah di langkah 12).
  const crypto = await import('node:crypto');
  const dupKey = `dup_${Date.now()}`;
  const dupPayload = {
    event: 'message.received',
    timestamp: new Date().toISOString(),
    sessionId,
    idempotencyKey: dupKey,
    deliveryId: 'dlv_dup',
    data: { from: '628123456789@c.us', body: 'hai', chatId: '628123456789@c.us' },
  };
  const dupBody = JSON.stringify(dupPayload);
  const dupSig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(dupBody).digest('hex');
  const dupHeaders = { 'Content-Type': 'application/json', 'X-OpenWA-Signature': dupSig };
  const first = await json(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: dupHeaders,
    body: dupBody,
  });
  const second = await json(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: dupHeaders,
    body: dupBody,
  });
  check('Delivery pertama diproses', first.status === 200 && first.body?.duplicate === false, `status=${first.status}`);
  check(
    'Delivery kedua terdeteksi duplikat (tidak diproses dua kali)',
    second.status === 200 && second.body?.duplicate === true,
    `status=${second.status} duplicate=${second.body?.duplicate}`,
  );

  // ── 12. Signature salah harus ditolak 401 ────────────────────────────────
  const forged = await json(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenWA-Signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    },
    body: JSON.stringify({
      event: 'message.received',
      timestamp: new Date().toISOString(),
      sessionId,
      idempotencyKey: `forged_${Date.now()}`,
      deliveryId: 'dlv_forged',
      data: { from: '628999888777@c.us', body: 'palsu' },
    }),
  });
  check(
    'Signature HMAC salah ditolak 401',
    forged.status === 401,
    `status=${forged.status} body=${JSON.stringify(forged.body).slice(0, 120)}`,
  );

  // ── 12b. Signature TIDAK ADA saat secret terdaftar → 401 ─────────────────
  const noSig = await json(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'message.received',
      timestamp: new Date().toISOString(),
      sessionId,
      idempotencyKey: `nosig_${Date.now()}`,
      deliveryId: 'dlv_nosig',
      data: { from: '628999888777@c.us', body: 'tanpa signature' },
    }),
  });
  check(
    'Delivery tanpa signature ditolak 401 (secret terdaftar)',
    noSig.status === 401,
    `status=${noSig.status}`,
  );

  // ── 13. Signature benar (HMAC dihitung manual) → diterima ───────────────
  const goodBody = JSON.stringify({
    event: 'message.received',
    timestamp: new Date().toISOString(),
    sessionId,
    idempotencyKey: `signed_${Date.now()}`,
    deliveryId: 'dlv_signed',
    data: { from: '628123456789@c.us', body: 'hai', chatId: '628123456789@c.us' },
  });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(goodBody).digest('hex');
  const signed = await json(`${API}/api/webhooks/openwa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OpenWA-Signature': sig },
    body: goodBody,
  });
  check(
    'Signature HMAC valid diterima 200',
    signed.status === 200 && signed.body?.success === true,
    `status=${signed.status} body=${JSON.stringify(signed.body).slice(0, 120)}`,
  );

  // ── 14. Daftar webhook ───────────────────────────────────────────────────
  const list = await json(`${API}/api/whatsapp/webhooks`, { headers: H });
  check(
    'Daftar webhook menampilkan webhook terdaftar',
    Array.isArray(list.body?.webhooks) && list.body.webhooks.some((w) => w.id === whId),
    `jumlah=${list.body?.webhooks?.length}`,
  );
  check(
    'Daftar webhook tidak membocorkan secret',
    list.body?.webhooks?.every((w) => w.secret === undefined),
    'secret tidak boleh muncul',
  );

  // ── 15. Test delivery dari gateway ──────────────────────────────────────
  const testDelivery = await json(`${API}/api/whatsapp/webhooks/${whId}/test`, {
    method: 'POST',
    headers: H,
  });
  check(
    'Test delivery dari gateway sukses (2xx)',
    testDelivery.status === 200 && testDelivery.body?.result?.success === true,
    `status=${testDelivery.status} result=${JSON.stringify(testDelivery.body?.result).slice(0, 120)}`,
  );

  // ── 16. Update webhook (nonaktifkan) ─────────────────────────────────────
  const upd = await json(`${API}/api/whatsapp/webhooks/${whId}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ active: false }),
  });
  check(
    'Update webhook (active=false) berhasil',
    upd.status === 200 && upd.body?.webhook?.active === false,
    `status=${upd.status} active=${upd.body?.webhook?.active}`,
  );

  // ── 17. Rotasi secret ────────────────────────────────────────────────────
  const rot = await json(`${API}/api/whatsapp/webhooks/rotate-secret`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ id: whId }),
  });
  check(
    'Rotasi secret berhasil',
    rot.status === 200 && rot.body?.rotated === true,
    `status=${rot.status}`,
  );
  check(
    'Rotasi secret tidak membocorkan secret baru',
    rot.body?.secret === undefined && !JSON.stringify(rot.body).includes('secret": "'),
    'secret tidak boleh dikembalikan',
  );

  // ── 18. Riwayat event ────────────────────────────────────────────────────
  const history = await json(`${API}/api/whatsapp/webhooks/history?limit=50`, { headers: H });
  check(
    'Riwayat event tersedia',
    history.status === 200 && Array.isArray(history.body?.events) && history.body.events.length > 0,
    `jumlah=${history.body?.events?.length}`,
  );
  check(
    'Riwayat mencatat event duplikat',
    history.body?.events?.some((e) => e.attempts > 1),
    'attempts > 1 menandakan retry',
  );

  // ── 19. Statistik ────────────────────────────────────────────────────────
  const stats = await json(`${API}/api/whatsapp/webhooks/stats`, { headers: H });
  check(
    'Statistik event tersedia',
    stats.status === 200 && typeof stats.body?.stats?.total === 'number',
    `total=${stats.body?.stats?.total}`,
  );

  // ── 19b. Dead-letter log (delivery gagal) ────────────────────────────────
  // Endpoint ini dipakai frontend untuk menampilkan delivery yang gagal.
  // Seed dulu ke mock gateway supaya daftarnya tidak kosong.
  const seeded = await json(`${MOCK}/__mock/seed-failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': MOCK_KEY },
    body: JSON.stringify({
      event: 'message.received',
      sessionId,
      url: 'http://localhost:9/tidak-aktif',
      status: 503,
      error: 'HTTP 503',
    }),
  });
  check(
    'Seed kegagalan delivery di mock gateway',
    seeded.status === 200 && seeded.body?.seeded === true,
    `status=${seeded.status}`,
  );

  const failures = await json(`${API}/api/whatsapp/webhooks/failures?limit=20`, { headers: H });
  check(
    'Daftar delivery gagal tersedia (dead-letter log)',
    failures.status === 200 && failures.body?.success === true
      && Array.isArray(failures.body?.failures) && failures.body.failures.length > 0,
    `jumlah=${failures.body?.failures?.length} status=${failures.status}`,
  );
  check(
    'Delivery gagal memuat detail event dan status',
    failures.body?.failures?.some((f) => f.event === 'message.received' && f.status === 503),
    JSON.stringify(failures.body?.failures?.[0] || {}).slice(0, 140),
  );

  // ── 20. Hapus webhook ────────────────────────────────────────────────────
  const del = await json(`${API}/api/whatsapp/webhooks/${whId}`, {
    method: 'DELETE',
    headers: H,
  });
  check('Hapus webhook berhasil', del.status === 200 && del.body?.success === true, `status=${del.status}`);

  const afterDel = await json(`${MOCK}/__mock/webhooks`, { headers: { 'X-API-Key': MOCK_KEY } });
  check(
    'Webhook hilang dari gateway setelah dihapus',
    !afterDel.body?.webhooks?.some((w) => w.id === whId),
    `count=${afterDel.body?.count}`,
  );

  // ── Ringkasan ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  log('\n' + '─'.repeat(64));
  log(`TOTAL: ${results.length}  LULUS: ${results.length - failed.length}  GAGAL: ${failed.length}`);
  if (failed.length) {
    log('\nGAGAL:');
    failed.forEach((f) => log(`  ✗ ${f.name} — ${f.detail || ''}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
