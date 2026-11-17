// ─── Seed database ─────────────────────────────────────────────────────────────
//
// Script ini dipakai untuk:
//   1. Membuat konfigurasi perangkat (masuk/keluar) —
//      IP/username/password diambil dari environment variable
//      (DEVICE_MASUK_IP, DEVICE_MASUK_USER, DEVICE_MASUK_PASS, dst).
//   2. Memuat DATA SAAT INI dari fixture `prisma/fixtures/current-data.json`
//      supaya instalasi baru langsung berisi data yang sama.
//
// KENAPA ADA FIXTURE JSON (bukan pg_dump):
//   `pg_dump` versinya harus cocok dengan server PostgreSQL. Di mesin
//   development, client sering lebih tua dari server sehingga dump gagal.
//   Fixture JSON dibuat oleh `npm run export:data` (script berbasis Prisma
//   Client) dan bisa di-commit, di-review, dan di-restore di environment mana
//   pun tanpa tooling database tambahan.
//
// KEAMANAN:
//   Fixture TIDAK memuat kredensial. Password perangkat, secret webhook, dan
//   token pada URL selalu dikosongkan saat ekspor, lalu diisi ulang dari
//   environment variable saat seeding.
//
// IDEMPOTENSI:
//   Semua operasi memakai upsert dengan unique key masing-masing tabel, sehingga
//   menjalankan seed berulang kali TIDAK menghasilkan baris duplikat.
//
// PEMAKAIAN:
//   cd server && npm run seed
//
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = path.resolve(__dirname, 'fixtures', 'current-data.json');

// Definisi perangkat dasar. Kredensial diambil dari environment.
const DEVICES = [
  {
    id: 'masuk',
    label: 'Fingerprint Masuk',
    type: 'masuk',
    direction: 'Masuk',
    ipEnv: 'DEVICE_MASUK_IP',
    ipDefault: '192.168.89.241',
    userEnv: 'DEVICE_MASUK_USER',
    passEnv: 'DEVICE_MASUK_PASS',
  },
  {
    id: 'keluar',
    label: 'Fingerprint Keluar',
    type: 'keluar',
    direction: 'Keluar',
    ipEnv: 'DEVICE_KELUAR_IP',
    ipDefault: '192.168.89.240',
    userEnv: 'DEVICE_KELUAR_USER',
    passEnv: 'DEVICE_KELUAR_PASS',
  },
];

/**
 * Baca fixture JSON bila tersedia.
 * @returns {object|null} isi fixture atau null
 */
function loadFixture() {
  if (!existsSync(FIXTURE_FILE)) {
    console.log('[seed] Fixture tidak ada — hanya konfigurasi perangkat yang di-seed.');
    return null;
  }
  const raw = readFileSync(FIXTURE_FILE, 'utf8');
  return JSON.parse(raw);
}

async function seedDevices(fixture) {
  for (const dev of DEVICES) {
    // Kalau fixture punya perangkat yang sama, pakai IP/user/pass dari fixture
    // sebagai fallback ketika env var tidak diisi.
    const fromFixture = fixture?.devices?.find((d) => d.id === dev.id) || null;

    const ip = process.env[dev.ipEnv] || fromFixture?.ip || dev.ipDefault;
    const username = process.env[dev.userEnv] || fromFixture?.username || 'admin';
    const password = process.env[dev.passEnv] || fromFixture?.password || '';

    await prisma.device.upsert({
      where: { id: dev.id },
      update: {
        label: dev.label,
        ip,
        username,
        // Jangan timpa password yang sudah ada bila env var tidak diisi.
        ...(password ? { password } : {}),
        type: dev.type,
        direction: dev.direction,
      },
      create: {
        id: dev.id,
        label: dev.label,
        ip,
        username,
        password,
        type: dev.type,
        direction: dev.direction,
      },
    });
    console.log(`[seed] Device "${dev.label}" (${dev.id}) siap — ip=${ip}`);
  }
}

async function seedFixture(fixture) {
  if (!fixture) return;

  // ── SystemSetting ────────────────────────────────────────────────────────
  for (const s of fixture.systemSettings || []) {
    await prisma.systemSetting.upsert({
      where: { id: s.id },
      update: { value: s.value, desc: s.desc },
      create: { id: s.id, value: s.value, desc: s.desc },
    });
  }
  console.log(`[seed] systemSettings: ${(fixture.systemSettings || []).length}`);

  // ── AttendanceRecord ─────────────────────────────────────────────────────
  let attendanceCount = 0;
  for (const r of fixture.attendanceRecords || []) {
    await prisma.attendanceRecord.upsert({
      where: { id: r.id },
      update: {
        employeeNo: r.employeeNo,
        employeeName: r.employeeName,
        cardNo: r.cardNo,
        time: new Date(r.time),
        direction: r.direction,
        verifyMode: r.verifyMode,
        doorNo: r.doorNo,
        cardReaderNo: r.cardReaderNo,
        deviceKey: r.deviceKey,
        deviceLabel: r.deviceLabel,
        deviceIP: r.deviceIP,
        major: r.major,
        minor: r.minor,
        serialNo: r.serialNo,
        userType: r.userType,
        validEnd: r.validEnd,
        rawTime: r.rawTime,
        syncedAt: new Date(r.syncedAt),
      },
      create: {
        id: r.id,
        employeeNo: r.employeeNo,
        employeeName: r.employeeName,
        cardNo: r.cardNo,
        time: new Date(r.time),
        direction: r.direction,
        verifyMode: r.verifyMode,
        doorNo: r.doorNo,
        cardReaderNo: r.cardReaderNo,
        deviceKey: r.deviceKey,
        deviceLabel: r.deviceLabel,
        deviceIP: r.deviceIP,
        major: r.major,
        minor: r.minor,
        serialNo: r.serialNo,
        userType: r.userType,
        validEnd: r.validEnd,
        rawTime: r.rawTime,
        syncedAt: new Date(r.syncedAt),
      },
    });
    attendanceCount += 1;
  }
  console.log(`[seed] attendanceRecords: ${attendanceCount}`);

  // ── AuditLog ─────────────────────────────────────────────────────────────
  for (const a of fixture.auditLogs || []) {
    await prisma.auditLog.upsert({
      where: { id: a.id },
      update: {
        action: a.action,
        user: a.user,
        detail: a.detail,
        ip: a.ip,
        createdAt: new Date(a.createdAt),
      },
      create: {
        id: a.id,
        action: a.action,
        user: a.user,
        detail: a.detail,
        ip: a.ip,
        createdAt: new Date(a.createdAt),
      },
    });
  }
  console.log(`[seed] auditLogs: ${(fixture.auditLogs || []).length}`);

  // ── DeviceUser (device_users) ────────────────────────────────────────────
  for (const u of fixture.deviceUsers || []) {
    await prisma.deviceUser.upsert({
      where: { employeeNo_deviceKey: { employeeNo: u.employeeNo, deviceKey: u.deviceKey } },
      update: {
        name: u.name,
        userType: u.userType,
        cardNo: u.cardNo,
        validEnd: u.validEnd,
        cachedAt: new Date(u.cachedAt),
        enabled: u.enabled,
        deviceEnabled: u.deviceEnabled,
      },
      create: {
        id: u.id,
        employeeNo: u.employeeNo,
        name: u.name,
        deviceKey: u.deviceKey,
        userType: u.userType,
        cardNo: u.cardNo,
        validEnd: u.validEnd,
        cachedAt: new Date(u.cachedAt),
        enabled: u.enabled,
        deviceEnabled: u.deviceEnabled,
      },
    });
  }
  console.log(`[seed] deviceUsers: ${(fixture.deviceUsers || []).length}`);

  // ── EmployeeIdAlias (employee_id_aliases) ────────────────────────────────
  for (const a of fixture.employeeIdAliases || []) {
    await prisma.employeeIdAlias.upsert({
      where: { deviceKey_deviceEmployeeNo: { deviceKey: a.deviceKey, deviceEmployeeNo: a.deviceEmployeeNo } },
      update: { employeeNo: a.employeeNo, note: a.note },
      create: {
        id: a.id,
        deviceKey: a.deviceKey,
        deviceEmployeeNo: a.deviceEmployeeNo,
        employeeNo: a.employeeNo,
        note: a.note,
        createdAt: new Date(a.createdAt),
      },
    });
  }
  console.log(`[seed] employeeIdAliases: ${(fixture.employeeIdAliases || []).length}`);

  // ── ReportSchedule ───────────────────────────────────────────────────────
  for (const s of fixture.reportSchedules || []) {
    await prisma.reportSchedule.upsert({
      where: { id: s.id },
      update: {
        name: s.name,
        enabled: s.enabled,
        cronExpr: s.cronExpr,
        period: s.period,
        channel: s.channel,
        recipients: s.recipients,
        lang: s.lang,
        waGatewayUrl: s.waGatewayUrl,
        lastRun: s.lastRun ? new Date(s.lastRun) : null,
        lastStatus: s.lastStatus,
        lastError: s.lastError,
      },
      create: {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        cronExpr: s.cronExpr,
        period: s.period,
        channel: s.channel,
        recipients: s.recipients,
        lang: s.lang,
        waGatewayUrl: s.waGatewayUrl,
        lastRun: s.lastRun ? new Date(s.lastRun) : null,
        lastStatus: s.lastStatus,
        lastError: s.lastError,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
      },
    });
  }
  console.log(`[seed] reportSchedules: ${(fixture.reportSchedules || []).length}`);

  // ── SyncJob ──────────────────────────────────────────────────────────────
  for (const j of fixture.syncJobs || []) {
    await prisma.syncJob.upsert({
      where: { id: j.id },
      update: {
        deviceKey: j.deviceKey,
        status: j.status,
        startTime: new Date(j.startTime),
        endTime: j.endTime ? new Date(j.endTime) : null,
        recordsCount: j.recordsCount,
        errorMsg: j.errorMsg,
      },
      create: {
        id: j.id,
        deviceKey: j.deviceKey,
        status: j.status,
        startTime: new Date(j.startTime),
        endTime: j.endTime ? new Date(j.endTime) : null,
        recordsCount: j.recordsCount,
        errorMsg: j.errorMsg,
        createdAt: new Date(j.createdAt),
      },
    });
  }
  console.log(`[seed] syncJobs: ${(fixture.syncJobs || []).length}`);

  // ── WhatsAppWebhookEvent ─────────────────────────────────────────────────
  for (const e of fixture.whatsappWebhookEvents || []) {
    await prisma.whatsAppWebhookEvent.upsert({
      where: { idempotencyKey: e.idempotencyKey },
      update: {
        event: e.event,
        sessionId: e.sessionId,
        deliveryId: e.deliveryId,
        status: e.status,
        from: e.from,
        chatId: e.chatId,
        body: e.body,
        eventStatus: e.eventStatus,
        payload: e.payload,
        error: e.error,
        attempts: e.attempts,
        processedAt: e.processedAt ? new Date(e.processedAt) : null,
      },
      create: {
        id: e.id,
        event: e.event,
        sessionId: e.sessionId,
        deliveryId: e.deliveryId,
        idempotencyKey: e.idempotencyKey,
        status: e.status,
        from: e.from,
        chatId: e.chatId,
        body: e.body,
        eventStatus: e.eventStatus,
        payload: e.payload,
        error: e.error,
        attempts: e.attempts,
        receivedAt: new Date(e.receivedAt),
        processedAt: e.processedAt ? new Date(e.processedAt) : null,
      },
    });
  }
  console.log(`[seed] whatsappWebhookEvents: ${(fixture.whatsappWebhookEvents || []).length}`);

  // ── WhatsAppWebhookRegistration ─────────────────────────────────────────
  // Secret TIDAK ikut dari fixture (selalu kosong) → diisi dari env bila ada.
  const waSecret = process.env.WA_WEBHOOK_SECRET || '';
  for (const r of fixture.whatsappWebhookRegistrations || []) {
    await prisma.whatsAppWebhookRegistration.upsert({
      where: { remoteId: r.remoteId },
      update: {
        sessionId: r.sessionId,
        sessionName: r.sessionName,
        url: r.url,
        events: r.events,
        active: r.active,
        lastError: r.lastError,
        ...(waSecret ? { secret: waSecret } : {}),
      },
      create: {
        id: r.id,
        remoteId: r.remoteId,
        sessionId: r.sessionId,
        sessionName: r.sessionName,
        url: r.url,
        events: r.events,
        secret: waSecret,
        active: r.active,
        lastTriggeredAt: r.lastTriggeredAt ? new Date(r.lastTriggeredAt) : null,
        lastError: r.lastError,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
      },
    });
  }
  console.log(`[seed] whatsappWebhookRegistrations: ${(fixture.whatsappWebhookRegistrations || []).length}`);
}

async function main() {
  console.log('[seed] Mulai seeding database...');
  const fixture = loadFixture();
  await seedDevices(fixture);
  await seedFixture(fixture);
  console.log('[seed] Selesai!');
}

main()
  .catch((e) => {
    console.error('[seed] Gagal:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
