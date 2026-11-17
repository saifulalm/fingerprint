// ─── Ekspor data database saat ini ke fixture JSON ─────────────────────────────
//
// TUJUAN:
//   Menyimpan data operational yang SEDANG ADA di PostgreSQL ke dalam file
//   JSON yang bisa di-commit ke repository, lalu mengembalikan database baru
//   (fresh install) ke kondisi yang sama via `npm run seed`.
//
// KENAPA TIDAK PAKAI pg_dump:
//   `pg_dump` harus versinya cocok dengan server PostgreSQL, dan versinya yang
//   tersedia di mesin sering lebih tua (mis. client 16 vs server 18). Script
//   ini memakai Prisma Client yang sudah menjadi dependency project, sehingga
//   bekerja di mana saja selama `npm install` sudah dijalankan.
//
// PENANGANAN RAHASIA:
//   Kolom yang isinya kredensial (password perangkat, token, secret) DIKOSONGKAN
//   di fixture dan diisi ulang dari `.env` / environment variable saat seeding.
//   Fixture TIDAK PERNAH memuat kredensial asli.
//
// PEMAKAIAN:
//   cd server && npm run export:data
//
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, '..', 'prisma', 'fixtures', 'current-data.json');

const prisma = new PrismaClient();

// Kolom/field yang dianggap rahasia → dikosongkan saat ekspor.
const SECRET_FIELDS = new Set(['password', 'secret']);

// Field yang nilainya bisa mengandung token di dalam string (URL ber-token).
const REDACT_URL_TOKEN_FIELDS = new Set(['wa_gateway_url']);

/**
 * Kosongkan nilai yang mengandung kredensial.
 * @param {string} field nama field
 * @param {unknown} value nilai asli
 */
function redact(field, value) {
  if (value === null || value === undefined) return value;
  if (SECRET_FIELDS.has(field)) return '';
  if (REDACT_URL_TOKEN_FIELDS.has(field) && typeof value === 'string') {
    // Pertahankan skema URL tetapi hapus nilai token.
    return value.replace(/([?&](?:token|api[_-]?key|key|password|secret)=)[^&]*/gi, '$1***');
  }
  return value;
}

/**
 * Ubah objek Date menjadi string ISO agar serializable ke JSON.
 * @param {unknown} value nilai kolom
 */
function normalize(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function main() {
  console.log('[export] Membaca data dari database...');

  const data = {
    _meta: {
      exportedAt: new Date().toISOString(),
      source: 'PostgreSQL (Prisma)',
      note: 'Field kredensial sengaja dikosongkan. Isi dari .env saat seeding.',
    },
    devices: [],
    systemSettings: [],
    attendanceRecords: [],
    auditLogs: [],
    deviceUsers: [],
    employeeIdAliases: [],
    reportSchedules: [],
    syncJobs: [],
    whatsappWebhookEvents: [],
    whatsappWebhookRegistrations: [],
  };

  // Device — password dibuang (diisi dari .env saat seeding).
  const devices = await prisma.device.findMany({ orderBy: { id: 'asc' } });
  data.devices = devices.map((d) => ({
    id: d.id,
    label: d.label,
    ip: d.ip,
    username: d.username,
    password: '',
    type: d.type,
    direction: d.direction,
  }));

  // SystemSetting — nilai string, disalin apa adanya kecuali field ber-token.
  const settings = await prisma.systemSetting.findMany({ orderBy: { id: 'asc' } });
  data.systemSettings = settings.map((s) => ({
    id: s.id,
    value: redact('wa_gateway_url', s.value) ?? s.value,
    desc: s.desc,
  }));

  const attendance = await prisma.attendanceRecord.findMany({ orderBy: { time: 'asc' } });
  data.attendanceRecords = attendance.map((r) => ({
    ...r,
    time: normalize(r.time),
    syncedAt: normalize(r.syncedAt),
  }));

  const auditLogs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  data.auditLogs = auditLogs.map((r) => ({ ...r, createdAt: normalize(r.createdAt) }));

  const deviceUsers = await prisma.deviceUser.findMany({ orderBy: { id: 'asc' } });
  data.deviceUsers = deviceUsers.map((u) => ({ ...u, cachedAt: normalize(u.cachedAt) }));

  const aliases = await prisma.employeeIdAlias.findMany({ orderBy: { id: 'asc' } });
  data.employeeIdAliases = aliases.map((a) => ({ ...a, createdAt: normalize(a.createdAt) }));

  const schedules = await prisma.reportSchedule.findMany({ orderBy: { id: 'asc' } });
  data.reportSchedules = schedules.map((s) => ({
    ...s,
    lastRun: normalize(s.lastRun),
    createdAt: normalize(s.createdAt),
    updatedAt: normalize(s.updatedAt),
  }));

  const syncJobs = await prisma.syncJob.findMany({ orderBy: { id: 'asc' } });
  data.syncJobs = syncJobs.map((s) => ({
    ...s,
    startTime: normalize(s.startTime),
    endTime: normalize(s.endTime),
    createdAt: normalize(s.createdAt),
  }));

  const events = await prisma.whatsAppWebhookEvent.findMany({ orderBy: { receivedAt: 'asc' } });
  data.whatsappWebhookEvents = events.map((e) => ({
    ...e,
    receivedAt: normalize(e.receivedAt),
    processedAt: normalize(e.processedAt),
  }));

  const registrations = await prisma.whatsAppWebhookRegistration.findMany({ orderBy: { id: 'asc' } });
  data.whatsappWebhookRegistrations = registrations.map((r) => ({
    ...r,
    secret: '',
    lastTriggeredAt: normalize(r.lastTriggeredAt),
    createdAt: normalize(r.createdAt),
    updatedAt: normalize(r.updatedAt),
  }));

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`[export] Selesai → ${OUT_FILE}`);
  console.log(
    `[export] devices=${data.devices.length} settings=${data.systemSettings.length} ` +
      `attendance=${data.attendanceRecords.length} audit=${data.auditLogs.length} ` +
      `deviceUsers=${data.deviceUsers.length} aliases=${data.employeeIdAliases.length} ` +
      `schedules=${data.reportSchedules.length} syncJobs=${data.syncJobs.length} ` +
      `waEvents=${data.whatsappWebhookEvents.length} waRegs=${data.whatsappWebhookRegistrations.length}`
  );
}

main()
  .catch((e) => {
    console.error('[export] Gagal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
