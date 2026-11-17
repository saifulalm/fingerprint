// ─── Pembersih port & proses yatim ─────────────────────────────────────────────
//
// MASALAH YANG DISELESAIKAN:
//   Setelah `npm run dev` dihentikan (SIGTERM / Ctrl+C / jendela terminal
//   ditutup), kadang proses server & vite tetap hidup dan memegang port
//   6601 / 6602. Akibatnya `npm run dev` berikutnya gagal dengan:
//       EADDRINUSE: address already in use :::6601
//   dan user melihat "Tidak dapat terhubung ke server".
//
// SOLUSI:
//   Script ini mencari SEMUA proses node yang commandline-nya mengandung
//   "fingerprint" (server, vite, nodemon, concurrently, runner) lalu membakar
//   POHON PROSESnya (taskkill /T /F) sekaligus menutup listener di port
//   dev yang relevan.
//
// PEMAKAIAN:
//   npm run cleanup
//   npm run cleanup -- --port 6601 6602 3000
//
// CATATAN:
//   Hanya menyentuh proses yang Obviously milik proyek ini (filter path
//   "fingerprint"), tidak menyentuh proses node lain milik user.

import { execFileSync } from 'node:child_process';

const NETSTAT = 'C:/Windows/System32/netstat.exe';
const TASKLIST = 'C:/Windows/System32/tasklist.exe';
const TASKKILL = 'C:/Windows/System32/taskkill.exe';
const PS = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

// Port dev default proyek ini
const DEFAULT_PORTS = ['6601', '6602'];

// Ambil argumen port tambahan dari CLI: --port 6601 6602
function parsePorts(argv) {
  const idx = argv.indexOf('--port');
  if (idx === -1) return DEFAULT_PORTS;
  const ports = [];
  for (let i = idx + 1; i < argv.length; i++) {
    const v = argv[i];
    if (!/^\d+$/.test(v)) break;
    ports.push(v);
  }
  return ports.length ? ports : DEFAULT_PORTS;
}

/**
 * Cari PID yang sedang LISTENING di port tertentu.
 */
function pidsOnPort(port) {
  try {
    const out = execFileSync(NETSTAT, ['-ano'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] || '';
      const pid = cols[cols.length - 1];
      const localPort = local.split(':').pop();
      if (localPort === port && /^\d+$/.test(pid)) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

/**
 * Cari proses node milik proyek ini (path mengandung "fingerprint").
 */
function projectNodeProcesses() {
  try {
    const out = execFileSync(
      PS,
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          'Where-Object { $_.CommandLine -match \'fingerprint\' } | ' +
          'ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }',
      ],
      { encoding: 'utf8' }
    );
    return out
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const [pid, ...rest] = l.split('|');
        return { pid: pid.trim(), cmd: rest.join('|').trim() };
      })
      .filter((p) => /^\d+$/.test(p.pid));
  } catch {
    return [];
  }
}

/**
 * Bunuh satu proses beserta seluruh pohon turunannya.
 */
function killTree(pid) {
  try {
    const out = execFileSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return (out || '').trim();
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    // "not found" = sudah mati, bukan error
    return out || `PID ${pid} gagal dibunuh`;
  }
}

// ─── Jalankan ──────────────────────────────────────────────────────────────────
const ports = parsePorts(process.argv.slice(2));
console.log(`Membersihkan proses & port: ${ports.join(', ')}\n`);

let killed = 0;

// 1. Proses node milik proyek ini
const procs = projectNodeProcesses();
if (procs.length) {
  console.log(`Menemukan ${procs.length} proses node milik proyek:`);
  for (const p of procs) {
    const res = killTree(p.pid);
    const ok = /SUCCESS/i.test(res);
    killed += ok ? 1 : 0;
    console.log(`  ${ok ? 'OK  ' : 'GAGAL'} PID ${p.pid} — ${p.cmd.slice(0, 90)}`);
  }
} else {
  console.log('Tidak ada proses node milik proyek yang sedang berjalan.');
}

// 2. Listener di port dev (apapun asalnya — mis. Vite dari versi lama)
for (const port of ports) {
  const pids = pidsOnPort(port);
  if (!pids.length) {
    console.log(`  Port ${port}: bebas`);
    continue;
  }
  for (const pid of pids) {
    const res = killTree(pid);
    const ok = /SUCCESS/i.test(res);
    killed += ok ? 1 : 0;
    console.log(`  Port ${port}: ${ok ? 'OK' : 'GAGAL'} kill PID ${pid}`);
  }
}

console.log(`\nTotal proses dibunuh: ${killed}`);

// 3. Verifikasi akhir
const remaining = ports.flatMap((port) => pidsOnPort(port));
if (remaining.length) {
  console.log(`PERINGATAN: masih ada listener di port ${[...new Set(remaining)].join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Semua port ${ports.join(', ')} sekarang bebas.`);
  console.log('Jalankan `npm run dev` untuk menyalakan ulang.');
}
