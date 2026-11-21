// Attendance sync service — menyinkronkan event Hikvision → PostgreSQL
//
// DIPISAHKAN dari controller karena dipakai oleh tiga tempat:
//   1. POST /api/attendance/sync  (trigger manual)
//   2. Startup server (sinkronisasi otomatis)
//   3. Endpoint laporan (auto-sync agar laporan tidak pernah kosong)
//
// MASALAH YANG DISELESAIKAN:
//   - Pagination perangkat terpotong (lihat fetchAllEvents di hikvision.js).
//   - Event sensor pintu (minor 21/22/23/24/49) tanpa employeeNo tidak boleh
//     masuk tabel laporan.
import { fetchAllEvents, isValidAccess, getVerifyModeFromMinor, getEmpNo, normName } from './hikvision.js';
import { config } from '../config/index.js';
import { parseDeviceTime } from '../utils/time.js';
import prisma from '../db.js';
import { createNameResolver, preferRealName } from './employeeIdentityService.js';

/**
 * Bangun resolver nama karyawan.
 *
 * Dulu ada salinan logika buildNameMap() di file ini DAN di tiga controller
 * lain, dengan prioritas yang sedikit berbeda-beda. Duplikasi itulah
 * penyebab laporan dan WhatsApp pernah menampilkan nama berbeda untuk orang
 * yang sama. Sekarang semuanya memakai `employeeIdentityService`.
 *
 * Resolver ini juga menerapkan alias (employee_id_aliases), sehingga
 * konflik nomor ID antar perangkat ikut terperbaiki di data yang ditulis
 * ke DB.
 */

/**
 * Sinkronkan seluruh event perangkat untuk sebuah rentang tanggal ke DB.
 *
 * @param {string} startDate YYYY-MM-DD (WIB)
 * @param {string} endDate   YYYY-MM-DD (WIB)
 * @param {object} opts
 * @param {string[]} opts.onlyDevices daftar deviceKey yang disinkronkan (default semua)
 * @returns {Promise<{ synced:number, skipped:number, byDevice:object, errors:string[] }>}
 */
export async function syncRangeToDb(startDate, endDate, opts = {}) {
  const targets = opts.onlyDevices?.length
    ? opts.onlyDevices.map((k) => config.devices[k]).filter(Boolean)
    : Object.values(config.devices);

  const resolver = await createNameResolver();

  let synced = 0;
  let skipped = 0;
  const byDevice = {};
  const errors = [];

  for (const dev of targets) {
    try {
      const events = await fetchAllEvents(dev, startDate, endDate);
      const valid = events.filter(isValidAccess);
      skipped += events.length - valid.length;

      for (const ev of valid) {
        try {
          const empNo = getEmpNo(ev);
          // Resolusi memakai device asal event, supaya alias per-perangkat
          // bisa memperbaiki nomor ID yang konflik.
          //
          // PERBAIKAN: bila resolver hanya menghasilkan placeholder
          // ("ID 3"), pakai nama yang dibaca langsung dari perangkat.
          // Tanpa ini placeholder TERTANAM di DB dan ikut terbawa ke
          // laporan, rekap, dan WhatsApp sebagai nama karyawan.
          const displayName = preferRealName(
            resolver.name(empNo, ev.deviceKey),
            ev.name,
          );
          const parsedTime = parseDeviceTime(ev.time);
          if (!parsedTime || isNaN(parsedTime)) { skipped++; continue; }

          await prisma.attendanceRecord.upsert({
            where: { id: `${ev.serialNo || ev.time}-${empNo}-${ev.deviceKey}` },
            update: {
              employeeName: displayName,
              time:         parsedTime,
            },
            create: {
              id:            `${ev.serialNo || ev.time}-${empNo}-${ev.deviceKey}`,
              employeeNo:    empNo,
              employeeName:  displayName,
              cardNo:        ev.cardNo && ev.cardNo !== '-' ? ev.cardNo : null,
              time:          parsedTime,
              direction:     ev.deviceKey === 'masuk' ? 'Masuk' : 'Keluar',
              verifyMode:    getVerifyModeFromMinor(ev.minor),
              doorNo:        ev.doorNo != null ? ev.doorNo : 1,
              cardReaderNo:  ev.cardReaderNo != null ? ev.cardReaderNo : 1,
              deviceKey:     ev.deviceKey,
              deviceLabel:   ev.deviceLabel,
              deviceIP:      ev.deviceIP,
              major:         ev.major ?? null,
              minor:         ev.minor ?? null,
              serialNo:      ev.serialNo != null ? String(ev.serialNo) : null,
              userType:      ev.userType || 'Normal',
              validEnd:      null,
              rawTime:       ev.time,
            },
          });
          synced++;
        } catch (err) {
          skipped++;
        }
      }
      byDevice[dev.type] = valid.length;
    } catch (err) {
      errors.push(`${dev.label}: ${err.message}`);
      console.warn(`[syncService] ${dev.label}: ${err.message}`);
    }
  }

  return { synced, skipped, byDevice, errors };
}

/**
 * Cek apakah sebuah rentang tanggal sudah ada datanya di DB.
 * Dipakai untuk deciding auto-sync sebelum membuat laporan.
 *
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD
 * @returns {Promise<{ count:number, latest:Date|null }>}
 */
export async function checkRangeCoverage(startDate, endDate) {
  const { wibRangeToUtc } = await import('../utils/time.js');
  const range = wibRangeToUtc(startDate, endDate);
  const count = await prisma.attendanceRecord.count({
    where: { time: { gte: range.gte, lte: range.lte } },
  });
  const latest = await prisma.attendanceRecord.findFirst({
    where: { time: { gte: range.gte, lte: range.lte } },
    orderBy: { time: 'desc' },
    select: { time: true },
  });
  return { count, latest: latest?.time ?? null };
}

export default { syncRangeToDb, checkRangeCoverage };
