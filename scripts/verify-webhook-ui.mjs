// Verifikasi UI halaman WhatsApp → tab Webhook.
//
// Menjalankan Chromium headless via CDP, login ke aplikasi, buka tab
// Webhook, lalu memeriksa elemen yang benar-benar ter-render di DOM.
//
// Dipakai sebagai ganti browser interaktif karena Chrome milik user sedang
// terkunci profilnya (tidak bisa dipakai headless).
//
// CATATAN idempotensi: profil Chromium dipakai ulang antar-jalankan, jadi
// localStorage (token login + bahasa) dibersihkan di awal agar hasil uji
// tidak bergantung pada sisa run sebelumnya.
import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME = path.join(
  process.env.LOCALAPPDATA || '',
  'hermes', 'tools', 'chromium-1208', 'chrome-win64', 'chrome.exe',
);
const PORT = 9444;
const BASE = process.env.TEST_WEB || 'http://localhost:6602';

let chrome;
let nextId = 1;
const pending = new Map();
let ws;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Kirim perintah CDP dan tunggu jawabannya. */
function cdp(method, params = {}, sessionId) {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(msg));
  });
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ── 1. Jalankan Chromium headless ───────────────────────────────────────
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(process.env.TEMP || '', 'fp-ui-verify')}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let version = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`);
      version = await r.json();
      break;
    } catch { await sleep(400); }
  }
  if (!version) { console.error('CDP tidak hidup'); process.exit(1); }
  console.log('CDP siap:', version.Browser);

  // ── 2. Sambung WebSocket ────────────────────────────────────────────────
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  };

  // ── 3. Buka tab aplikasi ────────────────────────────────────────────────
  const { targetId } = await cdp('Target.createTarget', { url: `${BASE}/login` });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const S = sessionId;

  await cdp('Page.enable', {}, S);
  await cdp('Runtime.enable', {}, S);

  const evalJs = async (expr) => {
    const r = await cdp('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    }, S);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'JS error');
    return r.result.value;
  };

  const waitReady = async () => {
    for (let i = 0; i < 40; i++) {
      if (await evalJs('document.readyState') === 'complete') break;
      await sleep(300);
    }
    await sleep(800);
  };

  await waitReady();

  // ── 3b. Bersihkan state dari run sebelumnya ────────────────────────────
  await evalJs('localStorage.clear(); sessionStorage.clear(); true');
  await cdp('Page.navigate', { url: `${BASE}/login` }, S);
  await waitReady();
  console.log('URL:', await evalJs('location.href'));

  // ── 4. Login ────────────────────────────────────────────────────────────
  const hasLoginForm = await evalJs(
    `!!document.querySelector('input[type="password"], input[name="password"]')`,
  );
  check('Halaman login tampil', hasLoginForm, await evalJs('location.pathname'));

  if (hasLoginForm) {
    await evalJs(`(() => {
      const setVal = (el, v) => {
        const proto = el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = Array.from(document.querySelectorAll('input'));
      const user = inputs.find(i => /user|nama|login/i.test(i.name + i.placeholder)) || inputs[0];
      const pass = inputs.find(i => i.type === 'password') || inputs[1];
      setVal(user, 'admin');
      setVal(pass, 'admin123');
      return true;
    })()`);

    await evalJs(`(() => {
      const btn = document.querySelector('button[type="submit"]')
        || Array.from(document.querySelectorAll('button')).find(b => /masuk|login|sign/i.test(b.textContent));
      if (btn) btn.click();
      return !!btn;
    })()`);

    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await evalJs('location.pathname') !== '/login') break;
    }
    await sleep(1500);
  }

  const afterLogin = await evalJs('location.pathname');
  check('Login berhasil (berpindah dari /login)', afterLogin !== '/login', afterLogin);

  // ── 5. Navigasi ke halaman WhatsApp ─────────────────────────────────────
  const clicked = await evalJs(`(() => {
    const links = Array.from(document.querySelectorAll('a[href*="whatsapp"]'));
    if (links.length) { links[0].click(); return 'link:' + links[0].getAttribute('href'); }
    return null;
  })()`);
  if (!clicked) {
    await evalJs(`history.pushState({}, '', '/whatsapp'); window.dispatchEvent(new PopStateEvent('popstate')); true`);
  }
  await sleep(2500);
  console.log('URL halaman WA:', await evalJs('location.pathname'));

  const onWaPage = await evalJs(
    `/whatsapp/i.test(document.body.innerText) || location.pathname.includes('whatsapp')`,
  );
  check('Halaman WhatsApp terbuka', onWaPage, await evalJs('location.pathname'));

  // ── 6. Klik tab Webhook ─────────────────────────────────────────────────
  const tabInfo = await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const tab = btns.find(b => /webhook/i.test(b.textContent));
    if (tab) { tab.click(); return { found: true, label: tab.textContent.trim() }; }
    return { found: false, buttons: btns.map(b => b.textContent.trim()).filter(Boolean).slice(0, 25) };
  })()`);
  check('Tab Webhook ditemukan', tabInfo.found, tabInfo.label || JSON.stringify(tabInfo.buttons));
  await sleep(2000);

  // ── 7. Verifikasi isi tab Webhook (bahasa Indonesia) ────────────────────
  // Set bahasa secara eksplisit supaya hasil uji deterministik.
  await evalJs(`localStorage.setItem('fp_lang', 'id'); true`);
  await cdp('Page.navigate', { url: `${BASE}/whatsapp` }, S);
  await waitReady();
  await evalJs(`(() => {
    const tab = Array.from(document.querySelectorAll('button')).find(b => /webhook/i.test(b.textContent));
    if (tab) tab.click();
    return true;
  })()`);
  await sleep(2000);

  const bodyText = await evalJs('document.body.innerText');

  check('Judul "Webhook OpenWA" tampil', /Webhook OpenWA/i.test(bodyText));
  check('Endpoint receiver tampil', /api\/webhooks\/openwa/.test(bodyText),
    (bodyText.match(/.*api\/webhooks\/openwa.*/) || [''])[0].trim().slice(0, 80));
  check('Tombol "Daftarkan Webhook" ada', /Daftarkan Webhook/i.test(bodyText));
  check('Tombol "Muat Ulang" ada', /Muat Ulang/i.test(bodyText));
  check('Bagian "Webhook Terdaftar" ada', /Webhook Terdaftar/i.test(bodyText));
  check('Bagian "Riwayat Event" ada', /Riwayat Event/i.test(bodyText));
  check('Bagian "Delivery Gagal" ada', /Delivery Gagal/i.test(bodyText));

  const statCards = await evalJs(`(() => {
    const texts = Array.from(document.querySelectorAll('div'))
      .filter(d => /^(Total Event|Diproses|Gagal|Duplikat)$/.test(d.textContent.trim()));
    return texts.length;
  })()`);
  check('4 kartu statistik tampil', statCards >= 4, `jumlah=${statCards}`);

  const hasWarning = await evalJs(`(() => {
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    return alerts.length ? alerts[0].innerText.trim().slice(0, 140) : null;
  })()`);
  check('Peringatan gateway belum dikonfigurasi tampil', !!hasWarning, hasWarning || 'tidak ada');

  const historyRows = await evalJs(`(() => {
    const m = document.body.innerText.match(/(message\\.received|session\\.status|test)/g);
    return m ? m.length : 0;
  })()`);
  check('Riwayat event menampilkan event dari DB', historyRows > 0, `jumlah=${historyRows}`);

  // ── 8. Buka form pendaftaran ────────────────────────────────────────────
  await evalJs(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /Daftarkan Webhook/i.test(x.textContent));
    if (b) b.click();
    return true;
  })()`);
  await sleep(1200);
  const formText = await evalJs('document.body.innerText');
  check('Form pendaftaran terbuka', /Daftarkan webhook baru/i.test(formText));
  check('Field URL Receiver ada', /URL Receiver/i.test(formText));
  check('Field Secret HMAC ada', /Secret HMAC/i.test(formText));
  check('Pilihan event (katalog) tampil', /message\.received/.test(formText));

  // Tangkapan layar bukti (bahasa Indonesia)
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }, S);
  if (shot?.data) {
    const fs = await import('node:fs');
    const out = path.join(process.env.TMPDIR || process.env.TEMP, 'fp-webhook-ui-id.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('Screenshot (ID):', out);
  }

  // ── 9. Bahasa Inggris: teks harus berubah, tidak ada raw key ────────────
  await evalJs(`localStorage.setItem('fp_lang', 'en'); true`);
  await cdp('Page.navigate', { url: `${BASE}/whatsapp` }, S);
  await waitReady();
  await evalJs(`(() => {
    const tab = Array.from(document.querySelectorAll('button')).find(b => /webhook/i.test(b.textContent));
    if (tab) tab.click();
    return true;
  })()`);
  await sleep(2000);

  const enText = await evalJs('document.body.innerText');
  check('Terjemahan Inggris termuat (judul EN)', /OpenWA Webhook/i.test(enText));
  check('Terjemahan Inggris termuat (tombol EN)', /Register Webhook/i.test(enText));
  check('Terjemahan Inggris termuat (bagian EN)', /Registered Webhooks/i.test(enText));
  check('Terjemahan Inggris termuat (dead-letter EN)', /Failed Deliveries/i.test(enText));
  check('Tidak ada raw key i18n di halaman EN',
    !/wa\.webhook_|wa\.tab_/.test(enText),
    (enText.match(/wa\.[a-z_]+/g) || []).slice(0, 5).join(', '));

  const shotEn = await cdp('Page.captureScreenshot', { format: 'png' }, S);
  if (shotEn?.data) {
    const fs = await import('node:fs');
    const out = path.join(process.env.TMPDIR || process.env.TEMP, 'fp-webhook-ui-en.png');
    fs.writeFileSync(out, Buffer.from(shotEn.data, 'base64'));
    console.log('Screenshot (EN):', out);
  }

  // ── Ringkasan ───────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '─'.repeat(64));
  console.log(`TOTAL: ${results.length}  LULUS: ${results.length - failed.length}  GAGAL: ${failed.length}`);
  if (failed.length) {
    console.log('\nGAGAL:');
    failed.forEach((f) => console.log('  ✗ ' + f.name));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
}).finally(() => {
  try { chrome?.kill(); } catch { /* noop */ }
  try { ws?.close(); } catch { /* noop */ }
});
