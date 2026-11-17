// ─── Runner dev tanpa cmd.exe ────────────────────────────────────────────────────
//
// MASALAH YANG DISELESAIKAN:
//   `concurrently` (v8) memakai dependency `spawn-command` yang HARDCODE
//   `cmd.exe`. Pada environment Git-Bash / Hermes, `C:\Windows\System32`
//   TIDAK ada di PATH sehingga spawn gagal dengan:
//       [0] Error: spawn cmd.exe ENOENT
//   Akibatnya `npm run dev` tidak pernah menyalakan server maupun web.
//
// SOLUSI:
//   Script ini spawn kedua proses secara LANGSUNG lewat `process.execPath`
//   (binary node yang sedang berjalan) TANPA shell sama sekali.
//   Tidak ada cmd.exe, tidak ada masalah PATH, tidak ada quoting yang rusak.
//
//   - server : node server/node_modules/nodemon/bin/nodemon.js src/index.js
//   - web    : node web/node_modules/vite/bin/vite.js
//
// Ctrl+C / SIGINT / SIGTERM akan menutup KEDUA proses anak beserta
// turunannya, sehingga tidak ada proses yatim yang menahan port.
//
// PEMAKAIAN:
//   npm run dev            (otomatis memakai script ini)
//   node scripts/dev.mjs   (sama saja)
//
// ────────────────────────────────────────────────────────────────────────────────

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Prefix log per proses supaya easy dibedakan
const TAG_SERVER = '[server]';
const TAG_WEB = '[web]   ';

/**
 * Resolusi path absolut untuk file bin target (relatif terhadap cwd target).
 */
function resolveBin(target) {
  const abs = path.join(target.cwd, target.bin);
  return existsSync(abs) ? abs : null;
}

// Definisi proses yang akan dijalankan.
// `bin` adalah path RELATIF terhadap folder target masing-masing.
const TARGETS = [
  {
    tag: TAG_SERVER,
    cwd: path.join(ROOT, 'server'),
    bin: 'node_modules/nodemon/bin/nodemon.js',
    args: ['src/index.js'],
    env: {},
  },
  {
    tag: TAG_WEB,
    cwd: path.join(ROOT, 'web'),
    bin: 'node_modules/vite/bin/vite.js',
    args: [],
    env: {},
  },
];

// ─── Validasi prasyarat ─────────────────────────────────────────────────────────
for (const t of TARGETS) t.bin = resolveBin(t);

const missing = TARGETS.filter((t) => !t.bin);
if (missing.length) {
  for (const t of missing) {
    console.error(`${t.tag} ERROR: dependency belum terinstall → ${t.bin ?? path.join(t.cwd, 'node_modules')}`);
  }
  console.error('\nJalankan: npm run install:all\n');
  process.exit(1);
}

// ─── Helper:Q spawn dan quiver ────────────────────────────────────────────────
const children = [];
let shuttingDown = false;

/**
 * Menyalakan satu proses anak dan menyambungkan stdout/stderr ke terminal
 * dengan prefix warna agar mudah dibaca.
 */
function start(target) {
  const child = spawn(process.execPath, [target.bin, ...target.args], {
    cwd: target.cwd,
    env: { ...process.env, ...target.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Tidak memakai shell → tidak ada cmd.exe, tidak ada masalah PATH
    shell: false,
    windowsHide: true,
  });

  const prefix = (line) => `${target.tag} ${line}`;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim() !== '') console.log(prefix(line));
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim() !== '') console.error(prefix(line));
    }
  });

  child.on('error', (err) => {
    console.error(`${target.tag} ERROR gagal start: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${target.tag} proses berhenti (code=${code}, signal=${signal})`);
    // Jika salah satu mati, matikan yang lain agar tidak ada proses separuh jalan
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

/**
 * Membunuh satu proses anak BESERTA seluruh turunannya.
 *
 * CATATAN PENTING (Windows):
 *   `child.kill('SIGTERM')` pada Windows hanya memanggil TerminateProcess
 *   pada proses itu sendiri — turunannya (mis. `node src/index.js` yang
 *   di-spawn nodemon) TIDAK ikut mati dan tetap memegang port.
 *   taskkill /T /F memotong SELURUH pohon proses, sehingga tidak ada
 *   proses yatim yang memblokir port 6601/6602 setelah runner ditutup.
 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* proses sudah mati */
    }
    return;
  }
  try {
    // POSIX: kirim sinyal ke grup proses agar anak ikut mati
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* sudah mati */
    }
  }
}

/**
 * Menutup semua proses anak (beserta turunannya) lalu keluar.
 */
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nMenghentikan semua proses dev...');
  for (const child of children) {
    killTree(child.pid);
  }
  // Beri waktu 1.5 detik untuk shut down bersih, lalu paksa
  setTimeout(() => {
    for (const child of children) {
      killTree(child.pid);
    }
    process.exit(exitCode);
  }, 1500).unref?.();
}

// ─── Signal handler ────────────────────────────────────────────────────────────
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => shutdown(0));
}
process.on('exit', () => {
  if (!shuttingDown) {
    for (const child of children) {
      killTree(child.pid);
    }
  }
});

// ─── Jalankan ──────────────────────────────────────────────────────────────────
console.log('Menyalakan dev environment (server + web)...');
console.log('  API  : http://localhost:6601');
console.log('  Web  : http://localhost:6602\n');

start(TARGETS[0]);
start(TARGETS[1]);
