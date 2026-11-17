#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Design Token Guard — Biomlock Attendance
// ═══════════════════════════════════════════════════════════════
//
// Script ini menjaga agar design token radius TIDAK bocor kembali ke
// nilai hardcoded.duluan:
//   - Semua radius harus memakai var(--radius-*) dari index.css
//   - Semua keyframes harus punya satu definisi (global di index.css)
//   - Tombol ikon-only harus punya accessible name (aria-label/title)
//   - Key i18n harus lengkap di blok ID dan EN
//
// Jalankan: node scripts/check-design-tokens.mjs
// Dijalankan otomatis oleh `npm run verify`.
//
// ═══════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const errors = [];
const warnings = [];

/** Kumpulkan file sumber (jsx/tsx/css) secara rekursif. */
function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((e) => full.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ─── Helper kontras WCAG ──────────────────────────────────────
/** Luminansi relatif (WCAG 2.1). */
function relativeLuminance(hex) {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Rasio kontras antara dua warna hex (1..21). */
function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── 1. Radius hardcoded ─────────────────────────────────────
// Nilai yang diizinkan: 0, 50% (avatar/lingkaran), 9999px (pill),
// serta compound seperti "3px 0 0 3px" → tetap harus pakai token.
const ALLOWED_RADIUS = new Set(['0', '0px', '50%', '9999px', 'inherit']);

const srcFiles = walk(SRC, ['.jsx', '.tsx']);
const cssFiles = walk(SRC, ['.css']);

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    // borderRadius: '12px'  /  borderRadius: 12
    const m = line.match(/borderRadius:\s*(?:'([^']*)'|(\d+))/);
    if (!m) return;
    const value = (m[1] ?? m[2] ?? '').trim();
    if (!value) return;
    if (value.includes('var(--radius')) return;

    // Compound (multi-sisi) tetap diperiksa per-token
    const parts = value.split(/\s+/);
    const bad = parts.filter((p) => !ALLOWED_RADIUS.has(p) && !/^var\(--radius/.test(p));
    if (bad.length) {
      errors.push(
        `${rel(file)}:${i + 1} — radius hardcoded ${bad.join(' ')} (pakai var(--radius-*))`
      );
    }
  });
}

for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/border-radius:\s*([^;]+);/);
    if (!m) return;
    const value = m[1].trim();
    if (value.includes('var(--radius')) return;
    const parts = value.split(/\s+/);
    const bad = parts.filter((p) => !ALLOWED_RADIUS.has(p) && !/^var\(--radius/.test(p));
    if (bad.length) {
      errors.push(
        `${rel(file)}:${i + 1} — border-radius hardcoded ${bad.join(' ')} (pakai var(--radius-*))`
      );
    }
  });
}

// ─── 2. Keyframes ganda ──────────────────────────────────────
// Keyframe yang sama didefinisikan di index.css DAN di halaman akan
// saling menimpa (tergantung urutan cascade) → animasi bisa hilang.
const globalCss = readFileSync(join(SRC, 'index.css'), 'utf8');
const globalKf = new Set([...globalCss.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const localKf = new Set([...text.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  for (const name of localKf) {
    if (globalKf.has(name)) {
      errors.push(
        `${rel(file)} — keyframes "${name}" menduplikasi definisi global di index.css (pakai nama unik)`
      );
    }
  }
}

// ─── 3. Keyframes dipakai tapi tidak didefinisikan ───────────
const allKf = new Set(globalKf);
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) allKf.add(m[1]);
}
// Keyframes bawaan Tailwind (animate plugin) yang boleh dipakai.
const BUILTIN = new Set(['enter', 'exit', 'ping', 'pulse', 'spin', 'bounce', 'none']);

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const used = new Set();
  for (const m of text.matchAll(/animation:\s*'([^']+)'/g)) {
    const first = m[1].trim().split(/\s+/)[0];
    if (first && first !== 'none') used.add(first);
  }
  for (const m of text.matchAll(/animation:\s*`([^`]+)`/g)) {
    const first = m[1].trim().split(/\s+/)[0];
    if (first && first !== 'none') used.add(first);
  }
  // Catatan: JANGAN menambahkan `animation: <identifier>` dari sini.
  // Pola `animation: online ? 'spin ...' : 'none'` akan salah dibaca sebagai
  // keyframes bernama "online". Hanya nilai literal dalam tanda kutip yang valid.

  const localKf = new Set([...text.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  for (const name of used) {
    if (!allKf.has(name) && !BUILTIN.has(name) && !localKf.has(name)) {
      errors.push(`${rel(file)} — animation "${name}" tanpa definisi @keyframes`);
    }
  }
}

// ─── 4. Tombol ikon-only tanpa accessible name ───────────────
const ICON_TAG =
  /<(X|RefreshCw|Trash2?|Pencil|Search|Eye|EyeOff|MoreVertical|Download|Upload|Copy|Check|ChevronDown|ChevronUp|Plus|Minus|Filter|Printer|Share2|Settings2|Menu|LogOut|Bell|Loader)\b/;

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!ICON_TAG.test(line)) return;
    // Cari tag <button ke belakang
    for (let j = i; j >= Math.max(0, i - 14); j--) {
      if (!lines[j].includes('<button')) continue;
      if (lines[j].includes('</button>')) continue;
      const chunk = lines.slice(j, i + 3).join('\n');
      const openTag = chunk.slice(0, chunk.indexOf('>') + 1);
      if (openTag.includes('aria-label') || openTag.includes('title=')) break;
      //是否有 teks di dalam button?
      const inner = chunk.slice(chunk.indexOf('>') + 1);
      const text2 = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text2.length >= 2 && /[A-Za-z]/.test(text2)) break; // ada teks visible
      errors.push(
        `${rel(file)}:${j + 1} — tombol ikon-only tanpa aria-label/title`
      );
      break;
    }
  });
}

// ─── 5. Kelengkapan i18n (ID vs EN) ──────────────────────────
// Kamus reside di `hooks/langData.js` (file terpisah dari provider context),
// supaya hook tidak mencampur data dan logika.
const langFile = join(SRC, 'hooks', 'langData.js');
if (readFileSync(langFile, 'utf8').includes('export const LANGS')) {
  const langText = readFileSync(langFile, 'utf8');
  const idStart = langText.indexOf('  id: {');
  const enStart = langText.indexOf('  en: {');
  const idBlock = langText.slice(idStart, enStart);
  const enBlock = langText.slice(enStart, langText.indexOf('\n};', enStart));
  const idKeys = new Set([...idBlock.matchAll(/^\s{4}'([^']+)':/gm)].map((m) => m[1]));
  const enKeys = new Set([...enBlock.matchAll(/^\s{4}'([^']+)':/gm)].map((m) => m[1]));

  for (const k of idKeys) if (!enKeys.has(k)) errors.push(`langData.js — key "${k}" hilang di blok EN`);
  for (const k of enKeys) if (!idKeys.has(k)) errors.push(`langData.js — key "${k}" hilang di blok ID`);

  // Key yang dipakai di halaman harus ada
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = m[1];
      // Key dinamis (mis. 'sched.toggle_' + x) tidak bisa dicek statis
      if (key.includes('+') || key.endsWith('_') || key.endsWith('.')) continue;
      if (!idKeys.has(key) && !key.includes('.')) continue;
      if (!idKeys.has(key)) {
        errors.push(`${rel(file)} — t('${key}') tidak ada di langData.js`);
      }
    }
  }
}

// ─── 6. Kontras label teks (WCAG AA) ─────────────────────────
// Warna teks sekunder yang HARUS berada di atas rasio kontras 4.5:1 terhadap
// latar card (#1E293B) / sidebar (#0B0F1A). Nilai lama #64748B hanya mencapai
// 3.07:1 di card — label sekunder jadi sulit dibaca.
const LOW_CONTRAST_TEXT = ['#64748B', '#475569'];
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // Hanya kelas utilitas TEKS yang diperiksa: `text-[#xxxxxx]`.
    // `bg-[#xxxxxx]` / `border-[#xxxxxx]` bukan warna teks.
    for (const bad of LOW_CONTRAST_TEXT) {
      const re = new RegExp(`text-\\[${bad}\\]`, 'gi');
      if (re.test(line)) {
        errors.push(`${rel(file)}:${i + 1} — text-[${bad}] kontras < 4.5:1, gunakan text-[#8494AD]`);
      }
    }
  });
}

// Token --color-text-muted di index.css harus tetap darkened ≥ 4.5:1.
const cssText = readFileSync(join(SRC, 'index.css'), 'utf8');
const mutedMatch = cssText.match(/--color-text-muted:\s*(#[0-9A-Fa-f]{6})/);
if (mutedMatch) {
  const ratio = contrastRatio(mutedMatch[1], '#1E293B');
  if (ratio < 4.5) {
    errors.push(`index.css — --color-text-muted ${mutedMatch[1]} kontras ${ratio.toFixed(2)}:1 di #1E293B (min 4.5:1)`);
  }
}

// ─── Output ─────────────────────────────────────────────────
if (warnings.length) {
  console.log('\nPeringatan:');
  for (const w of warnings) console.log('  ⚠ ' + w);
}

if (errors.length) {
  console.error(`\n✗ Design token check GAGAL (${errors.length} masalah):\n`);
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}

console.log('✓ Design token check OK — radius, keyframes, a11y button, i18n konsisten.');
