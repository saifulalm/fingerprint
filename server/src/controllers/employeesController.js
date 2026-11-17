// Employee management — CRUD for employee names + IDs
//
// CATATAN PENTING soal "hapus":
//   Perangkat Hikvision menolak hard-delete user (probe live 2026-11-10:
//   UserInfo/Delete → badParameters, UserInfoDetail/Delete →
//   MessageParametersLack). Jadi "hapus" di aplikasi berarti SOFT-DELETE:
//   baris device_users tetap ada tapi `enabled=false`, sehingga user tidak
//   lagi dipakai untuk memetakan nama di laporan.
//
//   Menonaktifkan akses di PERANGKAT dilakukan terpisah lewat Device
//   Center (PUT /api/device-center/users/status).
import prisma from '../db.js';
import { buildEmployeeIndex, loadIdAliases, resolveDisplayName } from '../services/employeeIdentityService.js';
import { config } from '../config/index.js';

// Device key yang valid. `config.devices` adalah satu-satunya sumber
// kebenaran (dikembalikan dari .env), bukan daftar hard-coded.
//
// SEBELUMNYA `deviceKey` diterima apa adanya di createEmployee. Baris
// bisa dibuat untuk perangkat yang tidak ada — lalu baris itu tidak pernah
// muncul di Device Center (yang cuma menampilkan device dari config) dan
// membingungkan saat sinkronisasi.
const VALID_DEVICE_KEYS = Object.keys(config.devices);

/**
 * Validasi deviceKey. Mengembalikan null bila valid, atau pesan error.
 */
function validateDeviceKey(deviceKey) {
  const key = String(deviceKey || 'masuk').trim();
  if (!VALID_DEVICE_KEYS.includes(key)) {
    return `deviceKey "${key}" tidak dikenal. Pilihan: ${VALID_DEVICE_KEYS.join(', ')}.`;
  }
  return null;
}

// GET /api/employees — list all
export async function getEmployees(req, res) {
  try {
    const employees = await prisma.deviceUser.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({ data: employees, total: employees.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/employees — create
export async function createEmployee(req, res) {
  try {
    const { employeeNo, name, deviceKey, userType, cardNo, validEnd } = req.body;
    if (!employeeNo || !name) {
      return res.status(400).json({ error: 'employeeNo dan name wajib diisi' });
    }

    // Validasi deviceKey (baris untuk perangkat tak dikenal tidak pernah
    // muncul di Device Center dan merusak hasil sinkronisasi).
    const deviceKeyError = validateDeviceKey(deviceKey);
    if (deviceKeyError) {
      return res.status(400).json({ error: deviceKeyError });
    }
    const resolvedDeviceKey = String(deviceKey || 'masuk').trim();

    const emp = await prisma.deviceUser.upsert({
      where: { employeeNo_deviceKey: { employeeNo, deviceKey: resolvedDeviceKey } },
      update: { name, userType, cardNo, validEnd },
      create: {
        employeeNo,
        name,
        deviceKey: resolvedDeviceKey,
        userType: userType || 'normal',
        cardNo: cardNo || null,
        validEnd: validEnd || null,
      },
    });
    res.json({ success: true, data: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/employees/:employeeNo — bulk update name across devices
export async function updateEmployee(req, res) {
  try {
    const { employeeNo } = req.params;
    const { name, userType, cardNo, validEnd } = req.body;
    if (!name) return res.status(400).json({ error: 'name wajib diisi' });

    // Update all entries for this employeeNo across all devices
    const updated = await prisma.deviceUser.updateMany({
      where: { employeeNo },
      data: { name, userType, cardNo, validEnd },
    });

    // Also update AttendanceRecord names for this employeeNo
    await prisma.attendanceRecord.updateMany({
      where: { employeeNo },
      data: { employeeName: name },
    });

    res.json({ success: true, updated: updated.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/employees/:employeeNo
//
// SOFT-DELETE, bukan hard-delete.
//
// Alasan: perangkat menolak hard-delete user, dan baris device_users
// dipakai untuk memetakan nomor ID → nama di laporan. Menghapus barisnya
// secara fisik akan membuat rekaman absensi lama kehilangan nama (jadi
// "ID 5" di laporan).
//
// Efek soft-delete: user ditandai enabled=false di SEMUA perangkatnya,
// sehingga tidak lagi dipetakan ke nama. Riwayat absensi tetap utuh.
//
// Untuk benar-benar menolak akses di perangkat, panggil juga
// PUT /api/device-center/users/status (Valid.enable=false).
export async function deleteEmployee(req, res) {
  try {
    const { employeeNo } = req.params;
    const no = String(employeeNo).trim();

    const updated = await prisma.deviceUser.updateMany({
      where: { employeeNo: no },
      data: { enabled: false },
    });

    // Nama pada rekaman absensi lama ikut diselaraskan supaya laporan
    // tidak menampilkan nama yang sudah dinonaktifkan.
    const index = await buildEmployeeIndex();
    const aliases = await loadIdAliases();
    const display = resolveDisplayName(no, index, aliases);

    if (updated.count > 0) {
      await prisma.attendanceRecord.updateMany({
        where: { employeeNo: no },
        data: { employeeName: display },
      });
    }

    res.json({
      success: true,
      disabled: updated.count,
      softDeleted: true,
      note: 'Pengguna dinonaktifkan di aplikasi (data tetap disimpan untuk riwayat laporan). Untuk menolak akses di perangkat, gunakan Device Center.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/employees/:employeeNo/status — aktifkan / nonaktifkan user
// di daftar aplikasi. Body: { enabled: boolean }
export async function setEmployeeStatus(req, res) {
  try {
    const { employeeNo } = req.params;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled harus berupa true/false' });
    }
    const no = String(employeeNo).trim();

    const updated = await prisma.deviceUser.updateMany({
      where: { employeeNo: no },
      data: { enabled },
    });

    if (updated.count === 0) {
      return res.status(404).json({ error: `Karyawan dengan ID "${no}" tidak ditemukan` });
    }

    // Perbarui juga nama pada rekaman lama agar konsisten.
    const index = await buildEmployeeIndex();
    const aliases = await loadIdAliases();
    const display = resolveDisplayName(no, index, aliases);
    await prisma.attendanceRecord.updateMany({
      where: { employeeNo: no },
      data: { employeeName: display },
    });

    res.json({ success: true, updated: updated.count, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/employees/bulk — bulk create from list
export async function bulkCreateEmployees(req, res) {
  try {
    const { employees } = req.body;
    if (!Array.isArray(employees)) {
      return res.status(400).json({ error: 'employees harus berupa array' });
    }

    // BATAS UKURAN. Tanpa ini, satu request bisa mengirim ribuan entri dan
    // membuat server menjalankan ribuan query (see N+1 di bawah) — sumber
    // timeout yang sangat sulit didiagnosis.
    if (employees.length > 500) {
      return res.status(400).json({ error: 'Maksimal 500 karyawan per permintaan' });
    }

    // Normalisasi + validasi SEBELUM menyentuh database. Elemen yang tidak
    // valid dilewati diam-diam sebelumnya — user mengira semua tersimpan
    // padahal ada yang gagal tanpa keterangan.
    const skipped = [];
    const valid = [];
    employees.forEach((emp, idx) => {
      const employeeNo = String(emp?.employeeNo ?? '').trim();
      const name = String(emp?.name ?? '').trim();
      if (!employeeNo || !name) {
        skipped.push({ index: idx, reason: 'employeeNo dan name wajib diisi' });
        return;
      }
      const deviceKey = String(emp?.deviceKey || 'masuk').trim();
      if (!VALID_DEVICE_KEYS.includes(deviceKey)) {
        skipped.push({ index: idx, reason: `deviceKey "${deviceKey}" tidak dikenal` });
        return;
      }
      valid.push({
        employeeNo,
        name,
        deviceKey,
        userType: String(emp?.userType || 'normal').trim(),
        cardNo: emp?.cardNo ? String(emp.cardNo).trim() : null,
      });
    });

    if (valid.length === 0) {
      return res.status(400).json({ error: 'Tidak ada data karyawan yang valid', skipped });
    }

    // N+1 DIPERBAIKI: sebelumnya satu `upsert` PER ELEMEN (await di dalam
    // loop), sehingga query count mengikuti panjang array. Sekarang dua query
    // bulk: `createMany` (insert yang belum ada, skipDuplicates) lalu
    // `updateMany` (sinkronkan nama untuk yang sudah ada).
    //
    // CATATAN: `upsertMany` TIDAK ada di Prisma 5.22 — hanya `createMany`,
    // `updateMany`, `createManyAndReturn`. Makanya approach dipecah dua.
    const rows = valid.map((v) => ({
      employeeNo: v.employeeNo,
      name: v.name,
      deviceKey: v.deviceKey,
      userType: v.userType,
      cardNo: v.cardNo,
      validEnd: null,
    }));

    await prisma.deviceUser.createMany({ data: rows, skipDuplicates: true });

    // Sinkronkan user yang sudah ada. Dikelompokkan per payload update yang
    // identik, sehingga jumlah query = jumlah Kombinasi data unik (biasanya
    // 1–3), bukan jumlah karyawan.
    const byKey = new Map(rows.map((r) => [`${r.deviceKey}:${r.employeeNo}`, r]));
    const existing = await prisma.deviceUser.findMany({
      where: {
        OR: rows.map((r) => ({
          deviceKey: r.deviceKey,
          employeeNo: r.employeeNo,
        })),
      },
      select: { employeeNo: true, deviceKey: true },
    });

    // Kelompokkan key per nilai update yang sama.
    const groups = new Map();
    for (const e of existing) {
      const r = byKey.get(`${e.deviceKey}:${e.employeeNo}`);
      if (!r) continue;
      const sig = `${r.name}|${r.userType}|${r.cardNo ?? ''}`;
      if (!groups.has(sig)) groups.set(sig, { data: { name: r.name, userType: r.userType, cardNo: r.cardNo }, keys: [] });
      groups.get(sig).keys.push({ employeeNo: r.employeeNo, deviceKey: r.deviceKey });
    }

    for (const g of groups.values()) {
      await prisma.deviceUser.updateMany({
        where: {
          OR: g.keys.map((k) => ({ employeeNo: k.employeeNo, deviceKey: k.deviceKey })),
        },
        data: g.data,
      });
    }

    // Samakan nama pada record absensi. PERBAIKAN N+1: satu updateMany untuk
    // semua nomor yang bernama sama, memakai operator `in` — bukan satu query
    // per nomor.
    const employeeNos = [...new Set(valid.map((v) => v.employeeNo))];
    const nameByNo = new Map(valid.map((v) => [v.employeeNo, v.name]));
    // Karena `updateMany` hanya bisa satu nilai `data`, nama harus diproses
    // per nama unik (biasanya sedikit), bukan per karyawan.
    const names = [...new Set(employeeNos.map((no) => nameByNo.get(no)))];
    for (const nm of names) {
      const nos = employeeNos.filter((no) => nameByNo.get(no) === nm);
      await prisma.attendanceRecord.updateMany({
        where: { employeeNo: { in: nos } },
        data: { employeeName: nm },
      });
    }

    res.json({
      success: true,
      created: valid.length,
      data: valid,
      ...(skipped.length ? { skipped } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
