// Attendance Page - Modern 2026 Design with New UI Components
import { useState, useEffect } from 'react';
import { Search, Download, RefreshCw, Loader2, ChevronRight, Calendar, Users, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, StatCard, Badge, Avatar, Button, Tabs, TabsList, TabsTrigger, TabsContent, Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter, Skeleton } from '@/components/ui';
import api from '../services/api.js';
import { useLang } from '../hooks/useLang.js';
import { dayName, directionLabel, fmtDateShort, userTypeLabel } from '../lib/i18nData.js';
import { useToast } from '../context/ToastContext.jsx';

// Verify Mode Colors
const VMC = {
  'Fingerprint': { bg: 'bg-[#8B5CF6]/15', color: 'text-[#A78BFA]' },
  'Kartu': { bg: 'bg-[#6366F1]/15', color: 'text-[#818CF8]' },
  'Wajah': { bg: 'bg-[#F97316]/15', color: 'text-[#FB923C]' },
  'Password': { bg: 'bg-[#64748B]/15', color: 'text-[#94A3B8]' },
  'default': { bg: 'bg-[#64748B]/15', color: 'text-[#94A3B8]' }
};

// Date presets
const DATE_PRESETS = [
  { key: 'today', id: 'Hari Ini', en: 'Today' },
  { key: 'yesterday', id: 'Kemarin', en: 'Yesterday' },
  { key: 'last7', id: '7 Hari', en: 'Last 7 Days' },
  { key: 'last30', id: '30 Hari', en: 'Last 30 Days' },
];

function getPresetDates(key, t) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  switch (key) {
    case 'today':
      return { start: today.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) };
    case 'yesterday':
      return { start: yesterday.toISOString().slice(0, 10), end: yesterday.toISOString().slice(0, 10) };
    case 'last7':
      const last7Start = new Date(yesterday);
      last7Start.setDate(last7Start.getDate() - 6);
      return { start: last7Start.toISOString().slice(0, 10), end: yesterday.toISOString().slice(0, 10) };
    case 'last30':
      const last30Start = new Date(yesterday);
      last30Start.setDate(last30Start.getDate() - 29);
      return { start: last30Start.toISOString().slice(0, 10), end: yesterday.toISOString().slice(0, 10) };
    default:
      return { start: yesterday.toISOString().slice(0, 10), end: yesterday.toISOString().slice(0, 10) };
  }
}

// Export to CSV
// Header & isi mengikuti bahasa UI aktif. Parameter `lang` diteruskan dari
// pemanggil; bila tidak, default ke 'id'.
function exportToCSV(data, filename, lang = 'id') {
  const headers = lang === 'id'
    ? ['No', 'Nama', 'ID Fingerprint', 'Tanggal', 'Jam', 'Hari', 'Arah', 'Verifikasi', 'Pintu', 'Kartu', 'Tipe', 'Device']
    : ['No', 'Name', 'Fingerprint ID', 'Date', 'Time', 'Day', 'Direction', 'Verification', 'Door', 'Card', 'Type', 'Device'];
  const rows = data.map((ev, i) => [
    i + 1, `"${ev.name}"`, ev.employeeNo, fmtDateShort(ev.dateKey || ev.date, lang), ev.timeOnly,
    dayName(ev.dateKey || ev.date, lang), directionLabel(ev, lang), ev.verifyMode,
    ev.doorNo, ev.cardNo || '-', userTypeLabel(ev.userType, lang), `"${ev.deviceLabel}"`
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendancePage() {
  const toast = useToast();
  const { t, lang } = useLang();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [startDate, setStartDate] = useState(() => {
    const s = new Date(); s.setDate(s.getDate() - 7);
    return s.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => {
    const e = new Date(); e.setDate(e.getDate() - 1);
    return e.toISOString().slice(0, 10);
  });
  const [device, setDevice] = useState('all');
  const [filterName, setFilterName] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState(null);
  const [activePreset, setActivePreset] = useState('last7');
  const [exportLoading, setExportLoading] = useState(false);

  const load = async (p = 1) => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const res = await api.post('/attendance/db', { startDate, endDate, device, page: p, pageSize, filterName });
      setData(res.data?.data || []);
      setStats(res.data?.stats);
      setTotal(res.data?.total || 0);
      setPage(res.data?.page || 1);
      setTotalPages(res.data?.totalPages || 1);
    } catch (err) {
      // Error harus terlihat user, bukan hanya di console browser.
      toast(err.serverMessage || err.message || 'Gagal memuat data absensi', 'error');
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handlePresetClick = (presetKey) => {
    setActivePreset(presetKey);
    const dates = getPresetDates(presetKey, t);
    setStartDate(dates.start);
    setEndDate(dates.end);
  };

  const handleExport = async () => {
    if (data.length === 0) return;
    setExportLoading(true);
    try {
      const res = await api.post('/attendance/db', {
        startDate, endDate, device, page: 1, pageSize: 10000, filterName
      });
      const allData = res.data?.data || [];
      exportToCSV(allData, `attendance-${startDate}-${endDate}.csv`, lang);
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal mengekspor data absensi', 'error');
    }
    setExportLoading(false);
  };

  const handleSearch = () => {
    setActivePreset(null);
    load(1);
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const getPresetLabel = (key) => lang === 'id'
    ? DATE_PRESETS.find(p => p.key === key)?.id
    : DATE_PRESETS.find(p => p.key === key)?.en;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#F1F5F9]">{t('page.attendance.title')}</h1>
          <p className="text-sm text-[#8494AD] mt-1">{t('page.attendance.sub')}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleExport} disabled={data.length === 0 || exportLoading}>
            {exportLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {t('top.export')}
          </Button>
          <Button onClick={() => load(page)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('top.refresh')}
          </Button>
        </div>
      </div>

      {/* Filter Card */}
      <Card className="p-5">
        {/* Date Presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {DATE_PRESETS.map(preset => (
            <button
              key={preset.key}
              onClick={() => handlePresetClick(preset.key)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${
                activePreset === preset.key
                  ? 'bg-gradient-to-r from-[#6366F1] to-[#818CF8] text-white shadow-lg shadow-[#6366F1]/30'
                  : 'bg-white/5 text-[#94A3B8] border border-white/10 hover:bg-white/10 hover:border-white/20'
              }`}
            >
              {lang === 'id' ? preset.id : preset.en}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.from')}</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setActivePreset(null); }}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.to')}</label>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setActivePreset(null); }}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.device')}</label>
            <select
              value={device}
              onChange={e => setDevice(e.target.value)}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
            >
              <option value="all">{t('f.all')}</option>
              <option value="masuk">{t('f.masuk')}</option>
              <option value="keluar">{t('f.keluar')}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.name_filter')}</label>
            <input
              type="text"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              placeholder={lang === 'id' ? 'Nama karyawan...' : 'Employee name...'}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] placeholder:text-[#8494AD] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 w-48"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.page_size')}</label>
            <select
              value={pageSize}
              onChange={e => { setPageSize(parseInt(e.target.value)); load(1); }}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
          <Button onClick={handleSearch} disabled={loading}>
            <Search size={14} />
            {t('f.show')}
          </Button>
        </div>
      </Card>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label={t('s.total')} value={stats.totalEvents} icon={<TrendingUp size={18} className="text-[#6366F1]" />} color="primary" />
          <StatCard label={t('s.in')} value={stats.totalMasuk} icon={<TrendingUp size={18} className="text-[#10B981]" />} color="success" />
          <StatCard label={t('s.out')} value={stats.totalKeluar} icon={<TrendingDown size={18} className="text-[#EF4444]" />} color="danger" />
          <StatCard label={t('s.unique')} value={stats.uniqueUsers} icon={<Users size={18} className="text-[#8B5CF6]" />} color="purple" />
          <StatCard label={t('s.days')} value={stats.uniqueDays} icon={<Calendar size={18} className="text-[#06B6D4]" />} color="cyan" />
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-[#F1F5F9]">{t('page.attendance.title')}</h3>
            <Badge variant="secondary">{total} {t('page.records')}</Badge>
          </div>
          {stats && (
            <span className="text-xs text-[#8494AD]">
              {stats.uniqueUsers} {t('s.unique_sub')} • {stats.uniqueDays} {t('s.days_sub')}
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-4">
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} height={56} className="rounded-lg" />)}
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="p-12 text-center">
            <Search size={48} className="mx-auto mb-3 text-[#8494AD] opacity-40" />
            <h3 className="text-base font-semibold text-[#94A3B8]">{t('empty.no_data')}</h3>
            <p className="text-sm text-[#8494AD] mt-1">{t('empty.select_date')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gradient-to-r from-[#0F172A] to-[#1E293B] border-b border-white/10">
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">#</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.name')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.date')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.time')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.day')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.dir')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.verify')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.door')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.device')}</th>
                  <th className="p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.map((ev, i) => {
                  const isMasuk = ev.deviceKey === 'masuk';
                  const vc = VMC[ev.verifyMode] || VMC.default;
                  // Tanggal & hari di-derive dari `dateKey` (netral), bukan dari
                  // field terformat server yang selalu Bahasa Indonesia.
                  const evDate = fmtDateShort(ev.dateKey || ev.date, lang);
                  const evDay = dayName(ev.dateKey || ev.date, lang);
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelected(ev)}
                      // Aksesibilitas keyboard: baris tabel yang bisa diklik harus
                      // bisa difokus dan diaktifkan lewat Enter/Space. Tanpa ini,
                      // pengguna keyboard tidak bisa membuka detail absensi.
                      tabIndex={0}
                      role="button"
                      aria-label={`${ev.name} ${ev.timeOnly}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(ev);
                        }
                      }}
                      className="hover:bg-[#6366F1]/5 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/60"
                    >
                      <td className="p-3 text-xs text-[#8494AD]">{from + i - 1}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={ev.name} size="sm" />
                          <div>
                            <p className="text-sm font-medium text-[#F1F5F9]">{ev.name}</p>
                            <p className="text-[10px] text-[#8494AD] font-mono">{ev.employeeNo}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-sm font-medium text-[#94A3B8]">{evDate}</td>
                      <td className="p-3 text-sm font-bold text-[#818CF8]">{ev.timeOnly}</td>
                      <td className="p-3">
                        <Badge variant="secondary" size="sm">{evDay}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={isMasuk ? 'success' : 'danger'} dot>
                          {directionLabel(ev, lang)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${vc.bg} ${vc.color}`}>
                          {ev.verifyMode}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-[#8494AD]">{t('th.door')} {ev.doorNo}</td>
                      <td className="p-3">
                        <Badge variant={ev.deviceKey === 'masuk' ? 'success' : 'danger'} size="sm">
                          {ev.deviceLabel}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <ChevronRight size={16} className="text-[#8494AD]" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs text-[#8494AD]">
              {t('page.showing')} {from}–{to} {t('page.of')} {total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => load(page - 1)} disabled={page <= 1}>‹</Button>
              {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                const pageNum = i + 1;
                return (
                  <Button key={pageNum} variant={pageNum === page ? 'default' : 'outline'} size="sm" onClick={() => load(pageNum)}>
                    {pageNum}
                  </Button>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => load(page + 1)} disabled={page >= totalPages}>›</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      <Modal open={!!selected} onOpenChange={(open) => !open && setSelected(null)} size="lg">
        {selected && (
          <>
            <ModalHeader onClose={() => setSelected(null)}>
              <div className="flex items-center gap-4">
                <Avatar name={selected.name} size="lg" />
                <div>
                  <ModalTitle>{selected.name}</ModalTitle>
                  <p className="text-sm text-[#8494AD]">{t('th.employee_id')}: {selected.employeeNo}</p>
                </div>
                <Badge variant={selected.deviceKey === 'masuk' ? 'success' : 'danger'} dot className="ml-auto">
                  {directionLabel(selected, lang)}
                </Badge>
              </div>
            </ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.date')}</p>
                  <p className="text-sm font-medium text-[#F1F5F9]">{fmtDateShort(selected.dateKey || selected.date, lang)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.time')}</p>
                  <p className="text-sm font-bold text-[#818CF8]">{selected.timeOnly}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.day')}</p>
                  <p className="text-sm font-medium text-[#F1F5F9]">{dayName(selected.dateKey || selected.date, lang)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.verify')}</p>
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${VMC[selected.verifyMode]?.bg || VMC.default.bg} ${VMC[selected.verifyMode]?.color || VMC.default.color}`}>
                    {selected.verifyMode}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.door')}</p>
                  <p className="text-sm font-medium text-[#F1F5F9]">{t('th.door')} {selected.doorNo}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('th.device')}</p>
                  <p className="text-sm font-medium text-[#F1F5F9]">{selected.deviceLabel}</p>
                </div>
                <div className="space-y-1 col-span-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8494AD]">{t('dev.ip')}</p>
                  <p className="text-sm font-mono text-[#94A3B8]">{selected.deviceIP}</p>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="outline" onClick={() => setSelected(null)}>{t('det.close')}</Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
