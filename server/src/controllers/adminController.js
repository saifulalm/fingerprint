// Admin Dashboard controller — system overview, audit log, stats
import prisma from '../db.js';
import { config } from '../config/index.js';
import { schedulerService } from '../services/schedulerService.js';
import { whatsappService } from '../services/whatsapp.js';

// ─── GET /api/admin/dashboard ──────────────────────────────────────────────────
export async function getDashboard(req, res) {
  try {
    const WIB_MS = 7 * 60 * 60 * 1000;
    const now = new Date(Date.now() + WIB_MS);

    // Time ranges
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    const weekStart  = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Counts
    const [
      totalRecords,
      todayRecords,
      weekRecords,
      monthRecords,
      uniqueEmployees,
      totalSchedules,
      enabledSchedules,
    ] = await Promise.all([
      prisma.attendanceRecord.count(),
      prisma.attendanceRecord.count({ where: { time: { gte: todayStart, lt: todayEnd } } }),
      prisma.attendanceRecord.count({ where: { time: { gte: weekStart, lt: todayEnd } } }),
      prisma.attendanceRecord.count({ where: { time: { gte: monthStart, lt: todayEnd } } }),
      prisma.attendanceRecord.findMany({
        select: { employeeNo: true },
        distinct: ['employeeNo'],
      }).then(rows => rows.length),
      prisma.reportSchedule.count(),
      prisma.reportSchedule.count({ where: { enabled: true } }),
    ]);

    // Last 30 days attendance trend
    const thirtyDaysAgo = new Date(todayStart); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentRecords = await prisma.attendanceRecord.findMany({
      where: { time: { gte: thirtyDaysAgo, lt: todayEnd } },
      select: {
        time: true,
        direction: true,
        deviceKey: true,
        verifyMode: true,
        employeeNo: true,
      },
      orderBy: { time: 'desc' },
      take: 5000,
    });

    // Build daily trend (last 14 days)
    const dayMap = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(todayStart); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: key, Masuk: 0, Keluar: 0, total: 0, uniq: new Set() };
    }
    recentRecords.forEach(r => {
      const key = r.time instanceof Date ? r.time.toISOString().slice(0, 10) : String(r.time).slice(0, 10);
      if (dayMap[key]) {
        if (r.direction === 'Masuk') dayMap[key].Masuk++;
        else if (r.direction === 'Keluar') dayMap[key].Keluar++;
        dayMap[key].total++;
        dayMap[key].uniq.add(r.employeeNo);
      }
    });
    const trend = Object.values(dayMap).map(d => ({
      date: d.date,
      Masuk: d.Masuk,
      Keluar: d.Keluar,
      total: d.total,
      uniqEmployees: d.uniq.size,
    }));

    // Verify mode breakdown (last 30 days)
    const verifyMap = {};
    recentRecords.forEach(r => {
      verifyMap[r.verifyMode] = (verifyMap[r.verifyMode] || 0) + 1;
    });
    const verifyModes = Object.entries(verifyMap)
      .map(([mode, count]) => ({ mode, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Active schedules
    const schedules = await prisma.reportSchedule.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Recent audit logs
    const auditLogs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Device info from config (live status is in deviceController)
    const deviceConfigs = Object.entries(config.devices).map(([key, dev]) => ({
      key,
      label: dev.label,
      ip: dev.ip,
      type: dev.type,
    }));

    res.json({
      // Counts
      stats: {
        totalRecords,
        todayRecords,
        weekRecords,
        monthRecords,
        uniqueEmployees,
        totalSchedules,
        enabledSchedules,
      },
      // Trend
      trend: trend.reverse(), // chronological order
      verifyModes,
      // System
      deviceConfigs,
      schedules,
      auditLogs: auditLogs.slice(0, 20),
      systemTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/dashboard]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
export async function getStats(req, res) {
  try {
    const WIB_MS = 7 * 60 * 60 * 1000;
    const now = new Date(Date.now() + WIB_MS);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);

    const [todayMasuk, todayKeluar, totalEmployees] = await Promise.all([
      prisma.attendanceRecord.count({
        where: { time: { gte: todayStart, lt: todayEnd }, direction: 'Masuk' }
      }),
      prisma.attendanceRecord.count({
        where: { time: { gte: todayStart, lt: todayEnd }, direction: 'Keluar' }
      }),
      prisma.attendanceRecord.findMany({
        select: { employeeNo: true },
        distinct: ['employeeNo'],
      }).then(rows => rows.length),
    ]);

    res.json({
      today: { masuk: todayMasuk, keluar: todayKeluar, total: todayMasuk + todayKeluar },
      uniqueEmployees: totalEmployees,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /api/admin/audit ────────────────────────────────────────────────────
export async function createAudit(req, res) {
  try {
    const { action, detail } = req.body;
    if (!action) return res.status(400).json({ error: 'Aksi wajib diisi' });

    const audit = await prisma.auditLog.create({
      data: {
        action,
        detail: detail || null,
        user: req.session?.user?.username || 'admin',
      },
    });
    res.json(audit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── DELETE /api/admin/audit ─────────────────────────────────────────────────
//
// MASALAH YANG DISELESAIKAN — "hapus semua log tanpa sengaja":
//   SEBELUMNYA: `days` yang kosong berarti cutoff = new Date(0) → SELURUH
//   log audit dihapus. Tidak ada konfirmasi, tidak ada validasi. Satu klik
//   di UI tanpa sengaja menghapus semua jejak audit — dan log auditlah
//   satu-satunya bukti kalau ada aktivitas mencurigakan.
//
//   SEKARANG:
//     - `days` WAJIB diisi dan harus angka bulat 1..3650.
//     - Wiping SELURUH log memerlukan flag eksplisit `?all=true`.
//     - Jumlah baris yang akan dihapus dikembalikan dalam respons, jadi
//       user bisa memverifikasi sebelum mengonfirmasi.
export async function clearAuditLogs(req, res) {
  try {
    const { days, all } = req.query;

    // Mode "hapus semua" harus diminta secara eksplisit.
    if (all === 'true') {
      const total = await prisma.auditLog.count();
      const result = await prisma.auditLog.deleteMany({});
      return res.json({
        success: true,
        deleted: result.count,
        scope: 'all',
        previousTotal: total,
        message: `Seluruh log audit dihapus (${result.count} baris).`,
      });
    }

    // Tanpa `days`, jangan hapus apa pun. Dulu perilaku defaultnya adalah
    // menghapus SEMUA log — terlalu berbahaya untuk sebuah endpoint
    // yang bisa dipanggil sekali klik.
    if (days === undefined || days === null || days === '') {
      return res.status(400).json({
        error: 'Parameter "days" wajib diisi (1–3650), atau gunakan ?all=true untuk menghapus seluruh log.',
      });
    }

    const parsed = Number(days);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
      return res.status(400).json({
        error: 'Parameter "days" harus berupa bilangan bulat antara 1 dan 3650.',
      });
    }

    const cutoff = new Date(Date.now() - parsed * 24 * 60 * 60 * 1000);
    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    res.json({
      success: true,
      deleted: result.count,
      scope: `older-than-${parsed}-days`,
      message: `${result.count} log audit lebih tua dari ${parsed} hari dihapus.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
