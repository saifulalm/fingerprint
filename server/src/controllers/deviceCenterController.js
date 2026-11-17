// Device Center controller — administer perangkat Hikvision.
//
// Prinsip: endpoint hanya mengekspos AKSI YANG BENAR-BENARN DIDUKUNG
// firmware perangkat.
//
// FAKTA FIELD (probe live ke 192.168.89.241 & .240, 2026-11-10):
//   - Tambah user ke perangkat   → TIDAK BISA (UserInfo/Add → notSupport)
//   - Hapus user dari perangkat   → TIDAK BISA (UserInfo/Delete → badParameters,
//                                   UserInfoDetail/Delete → MessageParametersLack)
//   - Ubah employeeNo di perangkat → TIDAK BISA (Modify → badParameters)
//   - Ubah nama / disable user     → BISA (Modify, terverifikasi)
//
// Karena itu aplikasi menyediakan padanan yang JUJUR:
//   - "Nonaktifkan" (disable) = padanan hapus yang benar-benar bisa jalan.
//   - "Perbaikan ID" = pemetaan di sisi APLIKASI (tabel employee_id_aliases),
//     karena perangkat tidak bisa mengganti employeeNo.
//   - "Hapus dari daftar aplikasi" = hapus baris di device_users (cache),
//     bukan di perangkat.
import prisma from '../db.js';
import {
  listDevices,
  getDeviceByKey,
  getOverview,
  getDeviceUsers,
  updateDeviceUser,
  setDeviceUserEnabled,
  getUserWriteCapabilities,
  detectConflicts,
} from '../services/hikvisionAdmin.js';
import {
  CANONICAL_DEVICE_KEY,
  suggestIdAliases,
} from '../services/employeeIdentityService.js';
import { config } from '../config/index.js';

/** Catat aksi perangkat ke audit log. Kegagalan TIDAK ditelan diam-diam. */
async function logAudit(action, detail) {
  try {
    await prisma.auditLog.create({ data: { action, detail, user: 'device-center' } });
  } catch (err) {
    // Jejak audit bolong tanpa tanda adalah bug yang sangat sulit ditemukan.
    // Setidaknya catat ke log server.
    console.warn(`[Audit] gagal menulis audit "${action}":`, err.message);
  }
}

/**
 * Ambil device dari query/body, dengan validasi ketat.
 * Tanpa validasi, `deviceKey` dari user bisa injecting ke path lain.
 */
function resolveDevice(deviceKey) {
  const key = String(deviceKey || '').trim();
  if (!key || !config.devices?.[key]) {
    const err = new Error(`Perangkat "${key || '(kosong)'}" tidak dikenal. Pilihan: ${Object.keys(config.devices).join(', ')}`);
    err.status = 400;
    throw err;
  }
  return getDeviceByKey(key);
}

/** GET /api/device-center/overview — ringkasan + kapabilitas semua perangkat. */
export async function getCenterOverview(req, res) {
  try {
    const overview = await getOverview();
    // Kirim kapabilitas tulis user supaya UI tidak menampilkan aksi
    // yang pasti gagal (mis. tombol tambah/hapus user).
    res.json({ ...overview, userWrite: getUserWriteCapabilities() });
  } catch (err) {
    console.error('[device-center] overview', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Ambil status aktif per employeeNo dari tabel aplikasi (device_users).
 * Key: employeeNo → boolean.
 */
async function loadAppEnabledMap(deviceKey) {
  const rows = await prisma.deviceUser.findMany({ where: { deviceKey } });
  const map = {};
  for (const r of rows) {
    map[r.employeeNo] = r.enabled !== false;
  }
  return map;
}

/** GET /api/device-center/users?device=masuk — daftar user di satu perangkat. */
export async function getCenterUsers(req, res) {
  try {
    const dev = resolveDevice(req.query.device);
    const users = await getDeviceUsers(dev);
    // Status aktif di APLIKASI, agar UI bisa menandai user yang sudah
    // dinonaktifkan dari menu lain (mis. Kelola Karyawan).
    const appEnabled = await loadAppEnabledMap(dev.type);

    // Gabungkan ke tiap user supaya UI tidak perlu tahu bentuk map-nya.
    const data = users.map((u) => ({
      ...u,
      appEnabled: appEnabled[u.employeeNo] !== false,
    }));

    res.json({
      deviceKey: dev.type,
      deviceLabel: dev.label,
      data,
      total: data.length,
    });
  } catch (err) {
    console.error('[device-center] users', err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * GET /api/device-center/conflicts — konflik nomor employee antar perangkat.
 * Konflik ini yang menyebabkan laporan absensi salah orang.
 */
export async function getCenterConflicts(req, res) {
  try {
    const result = await detectConflicts();
    // Sertakan alias yang sudah ditetapkan di aplikasi, supaya UI bisa
    // menandai konflik mana yang SUDAH diperbaiki.
    const aliases = await prisma.employeeIdAlias.findMany();
    res.json({
      ...result,
      canonicalDeviceKey: CANONICAL_DEVICE_KEY,
      aliases: aliases.map((a) => ({
        deviceKey: a.deviceKey,
        deviceEmployeeNo: a.deviceEmployeeNo,
        employeeNo: a.employeeNo,
        note: a.note,
      })),
    });
  } catch (err) {
    console.error('[device-center] conflicts', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/device-center/id-alias/suggestions — saran perbaikan nomor ID.
 *
 * Memindai data PERANGKAT langsung dan menentukan nomor mana yang bentrok,
 * lalu menghitung nomor canonical yang benar lewat pencocokan nama.
 *
 * Saran yang SUDAH punya alias tidak dikembalikan lagi — supaya UI
 * menampilkan daftar yang bersih: apa yang belum diperbaiki.
 */
export async function getIdAliasSuggestions(req, res) {
  try {
    const devs = listDevices();
    const perDevice = {};

    for (const dev of devs) {
      try {
        const users = await getDeviceUsers(dev);
        perDevice[dev.type] = users.map((u) => ({
          employeeNo: u.employeeNo,
          name: u.name,
        }));
      } catch (err) {
        perDevice[dev.type] = { error: err.message };
      }
    }

    const deviceKeys = Object.keys(perDevice).filter((k) => Array.isArray(perDevice[k]));
    const suggestions = suggestIdAliases(perDevice, deviceKeys, CANONICAL_DEVICE_KEY);

    // Tandai yang sudah punya alias → sudah diperbaiki.
    const existing = await prisma.employeeIdAlias.findMany();
    const applied = new Set(existing.map((a) => `${a.deviceKey}:${a.deviceEmployeeNo}`));

    const rows = suggestions.map((s) => ({
      ...s,
      applied: applied.has(`${s.deviceKey}:${s.deviceEmployeeNo}`),
    }));

    res.json({
      data: rows,
      total: rows.length,
      pending: rows.filter((r) => !r.applied).length,
      canonicalDeviceKey: CANONICAL_DEVICE_KEY,
    });
  } catch (err) {
    console.error('[device-center] alias suggestions', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/device-center/users — ubah user di perangkat.
 * Body: { device, employeeNo, name?, userType?, validBegin?, validEnd? }
 */
export async function putCenterUser(req, res) {
  try {
    const { device, employeeNo, name, userType, validBegin, validEnd } = req.body || {};
    if (!employeeNo) {
      return res.status(400).json({ error: 'employeeNo wajib diisi' });
    }
    if (name === undefined && userType === undefined && !validBegin && !validEnd) {
      return res.status(400).json({ error: 'Tidak ada perubahan yang diminta' });
    }

    const dev = resolveDevice(device);
    const result = await updateDeviceUser(dev, employeeNo, { name, userType, validBegin, validEnd });

    await logAudit(
      'device-user-update',
      `Perangkat ${dev.label}: user ${employeeNo} diperbarui (${name ? `nama="${name}"` : 'data lain'})`
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[device-center] update user', err);
    res.status(err.status || 500).json({ error: err.message, subStatus: err.deviceSubStatus || null });
  }
}

/**
 * PUT /api/device-center/users/status — aktifkan / nonaktifkan user.
 * Body: { device, employeeNo, enabled }
 *
 * Ini adalah padanan "hapus" yang benar-benar bisa dijalankan: perangkat
 * menolak hard-delete, jadi user dinonaktifkan (Valid.enable=false).
 */
export async function putCenterUserStatus(req, res) {
  try {
    const { device, employeeNo, enabled } = req.body || {};
    if (!employeeNo) {
      return res.status(400).json({ error: 'employeeNo wajib diisi' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled harus berupa true/false' });
    }

    const dev = resolveDevice(device);
    const result = await setDeviceUserEnabled(dev, employeeNo, enabled);

    // Sinkronkan juga ke cache aplikasi supaya status konsisten di semua
    // halaman (Kelola Karyawan, laporan, Users).
    await prisma.deviceUser.updateMany({
      where: { employeeNo: String(employeeNo), deviceKey: dev.type },
      data: { deviceEnabled: enabled },
    });

    await logAudit(
      'device-user-status',
      `Perangkat ${dev.label}: user ${employeeNo} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[device-center] update user status', err);
    res.status(err.status || 500).json({ error: err.message, subStatus: err.deviceSubStatus || null });
  }
}

/**
 * POST /api/device-center/id-alias — tetapkan pemetaan nomor ID.
 *
 * MENGAPA ADA:
 *   Nomor employee adalah kunci lokal di tiap perangkat, dan perangkat
 *   TIDAK bisa mengubahnya (Modify → badParameters). ID yang sama bisa
 *   menunjuk orang berbeda di dua perangkat — dan itu bikin laporan salah
 *   orang. Jadi perbaikan dilakukan di sisi APLIKASI: catat bahwa
 *   "nomor X di perangkat D sebenarnya menunjuk nomor canonical Y".
 *
 * ARAH PEMETAAN:
 *   Nilai alias SELALU nomor canonical yang dipakai di perangkat REFERENSI
 *   (`CANONICAL_DEVICE_KEY`, default "masuk"). Jadi `keluar:5 → 6` berarti
 *   "nomor 5 di Keluar adalah orang bernomor 6 di perangkat referensi".
 *
 * Body: { device, deviceEmployeeNo, employeeNo, note? }
 */
export async function postIdAlias(req, res) {
  try {
    const { device, deviceEmployeeNo, employeeNo, note } = req.body || {};
    if (!device || !deviceEmployeeNo || !employeeNo) {
      return res.status(400).json({ error: 'device, deviceEmployeeNo, dan employeeNo wajib diisi' });
    }
    const dev = resolveDevice(device);
    const src = String(deviceEmployeeNo).trim();
    const dst = String(employeeNo).trim();
    if (src === dst) {
      return res.status(400).json({ error: 'deviceEmployeeNo dan employeeNo tidak boleh sama' });
    }

    // Nomor asal HARUS ada di perangkat itu — kalau tidak, pemetaan tidak
    // ada artinya.
    const users = await getDeviceUsers(dev);
    const srcFound = users.find((u) => u.employeeNo === src);
    if (!srcFound) {
      return res.status(404).json({ error: `Nomor ${src} tidak ada di perangkat ${dev.label}` });
    }

    // Nomor tujuan HARUS ada di perangkat REFERENSI — di sanalah nomor
    // canonical dipakai. Kalau tidak ada di sana, pemetaan tidak akan
    // pernah menghasilkan nomor yang valid.
    const refDev = getDeviceByKey(CANONICAL_DEVICE_KEY);
    const refUsers = await getDeviceUsers(refDev);
    const dstFound = refUsers.find((u) => u.employeeNo === dst);
    if (!dstFound) {
      return res.status(404).json({
        error: `Nomor ${dst} tidak ada di perangkat referensi (${refDev.label})`,
      });
    }

    const alias = await prisma.employeeIdAlias.upsert({
      where: { deviceKey_deviceEmployeeNo: { deviceKey: dev.type, deviceEmployeeNo: src } },
      create: { deviceKey: dev.type, deviceEmployeeNo: src, employeeNo: dst, note: note || null },
      update: { employeeNo: dst, note: note || null },
    });

    await logAudit(
      'device-id-alias',
      `Perangkat ${dev.label}: nomor ${src} dipetakan ke nomor canonical ${dst} (${dstFound.name})`
    );
    res.json({ success: true, data: alias });
  } catch (err) {
    console.error('[device-center] id alias', err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * DELETE /api/device-center/id-alias — hapus pemetaan nomor ID.
 * Query: ?device=&deviceEmployeeNo=
 */
export async function deleteIdAlias(req, res) {
  try {
    const { device, deviceEmployeeNo } = req.query || {};
    if (!device || !deviceEmployeeNo) {
      return res.status(400).json({ error: 'device dan deviceEmployeeNo wajib diisi' });
    }
    const dev = resolveDevice(device);

    const deleted = await prisma.employeeIdAlias.deleteMany({
      where: { deviceKey: dev.type, deviceEmployeeNo: String(deviceEmployeeNo).trim() },
    });

    await logAudit(
      'device-id-alias-delete',
      `Perangkat ${dev.label}: pemetaan nomor ${deviceEmployeeNo} dihapus`
    );
    res.json({ success: true, deleted: deleted.count });
  } catch (err) {
    console.error('[device-center] delete id alias', err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * DELETE /api/device-center/users — hapus user dari DAFTAR APLIKASI.
 *
 * PENTING: ini menghapus baris di tabel `device_users` (cache aplikasi),
 * BUKAN user di perangkat. Perangkat menolak hard-delete, jadi untuk
 * benar-benar menolak akses di perangkat, pakai
 * PUT /api/device-center/users/status dengan enabled=false.
 *
 * Query: ?device=&employeeNo=
 */
export async function deleteCenterUser(req, res) {
  try {
    const { device, employeeNo } = req.query || {};
    if (!device || !employeeNo) {
      return res.status(400).json({ error: 'device dan employeeNo wajib diisi' });
    }
    const dev = resolveDevice(device);
    const no = String(employeeNo).trim();

    // Peringatan eksplisit: user di perangkat TIDAK ikut terhapus.
    const deleted = await prisma.deviceUser.deleteMany({
      where: { employeeNo: no, deviceKey: dev.type },
    });

    await logAudit(
      'device-user-remove-from-list',
      `Perangkat ${dev.label}: user ${no} dihapus dari daftar aplikasi (bukan dari perangkat)`
    );
    res.json({
      success: true,
      deleted: deleted.count,
      deviceUntouched: true,
      note: 'User di perangkat tidak dihapus (firmware menolak hard-delete). Gunakan nonaktifkan untuk menolak akses.',
    });
  } catch (err) {
    console.error('[device-center] delete user', err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * POST /api/device-center/sync-name — samakan nama user ke semua perangkat
 * yang memuat nomor employee tersebut.
 * Body: { employeeNo, name, sourceDevice? }
 */
export async function postSyncName(req, res) {
  try {
    const { employeeNo, name, sourceDevice } = req.body || {};
    if (!employeeNo || !name) {
      return res.status(400).json({ error: 'employeeNo dan name wajib diisi' });
    }

    const devs = listDevices();
    const results = [];

    for (const dev of devs) {
      try {
        const users = await getDeviceUsers(dev);
        const found = users.find((u) => u.employeeNo === String(employeeNo));
        if (!found) {
          results.push({ deviceKey: dev.type, skipped: true, reason: 'tidak ada user dengan nomor ini di perangkat' });
          continue;
        }
        if ((found.name || '').trim() === name.trim()) {
          results.push({ deviceKey: dev.type, skipped: true, reason: 'nama sudah sama' });
          continue;
        }
        const r = await updateDeviceUser(dev, employeeNo, { name });
        results.push({ deviceKey: dev.type, skipped: false, success: true, response: r.response });
      } catch (err) {
        results.push({ deviceKey: dev.type, skipped: false, success: false, error: err.message });
      }
    }

    await logAudit('device-name-sync', `Sinkron nama user ${employeeNo} → "${name}" ke ${results.filter(r => r.success).length} perangkat`);

    // `success` top-level mencerminkan hasil SEBENARNYA, bukan selalu true.
    //
    // SEBELUMNYA: `res.json({ success: true, results })` aunque satu atau
    // beberapa perangkat gagal. Frontend membaca `success` dan menampilkan
    // toast "Berhasil" padahal ada perangkat yang namanya tidak berubah —
    // user mengira semua perangkat sudah sinkron.
    const failed = results.filter((r) => r.success === false);

    res.json({
      success: failed.length === 0,
      results,
      ...(failed.length
        ? { error: `${failed.length} perangkat gagal diperbarui: ${failed.map((f) => f.deviceKey).join(', ')}.` }
        : {}),
    });
  } catch (err) {
    console.error('[device-center] sync name', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/device-center/audit — jejak aksi perangkat terakhir.
 */
export async function getCenterAudit(req, res) {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'device-' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ data: logs, total: logs.length });
  } catch (err) {
    console.error('[device-center] audit', err);
    res.status(500).json({ error: err.message });
  }
}
