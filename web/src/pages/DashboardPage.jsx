// Dashboard Page - Modern 2026 Design with New UI Components
import { useState, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Filter, Activity, Users, RefreshCw, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, StatCard, Badge, Avatar, Tabs, TabsList, TabsTrigger, TabsContent, Button, Skeleton } from '@/components/ui';
import api from '../services/api.js';
import { useLang } from '../hooks/useLang.js';
import { dayName, directionLabel, fmtDateShort } from '../lib/i18nData.js';
import { useToast } from '../context/ToastContext.jsx';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// Verify Mode Colors
const VMC = {
  'Fingerprint': { bg: 'bg-[#8B5CF6]/15', color: 'text-[#A78BFA]', border: 'border-[#8B5CF6]/30' },
  'Kartu': { bg: 'bg-[#6366F1]/15', color: 'text-[#818CF8]', border: 'border-[#6366F1]/30' },
  'Wajah': { bg: 'bg-[#F97316]/15', color: 'text-[#FB923C]', border: 'border-[#F97316]/30' },
  'Password': { bg: 'bg-[#64748B]/15', color: 'text-[#94A3B8]', border: 'border-[#64748B]/30' },
  'default': { bg: 'bg-[#64748B]/15', color: 'text-[#94A3B8]', border: 'border-[#64748B]/30' }
};

export default function DashboardPage() {
  const toast = useToast();
  const { t, lang } = useLang();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [data, setData] = useState([]);
  const [startDate, setStartDate] = useState(() => {
    const s = new Date(); s.setDate(s.getDate() - 7);
    s.setHours(0, 0, 0, 0);
    return s.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => {
    const e = new Date(); e.setDate(e.getDate() - 1);
    return e.toISOString().slice(0, 10);
  });
  const [device, setDevice] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');

  const load = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const res = await api.post('/attendance', { startDate, endDate, device, page: 1, pageSize: 50 });
      setStats(res.data?.stats);
      setData(res.data?.data || []);
    } catch (err) {
      // Error harus terlihat user, bukan hanya di console browser.
      toast(err.serverMessage || err.message || 'Gagal memuat data dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Hour chart data
  const hourMap = {};
  for (let h = 5; h <= 22; h++) hourMap[String(h).padStart(2, '0')] = { Masuk: 0, Keluar: 0 };
  data.forEach(r => {
    const d = new Date(r.time);
    const h = String(d.getHours()).padStart(2, '0');
    if (!hourMap[h]) hourMap[h] = { Masuk: 0, Keluar: 0 };
    // Kunci arah diambil dari `deviceKey` (netral terhadap bahasa), bukan dari
    // `direction` yang selalu bernilai "Masuk"/"Keluar" dari server.
    if (r.deviceKey === 'masuk') hourMap[h].Masuk++;
    else hourMap[h].Keluar++;
  });
  const hourLabels = Object.keys(hourMap).sort();

  const barData = {
    labels: hourLabels.map(h => h + ':00'),
    datasets: [
      {
        label: t('rek.in'),
        data: hourLabels.map(h => hourMap[h].Masuk),
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
        borderRadius: 'var(--radius-xs)',
        borderSkipped: false,
      },
      {
        label: t('rek.out'),
        data: hourLabels.map(h => hourMap[h].Keluar),
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderRadius: 'var(--radius-xs)',
        borderSkipped: false,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: { family: 'Inter', size: 11 },
          boxWidth: 12,
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: 'Inter', size: 9 }, maxRotation: 45 },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { font: { family: 'Inter', size: 10 }, stepSize: 1 },
      },
    },
  };

  // Verify mode stats
  const verifyMap = {};
  data.forEach(r => { verifyMap[r.verifyMode] = (verifyMap[r.verifyMode] || 0) + 1; });
  const verifyEntries = Object.entries(verifyMap).sort((a, b) => b[1] - a[1]);
  const total = data.length || 1;

  // Daily stats
  const dayMap = {};
  data.forEach(r => {
    const dk = r.dateKey || r.date;
    if (!dayMap[dk]) dayMap[dk] = { dateKey: dk, Masuk: 0, Keluar: 0 };
    if (r.deviceKey === 'masuk') dayMap[dk].Masuk++;
    else dayMap[dk].Keluar++;
  });
  const dayEntries = Object.entries(dayMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#F1F5F9]">{t('page.dashboard.title')}</h1>
          <p className="text-sm text-[#8494AD] mt-1">
            {startDate} — {endDate}
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('top.refresh')}
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.from')}</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.to')}</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
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
          <Button onClick={load} disabled={loading}>
            <Filter size={14} />
            {t('f.show')}
          </Button>
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={() => {
              const s = new Date().toISOString().slice(0,10);
              setStartDate(s); setEndDate(s);
            }}>{t('f.today')}</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const s = new Date(); s.setDate(s.getDate()-7);
              setStartDate(s.toISOString().slice(0,10)); setEndDate(new Date().toISOString().slice(0,10));
            }}>{t('f.week')}</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const s = new Date(); s.setDate(1);
              setStartDate(s.toISOString().slice(0,10)); setEndDate(new Date().toISOString().slice(0,10));
            }}>{t('f.month')}</Button>
          </div>
        </div>
      </Card>

      {/* Stats Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} height={140} className="rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={t('s.total')}
            value={stats?.totalEvents || 0}
            trend={{ value: 12.5, positive: true }}
            icon={<Activity size={20} className="text-[#6366F1]" />}
            color="primary"
          />
          <StatCard
            label={t('s.in')}
            value={stats?.totalMasuk || 0}
            trend={{ value: 5.2, positive: true }}
            icon={<TrendingUp size={20} className="text-[#10B981]" />}
            color="success"
          />
          <StatCard
            label={t('s.out')}
            value={stats?.totalKeluar || 0}
            trend={{ value: 3.1, positive: false }}
            icon={<TrendingDown size={20} className="text-[#EF4444]" />}
            color="danger"
          />
          <StatCard
            label={t('s.unique')}
            value={stats?.uniqueUsers || 0}
            trend={{ value: 8.0, positive: true }}
            icon={<Users size={20} className="text-[#8B5CF6]" />}
            color="purple"
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="pills">
          <TabsTrigger value="overview">📊 {t('chart.trend')}</TabsTrigger>
          <TabsTrigger value="chart">📈 {t('chart.verify')}</TabsTrigger>
          <TabsTrigger value="activity">📋 {t('dash.recent')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Verify Mode */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">📌 {t('chart.verify')}</h3>
              {verifyEntries.length === 0 ? (
                <p className="text-sm text-[#8494AD] text-center py-8">{t('empty.no_data')}</p>
              ) : (
                <div className="space-y-3">
                  {verifyEntries.map(([mode, count]) => {
                    const pct = Math.round((count / total) * 100);
                    const vc = VMC[mode] || VMC.default;
                    return (
                      <div key={mode}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-[#F1F5F9]">{mode}</span>
                          <span className={`text-sm font-bold ${vc.color}`}>{count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${vc.bg.replace('/15', '')}`}
                            style={{ width: `${pct}%`, transition: 'width 0.5s ease' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Daily Trend */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">📅 {t('rek.per_day')}</h3>
              {dayEntries.length === 0 ? (
                <p className="text-sm text-[#8494AD] text-center py-8">{t('empty.no_data')}</p>
              ) : (
                <div className="space-y-3">
                  {dayEntries.map(([dk, d]) => {
                    const dayTotal = d.Masuk + d.Keluar;
                    const masukPct = dayTotal > 0 ? (d.Masuk / dayTotal) * 100 : 0;
                    const keluarPct = dayTotal > 0 ? (d.Keluar / dayTotal) * 100 : 0;
                    return (
                      <div key={dk} className="flex items-center gap-3">
                        <div className="w-16 shrink-0">
                          <span className="text-xs font-medium text-[#94A3B8]">{fmtDateShort(d.dateKey, lang)}</span>
                        </div>
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden flex">
                          <div
                            className="bg-[#10B981] h-full transition-all duration-300"
                            style={{ width: `${masukPct}%` }}
                          />
                          <div
                            className="bg-[#EF4444] h-full transition-all duration-300"
                            style={{ width: `${keluarPct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-[#F1F5F9] w-8 text-right">{dayTotal}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="chart">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">📈 {t('chart.trend')}</h3>
            <div className="h-80">
              <Bar data={barData} options={barOptions} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F1F5F9]">{t('dash.recent')}</h3>
              <Badge variant="secondary">{data.length} {t('page.records')}</Badge>
            </div>
            {loading ? (
              <div className="p-4 space-y-3">
                {[1,2,3,4,5].map(i => <Skeleton key={i} height={48} className="rounded-lg" />)}
              </div>
            ) : data.length === 0 ? (
              <div className="p-12 text-center">
                <Activity size={48} className="mx-auto mb-3 text-[#8494AD] opacity-40" />
                <p className="text-sm font-medium text-[#8494AD]">{t('dash.no_data')}</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {data.slice(0, 10).map((ev, i) => {
                  const isMasuk = ev.deviceKey === 'masuk';
                  return (
                    <div key={i} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors cursor-pointer">
                      <Avatar name={ev.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#F1F5F9] truncate">{ev.name}</p>
                        <p className="text-xs text-[#8494AD]">{ev.employeeNo}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant={isMasuk ? 'success' : 'danger'} dot>
                          {directionLabel(ev, lang)}
                        </Badge>
                        <p className="text-xs text-[#8494AD] mt-1">{ev.timeOnly}</p>
                      </div>
                      <ChevronRight size={16} className="text-[#8494AD]" />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
