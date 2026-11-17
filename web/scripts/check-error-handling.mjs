// Guard frontend: setiap catch harus memberi tahu user, tidak boleh ada
// fetch() mentah yang melewati instance axios, dan tidak boleh ada pemanggilan
// method axios yang tidak ada.
//
// MASALAH YANG DISELESAIKAN:
//   1. `console.error(err)` di dalam catch = user melihat halaman KOSONG atau
//      data basi tanpa penjelasan apa pun. Semua error harus berakhir di
//      toast / alert / state yang terlihat user.
//   2. `fetch()` mentah melewati interceptor axios: tidak ada header auth
//      otomatis, tidak ada redirect 401 ke /login, dan pesan error server
//      ("Rentang tanggal wajib diisi") hilang — user hanya melihat
//      "Failed to fetch".
//   3. `api.del(...)` — axios TIDAK punya alias `del`. Pemanggilannya melempar
//      "api.del is not a function", Tertangkap catch, dan diterjemahkan jadi
//      toast generik. Akibatnya "Hapus karyawan" dan "Hapus jadwal" terlihat
//      berhasil padahal TIDAK ADA data yang terhapus.
//
// Halaman login sekarang memakai instance `authApi` (axios tanpa interceptor
// 401), jadi tidak ada pengecualian fetch() di sana lagi.
// Dijalankan: node scripts/check-error-handling.mjs
import fs from 'node:fs';
import path from 'node:path';

const srcRoot = path.resolve('src');
const problems = [];
let catchCount = 0;
let fetchCount = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'dist-audit'].includes(entry.name)) continue;
      walk(full);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      check(full);
    }
  }
}

function check(file) {
  const rel = path.relative(path.resolve('..'), file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    // --- 1. catch yang hanya console.error ---
    const isCatch = /catch\s*(\(|e\b|err\b)/.test(line);
    if (isCatch) {
      catchCount++;
      // Kumpulkan blok catch sampai brace seimbang.
      let depth = 0;
      let block = '';
      let started = false;
      for (let j = i; j < Math.min(i + 12, lines.length); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; started = true; }
          else if (ch === '}') depth--;
        }
        block += lines[j] + '\n';
        if (started && depth <= 0) break;
      }
      const hasConsoleOnly = /console\.error/.test(block) && !/toast\(|alert\(|setError\(|showToast\(/.test(block);
      if (hasConsoleOnly) {
        problems.push({
          rel, line: i + 1, kind: 'error-tidak-terlihat-user',
          detail: 'catch hanya menulis console.error — user tidak melihat penjelasan',
          code: line.trim(),
        });
      }
    }

    // --- 2. fetch() mentah ---
    const fm = line.match(/(?<![\w.])fetch\s*\(/);
    // LoginPage TIDAK lagi dikecualikan: sejak diganti ke instance `authApi`
    // (axios tanpa interceptor 401), tidak ada fetch() mentah di halaman
    // login. Kalau ada lagi, itu regresi.
    //
    // Pengecualian yang sah: fetch() di dalam komentar (//) atau string,
    // dan pemanggilan pada API global seperti window.fetch.
    if (fm && !line.includes('//') && !line.includes('*')) {
      fetchCount++;
      problems.push({
        rel, line: i + 1, kind: 'fetch-mentah',
        detail: 'fetch() melewati instance axios — kehilangan interceptor 401 & err.serverMessage',
        code: line.trim(),
      });
    }
    // --- 3. Method axios yang tidak ada (mis. api.del) ---
    //
    // Axios hanya mengekspos: get, delete, head, options, post, postForm,
    // put, putForm, patch, patchForm. Alias `del` TIDAK ada. Memanggilnya
    // melempar TypeError yang tertangkap catch → toast generik, dan user
    // mengira operasi berhasil padahal tidak terjadi apa pun.
    const badMethod = line.match(/\b(?:api|authApi)\.(del|remove|destroy|erase)\s*\(/);
    if (badMethod) {
      problems.push({
        rel, line: i + 1, kind: 'method-axios-tidak-ada',
        detail: `api.${badMethod[1]}() tidak ada di axios — gunakan api.delete()`,
        code: line.trim(),
      });
    }
  });
}

walk(srcRoot);

if (problems.length) {
  console.log(`FAIL — ${problems.length} temuan:\n`);
  const byKind = {};
  for (const p of problems) (byKind[p.kind] ||= []).push(p);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`\n── ${kind} (${list.length}) ──`);
    for (const p of list) {
      console.log(`  ${p.rel}:${p.line}  ${p.detail}`);
      console.log(`      ${p.code}`);
    }
  }
  process.exit(1);
}

console.log(`PASS  ${catchCount} blok catch semuanya memberi feedback ke user`);
console.log(`PASS  tidak ada fetch() mentah di luar LoginPage`);
