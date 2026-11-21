// Export controller — Excel, PDF, CSV generation
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { fetchAllEvents, isValidAccess, getVerifyModeFromMinor, getEmpNo, normName } from '../services/hikvision.js';
import { dateKey, dayOfWeek, fmtDate, fmtDateLong, fmtDateShort, fmtTime, fmtWIB, fmtWIBShort, isValidDateStr, nowWIB, parseDeviceTime } from '../utils/time.js';
import { config } from '../config/index.js';
import prisma from '../db.js';
import { createNameResolver, preferRealName } from '../services/employeeIdentityService.js';

// ─── Helper: resolver nama karyawan ───────────────────────────────────────────
//
// Salinan `buildEmployeeNameMap()` yang tadinya ada di sini sudah dihapus:
// prioritasnya berbeda dari controller lain sehingga laporan bisa
// menampilkan nama berbeda untuk orang yang sama. Sekarang semua memakai
// `employeeIdentityService` (satu sumber kebenaran) yang juga menerapkan
// pemetaan alias untuk memperbaiki konflik nomor ID.

// Reuse enrichEvent from attendance controller (copy for self-contained module)
function enrichEvent(ev, devMaps) {
  const devMap = devMaps[ev.deviceKey] || new Map();
  const empNo  = getEmpNo(ev);
  const user   = devMap.get(empNo) || {};

  const name = (user.name && user.name.trim())
    ? user.name.trim()
    : (ev.name && ev.name.trim()) ? ev.name.trim()
    : `ID ${empNo || '?'}`;

  const hasRealName = (user.name && user.name.trim()) || (ev.name && ev.name.trim());
  const nameKey = hasRealName ? normName(name) : `#${ev.deviceKey}:${empNo}`;

  const verifyMode = getVerifyModeFromMinor(ev.minor);
  const direction  = ev.deviceKey === 'masuk' ? 'Masuk' : 'Keluar';
  const userType   = ev.userType === 'administrator' ? 'Administrator'
    : ev.userType === 'visitor' ? 'Tamu' : 'Normal';

  const d = parseDeviceTime(ev.time);
  return {
    employeeNo:  empNo || '-',
    name,
    nameKey,
    userType,
    time:         d ? d.toISOString() : ev.time,
    timeFormatted: fmtWIB(d || ev.time),
    date:         fmtDate(d || ev.time),
    dateKey:      dateKey(d || ev.time),
    timeOnly:     fmtTime(d || ev.time),
    dayOfWeek:    dayOfWeek(d || ev.time),
    direction,
    verifyMode,
    cardNo:    ev.cardNo || '-',
    doorNo:    ev.doorNo != null ? ev.doorNo : 1,
    deviceKey:   ev.deviceKey,
    deviceLabel: ev.deviceLabel,
    deviceIP:    ev.deviceIP,
  };
}

async function fetchEvents(startDate, endDate, device, filterName) {
  const targets = device === 'all'
    ? Object.values(config.devices)
    : [config.devices[device]].filter(Boolean);

  // Build unified name map from DeviceUser table
  const resolver = await createNameResolver();

  const devMaps = {};
  const dbUsers = await prisma.deviceUser.findMany();
  for (const [key] of Object.entries(config.devices)) {
    devMaps[key] = new Map();
  }
  for (const u of dbUsers) {
    if (!devMaps[u.deviceKey]) devMaps[u.deviceKey] = new Map();
    devMaps[u.deviceKey].set(u.employeeNo, u);
  }

  // Kegagalan perangkat TIDAK boleh disembunyikan.
  //
  // SEBELUMNYA: `.catch(() => [])` membuat perangkat offline terlihat SEPERTI
  // perangkat kosong. Excel/PDF/CSV yang diekspor terlihat lengkap padahal
  // berhari-hari data hilang — user mengira semua orang absen.
  //
  // SEKARANG: kegagalan dicatat dan dilempar supaya caller tidak mengirim
  // laporan yang tidak lengkap.
  const eventResults = await Promise.all(
    targets.map(async (dev) => {
      try {
        return await fetchAllEvents(dev, startDate, endDate);
      } catch (err) {
        console.error(`[export] gagal membaca perangkat ${dev.type} (${dev.ip}):`, err.message);
        throw err;
      }
    })
  );

  let allEvents = eventResults.flat()
    .filter((ev) => isValidAccess(ev))
    .map((ev) => {
      const enriched = enrichEvent(ev, devMaps);
      // Use unified name map for consistent display
      // PERBAIKAN: bila resolver hanya menghasilkan placeholder ("ID 3"),
      // pakai nama dari perangkat sebagai cadangan.
      enriched.name = preferRealName(resolver.name(getEmpNo(ev), ev.deviceKey), ev.name);
      enriched.nameKey = normName(enriched.name);
      return enriched;
    });

  allEvents.sort((a, b) =>
    `${b.dateKey}T${b.timeOnly}`.localeCompare(`${a.dateKey}T${a.timeOnly}`)
  );

  if (filterName) {
    const q = filterName.toLowerCase();
    allEvents = allEvents.filter((e) => e.name.toLowerCase().includes(q));
  }

  return allEvents;
}

// ── Excel ────────────────────────────────────────────────────────────────────
export async function exportExcel(req, res) {
  try {
    const { startDate, endDate, device = 'all', filterName = '' } = req.body;
    // Rentang tanggal WAJIB diisi dan formatnya YYYY-MM-DD.
    // Tanpa ini, export tanpa rentang menghasilkan file kosong yang terlihat
    // "berhasil", dan format salah berakhir jadi HTTP 500 di tengah render.
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }
    const events = await fetchEvents(startDate, endDate, device, filterName);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Fingerprint System';
    wb.created = new Date();

    const titleStyle = {
      font: { bold: true, size: 16, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    };
    const subStyle = {
      font: { italic: true, size: 10, color: { argb: 'FF475569' } },
      alignment: { horizontal: 'center' },
    };
    const headStyle = {
      font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    };
    const borderLight = {
      bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };

    // ── Sheet 1: Detail ──
    const ws = wb.addWorksheet('Detail Absensi', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    ws.mergeCells('A1:K1');
    Object.assign(ws.getCell('A1'), {
      value: 'LAPORAN DETAIL ABSENSI FINGERPRINT',
      ...titleStyle,
    });
    ws.getRow(1).height = 36;

    ws.mergeCells('A2:K2');
    Object.assign(ws.getCell('A2'), {
      value: `Periode: ${fmtDateLong(startDate)} — ${fmtDateLong(endDate)} | Total: ${events.length} record | Dicetak: ${nowWIB('short')}`,
      ...subStyle,
    });
    ws.getRow(2).height = 20;
    ws.getRow(3).height = 5;

    const heads = ['No', 'Nama Karyawan', 'Tipe', 'Tanggal', 'Hari', 'Jam', 'Arah', 'Mode Verifikasi', 'No. Pintu', 'ID (Masuk)', 'Device'];
    const headerRow = ws.addRow(heads);
    headerRow.height = 28;
    headerRow.eachCell((cell) => Object.assign(cell, headStyle));

    events.forEach((ev, idx) => {
      const isEven  = idx % 2 === 0;
      const isMasuk = ev.deviceKey === 'masuk';
      const row = ws.addRow([
        idx + 1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly,
        ev.direction, ev.verifyMode, ev.doorNo, ev.employeeNo, ev.deviceLabel,
      ]);
      row.height = 22;
      row.eachCell((cell, col) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' },
        };
        cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'center' : 'left' };
        cell.font = { size: 10 };
        cell.border = borderLight;
      });
      row.getCell(2).font  = { bold: true, size: 10 };
      row.getCell(7).font  = { bold: true, size: 10, color: { argb: isMasuk ? 'FF16A34A' : 'FFDC2626' } };
      row.getCell(11).font = { bold: true, size: 10, color: { argb: isMasuk ? 'FF16A34A' : 'FFDC2626' } };
    });

    [5, 22, 14, 14, 10, 10, 10, 20, 10, 12, 22].forEach((w, i) => ws.getColumn(i + 1).width = w);

    // ── Sheet 2: Rekap ──
    const wsR = wb.addWorksheet('Rekap Karyawan');
    wsR.mergeCells('A1:H1');
    Object.assign(wsR.getCell('A1'), { value: 'REKAP ABSENSI PER KARYAWAN', ...titleStyle });
    wsR.getRow(1).height = 30;
    wsR.mergeCells('A2:H2');
    Object.assign(wsR.getCell('A2'), { value: `Periode: ${fmtDateShort(startDate)} — ${fmtDateShort(endDate)}`, ...subStyle });
    wsR.getRow(2).height = 18;
    wsR.getRow(3).height = 5;

    const headsR = ['No', 'Nama Karyawan', 'Tipe', 'Hari Hadir', 'Total Masuk', 'Total Keluar', 'Pertama Masuk', 'Terakhir Keluar'];
    const hrRow = wsR.addRow(headsR);
    hrRow.height = 26;
    hrRow.eachCell((cell) => Object.assign(cell, headStyle));

    const grouped = new Map();
    events.forEach((ev) => {
      const key = ev.nameKey || normName(ev.name);
      if (!grouped.has(key)) {
        grouped.set(key, { name: ev.name, userType: ev.userType, masuk: [], keluar: [], days: new Set() });
      }
      const g = grouped.get(key);
      if (ev.deviceKey === 'masuk') g.masuk.push(ev.time);
      else g.keluar.push(ev.time);
      g.days.add(ev.date);
    });

    [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((g, i) => {
      const masukSorted  = g.masuk.sort();
      const keluarSorted = g.keluar.sort();
      const row = wsR.addRow([
        i + 1, g.name, g.userType, g.days.size,
        g.masuk.length, g.keluar.length,
        masukSorted[0] ? fmtWIBShort(masukSorted[0]) : '-',
        keluarSorted[keluarSorted.length - 1] ? fmtWIBShort(keluarSorted[keluarSorted.length - 1]) : '-',
      ]);
      row.height = 22;
      const isEven = i % 2 === 0;
      row.eachCell((cell, col) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: col <= 3 || col >= 7 ? 'left' : 'center' };
        cell.font  = { size: 10 };
        cell.border = borderLight;
      });
      row.getCell(2).font = { bold: true, size: 10 };
    });
    [5, 22, 12, 12, 13, 13, 20, 20].forEach((w, i) => wsR.getColumn(i + 1).width = w);

    // ── Sheet 3: Ringkasan ──
    const wsS = wb.addWorksheet('Ringkasan');
    wsS.getColumn(1).width = 30;
    wsS.getColumn(2).width = 25;
    wsS.mergeCells('A1:B1');
    Object.assign(wsS.getCell('A1'), { value: 'RINGKASAN', ...titleStyle });
    wsS.getRow(1).height = 28;

    const masukC  = events.filter((e) => e.deviceKey === 'masuk').length;
    const keluarC = events.filter((e) => e.deviceKey === 'keluar').length;
    const uniqC   = [...new Set(events.map((e) => e.nameKey))].length;

    [
      ['Periode', `${fmtDateShort(startDate)} — ${fmtDateShort(endDate)}`],
      ['Total Semua Absensi', events.length],
      ['Total Masuk', masukC],
      ['Total Keluar', keluarC],
      ['Karyawan Unik', uniqC],
      ['Hari Kerja Unik', [...new Set(events.map((e) => e.date))].length],
      ['Dicetak Pada', nowWIB()],
    ].forEach(([label, val]) => {
      const r = wsS.addRow([label, val]);
      r.getCell(1).font = { bold: true, size: 11 };
      r.getCell(2).font = { size: 11 };
      r.height = 24;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${startDate}-${endDate}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[exportExcel]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── PDF ────────────────────────────────────────────────────────────────────
export async function exportPDF(req, res) {
  try {
    const { startDate, endDate, device = 'all', filterName = '' } = req.body;
    // Rentang tanggal WAJIB diisi dan formatnya YYYY-MM-DD.
    // Tanpa ini, export tanpa rentang menghasilkan file kosong yang terlihat
    // "berhasil", dan format salah berakhir jadi HTTP 500 di tengah render.
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }
    const events = await fetchEvents(startDate, endDate, device, filterName);

    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${startDate}-${endDate}.pdf"`);
    doc.pipe(res);

    const W = doc.page.width, M = 36;

    // Header
    doc.rect(0, 0, W, 72).fill('#1E40AF');
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold')
      .text('LAPORAN ABSENSI FINGERPRINT', M, 16, { align: 'center', width: W - M * 2 });
    doc.fontSize(9).font('Helvetica')
      .text(`Periode: ${fmtDateLong(startDate)} — ${fmtDateLong(endDate)}  |  Dicetak: ${nowWIB('short')}`, M, 44, { align: 'center', width: W - M * 2 });

    // Stats
    const masukC  = events.filter((e) => e.deviceKey === 'masuk').length;
    const keluarC = events.filter((e) => e.deviceKey === 'keluar').length;
    const uniqC   = [...new Set(events.map((e) => e.nameKey))].length;

    let sy = 84;
    [
      { label: 'Total Absensi', value: events.length, color: '#1D4ED8' },
      { label: 'Total Masuk',   value: masukC,          color: '#15803D' },
      { label: 'Total Keluar',  value: keluarC,         color: '#B91C1C' },
      { label: 'Karyawan Unik', value: uniqC,            color: '#7C3AED' },
    ].forEach((s, i) => {
      const x = M + i * 172;
      doc.roundedRect(x, sy, 160, 44, 6).fill(s.color);
      doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
        .text(String(s.value), x, sy + 4, { width: 160, align: 'center' });
      doc.fontSize(8).font('Helvetica')
        .text(s.label, x, sy + 28, { width: 160, align: 'center' });
    });

    // Table
    let ty = sy + 56;
    const cols = [28, 110, 60, 66, 50, 50, 42, 88, 28, 100];
    const headsTxt = ['No', 'Nama Karyawan', 'Tipe', 'Tanggal', 'Hari', 'Jam', 'Arah', 'Verifikasi', 'Pintu', 'Device'];

    const drawTableHeader = (y) => {
      doc.rect(M, y, cols.reduce((a, b) => a + b, 0), 20).fill('#1E3A8A');
      let cx = M;
      headsTxt.forEach((h, i) => {
        doc.fillColor('white').fontSize(7.5).font('Helvetica-Bold')
          .text(h, cx + 2, y + 5, { width: cols[i] - 4, align: 'center' });
        cx += cols[i];
      });
      return y + 20;
    };

    ty = drawTableHeader(ty);

    events.forEach((ev, idx) => {
      if (ty > doc.page.height - 48) {
        doc.addPage({ layout: 'landscape' });
        ty = 36;
        ty = drawTableHeader(ty);
      }
      const rowH = 16;
      doc.rect(M, ty, cols.reduce((a, b) => a + b, 0), rowH)
        .fill(idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF');
      const isMasuk = ev.deviceKey === 'masuk';
      const cells = [idx + 1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly, ev.direction, ev.verifyMode, ev.doorNo, ev.deviceLabel];
      let cx = M;
      cells.forEach((val, i) => {
        const isMasukC = i === 6 || i === 9;
        doc.fillColor(isMasukC ? (isMasuk ? '#15803D' : '#B91C1C') : '#0F172A')
          .fontSize(7)
          .font(i === 1 || isMasukC ? 'Helvetica-Bold' : 'Helvetica')
          .text(String(val), cx + 2, ty + 4, { width: cols[i] - 4, align: i === 0 || i === 8 ? 'center' : 'left', ellipsis: true });
        cx += cols[i];
      });
      doc.rect(M, ty, cols.reduce((a, b) => a + b, 0), rowH).stroke('#E2E8F0');
      ty += rowH;
    });

    doc.fillColor('#94A3B8').fontSize(7).font('Helvetica')
      .text(`Fingerprint Attendance System — ${nowWIB()} WIB`, M, doc.page.height - 24, { align: 'center', width: W - M * 2 });
    doc.end();
  } catch (err) {
    console.error('[exportPDF]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── CSV ────────────────────────────────────────────────────────────────────
export async function exportCSV(req, res) {
  try {
    const { startDate, endDate, device = 'all', filterName = '' } = req.body;
    // Rentang tanggal WAJIB diisi dan formatnya YYYY-MM-DD.
    // Tanpa ini, export tanpa rentang menghasilkan file kosong yang terlihat
    // "berhasil", dan format salah berakhir jadi HTTP 500 di tengah render.
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate dan endDate wajib diisi' });
    }
    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({ error: 'Format tanggal harus YYYY-MM-DD (mis. 2026-11-10).' });
    }
    const events = await fetchEvents(startDate, endDate, device, filterName);

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const heads = ['No', 'Nama Karyawan', 'Tipe Karyawan', 'Tanggal', 'Hari', 'Jam', 'Arah', 'Mode Verifikasi', 'No. Pintu', 'ID di Device', 'Device', 'IP Device'];
    const lines = [heads.map(esc).join(',')];

    events.forEach((ev, i) => {
      lines.push([
        i + 1, ev.name, ev.userType, ev.date, ev.dayOfWeek, ev.timeOnly,
        ev.direction, ev.verifyMode, ev.doorNo, ev.employeeNo, ev.deviceLabel, ev.deviceIP,
      ].map(esc).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="absensi-${startDate}-${endDate}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    console.error('[exportCSV]', err);
    res.status(500).json({ error: err.message });
  }
}
