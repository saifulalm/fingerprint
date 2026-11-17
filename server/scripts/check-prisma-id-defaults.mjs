#!/usr/bin/env node
// Guard: setiap model Prisma yang kolom `id`-nya String HARUS punya default.
//
// BUG CLASS: `id String @id` tanpa default membuat `create({ data: {...} })`
// melempar "Argument `id` is missing". Kalau pemanggil menelan error
// (`catch (_) {}`), gejalanya SEPENUHNYA HENDAK: fitur "tidak jalan" tanpa
// satu pun pesan error. Case nyata di project ini: jejak audit mati sejak
// 16 Oktober dan jadwal laporan tidak pernah bisa dibuat.
//
// Pengecualian:
//   - `AttendanceRecord.id` dibangun deterministik dari data event perangkat
//     (serialNo + employeeNo + deviceKey) supaya sinkronisasi ulang tidak
//     menduplikasi baris — WAJIB tanpa default.
//   - `SystemSetting.id` adalah KUNCI pengaturan (mis. "smtp_host"), bukan
//     id acak — nilainya ditentukan oleh kode, bukan oleh database.
const MODELS_WITHOUT_DEFAULT_OK = new Set(['AttendanceRecord', 'SystemSetting']);
//
// Jalankan: node scripts/check-prisma-id-defaults.mjs
import fs from 'node:fs';
import path from 'node:path';

const schemaPath = path.resolve(process.argv[2] || 'prisma/schema.prisma');
const raw = fs.readFileSync(schemaPath, 'utf8');

const models = [];
const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
let m;
while ((m = modelRe.exec(raw)) !== null) {
  models.push({ name: m[1], body: m[2] });
}

if (!models.length) {
  console.error('FAIL: tidak ada model ditemukan di', schemaPath);
  process.exit(1);
}

const problems = [];
for (const { name, body } of models) {
  // Cari baris field id (bukan @@map / @@index / @@unique).
  const idLine = body.split('\n').find((l) => /^\s*id\s+String\b/.test(l));
  if (!idLine) continue; // model tanpa kolom String id — tidak relevan

  const hasDefault = /@default\(/.test(idLine);
  const allowed = MODELS_WITHOUT_DEFAULT_OK.has(name);

  if (!hasDefault && !allowed) {
    problems.push({ name, idLine: idLine.trim() });
  }
}

if (problems.length) {
  console.error('FAIL: model berikut punya kolom `id` tanpa @default — create() akan gagal diam-diam:');
  for (const p of problems) {
    console.error(`  - ${p.name}: ${p.idLine}`);
  }
  console.error('\nPerbaiki: `id String @id @default(uuid())`');
  console.error(`(kecuali: ${[...MODELS_WITHOUT_DEFAULT_OK].join(', ')} — id-nya deterministik dari data event)`);
  process.exit(1);
}

console.log(`PASS  semua ${models.length} model punya id yang bisa di-generate otomatis`);
