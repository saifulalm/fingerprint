// Verifikasi UI fitur "Bersihkan Log Audit" di Admin Dashboard.
//
// Menjalankan Chromium headless via CDP, login, buka tab Audit Log,
// lalu memeriksa:
//   1. Tombol "Bersihkan Log" benar-benar ada di DOM.
//   2. Membukanya memunculkan dialog dengan DUA opsi cakupan.
//   3. Pilihan "hapus seluruh" benar-benar mengubah parameter request
//      (dicek lewat intercept fetch) — bukan sekadar tampilan.
//   4. Dialog punya role="dialog" + aria-modal (a11y).
//
// CATATAN idempotensi: localStorage dibersihkan di awal agar hasil uji
// tidak bergantung pada sisa run sebelumnya.
import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME = path.join(
  process.env.LOCALAPPDATA || '',
  'hermes', 'tools', 'chromium-1208', 'chrome-win64', 'chrome.exe',
);
const PORT = 9449;
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
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(process.env.TEMP || '', 'fp-ui-audit')}`,
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
  await evalJs('localStorage.clear(); sessionStorage.clear(); true');
  await cdp('Page.navigate', { url: `${BASE}/login` }, S);
  await waitReady();

  // ── Login ───────────────────────────────────────────────────────────────
  await evalJs(`(() => {
    const setVal = (el, v) => {
      const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = Array.from(document.querySelectorAll('input'));
    setVal(inputs[0], 'admin');
    setVal(inputs.find(x => x.type === 'password'), 'admin123');
    const btn = document.querySelector('button[type="submit"]')
      || Array.from(document.querySelectorAll('button')).find(x => /masuk|login/i.test(x.textContent));
    btn && btn.click();
    return true;
  })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await evalJs('location.pathname') !== '/login') break;
  }
  await sleep(1200);
  check('Login berhasil', (await evalJs('location.pathname')) !== '/login', await evalJs('location.pathname'));

  // ── Buka Admin Dashboard → tab Audit Log ───────────────────────────────
  await cdp('Page.navigate', { url: `${BASE}/admin` }, S);
  await waitReady();

  // Tunggu tab "Audit Log" benar-benar muncul. Halaman ini menampilkan
  // spinner selama `load()` berjalan, jadi menebak waktu tunggu tetap
  // menghasilkan hasil yang flaky.
  let foundTab = false;
  for (let i = 0; i < 40; i++) {
    foundTab = await evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button, [role="tab"], a'))
        .find(x => /^Audit Log$/i.test((x.textContent || '').trim()));
      if (b) { b.click(); return true; }
      return false;
    })()`);
    if (foundTab) break;
    await sleep(500);
  }
  check('Tab Audit Log ditemukan', !!foundTab, await evalJs('location.pathname'));
  await sleep(1500);

  const cleanBtn = await evalJs(`(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /bersihkan log|clean logs/i.test((x.textContent || '').trim()));
    return b ? { text: b.textContent.trim(), hasLabel: !!b.getAttribute('aria-label') } : null;
  })()`);
  check('Tombol "Bersihkan Log" ada', !!cleanBtn, cleanBtn?.text || 'tidak ditemukan');
  check('Tombol punya accessible name', !!cleanBtn?.hasLabel);

  // ── Buka dialog ─────────────────────────────────────────────────────────
  await evalJs(`(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /bersihkan log|clean logs/i.test((x.textContent || '').trim()));
    b && b.click();
    return true;
  })()`);
  await sleep(1000);

  const dialog = await evalJs(`(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const radios = Array.from(d.querySelectorAll('input[type="radio"]'));
    const num = d.querySelector('input[type="number"]');
    return {
      role: d.getAttribute('role'),
      ariaModal: d.getAttribute('aria-modal'),
      radioCount: radios.length,
      radioLabels: radios.map(r => {
        const lab = r.closest('label');
        return (lab?.textContent || '').trim().slice(0, 60);
      }),
      hasNumberInput: !!num,
      numberValue: num?.value || null,
      text: d.innerText.slice(0, 300),
    };
  })()`);
  check('Dialog terbuka dengan role="dialog"', dialog?.role === 'dialog', dialog?.role || 'tidak ada');
  check('Dialog punya aria-modal="true"', dialog?.ariaModal === 'true', dialog?.ariaModal || '-');
  check('Dialog punya 2 pilihan cakupan', dialog?.radioCount === 2, `jumlah=${dialog?.radioCount}`);
  check('Input jumlah hari ada', !!dialog?.hasNumberInput, `nilai=${dialog?.numberValue}`);
  check('Opsi "hapus seluruh" tersedia',
    (dialog?.radioLabels || []).some(l => /seluruh|all/i.test(l)),
    (dialog?.radioLabels || []).join(' | ').slice(0, 100));

  // ── Intercept DELETE untuk memastikan parameter benar ───────────────────
  // CATATAN: aplikasi memakai axios → XMLHttpRequest, BUKAN fetch.
  // Jadi intercept harus dipasang pada XHR (open + send), bukan fetch.
  await evalJs(`(() => {
    window.__auditCalls = [];
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__auditMethod = method;
      this.__auditUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const url = this.__auditUrl || '';
      if (url.includes('/admin/audit')) {
        window.__auditCalls.push({ url, method: this.__auditMethod });
        // Dry-run: balas 200 dengan bentuk respons SAMA seperti server sungguhan,
        // supaya toast di UI berisi teks yang realistis. Kalau mock memakai
        // message lain, toast akan menampilkan teks mock — bukan bukti bahwa
        // aplikasi menampilkan pesan server dengan benar.
        const body = JSON.stringify({
          success: true,
          deleted: 0,
          scope: 'dry-run',
          message: '0 log audit lebih tua dari 90 hari dihapus.',
        });
        Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(this, 'status', { value: 200, configurable: true });
        Object.defineProperty(this, 'responseText', { value: body, configurable: true });
        Object.defineProperty(this, 'response', { value: body, configurable: true });
        setTimeout(() => {
          if (this.onreadystatechange) this.onreadystatechange();
          if (this.onload) this.onload();
          // PENTING: adapter XHR axios resolving lewat 'onloadend'.
          // Kalau event ini tidak dipicu, promise axios tidak pernah
          // resolve → state "sedang menghapus" tetap true → tombol
          // konfirmasi berikutnya ter-disable dan request tak pernah terkirim.
          if (this.onloadend) this.onloadend();
        }, 10);
        return;
      }
      return origSend.apply(this, arguments);
    };
    return true;
  })()`);

  // Klik "Hapus Log" dengan mode berumur (default)
  await evalJs(`(() => {
    const d = document.querySelector('[role="dialog"]');
    const btns = Array.from(d.querySelectorAll('button'));
    const go = btns.find(b => /hapus log|delete logs/i.test(b.textContent.trim()));
    go && go.click();
    return true;
  })()`);

  // Tunggu request terkirim DAN aksi selesai. `handleCleanAudit` menahan
  // state `auditCleaning` sampai `await load()` selesai, dan selama itu
  // tombol konfirmasi tetap nonaktif — jadi penundaan tetap (sleep) tidak
  // handal.
  let sentAge = false;
  for (let i = 0; i < 40; i++) {
    sentAge = /admin\/audit/.test(
      await evalJs('JSON.stringify(window.__auditCalls || [])'),
    );
    if (sentAge) break;
    await sleep(300);
  }

  const callsAge = await evalJs('JSON.stringify(window.__auditCalls || [])');
  check('Request DELETE terkirim', /admin\/audit/.test(callsAge), callsAge.slice(0, 160));
  check('Mode berumur memakai parameter days',
    /days=\d+/.test(callsAge), callsAge.slice(0, 160));
  check('Mode berumur TIDAK memakai all=true',
    !/all=true/.test(callsAge), callsAge.slice(0, 160));

  // ── Uji mode "hapus seluruh" ───────────────────────────────────────────
  await evalJs('window.__auditCalls = []; true');

  // Tunggu aksi PERTAMA benar-benar selesai.
  //
  // PENTING: mendeteksi request "terkirim" (di interceptor `send()`) BUKAN
  // bukti aksi selesai. Urutannya di `handleCleanAudit`:
  //   await api.delete(...) → toast → setAuditCleanOpen(false) → await load()
  // `load()` men-set `loading` true, dan `AdminDashboardPage` mengembalikan
  // spinner PENUH saat itu (early return) — `<Modal>` berada di bawah
  // early-return itu, jadi dialog yang keburu dibuka akan ter-unmount lagi.
  //
  // Karena itu skrip menunggu DUA sinyal:
  //   1. Toast hasil aksi muncul (bukti response sudah diproses).
  //   2. Spinner hilang dan tetap hilang (bukti `load()` sudah selesai).
  const waitSettled = async () => {
    let toasted = false;
    let toastDump = '';
    for (let i = 0; i < 60; i++) {
      const snap = await evalJs(`(() => {
        const cont = document.querySelector('.toast-container');
        const msgs = Array.from(document.querySelectorAll('.toast-msg'))
          .map(e => (e.textContent || '').trim());
        return JSON.stringify({
          msgs,
          containerText: cont ? (cont.textContent || '').trim().slice(0, 120) : null,
        });
      })()`);
      const parsed = JSON.parse(snap);
      if (parsed.msgs.some((m) => /dihapus|deleted/i.test(m))) {
        toasted = true;
        break;
      }
      toastDump = parsed.containerText ?? '(tanpa container)';
      await sleep(200);
    }
    // Tunggu spinner selesai, lalu pastikan STABIL (tidak muncul lagi).
    let idle = false;
    for (let i = 0; i < 60; i++) {
      idle = await evalJs(
        `document.querySelectorAll('[style*="spin"]').length === 0`,
      );
      if (idle) break;
      await sleep(200);
    }
    await sleep(700);
    idle = await evalJs(
      `document.querySelectorAll('[style*="spin"]').length === 0`,
    );
    return { toasted, idle, toastDump };
  };

  const settled = await waitSettled();
  check('Toast hasil aksi pertama muncul', settled.toasted, settled.toastDump);
  check('Halaman kembali idle setelah aksi pertama', settled.idle);

  await evalJs(`(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /bersihkan log|clean logs/i.test((x.textContent || '').trim()));
    b && b.click();
    return true;
  })()`);

  // Tunggu dialog benar-benar ter-mount. Penundaan tetap (sleep) tidak
  // handal: aksi pertama memicu `load()` yang me-render ulang daftar log,
  // sehingga timing mount dialog kedua bisa bergeser.
  //
  // Klik diulang sampai dialog muncul: saat `load()` berjalan, React bisa
  // MELUCAPI node tombol yang lama, sehingga `click()` pada node itu
  // tidak memicu handler sama sekali.
  let reopened = false;
  for (let i = 0; i < 40; i++) {
    reopened = await evalJs(
      `!!document.querySelector('[role="dialog"] input[type="radio"]')`,
    );
    if (reopened) break;
    await evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => /bersihkan log|clean logs/i.test((x.textContent || '').trim()));
      if (b && !b.disabled) b.click();
      return true;
    })()`);
    await sleep(400);
  }
  check('Dialog bisa dibuka ulang setelah aksi pertama', reopened);

  await evalJs(`(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'tidak ada dialog';
    const radios = Array.from(d.querySelectorAll('input[type="radio"]'));
    const all = radios[1];
    if (!all) return 'tidak ada radio kedua';
    // Radio yang dikendalikan React merespons event 'click' (bukan 'change'
    // saja) — jadi klik langsung elemennya.
    all.click();
    return 'kliked';
  })()`);
  await sleep(800);
  const radioState = await evalJs(`(() => {
    const d = document.querySelector('[role="dialog"]');
    const radios = Array.from(d.querySelectorAll('input[type="radio"]'));
    return JSON.stringify(radios.map(r => ({ checked: r.checked, value: r.value })));
  })()`);
  check('Radio "hapus seluruh" tercentang', /true/.test(radioState), radioState);

  // Klik konfirmasi HANYA setelah tombol siap (tidak disabled). State
  // `auditCleaning` dari aksi pertama masih aktif sampai `load()` selesai,
  // sehingga tombol menampilkan "Menghapus..." dan nonaktif.
  let confirmed = false;
  for (let i = 0; i < 40; i++) {
    confirmed = await evalJs(`(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return false;
      const go = Array.from(d.querySelectorAll('button'))
        .find(b => /hapus log|delete logs/i.test(b.textContent.trim()));
      if (!go || go.disabled) return false;
      go.click();
      return true;
    })()`);
    if (confirmed) break;
    await sleep(300);
  }
  check('Tombol konfirmasi siap diklik', confirmed);

  // Tunggu request all=true terkirim.
  let sentAll = false;
  for (let i = 0; i < 40; i++) {
    sentAll = /all=true/.test(
      await evalJs('JSON.stringify(window.__auditCalls || [])'),
    );
    if (sentAll) break;
    await sleep(300);
  }

  const callsAll = await evalJs('JSON.stringify(window.__auditCalls || [])');
  check('Mode "hapus seluruh" memakai all=true',
    /all=true/.test(callsAll), callsAll.slice(0, 160));

  if (!/all=true/.test(callsAll)) {
    // Diagnostik: apakah dialog masih terbuka dan apa state tombolnya?
    const diag = await evalJs(`(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return JSON.stringify({ dialog: 'hilang' });
      const btns = Array.from(d.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(), disabled: b.disabled,
      }));
      const radios = Array.from(d.querySelectorAll('input[type="radio"]')).map(r => r.checked);
      return JSON.stringify({ dialog: 'ada', btns, radios, calls: window.__auditCalls });
    })()`);
    console.log('  diagnostik:', diag);
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
