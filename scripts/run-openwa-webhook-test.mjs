// Runner uji integrasi webhook OpenWA.
//
// Menjalankan mock gateway + API BioClock sebagai child process, lalu
// mengeksekusi skrip uji webhook. Semua proses dibersihkan di akhir.
//
// Dipakai karena shell Git-Bash menolak pola `cmd &` pada tool terminal.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const API_PORT = process.env.TEST_API_PORT || '6701';
const MOCK_PORT = process.env.MOCK_PORT || '2786';

const children = [];

function launch(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  children.push({ name, child });
  const tag = `[${name}]`;
  child.stdout.on('data', (c) => process.stdout.write(tag + ' ' + c.toString()));
  child.stderr.on('data', (c) => process.stderr.write(tag + ' ' + c.toString()));
  child.on('exit', (code) => console.log(tag + ' keluar, code=' + code));
  return child;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch { /* belum hidup */ }
    await sleep(400);
  }
  return false;
}

function cleanup() {
  for (const { child } of children) {
    try { child.kill('SIGTERM'); } catch { /* noop */ }
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function main() {
  // ── 1. Mock OpenWA gateway ───────────────────────────────────────────────
  launch('mock', process.execPath, [path.join(ROOT, 'scripts/mock-openwa-gateway.mjs')], {
    env: { MOCK_PORT },
  });

  // ── 2. API BioClock dengan konfigurasi OpenWA ────────────────────────────
  launch('api', process.execPath, [path.join(ROOT, 'server/src/index.js')], {
    cwd: path.join(ROOT, 'server'),
    env: {
      PORT: API_PORT,
      WA_GATEWAY_URL: `http://localhost:${MOCK_PORT}`,
      WA_GATEWAY_API_KEY: 'test-key',
      WA_GATEWAY_SESSION: 'bioclock',
    },
  });

  // Tunggu keduanya hidup.
  const mockUp = await waitForHttp(`http://localhost:${MOCK_PORT}/api/health`);
  const apiUp = await waitForHttp(`http://localhost:${API_PORT}/api/health`);
  console.log(`\nmock siap=${mockUp} | api siap=${apiUp}`);
  if (!mockUp || !apiUp) {
    console.error('Server tidak siap — uji dibatalkan.');
    cleanup();
    process.exit(1);
  }

  // ── 3. Jalankan uji integrasi webhook ────────────────────────────────────
  await sleep(1200);
  const test = spawn(process.execPath, [path.join(ROOT, 'scripts/test-openwa-webhook.mjs')], {
    cwd: ROOT,
    env: { ...process.env, TEST_API: `http://localhost:${API_PORT}`, MOCK_API: `http://localhost:${MOCK_PORT}` },
    stdio: 'inherit',
    shell: false,
  });

  const code = await new Promise((r) => test.on('exit', r));
  console.log('\nKode keluar uji:', code);
  cleanup();
  await sleep(600);
  process.exit(code ?? 1);
}

main().catch((e) => { console.error('FATAL:', e); cleanup(); process.exit(1); });
