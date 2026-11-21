// AdminDashboard — dark glass theme
import { useState, useEffect } from 'react';
import { useLang } from '../hooks/useLang.js';
import {
  Activity, Users, Database, Calendar, Clock,
  CheckCircle, XCircle, AlertTriangle, RefreshCw,
  TrendingUp, TrendingDown, Wifi, WifiOff, Server,
  BarChart2, Shield, Globe, HardDrive, ChevronRight, Trash2
} from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter, Button } from '@/components/ui';

function StatCard({ label, value, sub, color, icon: Icon, trend }) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
      padding: '18px',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all .2s',
    }}>
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, height: '3px',
        background: color,
        borderRadius: 'var(--radius) var(--radius) 0 0',
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: 'var(--radius-md)',
          background: color + '18', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={20} style={{ stroke: color }} />
        </div>
        {trend !== undefined && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: '11px', fontWeight: 600,
            color: trend >= 0 ? 'var(--success)' : 'var(--danger)',
          }}>
            {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trend)}
          </div>
        )}
      </div>
      <div style={{
        fontSize: '28px', fontWeight: 800, lineHeight: 1,
        letterSpacing: '-.5px', color: 'var(--text)',
      }}>{value ?? '—'}</div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginTop: '6px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function DeviceStatusCard({ dev, deviceInfo }) {
  const info = deviceInfo?.[dev.key] || {};
  const isOnline = info.status === 'online';
  const statusColor = isOnline ? 'var(--success)' : 'var(--danger)';
  const statusBg = isOnline ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
  const statusBorder = isOnline ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';
  const accentColor = isOnline ? 'var(--success)' : 'var(--danger)';

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
        background: accentColor,
        borderRadius: 'var(--radius) var(--radius) 0 0',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', marginTop: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
            background: isOnline ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {isOnline
              ? <Wifi size={18} style={{ stroke: 'var(--success)' }} />
              : <WifiOff size={18} style={{ stroke: 'var(--danger)' }} />
            }
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{dev.label}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{dev.ip}</div>
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 700,
          background: statusBg, color: statusColor, border: '1px solid ' + statusBorder,
        }}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      {isOnline && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: '8px' }}>
          {[
            { lbl: 'Model', val: info.model || '-' },
            { lbl: 'Serial', val: info.serialNumber || '-' },
            { lbl: 'Firmware', val: info.firmwareVersion || '-' },
            { lbl: 'Device Name', val: info.deviceName || '-' },
          ].map(({ lbl, val }) => (
            <div key={lbl} style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
              <div style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>{lbl}</div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</div>
            </div>
          ))}
        </div>
      )}
      {!isOnline && (
        <div style={{
          padding: '10px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-sm)',
          fontSize: '12px', color: 'var(--danger)',
        }}>
          <AlertTriangle size={12} style={{ display: 'inline', marginRight: '6px' }} />
          {info.error || 'Device tidak reachable'}
        </div>
      )}
    </div>
  );
}

function AuditRow({ log }) {
  const actionConfig = {
    login:    { color: 'var(--primary)',    bg: 'rgba(99,102,241,0.12)', icon: '🔑', label: 'Login' },
    logout:   { color: 'var(--text-muted)', bg: 'var(--bg)',            icon: '🚪', label: 'Logout' },
    export:   { color: 'var(--success)',   bg: 'rgba(16,185,129,0.12)', icon: '📊', label: 'Export' },
    email:    { color: 'var(--purple)',    bg: 'rgba(139,92,246,0.12)', icon: '📧', label: 'Email' },
    sync:     { color: 'var(--warning)',   bg: 'rgba(245,158,11,0.12)', icon: '🔄', label: 'Sync' },
    schedule: { color: 'var(--cyan)',      bg: 'rgba(6,182,212,0.12)',  icon: '⏰', label: 'Schedule' },
    whatsapp: { color: 'var(--success)',    bg: 'rgba(16,185,129,0.12)', icon: '💬', label: 'WhatsApp' },
  };
  const cfg = actionConfig[log.action] || { color: 'var(--text-muted)', bg: 'var(--bg)', icon: '📌', label: log.action };

  const fmtTime = (d) => {
    if (!d) return '-';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '10px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
        background: cfg.bg, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: '14px',
      }}>
        {cfg.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>{cfg.label}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {log.detail || log.user || '—'}
        </div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {fmtTime(log.createdAt)}
      </div>
    </div>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Tidak ada data trend
      </div>
    );
  }
  const maxVal = Math.max(...trend.map(d => d.total)) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '100px' }}>
      {trend.map((d, i) => {
        const masukH = (d.Masuk / maxVal) * 100;
        const keluarH = (d.Keluar / maxVal) * 100;
        const fmt = (ds) => {
          const parts = String(ds).split('-');
          return parts.length === 3 ? parts[2] + '/' + parts[1] : ds;
        };
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <div style={{ display: 'flex', gap: '1px', flex: 1, alignItems: 'flex-end' }}>
              <div style={{ flex: 1, height: masukH + '%', background: 'var(--success)', borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0', minHeight: '2px' }} />
              <div style={{ flex: 1, height: keluarH + '%', background: 'var(--danger)', borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0', minHeight: '2px' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VerifyModeChart({ verifyModes, total }) {
  if (!verifyModes || verifyModes.length === 0) return null;
  const colors = ['var(--purple)', 'var(--primary)', 'var(--warning)', 'var(--success)', 'var(--danger)', 'var(--cyan)', 'var(--text-muted)'];
  // Penyebut WAJIB disamakan dengan basis data verifyModes itu sendiri.
  // Sebelumnya memakai `totalTrend` (14 hari) sedangkan verifyModes dihitung
  // server dari 30 hari — sehingga persentase bisa > 100% dan bar meluber
  // (terukur width 220% di viewport 390px).
  const vmTotal = verifyModes.reduce((s, vm) => s + (Number(vm.count) || 0), 0) || Number(total) || 0;
  return (
    <div>
      {verifyModes.map((vm, i) => {
        const pct = vmTotal > 0 ? Math.min(100, Math.max(0, Math.round((vm.count / vmTotal) * 100))) : 0;
        const color = colors[i % colors.length];
        return (
          <div key={vm.mode} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>{vm.mode}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color }}>{vm.count} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({pct}%)</span></span>
            </div>
            <div style={{ height: '6px', background: 'var(--bg)', borderRadius: 'var(--radius-xs)', overflow: 'hidden', maxWidth: '100%' }}>
              <div style={{ height: '100%', background: color, borderRadius: 'var(--radius-xs)', width: pct + '%', maxWidth: '100%' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleCard({ schedule }) {
  const fmtDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const isSuccess = schedule.lastStatus === 'success';
  const isFailed = schedule.lastStatus === 'failed';
  const channelColor = schedule.channel === 'email' ? 'var(--primary)' : schedule.channel === 'whatsapp' ? 'var(--success)' : 'var(--purple)';
  const channelBg = schedule.channel === 'email' ? 'rgba(99,102,241,0.12)' : schedule.channel === 'whatsapp' ? 'rgba(16,185,129,0.12)' : 'rgba(139,92,246,0.12)';

  return (
    <div style={{
      padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)', opacity: schedule.enabled ? 1 : 0.6,
      marginBottom: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{schedule.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: 'var(--radius-md)', fontWeight: 600, background: channelBg, color: channelColor }}>
            {schedule.channel === 'email' ? 'Email' : schedule.channel === 'whatsapp' ? 'WhatsApp' : 'Both'}
          </span>
          {isSuccess && <CheckCircle size={12} style={{ stroke: 'var(--success)' }} />}
          {isFailed && <XCircle size={12} style={{ stroke: 'var(--danger)' }} />}
        </div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Clock size={10} style={{ stroke: 'var(--text-muted)' }} />
          <code style={{ background: 'var(--surface)', padding: '1px 4px', borderRadius: 'var(--radius-xs)', fontFamily: 'monospace', fontSize: '10px' }}>{schedule.cronExpr}</code>
        </span>
        {schedule.lastRun && <span>Last: {fmtDate(schedule.lastRun)}</span>}
      </div>
      {schedule.lastError && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '4px 8px', borderRadius: 'var(--radius-xs)' }}>
          <AlertTriangle size={10} style={{ display: 'inline', marginRight: '4px' }} />
          {schedule.lastError.slice(0, 80)}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t, lang } = useLang();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('overview');
  const [deviceInfo, setDeviceInfo] = useState({});
  // Kontrol pembersihan log audit. Backend (DELETE /api/admin/audit)
  // mewajibkan `days` eksplisit atau flag `?all=true` supaya log audit
  // tidak terhapus seluruhnya karena satu klik tak sengaja.
  const [auditCleanOpen, setAuditCleanOpen] = useState(false);
  const [auditCleanDays, setAuditCleanDays] = useState(90);
  const [auditCleanAll, setAuditCleanAll] = useState(false);
  const [auditCleaning, setAuditCleaning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, devRes] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/devices'),
      ]);
      setData(dashRes.data || {});
      setDeviceInfo(devRes.data || {});
    } catch (err) {
      // Error harus terlihat user, bukan hanya di console browser.
      toast(err.serverMessage || err.message || 'Gagal memuat data dashboard admin', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  /**
   * Hapus log audit sesuai cakupan yang dipilih user.
   *
   * Dua mode, keduanya wajib diminta secara eksplisit:
   *   - Berthumur (default 90 hari) → `?days=N`
   *   - Seluruhnya                 → `?all=true`
   *
   * Backend membalas 400 bila `days` kosong tanpa `all=true`, jadi UI
   * tidak pernah bisa menghapus seluruh jejak audit secara tak sengaja.
   */
  const handleCleanAudit = async () => {
    setAuditCleaning(true);
    try {
      const query = auditCleanAll ? '?all=true' : `?days=${auditCleanDays}`;
      const res = await api.delete(`/admin/audit${query}`);
      const deleted = res.data?.deleted ?? 0;
      toast(
        res.data?.message || `${deleted} baris log audit dihapus.`,
        'success',
      );
      setAuditCleanOpen(false);
      setAuditCleanAll(false);
      await load();
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal menghapus log audit', 'error');
    } finally {
      setAuditCleaning(false);
    }
  };

  const { stats = {}, trend = [], verifyModes = [], schedules = [], auditLogs = [] } = data || {};
  const totalTrend = trend.reduce((s, d) => s + d.total, 0);
  const avgDaily = trend.length ? Math.round(totalTrend / trend.length) : 0;

  if (loading) {
    return (
      // Padding responsif: 80px membuat spinner melompong jauh di layar
      // sempit, sedangkan 0px membuatnya menempel tepi.
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 16px' }}>
        <RefreshCw size={32} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page-pad">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={22} style={{ stroke: 'var(--primary)' }} />
            Admin Dashboard
          </h1>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Sistem Fingerprint Attendance — Overview & Monitoring
          </p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleRefresh} disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'Memuat...' : 'Refresh'}
        </button>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label={t('page.dashboard.title')} value={stats.totalRecords} sub={t('page.dashboard.sub')} color="var(--primary)" icon={Database} />
        <StatCard label={t('admin.stat_today')} value={stats.todayRecords} sub={t('admin.stat_today_sub')} color="var(--success)" icon={Activity} />
        <StatCard label={t('admin.stat_week')} value={stats.weekRecords} sub={t('admin.stat_week_sub')} color="var(--purple)" icon={BarChart2} />
        <StatCard label={t('s.unique')} value={stats.uniqueEmployees} sub={t('admin.stat_unique_sub')} color="var(--cyan)" icon={Users} />
        <StatCard label={t('nav.scheduler')} value={(stats.enabledSchedules || 0) + '/' + (stats.totalSchedules || 0)} sub={t('admin.stat_sched_sub')} color="var(--warning)" icon={Calendar} />
        <StatCard label={t('admin.stat_avg_daily')} value={avgDaily} sub={t('admin.stat_avg_daily_sub')} color="var(--danger)" icon={TrendingUp} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'devices', label: 'Devices' },
          { key: 'scheduler', label: 'Scheduler' },
          { key: 'audit', label: 'Audit Log' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '8px 18px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (tab === key ? 'transparent' : 'var(--border)'),
              cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'Inter, sans-serif',
              background: tab === key ? 'var(--gradient-primary)' : 'var(--surface)',
              color: tab === key ? 'white' : 'var(--text-muted)',
              boxShadow: tab === key ? '0 4px 15px rgba(99,102,241,0.3)' : 'none',
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: '16px', marginBottom: '20px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>{t('admin.trend_14')}</h3>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-xs)', background: 'var(--success)', display: 'inline-block' }} />{t('rek.in')}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-xs)', background: 'var(--danger)', display: 'inline-block' }} />{t('rek.out')}
                </span>
              </div>
            </div>
            <TrendChart trend={trend} />
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>{t('admin.verify_mode')}</h3>
            <VerifyModeChart verifyModes={verifyModes} total={totalTrend} />
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>{t('admin.sys_info')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { icon: Globe, label: 'Port', val: '6601' },
                { icon: HardDrive, label: t('admin.db_label'), val: 'PostgreSQL (Prisma)' },
                { icon: Server, label: t('admin.api_path'), val: '/api/admin/dashboard' },
                { icon: Clock, label: t('admin.server_time'), val: data?.systemTime ? new Date(data.systemTime).toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB') : '-' },
              ].map(({ icon: Icon, label, val }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon size={14} style={{ stroke: 'var(--text-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: '12px', color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>{t('admin.quick_actions')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: t('admin.sync_attendance'), href: '/dashboard', color: 'var(--primary)' },
                { label: t('admin.generate_report'), href: '/reports', color: 'var(--success)' },
                { label: t('admin.schedule_report'), href: '/scheduler', color: 'var(--warning)' },
              ].map(({ label, href, color }) => (
                <a key={href} href={href} onClick={(e) => { e.preventDefault(); window.location.href = href; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    textDecoration: 'none', color: 'var(--text)',
                    fontSize: '13px', fontWeight: 600, transition: 'all .15s',
                  }}>
                  <ChevronRight size={14} style={{ stroke: color }} />
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'devices' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: '16px', marginBottom: '20px' }}>
          {[
            { key: 'masuk', label: t('dev.masuk'), ip: deviceInfo.masuk?.ip || '-' },
            { key: 'keluar', label: t('dev.keluar'), ip: deviceInfo.keluar?.ip || '-' },
          ].map(dev => (
            <DeviceStatusCard key={dev.key} dev={dev} deviceInfo={deviceInfo} />
          ))}
        </div>
      )}

      {tab === 'scheduler' && (
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
              Scheduled Reports ({schedules.length})
            </h3>
            <a href="/scheduler" onClick={(e) => { e.preventDefault(); window.location.href = '/scheduler'; }}
              style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Kelola Jadwal <ChevronRight size={12} />
            </a>
          </div>
          {schedules.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Belum ada jadwal.{' '}
              <a href="/scheduler" onClick={(e) => { e.preventDefault(); window.location.href = '/scheduler'; }} style={{ color: 'var(--primary)' }}>
                Buat jadwal pertama
              </a>
            </div>
          ) : (
            schedules.map(s => <ScheduleCard key={s.id} schedule={s} />)
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                {t('admin.audit_log')} ({auditLogs.length})
              </h3>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t('admin.recent_20')}</div>
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setAuditCleanOpen(true)}
              style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.35)' }}
              aria-label={t('admin.audit_clean_title')}
            >
              <Trash2 size={13} />
              {t('admin.audit_clean')}
            </button>
          </div>
          {auditLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
              {t('admin.no_activity')}
            </div>
          ) : (
            auditLogs.map(log => <AuditRow key={log.id} log={log} />)
          )}
        </div>
      )}

      {/* Dialog pembersihan log audit — cakupan harus dipilih eksplisit.
          Memakai Modal (bukan ConfirmDialog) karena user perlu memilih
          rentang usia log yang akan dihapus, bukan sekadar ya/tidak. */}
      <Modal open={auditCleanOpen} onOpenChange={setAuditCleanOpen} size="md">
        <ModalHeader onClose={() => setAuditCleanOpen(false)}>
          <ModalTitle>{t('admin.audit_clean_title')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p style={{ fontSize: '12.5px', color: 'var(--text-sub)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {t('admin.audit_clean_desc')}
          </p>

          <label
            style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              background: auditCleanAll ? 'rgba(239,68,68,0.08)' : 'var(--surface)',
              cursor: 'pointer', marginBottom: '8px' }}
          >
            <input
              type="radio"
              name="audit-clean-scope"
              checked={!auditCleanAll}
              onChange={() => setAuditCleanAll(false)}
              style={{ marginTop: 2, accentColor: 'var(--primary)' }}
            />
            <span style={{ fontSize: '12.5px', color: 'var(--text)' }}>
              {t('admin.audit_clean_older')}
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                {t('admin.audit_clean_older_hint')}
              </span>
            </span>
          </label>

          {!auditCleanAll && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 12px 12px 34px' }}>
              <input
                type="number"
                min="1"
                max="3650"
                value={auditCleanDays}
                onChange={(e) => setAuditCleanDays(Math.min(3650, Math.max(1, Number(e.target.value) || 1)))}
                style={{ width: '90px', padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '12.5px' }}
                aria-label={t('admin.audit_clean_older')}
              />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('admin.audit_clean_days_unit')}</span>
            </div>
          )}

          <label
            style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              background: auditCleanAll ? 'rgba(239,68,68,0.08)' : 'var(--surface)',
              cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="audit-clean-scope"
              checked={auditCleanAll}
              onChange={() => setAuditCleanAll(true)}
              style={{ marginTop: 2, accentColor: '#EF4444' }}
            />
            <span style={{ fontSize: '12.5px', color: 'var(--text)' }}>
              {t('admin.audit_clean_all')}
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--danger)', marginTop: 2 }}>
                {t('admin.audit_clean_all_hint')}
              </span>
            </span>
          </label>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setAuditCleanOpen(false)} disabled={auditCleaning}>
            {t('confirm.cancel')}
          </Button>
          <Button
            variant={auditCleanAll ? 'danger' : 'default'}
            onClick={handleCleanAudit}
            disabled={auditCleaning}
          >
            {auditCleaning ? t('admin.audit_clean_running') : t('admin.audit_clean_confirm')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
