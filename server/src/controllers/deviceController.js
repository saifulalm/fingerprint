// Device controller
import crypto from 'crypto';
import { getDeviceInfo } from '../services/hikvision.js';
import { config } from '../config/index.js';
import prisma from '../db.js';

export async function getDevices(req, res) {
  try {
    const devs = Object.values(config.devices);
    // Global abort controller: cancels all device pings after 10s so DB update runs regardless
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const results = await Promise.all(
      devs.map(async (dev) => {
        const info = await getDeviceInfo(dev, controller.signal);

        // Update DB record — always runs, even if device pings timed out
        await prisma.device.upsert({
          where: { id: dev.type },
          update: {
            ip: dev.ip,
            username: dev.username,
            password: dev.password,
            lastSeen: info.status === 'online' ? new Date() : undefined,
            lastError: info.error || null,
          },
          create: {
            id: dev.type,
            label: dev.label,
            ip: dev.ip,
            username: dev.username,
            password: dev.password,
            type: dev.type,
            direction: dev.direction,
            lastSeen: info.status === 'online' ? new Date() : null,
            lastError: info.error || null,
          },
        });

        return [dev.type, info];
      })
    );

    clearTimeout(timer);
    const map = Object.fromEntries(results);
    res.json(map);
  } catch (err) {
    console.error('[devices]', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getUsers(req, res) {
  try {
    const users = await prisma.deviceUser.findMany({ orderBy: { name: 'asc' } });
    res.json({ data: users, total: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function refreshUsers(req, res) {
  try {
    const { fetchAllUsers } = await import('../services/hikvision.js');

    const allUsers = [];
    // Kegagalan per perangkat DICATAT dan dikembalikan ke user.
    //
    // SEBELUMNYA: `catch (err) { console.error(...) }` lalu tetap
    // `res.json({ success: true, cached: ... })`. Perangkat yang offline
    // terlihat seperti perangkat yang berhasil disinkronkan — user menekan
    // "Refresh Device", melihat "Berhasil", padahal separuh data cache stale
    // (atau tak ada sama sekali).
    //
    // SEKARANG: respons memuat daftar kegagalan per perangkat, dan `success`
    // hanya true bila SEMUA perangkat berhasil.
    const failures = [];

    for (const [key, dev] of Object.entries(config.devices)) {
      try {
        const users = await fetchAllUsers(dev);
        for (const u of users) {
          const empNo = String(u.employeeNo ?? u.employeeNoString ?? '').trim();
          if (!empNo) continue;

          // Status di perangkat (Valid.enable) ikut disimpan, supaya cache
          // aplikasi tidak menyimpang dari kondisi perangkat. Tanpa ini,
          // user yang dinonaktifkan dari layar perangkat tetap terlihat
          // aktif di aplikasi.
          const deviceEnabled = u.Valid?.enable !== false;

          await prisma.deviceUser.upsert({
            where: { employeeNo_deviceKey: { employeeNo: empNo, deviceKey: key } },
            update: {
              name: (u.name || '').trim(),
              userType: u.userType || 'normal',
              cardNo: u.cardNo || null,
              validEnd: u.Valid?.endTime || null,
              deviceEnabled,
              cachedAt: new Date(),
            },
            create: {
              id: crypto.randomUUID(),
              employeeNo: empNo,
              name: (u.name || '').trim() || `ID ${empNo}`,
              deviceKey: key,
              userType: u.userType || 'normal',
              cardNo: u.cardNo || null,
              validEnd: u.Valid?.endTime || null,
              deviceEnabled,
            },
          });
          allUsers.push({ name: u.name, employeeNo: empNo, deviceKey: key });
        }
        console.log(`[Users] ${dev.label}: ${users.length} users cached`);
      } catch (err) {
        console.error(`[Users] Failed to fetch from ${dev.label}: ${err.message}`);
        failures.push({ deviceKey: key, label: dev.label, error: err.message });
      }
    }

    res.json({
      success: failures.length === 0,
      cached: allUsers.length,
      ...(failures.length ? { failures } : {}),
      ...(failures.length
        ? { error: `${failures.length} perangkat gagal diakses: ${failures.map((f) => f.label).join(', ')}.` }
        : {}),
    });
  } catch (err) {
    console.error('[refreshUsers]', err);
    res.status(500).json({ error: err.message });
  }
}
