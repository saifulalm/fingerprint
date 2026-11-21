// Attendance analytics service — perhitungan metrik & rekomendasi laporan
//
// BERDASARKAN TEMUAN ANALISIS DATA (27 hari kerja, 953 event):
//
//   1. Device "masuk" dan "keluar" BUKAN penanda arah. Keduanya adalah pintu
//      dengan scan berulang:
//        - 133 dari 479 event "keluar" terjadi SEBELUM jam 12:00.
//        - 37 dari 474 event "masuk" terjadi SETELAH jam 17:00.
//        - Chika: 128 scan di device masuk, 0 scan di device keluar.
//        - Urutan scan per hari tidak bergantian rapi (M07:11 K08:36 M08:48 K09:00 ...).
//      Kesimpulan: metrik karyawan TIDAK BOLEH dihitung dari deviceKey
//      sebagai arah. Yang valid adalah:
//        - "Masuk Pertama"  = scan PERTAMA di hari (device apa pun)
//        - "Keluar Terakhir" = scan TERAKHIR di hari (device apa pun)
//        - Durasi kerja      = selisih keduanya
//
//   2. Scan ganda terjadi rutin (115 transisi berdekatan ≤5 menit, rata2 96 detik)
//      → durasi kerja harus memakai scan pertama & terakhir, bukan penjumlahan.
//
//   3. Keterlambatan dihitung dari scan pertama hari, bukan dari setiap scan
//      "masuk" — kalau tidak, satu orang dengan 7 scan/hari terhitung 7×
//      terlambat.
//
// Semua metrik dihitung per hari, lalu diagregasi per karyawan & periode.
import { fmtDateShortLang, fmtDateLongLang, dayOfWeekLang } from '../utils/time.js';
import { isPlaceholderName, preferRealName } from './employeeIdentityService.js';

// ─── Helper waktu ────────────────────────────────────────────────────────────
/** "HH:MM" → jumlah menit sejak tengah malam */
function toMinutes(hm) {
  if (!hm || typeof hm !== 'string') return null;
  const [h, m] = hm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** jumlah menit → "7j 44m" */
function fmtDuration(mins) {
  if (mins == null || !Number.isFinite(mins)) return '-';
  // Sama seperti fmtHM: pembulatan harus "membawa" ke jam berikutnya, bukan
  // menghasilkan menit 60 ("1j 60m" adalah waktu yang tidak valid).
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}j ${String(m).padStart(2, '0')}m`;
}

/** jumlah menit → "07:44" (jam:menit) */
function fmtHM(mins) {
  if (mins == null || !Number.isFinite(mins)) return '-';
  // Pembulatan menit harus bisa "membawa" ke jam berikutnya, bukan menghasilkan
  // menit 60. Contoh: 08:59.6 (539.6 menit) → 9 jam 0 menit, bukan "09:60".
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** standar deviasi populasi */
function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** persentil dari array angka (linear interpolation) */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** nama hari dalam bahasa laporan */
const DOW_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Identitas satu hari untuk satu orang, lengkap dengan metrik turunan.
 */
function buildDayRecord(dateKey, lang) {
  return {
    dateKey,
    date: fmtDateShortLang(dateKey, lang),
    dayLong: (lang === 'id' ? DOW_ID : DOW_EN)[new Date(`${dateKey}T12:00:00Z`).getUTCDay()],
    firstScan: null,       // { time, deviceKey } scan pertama hari ini
    lastScan: null,        // { time, deviceKey } scan terakhir hari ini
    scanCount: 0,
    masukCount: 0,         // event di device "masuk" (data mentah perangkat)
    keluarCount: 0,        // event di device "keluar" (data mentah perangkat)
    devices: new Set(),
  };
}

/**
 * Bangun analitik lengkap untuk satu periode.
 *
 * @param {Array}  events   event enriched (butuh: employeeNo, name, deviceKey,
 *                          timeOnly, dateKey, verifyMode, deviceLabel)
 * @param {object} stats    statistik mentah dari sumber data
 * @param {string} lang     'id' | 'en'
 * @param {string} workStart jam kerja mulai (HH:MM)
 * @param {string} workEnd   jam kerja selesai (HH:MM)
 * @param {object} opts     { startDate, endDate, detectLate }
 */
export function buildAnalytics(events, stats, lang = 'id', workStart = '09:00', workEnd = '17:00', opts = {}) {
  const { startDate, endDate, detectLate = true } = opts;
  const startMin = toMinutes(workStart);
  const endMin = toMinutes(workEnd);

  // ── Langkah 1: kelompokkan per orang per hari ─────────────────────────────
  // Key: nama ternormalisasi (bukan employeeNo) karena satu orang bisa punya
  // lebih dari satu ID di device berbeda (Juanto: ID 5 & ID 7).
  //
  // PERBAIKAN: bila nama event ternyata placeholder ("ID 3"), key-nya memakai
  // perangkat + nomor ID, bukan nama. Dua orang berbeda dengan placeholder
  // yang sama tidak boleh digabung jadi satu orang — kalau tidak, statistik
  // keterlambatan salah orang.
  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const people = new Map();

  for (const ev of events) {
    // Nama asli: pakai yang non-placeholder. `ev.employeeName` adalah nama
    // yang tersimpan di record absensi (cadangan bila resolver belum sinkron).
    const displayName = preferRealName(ev.name, ev.employeeName);
    if (!displayName) continue;

    const key = isPlaceholderName(displayName)
      ? `#${ev.deviceKey}:${ev.employeeNo}`
      : norm(displayName);
    if (!people.has(key)) {
      people.set(key, {
        key,
        name: displayName,
        employeeNos: new Set(),
        days: new Map(),
        totalAkses: 0,
        deviceMasuk: 0,
        deviceKeluar: 0,
        verifyModes: {},
      });
    }
    const p = people.get(key);
    if (ev.employeeNo) p.employeeNos.add(ev.canonicalNo || ev.employeeNo);
    p.totalAkses++;
    if (ev.deviceKey === 'masuk') p.deviceMasuk++;
    else p.deviceKeluar++;
    if (ev.verifyMode) p.verifyModes[ev.verifyMode] = (p.verifyModes[ev.verifyMode] || 0) + 1;

    const dk = ev.dateKey;
    if (!dk) continue;
    if (!p.days.has(dk)) p.days.set(dk, buildDayRecord(dk, lang));
    const d = p.days.get(dk);
    const t = ev.timeOnly ? String(ev.timeOnly).slice(0, 5) : null;
    if (!t) continue;

    d.scanCount++;
    d.devices.add(ev.deviceKey);
    if (ev.deviceKey === 'masuk') d.masukCount++;
    else d.keluarCount++;

    const tMin = toMinutes(t);
    if (d.firstScan === null || tMin < toMinutes(d.firstScan.time)) {
      d.firstScan = { time: t, deviceKey: ev.deviceKey, minutes: tMin };
    }
    if (d.lastScan === null || tMin > toMinutes(d.lastScan.time)) {
      d.lastScan = { time: t, deviceKey: ev.deviceKey, minutes: tMin };
    }
  }

  // ── Langkah 2: hitung hari kerja efektif dalam periode ────────────────────
  // Hari kerja = hari kerja (Sen–Jum) yang jatuh di dalam rentang periode.
  // Ini menjadi penyebut untuk persentase kehadiran.
  const workDays = [];
  if (startDate && endDate) {
    const cur = new Date(`${startDate}T12:00:00Z`);
    const end = new Date(`${endDate}T12:00:00Z`);
    while (cur <= end) {
      const dow = cur.getUTCDay();
      if (dow >= 1 && dow <= 5) {
        workDays.push(cur.toISOString().slice(0, 10));
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  const effectiveWorkDays = workDays.length;

  // ── Langkah 3: metrik per karyawan ────────────────────────────────────────
  const employees = [];
  for (const p of people.values()) {
    const days = [...p.days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const firstTimes = [];
    const lastTimes = [];
    const durations = [];
    const lateEntries = [];
    const earlyLeaveEntries = [];
    let daysWithBoth = 0;

    for (const d of days) {
      if (d.firstScan) firstTimes.push(d.firstScan.minutes);
      if (d.lastScan) lastTimes.push(d.lastScan.minutes);
      if (d.firstScan && d.lastScan && d.lastScan.minutes > d.firstScan.minutes) {
        durations.push(d.lastScan.minutes - d.firstScan.minutes);
        daysWithBoth++;
      }
      // Keterlambatan: scan pertama hari ini melewati batas jam masuk.
      if (detectLate && d.firstScan && startMin != null && d.firstScan.minutes > startMin) {
        lateEntries.push({
          date: d.date,
          dateKey: d.dateKey,
          dayLong: d.dayLong,
          time: d.firstScan.time,
          minutes: d.firstScan.minutes - startMin,
        });
      }
      // Pulang lebih awal: scan terakhir hari ini sebelum jam kerja selesai.
      if (detectLate && d.lastScan && endMin != null && d.lastScan.minutes < endMin) {
        earlyLeaveEntries.push({
          date: d.date,
          dateKey: d.dateKey,
          dayLong: d.dayLong,
          time: d.lastScan.time,
          minutes: endMin - d.lastScan.minutes,
        });
      }
    }

    const avgFirst = firstTimes.length ? firstTimes.reduce((a, b) => a + b, 0) / firstTimes.length : null;
    const avgLast = lastTimes.length ? lastTimes.reduce((a, b) => a + b, 0) / lastTimes.length : null;
    const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const sdFirst = stdev(firstTimes);

    const hariHadir = days.length;
    const lateCount = lateEntries.length;
    const earlyCount = earlyLeaveEntries.length;
    const attendanceRate = effectiveWorkDays > 0 ? (hariHadir / effectiveWorkDays) * 100 : null;

    // Konsistensi: makin kecil sd → makin konsisten datang.
    // Skala 0–100, 100 = selalu datang pada menit yang sama.
    const consistency = sdFirst == null ? null
      : Math.max(0, Math.min(100, Math.round(100 - (sdFirst / 60) * 100)));

    // Kelengkapan scan: apakah orang ini ter-scan di kedua perangkat?
    const hasMasuk = p.deviceMasuk > 0;
    const hasKeluar = p.deviceKeluar > 0;
    const deviceCoverage = hasMasuk && hasKeluar ? 'both' : (hasMasuk ? 'masuk' : (hasKeluar ? 'keluar' : 'none'));

    employees.push({
      name: p.name,
      employeeNo: [...p.employeeNos].join(', ') || '-',
      employeeNos: [...p.employeeNos],
      userType: 'Normal',
      totalAkses: p.totalAkses,
      masukCount: p.deviceMasuk,
      keluarCount: p.deviceKeluar,
      hariHadir,
      daysList: days.map(d => d.date),
      dayRecords: days,
      firstIn: firstTimes.length ? fmtHM(Math.min(...firstTimes)) : '-',
      lastOut: lastTimes.length ? fmtHM(Math.max(...lastTimes)) : '-',
      avgTime: avgFirst != null ? fmtHM(avgFirst) : '-',
      avgFirstMinutes: avgFirst,
      avgLastMinutes: avgLast,
      avgDuration: avgDur,
      avgDurationLabel: fmtDuration(avgDur),
      totalDuration: durations.reduce((a, b) => a + b, 0),
      stdDevFirst: sdFirst,
      consistency,
      lateCount,
      lateMinutesTotal: lateEntries.reduce((s, l) => s + l.minutes, 0),
      lateAvgMinutes: lateCount ? Math.round(lateEntries.reduce((s, l) => s + l.minutes, 0) / lateCount) : 0,
      lateArrivals: lateEntries,
      earlyCount,
      earlyMinutesTotal: earlyLeaveEntries.reduce((s, l) => s + l.minutes, 0),
      earlyLeaveEntries,
      ontimeCount: Math.max(0, hariHadir - lateCount),
      daysWithBoth,
      attendanceRate,
      deviceCoverage,
      verifyModes: p.verifyModes,
    });
  }

  employees.sort((a, b) => a.name.localeCompare(b.name));

  // ── Langkah 4: analitik tingkat organisasi ───────────────────────────────
  const allFirstTimes = [];
  const allDurations = [];
  const allLateMinutes = [];
  for (const e of employees) {
    for (const d of e.dayRecords) {
      if (d.firstScan) allFirstTimes.push(d.firstScan.minutes);
    }
    if (e.avgDuration != null) allDurations.push(e.avgDuration);
    if (e.lateCount) allLateMinutes.push(e.lateAvgMinutes);
  }
  const sortedFirst = [...allFirstTimes].sort((a, b) => a - b);
  const sortedDur = [...allDurations].sort((a, b) => a - b);
  const sortedLate = [...allLateMinutes].sort((a, b) => a - b);

  const organization = {
    effectiveWorkDays,
    observedDays: new Set(events.map(e => e.dateKey).filter(Boolean)).size,
    // Usulan jam kerja dari data aktual (median + persentil 75).
    medianFirstIn: sortedFirst.length ? percentile(sortedFirst, 0.5) : null,
    p25FirstIn: sortedFirst.length ? percentile(sortedFirst, 0.25) : null,
    p75FirstIn: sortedFirst.length ? percentile(sortedFirst, 0.75) : null,
    p90FirstIn: sortedFirst.length ? percentile(sortedFirst, 0.9) : null,
    earliestFirstIn: sortedFirst.length ? sortedFirst[0] : null,
    latestFirstIn: sortedFirst.length ? sortedFirst[sortedFirst.length - 1] : null,
    medianDuration: sortedDur.length ? percentile(sortedDur, 0.5) : null,
    avgDuration: sortedDur.length ? sortedDur.reduce((a, b) => a + b, 0) / sortedDur.length : null,
    medianLate: sortedLate.length ? percentile(sortedLate, 0.5) : null,
    totalLateMinutes: employees.reduce((s, e) => s + e.lateMinutesTotal, 0),
    totalLateCount: employees.reduce((s, e) => s + e.lateCount, 0),
    totalEarlyCount: employees.reduce((s, e) => s + e.earlyCount, 0),
    totalEarlyMinutes: employees.reduce((s, e) => s + e.earlyMinutesTotal, 0),
    avgAttendanceRate: (() => {
      const rates = employees.map(e => e.attendanceRate).filter(r => r != null);
      return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    })(),
    avgConsistency: (() => {
      const cs = employees.map(e => e.consistency).filter(c => c != null);
      return cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : null;
    })(),
  };

  // ── Langkah 5: temuan & rekomendasi (berbasis aturan) ─────────────────────
  const findings = [];
  const recommendations = [];

  const push = (level, code, title, detail, action) =>
    findings.push({ level, code, title, detail, action });

  const pushRec = (priority, title, detail, impact) =>
    recommendations.push({ priority, title, detail, impact });

  // (a) Konfigurasi perangkat tidak lengkap — device keluar tidak terpakai.
  const noKeluar = employees.filter(e => e.deviceCoverage === 'masuk');
  if (noKeluar.length) {
    push(
      'warning', 'DEVICE_COVERAGE',
      lang === 'id' ? 'Karyawan tanpa aktivitas di perangkat keluar' : 'Employees with no activity on exit device',
      lang === 'id'
        ? `${noKeluar.length} karyawan (${noKeluar.map(e => e.name).join(', ')}) hanya tercatat di perangkat masuk. Durasi kerja untuk karyawan ini tidak dapat diverifikasi secara lengkap.`
        : `${noKeluar.length} employees (${noKeluar.map(e => e.name).join(', ')}) are only recorded on the entry device. Their working duration cannot be fully verified.`,
      lang === 'id'
        ? 'Periksa registrasi ID di perangkat Keluar, atau pastikan seluruh karyawan memindai hanya di satu pintu.'
        : 'Check ID registration on the exit device, or ensure all employees scan at a single gate.',
    );
    pushRec(
      'high',
      lang === 'id' ? 'Lengkapi konfigurasi perangkat Keluar' : 'Complete exit device configuration',
      lang === 'id'
        ? 'Sebagian karyawan tidak pernah tercatat di perangkat Keluar sehingga durasi kerja terukur lebih panjang dari kenyataan.'
        : 'Some employees are never recorded on the exit device, inflating their measured working duration.',
      lang === 'id' ? 'Akurasi durasi kerja & deteksi pulang awal' : 'Working duration accuracy & early-leave detection',
    );
  }

  // (b) Karyawan terlambat habitual.
  //
  // Nama employees dianalisis + nomor ID ditampilkan agar pembaca laporan bisa
  // mencocokkan ke data perangkat. Nomor ID diambil dari `employeeNos`
  // (bisa lebih dari satu bila orang yang sama punya ID berbeda per perangkat).
  const idLabel = (e) => {
    const nos = (e.employeeNos || []).filter(Boolean);
    if (!nos.length) return '';
    const uniq = [...new Set(nos.map(String))];
    return ` (ID ${uniq.join(', ')})`;
  };
  for (const e of employees) {
    const rate = e.hariHadir ? (e.lateCount / e.hariHadir) * 100 : 0;
    if (rate >= 30 && e.lateCount >= 3) {
      push(
        'warning', 'LATE_HABITUAL',
        lang === 'id'
          ? `Terlambat rutin: ${e.name}${idLabel(e)}`
          : `Habitual lateness: ${e.name}${idLabel(e)}`,
        lang === 'id'
          ? `${e.lateCount} dari ${e.hariHadir} hari hadir (${rate.toFixed(0)}%) terlambat, rata-rata keterlambatan ${e.lateAvgMinutes} menit.`
          : `Late on ${e.lateCount} of ${e.hariHadir} days present (${rate.toFixed(0)}%), averaging ${e.lateAvgMinutes} minutes late.`,
        lang === 'id'
          ? `Optimalkan jam kerja atau lakukan pembinaan; rata-rata datang ${e.avgTime}.`
          : `Consider adjusting the shift or coaching; average arrival is ${e.avgTime}.`,
      );
    }
  }
  if (employees.some(e => e.lateCount >= 3)) {
    const totalLate = employees.reduce((s, e) => s + e.lateCount, 0);
    pushRec(
      'high',
      lang === 'id' ? 'Evaluasi ulang batas jam masuk kerja' : 'Re-evaluate the work start threshold',
      lang === 'id'
        ? `Terdapat ${totalLate} kejadian terlambat. Batas saat ini ${workStart}, sedangkan median jam datang aktual ${fmtHM(organization.medianFirstIn)}.`
        : `There are ${totalLate} late arrivals. Current threshold is ${workStart}, while the actual median arrival is ${fmtHM(organization.medianFirstIn)}.`,
      lang === 'id' ? 'Kurangi keterlambatan tanpa menurunkan produktivitas' : 'Reduce lateness without hurting productivity',
    );
  }

  // (c) Durasi kerja di bawah standar (indikasi scan tidak lengkap).
  const shortDays = employees.filter(e => e.avgDuration != null && e.avgDuration < 6 * 60);
  if (shortDays.length) {
    push(
      'warning', 'SHORT_DURATION',
      lang === 'id' ? 'Durasi kerja di bawah 6 jam' : 'Working duration below 6 hours',
      lang === 'id'
        ? `${shortDays.map(e => `${e.name} (${e.avgDurationLabel})`).join(', ')} — indikasi scan keluar tidak tercatat.`
        : `${shortDays.map(e => `${e.name} (${e.avgDurationLabel})`).join(', ')} — indicates missing exit scans.`,
      lang === 'id' ? 'Verifikasi pikatan ID di kedua perangkat.' : 'Verify ID binding on both devices.',
    );
  }

  // (d) Kehadiran rendah.
  if (organization.avgAttendanceRate != null && organization.avgAttendanceRate < 80) {
    push(
      'info', 'LOW_ATTENDANCE',
      lang === 'id' ? 'Tingkat kehadiran di bawah 80%' : 'Attendance rate below 80%',
      lang === 'id'
        ? `Rata-rata kehadiran ${organization.avgAttendanceRate.toFixed(1)}% dari ${organization.effectiveWorkDays} hari kerja.`
        : `Average attendance is ${organization.avgAttendanceRate.toFixed(1)}% across ${organization.effectiveWorkDays} working days.`,
      lang === 'id' ? 'Pastikan tidak ada hari kerja yang terlewat dari sinkronisasi.' : 'Ensure no working day is missing from synchronization.',
    );
  }

  // (e) Ketidakkonsistenan datang (sd tinggi).
  const inconsistent = employees.filter(e => e.stdDevFirst != null && e.stdDevFirst > 45);
  if (inconsistent.length) {
    push(
      'info', 'INCONSISTENT_ARRIVAL',
      lang === 'id' ? 'Jam datang tidak konsisten' : 'Inconsistent arrival times',
      lang === 'id'
        ? `${inconsistent.map(e => `${e.name} (sd ${Math.round(e.stdDevFirst)} mnt)`).join(', ')}.`
        : `${inconsistent.map(e => `${e.name} (sd ${Math.round(e.stdDevFirst)} min)`).join(', ')}.`,
      lang === 'id' ? 'Perlu konfirmasi jadwal atau kios fingerprint tambahan.' : 'Confirm schedules or consider an additional fingerprint terminal.',
    );
  }

  // (f) Rekomendasi jam kerja optimal dari data.
  if (organization.medianFirstIn != null && organization.p75FirstIn != null) {
    pushRec(
      'medium',
      lang === 'id' ? 'Usulan jam kerja dari data aktual' : 'Proposed work hours from actual data',
      lang === 'id'
        ? `Median jam datang ${fmtHM(organization.medianFirstIn)}, persentil 75 ${fmtHM(organization.p75FirstIn)}, terlambat paling lambat ${fmtHM(organization.p90FirstIn)}. Disarankan batas masuk ${fmtHM(organization.p75FirstIn)} agar 75% karyawan dianggap tepat waktu.`
        : `Median arrival ${fmtHM(organization.medianFirstIn)}, 75th percentile ${fmtHM(organization.p75FirstIn)}, latest arrival ${fmtHM(organization.p90FirstIn)}. A threshold of ${fmtHM(organization.p75FirstIn)} would mark 75% of employees on time.`,
      lang === 'id' ? 'Keadilan penilaian keterlambatan' : 'Fairness of lateness assessment',
    );
  }

  // (g) Rekomendasi durasi kerja normal.
  if (organization.medianDuration != null) {
    pushRec(
      'medium',
      lang === 'id' ? 'Usulan durasi kerja normal' : 'Proposed normal working duration',
      lang === 'id'
        ? `Durasi kerja median ${fmtDuration(organization.medianDuration)}, rata-rata ${fmtDuration(organization.avgDuration)}.`
        : `Median working duration is ${fmtDuration(organization.medianDuration)}, average ${fmtDuration(organization.avgDuration)}.`,
      lang === 'id' ? 'Deteksi pulang lebih awal' : 'Early-leave detection',
    );
  }

  // (h) Hari tanpa aktivitas sama sekali.
  const observedKeys = new Set(events.map(e => e.dateKey).filter(Boolean));
  const silentDays = workDays.filter(d => !observedKeys.has(d));
  if (silentDays.length) {
    push(
      'warning', 'SILENT_DAYS',
      lang === 'id' ? 'Hari kerja tanpa aktivitas absensi' : 'Working days with no attendance activity',
      lang === 'id'
        ? `${silentDays.length} hari: ${silentDays.map(d => fmtDateShortLang(d, lang)).join(', ')}.`
        : `${silentDays.length} days: ${silentDays.map(d => fmtDateShortLang(d, lang)).join(', ')}.`,
      lang === 'id' ? 'Periksa perangkat dan jalankan sinkronisasi ulang.' : 'Check devices and run a re-sync.',
    );
    pushRec(
      'high',
      lang === 'id' ? 'Tutup celah sinkronisasi data' : 'Close the data synchronization gap',
      lang === 'id'
        ? 'Ada hari kerja tanpa data sama sekali. Sistem kini melakukan sinkronisasi otomatis sebelum laporan dibuat.'
        : 'Some working days have no data at all. The system now auto-syncs before building a report.',
      lang === 'id' ? 'Kelengkapan laporan' : 'Report completeness',
    );
  }

  // (i) Rekomendasi berdasarkan konsistensi terendah.
  const lowest = [...employees].filter(e => e.consistency != null).sort((a, b) => a.consistency - b.consistency)[0];
  if (lowest && lowest.consistency < 60) {
    pushRec(
      'low',
      lang === 'id' ? 'Tingkatkan konsistensi kehadiran' : 'Improve attendance consistency',
      lang === 'id'
        ? `${lowest.name} memiliki konsistensi kehadiran terendah (${lowest.consistency}/100, simpangan ${Math.round(lowest.stdDevFirst)} menit).`
        : `${lowest.name} has the lowest attendance consistency (${lowest.consistency}/100, deviation ${Math.round(lowest.stdDevFirst)} minutes).`,
      lang === 'id' ? 'Prediksi dan perencanaan jadwal' : 'Forecasting and shift planning',
    );
  }

  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  recommendations.sort((a, b) => order[a.priority] - order[b.priority]);

  return {
    employees,
    organization,
    findings,
    recommendations,
    effectiveWorkDays,
    workDays,
  };
}

export { fmtDuration, fmtHM, toMinutes, percentile, stdev };
