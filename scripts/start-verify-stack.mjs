// Menjalankan stack verifikasi UI: mock OpenWA gateway + API BioClock
// (menyajikan SPA dari web/dist) lalu menahan proses sampai dihentikan.
//
// Pakai: node scripts/start-verify-stack.mjs
// Hentikan dengan Ctrl+C — seluruh child process ikut dibersihkan.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const API_PORT = process.env.VERIFY_API_PORT || '6699';
const MOCK_PORT = process.env.VERIFY_MOCK_PORT || '2785';

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
  return child;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForHttp(url, timeoutMs = 25000) {
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
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

async function main() {
  launch('mock', process.execPath, [path.join(ROOT, 'scripts/mock-openwa-gateway.mjs')], {
    env: { MOCK_PORT },
  });

  launch('api', process.execPath, [path.join(ROOT, 'server/src/index.js')], {
    cwd: path.join(ROOT, 'server'),
    env: {
      PORT: API_PORT,
      WA_GATEWAY_URL: `http://localhost:${MOCK_PORT}`,
      WA_GATEWAY_API_KEY: 'test-key',
      WA_GATEWAY_SESSION: 'bioclock',
    },
  });

  const mockUp = await waitForHttp(`http://localhost:${MOCK_PORT}/api/health`);
  const apiUp = await waitForHttp(`http://localhost:${API_PORT}/api/health`);
  console.log(`\n=== STACK VERIFIKASI ===\nmock=${mockUp ? 'SIAP' : 'GAGAL'} @ ${MOCK_PORT}`);
  console.log(`api=${apiUp ? 'SIAP' : 'GAGAL'} @ ${API_PORT}`);
  console.log(`SPA  : http://localhost:${API_PORT}/whatsapp\n`);
  console.log('Tekan Ctrl+C untuk menghentikan.');

  // Tahan proses.
  await new Promise(() => {});
}

main().catch((e) => { console.error('FATAL:', e); cleanup(); process.exit(1); });
