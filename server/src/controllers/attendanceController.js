// Attendance controller — live fetch + optional DB cache
import { fetchAllEvents, isValidAccess, getVerifyModeFromMinor, getEmpNo, normName } from '../services/hikvision.js';
import { syncRangeToDb } from '../services/attendanceSyncService.js';
import { dateKey, dayOfWeek, fmtDate, fmtDateLong, fmtDateShort, fmtDateShortLang, fmtTime, fmtWIB, fmtWIBShort, isValidDateStr, nowWIB, parseDeviceTime, wibRangeToUtc } from '../utils/time.js';
import { config } from '../config/index.js';
import prisma from '../db.js';
import { createNameResolver } from '../services/employeeIdentityService.js';

// ─── Helper: resolver nama karyawan ─────────────────────────────────────────────
//
// Dulu ada salinan `buildEmployeeNameMap()` di EMPAT controller dengan
// prioritas berbeda-beda — akibatnya laporan, rekap, dan WhatsApp bisa
// menampilkan nama berbeda untuk orang yang sama. Sekarang semuanya memakai
// `employeeIdentityService`, satu sumber kebenaran.
//
// Alias (employee_id_aliases) juga diterapkan di sini: kalau nomor ID di
// suatu perangkat sebenarnya menunjuk nomor canonical lain, nama yang
// ditampilkan ikut diperbaiki — inilah cara memperbaiki konflik ID yang
// tidak bisa diperbaiki di sisi perangkat.


// ─── Helper: normalisasi parameter paginasi ───────────────────────────────────
//
// MASALAH YANG DISELESAIKAN:
//   `page` dan `pageSize` diambil apa adanya dari body. Nilai non-numerik
//   membuat `skip` jadi NaN (Prisma error → HTTP 500), dan pageSize
//   yang sangat besar membuat server membaca SELURUH tabel absensi ke
//   memori. Keduanya berujung pada error HTTP 500 atau browser mati.
//
// SEKARANG: nilai non-numerik jatuh ke default, dan ada batas atas keras.
const MAX_PAGE_SIZE = 500;

function normalizePagination(page, pageSize) {
  const parsedPage = parseInt(page, 10);
  const parsedSize = parseInt(pageSize, 10);

  const safePage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const safeSize = Number.isFinite(parsedSize) && parsedSize >= 1
    ? Math.min(parsedSize, MAX_PAGE_SIZE)
    : 25;

  return { page: safePage, pageSize: safeSize };
}

// Enrich raw device event with human-readable fields
function enrichEvent(ev, devMaps) {
  const devMap = devMaps[ev.deviceKey] || new Map();
  const empNo  = getEmpNo(ev);
  const user   = devMap.get(empNo) || {};

  const name = (user.name && user.name.trim())
    ? user.name.trim()
    : (ev.name && ev.name.trim())
      ? ev.name.trim()
      : `ID ${empNo || '?'}`;

  const hasRealName = (user.name && user.name.trim()) || (ev.name && ev.name.trim());
  const nameKey = hasRealName ? normName(name) : `#${ev.deviceKey}:${empNo}`;

  const verifyMode = getVerifyModeFromMinor(ev.minor);
  const direction  = ev.deviceKey === 'masuk' ? 'Masuk' : 'Keluar';
  const userType   = ev.userType === 'administrator' ? 'Administrator'
    : ev.userType === 'visitor' ? 'Tamu' : 'Normal';

  const rawTime = ev.time;
  const d = parseDeviceTime(rawTime);   // parse device timestamp → UTC JS Date for storage

  return {
    // Identity
    employeeNo: empNo || '-',
    name,
    nameKey,
    userType,
    // Time (all in WIB — use parsed Date so formatters produce correct output)
    time:         d ? d.toISOString() : rawTime,
    timeFormatted: fmtWIB(d || rawTime),
    date:         fmtDate(d || rawTime),
    dateKey:      dateKey(d || rawTime),
    timeOnly:     fmtTime(d || rawTime),
    dayOfWeek:    dayOfWeek(d || rawTime),
    // Access
    direction,
    verifyMode,
    cardNo:    ev.cardNo || '-',
    doorNo:    ev.doorNo != null ? ev.doorNo : 1,
    cardReaderNo: ev.cardReaderNo || 1,
    // Raw event
    major:       ev.major,
    minor:       ev.minor,
    serialNo:    ev.serialNo || null,
    verifyNo:    ev.verifyNo ?? null,
    cardType:    ev.cardType ?? null,
    attendanceStatus: (ev.attendanceStatus && ev.attendanceStatus !== 'undefined') ? ev.attendanceStatus : null,
    // Device
    deviceKey:   ev.deviceKey,
    deviceLabel: ev.deviceLabel,
    deviceIP:    ev.deviceIP,
    // User validity
    validEnd: user.Valid?.endTime ? fmtDate(user.Valid.endTime) : '-',
    pictureURL: ev.pictureURL || null,
  };
}

// ─── Read from DB cache (fast, for dashboard) ────────────────────────────────────
export async function getAttendanceFromDb(req, res) {
  try {
    const {
      startDate, endDate,
      device = 'all',
      page: rawPage = 1, pageSize: rawPageSize = 25,
      filterName = '',
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos dan berakhir jadi HTTP 500 di Prisma.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    // Normalisasi paginasi: nilai non-numerik → default, batas atas keras.
    const { page, pageSize } = normalizePagination(rawPage, rawPageSize);

    // Batas query memakai zona WIB (data tersimpan sebagai UTC ekuivalen WIB).
        const where = {
          time: wibRangeToUtc(startDate, endDate),
        };
        if (device !== 'all') where.deviceKey = device;
        if (filterName) where.OR = [
          { employeeName: { contains: filterName } },
          { employeeNo:   { contains: filterName } },
        ];

    const [records, total] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where,
        orderBy: { time: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.attendanceRecord.count({ where }),
    ]);

    // Build unified name resolver from DeviceUser table (+ ID aliases)
    const resolver = await createNameResolver();

    const stats = await prisma.attendanceRecord.groupBy({
      by: ['deviceKey'],
      where,
      _count: true,
    });

    const enrichRecord = (r) => {
      const t = new Date(r.time);
      const dir = r.deviceKey === 'masuk' ? 'Masuk' : 'Keluar';
      // Use getDay() for local time (WIB), NOT getUTCDay() which gives UTC day
      const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      const displayName = resolver.name(r.employeeNo, r.deviceKey);
      return {
        employeeNo: r.employeeNo,
        name: displayName,
        nameKey: normName(displayName),
        userType: 'Normal',
        time: r.time.toISOString(),
        timeFormatted: fmtWIB(r.time.toISOString()),
        date: fmtDate(r.time.toISOString()),
        dateKey: dateKey(r.time.toISOString()),
        timeOnly: fmtTime(r.time.toISOString()),
        dayOfWeek: days[t.getDay()],  // ✅ Use getDay() for WIB
        direction: dir,
        verifyMode: getVerifyModeFromMinor(r.minor),
        cardNo: r.cardNo || '-',
        doorNo: r.doorNo || 1,
        cardReaderNo: r.cardReaderNo || 1,
        major: r.major,
        minor: r.minor,
        serialNo: r.serialNo,
        deviceKey: r.deviceKey,
        deviceLabel: r.deviceLabel,
        deviceIP: r.deviceIP,
        userType: r.userType || 'Normal',
        validEnd: '-',
        pictureURL: null,
      };
    };

    const data = records.map(enrichRecord);
    const statsMap = {
      totalEvents: total,
      totalMasuk:  stats.find(s => s.deviceKey === 'masuk')?._count || 0,
      totalKeluar: stats.find(s => s.deviceKey === 'keluar')?._count || 0,
      uniqueUsers: [...new Set(records.map(r => r.employeeNo))].length,
      uniqueDays: [...new Set(records.map(r => fmtDate(r.time.toISOString())))].length,
    };

    res.json({
      data,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(total / pageSize),
      stats: statsMap,
      source: 'db',
    });
  } catch (err) {
    console.error('[attendance/db]', err);
    res.status(500).json({ error: err.message });
  }
}
// ─── Live fetch direct from devices (slow, use with caution) ────────────────────────
export async function getAttendance(req, res) {
  try {
    const {
      startDate, endDate, device = 'all',
      page: rawPage = 1, pageSize: rawPageSize = 25,
      filterName = '',
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos dan berakhir jadi HTTP 500 di Prisma.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    // Normalisasi paginasi (lihat normalizePagination).
    const { page, pageSize } = normalizePagination(rawPage, rawPageSize);

    const targets = device === 'all'
      ? Object.values(config.devices)
      : [config.devices[device]].filter(Boolean);

    // Build name resolver from DeviceUser table (DB) for employee names
    const resolver = await createNameResolver();

    // Build devMaps from DeviceUser for enrichEvent
    const dbUsers = await prisma.deviceUser.findMany();
    const devMaps = {};
    for (const [key] of Object.entries(config.devices)) {
      devMaps[key] = new Map();
    }
    for (const u of dbUsers) {
      if (!devMaps[u.deviceKey]) devMaps[u.deviceKey] = new Map();
      devMaps[u.deviceKey].set(u.employeeNo, u);
    }

    const results = await Promise.allSettled(targets.map(dev => fetchAllEvents(dev, startDate, endDate)));

    let allEvents = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allEvents.push(...r.value);
      else console.warn('[attendance/live]', r.reason?.message);
    }

    allEvents = allEvents.filter(isValidAccess).map(ev => {
      const enriched = enrichEvent(ev, devMaps);
      // Use unified name map for consistent display
      const empNo = getEmpNo(ev);
      enriched.name = resolver.name(empNo, ev.deviceKey);
      enriched.nameKey = normName(enriched.name);
      return enriched;
    });
    allEvents.sort((a, b) => `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`));

    if (filterName) {
      const q = filterName.toLowerCase();
      allEvents = allEvents.filter(e => e.name.toLowerCase().includes(q));
    }

    const stats = {
      totalEvents: allEvents.length,
      totalMasuk:  allEvents.filter(e => e.deviceKey === 'masuk').length,
      totalKeluar: allEvents.filter(e => e.deviceKey === 'keluar').length,
      uniqueUsers: [...new Set(allEvents.map(e => e.nameKey))].length,
      uniqueDays:  [...new Set(allEvents.map(e => e.date))].length,
    };

    const total = allEvents.length;
    const startIdx = (page - 1) * pageSize;
    const paged = allEvents.slice(startIdx, startIdx + pageSize);

    res.json({ data: paged, total, page, pageSize, totalPages: Math.ceil(total / pageSize), stats, source: 'live' });
  } catch (err) {
    console.error('[attendance/live]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─── Sync Hikvision events → DB (for caching) ───────────────────────────────────────
export async function syncAttendanceToDb(req, res) {
  try {
    const { startDate, endDate } = req.body;
    const s = startDate || nowWIB().split('T')[0];
    const e = endDate   || nowWIB().split('T')[0];

    // Logika sinkronisasi dipindah ke attendanceSyncService agar dipakai
    // bersama oleh endpoint ini, startup server, dan auto-sync laporan.
    const result = await syncRangeToDb(s, e);

    res.json({
      success: true,
      synced: result.synced,
      skipped: result.skipped,
      byDevice: result.byDevice,
      errors: result.errors,
      period: `${s} s/d ${e}`,
    });
  } catch (err) {
    console.error('[sync]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─── Rekap per karyawan (from DB — fast) ──────────────────────────────────────────
export async function getRekap(req, res) {
  try {
    const { startDate, endDate, device = 'all' } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Rentang tanggal wajib diisi' });
    }
    // Format tanggal harus YYYY-MM-DD yang benar-benar ada di kalender.
    // Tanpa ini, "abc" lolos ke wibRangeToUtc() → Invalid Date → HTTP 500.
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }

    const where = {
          time: wibRangeToUtc(startDate, endDate),
        };
        if (device !== 'all') where.deviceKey = device;

        const records = await prisma.attendanceRecord.findMany({ where, orderBy: { time: 'asc' } });

    // Build unified name resolver from DeviceUser table (+ ID aliases)
    const resolver = await createNameResolver();

    const grouped = new Map();
    records.forEach(r => {
      // Use unified name map for consistent display
      const name = resolver.name(r.employeeNo, r.deviceKey);
      const key  = normName(name);
      if (!grouped.has(key)) {
        grouped.set(key, { name, userType: r.userType || 'Normal', ids: { masuk: new Set(), keluar: new Set() }, totalMasuk: 0, totalKeluar: 0, days: new Set(), firstMasukISO: null, lastKeluarISO: null, events: [] });
      }
      const g = grouped.get(key);
      if (r.employeeNo) g.ids[r.deviceKey]?.add(r.employeeNo);
      if (r.deviceKey === 'masuk') {
        g.totalMasuk++;
        if (!g.firstMasukISO || r.time < g.firstMasukISO) g.firstMasukISO = r.time;
      } else {
        g.totalKeluar++;
        if (!g.lastKeluarISO || r.time > g.lastKeluarISO) g.lastKeluarISO = r.time;
      }
      g.days.add(dateKey(r.time.toISOString()));
      g.events.push(r);
    });

    const result = [...grouped.values()].map(g => {
      const daysSorted  = [...g.days].sort();
      const daysDisplay = daysSorted.map(dk => { const [y,m,d] = dk.split('-'); return `${d}/${m}/${y}`; });
      const perHari = computePerHari(g.events);
      return {
        name:         g.name,
        userType:     g.userType,
        idMasuk:      [...g.ids.masuk].join(', ') || '-',
        idKeluar:     [...g.ids.keluar].join(', ') || '-',
        totalEvents:  g.totalMasuk + g.totalKeluar,
        totalMasuk:   g.totalMasuk,
        totalKeluar:  g.totalKeluar,
        hariHadir:   g.days.size,
        days:         daysDisplay,
        daysKey:      daysSorted,
        firstMasuk:   g.firstMasukISO ? fmtWIBShort(g.firstMasukISO.toISOString()) : '-',
        lastKeluar:   g.lastKeluarISO ? fmtWIBShort(g.lastKeluarISO.toISOString()) : '-',
        perHari,
      };
    });

    result.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: result, total: result.length });
  } catch (err) {
    console.error('[rekap]', err);
    res.status(500).json({ error: err.message });
  }
}

function computePerHari(events) {
  const byDay = {};
  events.forEach(ev => {
    const isoTime = ev.time instanceof Date ? ev.time.toISOString() : ev.time;
    const dk  = dateKey(isoTime);
    const dis = fmtDate(isoTime);
    const dow = dayOfWeek(isoTime);
    if (!byDay[dk]) byDay[dk] = { dateKey: dk, date: dis, dayOfWeek: dow, masukList: [], keluarList: [] };
    // Arah event ditentukan oleh perangkat asalnya ('masuk'/'keluar').
    // SEBELUMNYA ada variabel `dk2` yang isinya persis sama dengan
    // `ev.deviceKey` — selalu undefined saat deviceKey ada, dan membingungkan
    // pembaca. Digapus karena tidak pernah dipakai.
    if (ev.deviceKey === 'masuk') byDay[dk].masukList.push(fmtTime(isoTime));
    else byDay[dk].keluarList.push(fmtTime(isoTime));
  });

  return Object.values(byDay).sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map(d => {
    const ms = [...d.masukList].sort();
    const ks = [...d.keluarList].sort();
    const durMenit = (() => {
      if (!ms.length || !ks.length) return null;
      const [hm, mm] = ms[0].split(':').map(Number);
      const [hk, mk] = ks[ks.length - 1].split(':').map(Number);
      const diff = (hk * 60 + mk) - (hm * 60 + mm);
      return diff > 0 ? diff : null;
    })();
    return {
      dateKey:     d.dateKey,
      date:        d.date,
      dayOfWeek:   d.dayOfWeek,
      jamMasuk:    ms[0] || '-',
      jamKeluar:   ks[ks.length - 1] || '-',
      semuaMasuk:  ms,
      semuaKeluar: ks,
      totalMasuk:  ms.length,
      totalKeluar: ks.length,
      totalAkses:  ms.length + ks.length,
      durasi:      durMenit ? `${Math.floor(durMenit / 60)}j ${durMenit % 60}m` : '-',
    };
  });
}

// ─── Repair: fix timezone offset on existing DB records ─────────────────────────
// The old code stored: new Date("2026-09-02T13:57:29+08:00") → interpreted +08:00 as UTC
// → stored: "2026-09-02T05:57:29.000Z" (wrong by 1h)
// Correct storage: parseDeviceTime(rawTime) → "2026-09-02T06:57:29.000Z" (13:57-7h)
//
// Strategy: use rawTime (already stored) + parseDeviceTime to recalculate correctly.
// Run once via POST /api/attendance/repair
export async function repairStoredTimes(req, res) {
  try {
    // N+1 DIPERBAIKI: `findMany()` tanpa filter mengambil SELURUH tabel,
    // lalu satu `update` per baris di dalam loop. Untuk ribuan baris itu
    // berarti ribuan query dan bisa membuat request timeout.
    //
    // Pendekatan baru: baca Offset cursor per halaman, hitung waktu yang
    // perlu diperbaiki di MEMORI, lalu tulis per halaman. Jumlah query
    // = jumlah halaman, bukan jumlah baris.
    const PAGE = 500;
    let fixed = 0;
    let skipped = 0;
    let cursor;

    for (;;) {
      const records = await prisma.attendanceRecord.findMany({
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (records.length === 0) break;

      // Kumpulkan id yang perlu ditulis, lalu satu updateMany per halaman.
      const idsToFix = [];
      for (const r of records) {
        if (!r.rawTime) { skipped++; continue; }
        const corrected = parseDeviceTime(r.rawTime);
        if (!corrected || isNaN(corrected)) { skipped++; continue; }

        const currentMs = r.time instanceof Date ? r.time.getTime() : new Date(r.time).getTime();
        if (Math.abs(currentMs - corrected.getTime()) < 1000) { fixed++; continue; }

        idsToFix.push({ id: r.id, time: corrected });
      }

      // Tulis per nilai waktu unik — jumlah query per halaman = jumlah
      // timestamp berbeda, biasanya sangat sedikit.
      const byTime = new Map();
      for (const it of idsToFix) {
        const key = it.time.toISOString();
        if (!byTime.has(key)) byTime.set(key, { time: it.time, ids: [] });
        byTime.get(key).ids.push(it.id);
      }
      for (const g of byTime.values()) {
        await prisma.attendanceRecord.updateMany({
          where: { id: { in: g.ids } },
          data: { time: g.time },
        });
      }
      fixed += idsToFix.length;

      cursor = records[records.length - 1].id;
      if (records.length < PAGE) break;
    }

    res.json({ success: true, repaired: fixed, skipped, note: 'Used rawTime + parseDeviceTime to recalculate; new sync will use parseDeviceTime going forward' });
  } catch (err) {
    console.error('[repair]', err);
    res.status(500).json({ error: err.message });
  }
}
