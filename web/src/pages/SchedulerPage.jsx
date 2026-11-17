// Scheduler page — manage automated report delivery schedules
import { useState, useEffect } from 'react';
import { useLang } from '../hooks/useLang.js';
import {
  Calendar, Plus, Trash2, Play, Pause, Edit2,
  Clock, CheckCircle, XCircle, AlertCircle, X, Loader, Check,
  Mail, MessageSquare, Zap
} from 'lucide-react';
import api from '../services/api.js';

const PERIOD_OPTIONS = [
  { value: 'yesterday', label: { id: 'Kemarin (Yesterday)', en: 'Yesterday' } },
  { value: 'last_week', label: { id: '7 Hari Terakhir (Last 7 days)', en: 'Last 7 days' } },
  { value: 'last_month', label: { id: '30 Hari Terakhir (Last 30 days)', en: 'Last 30 days' } },
  { value: 'last_7d', label: { id: 'Hari Ini - 7 (Today - 7)', en: 'Today - 7' } },
  { value: 'last_30d', label: { id: 'Hari Ini - 30 (Today - 30)', en: 'Today - 30' } },
];

const CHANNEL_OPTIONS = [
  { value: 'email', label: { id: 'Email', en: 'Email' }, icon: Mail },
  { value: 'whatsapp', label: { id: 'WhatsApp', en: 'WhatsApp' }, icon: MessageSquare },
  { value: 'both', label: { id: 'Email + WhatsApp', en: 'Email + WhatsApp' }, icon: Zap },
];

const PRESET_CRON = [
  { label: { id: 'Setiap hari 07:00 WIB', en: 'Every day 07:00 WIB' }, expr: '0 7 * * *' },
  { label: { id: 'Setiap hari 08:00 WIB', en: 'Every day 08:00 WIB' }, expr: '0 8 * * *' },
  { label: { id: 'Setiap weekday 07:00', en: 'Every weekday 07:00' }, expr: '0 7 * * 1-5' },
  { label: { id: 'Setiap weekday 08:00', en: 'Every weekday 08:00' }, expr: '0 8 * * 1-5' },
  { label: { id: 'Setiap Senin 07:00', en: 'Every Monday 07:00' }, expr: '0 7 * * 1' },
  { label: { id: 'Setiap Jumat 16:00', en: 'Every Friday 16:00' }, expr: '0 16 * * 5' },
  { label: { id: 'Setiap tanggal 1 07:00', en: 'Every 1st of month 07:00' }, expr: '0 7 1 * *' },
];

function StatusBadge({ status }) {
  if (status === 'success') return (
    <span style={{
      fontSize: '11px', padding: '3px 10px', borderRadius: 'var(--radius-full)',
      background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)',
      fontWeight: 600, border: '1px solid rgba(16, 185, 129, 0.3)',
      display: 'inline-flex', alignItems: 'center', gap: '4px'
    }}>
      <CheckCircle size={10} />
    </span>
  );
  if (status === 'failed') return (
    <span style={{
      fontSize: '11px', padding: '3px 10px', borderRadius: 'var(--radius-full)',
      background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)',
      fontWeight: 600, border: '1px solid rgba(239, 68, 68, 0.3)',
      display: 'inline-flex', alignItems: 'center', gap: '4px'
    }}>
      <XCircle size={10} />
    </span>
  );
  return (
    <span style={{
      fontSize: '11px', padding: '3px 10px', borderRadius: 'var(--radius-full)',
      background: 'rgba(100, 116, 139, 0.15)', color: 'var(--text-muted)',
      fontWeight: 600, border: '1px solid rgba(100, 116, 139, 0.3)',
      display: 'inline-flex', alignItems: 'center', gap: '4px'
    }}>
      <Clock size={10} />
    </span>
  );
}

function EnabledBadge({ enabled }) {
  return (
    <span style={{
      fontSize: '10px', padding: '2px 8px', borderRadius: 'var(--radius-full)',
      background: enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.12)',
      color: enabled ? 'var(--success)' : 'var(--text-muted)',
      fontWeight: 600, border: '1px solid ' + (enabled ? 'rgba(16, 185, 129, 0.25)' : 'rgba(100, 116, 139, 0.25)'),
      textTransform: 'uppercase', letterSpacing: '0.5px'
    }}>
      {enabled ? 'ON' : 'OFF'}
    </span>
  );
}

function ScheduleForm({ edit, onSave, onCancel }) {
  const { t, lang } = useLang();
  const [form, setForm] = useState({
    name: '', cronExpr: '0 8 * * 1-5', period: 'yesterday',
    channel: 'email', recipients: '', lang: 'id', waGatewayUrl: '', enabled: true,
  });

  useEffect(() => {
    if (edit) {
      setForm({
        name: edit.name || '',
        cronExpr: edit.cronExpr || '0 8 * * 1-5',
        period: edit.period || 'yesterday',
        channel: edit.channel || 'email',
        recipients: edit.recipients || '',
        lang: edit.lang || 'id',
        // Server TIDAK pernah mengirim nilai gateway asli ke browser —
        // hanya versi tersamar (`_maskedWaGatewayUrl`). Kolom form karena
        // itu selalu kosong; nilai lama tetap tersimpan di server.
        waGatewayUrl: '',
        enabled: edit.enabled !== undefined ? edit.enabled : true,
      });
    } else {
      setForm({
        name: '', cronExpr: '0 8 * * 1-5', period: 'yesterday',
        channel: 'email', recipients: '', lang: 'id', waGatewayUrl: '', enabled: true,
      });
    }
  }, [edit]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError(t('sched.error_name_required')); return; }
    if (!form.cronExpr.trim()) { setError(t('sched.error_cron_required')); return; }
    if ((form.channel === 'email' || form.channel === 'both') && !form.recipients.trim()) {
      setError(t('sched.error_recipients_required')); return; }
    setSaving(true);
    setError('');
    try {
      // Kolom gateway yang dikosongkan berarti "tidak diubah" — jangan
      // kirim string kosong, karena itu akan menimpa nilai lama yang
      // benar dengan string kosong.
      const payload = { ...form };
      if (!payload.waGatewayUrl) delete payload.waGatewayUrl;

      let res;
      if (edit) { res = await api.put('/scheduler/' + edit.id, payload); }
      else { res = await api.post('/scheduler', payload); }
      if (res.error) { setError(res.error); return; }
      onSave();
    } catch (e) { setError(e.serverMessage || e.message); }
    setSaving(false);
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', marginBottom: '16px', overflow: 'hidden'
    }}>
      {/* Gradient header */}
      <div style={{
        background: 'var(--gradient-primary)', padding: '14px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#fff' }}>
          {edit ? t('sched.edit_schedule') : t('sched.new_schedule')}
        </h3>
        <button
          onClick={onCancel}
          aria-label={t('sched.aria_cancel_create')}
          style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '6px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center'
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Form body */}
      <div style={{ padding: '20px' }}>
        {error && (
          <div style={{
            padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)', fontSize: '13px', marginBottom: '16px',
            display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Schedule Name */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
            textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px'
          }}>
            {t('sched.schedule_name')}
          </label>
          <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)}
            placeholder={t('sched.name_placeholder')} />
        </div>

        {/* Preset Cron Pills */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
            textTransform: 'uppercase', display: 'block', marginBottom: '8px', letterSpacing: '0.5px'
          }}>
            {t('sched.time_preset')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {PRESET_CRON.map(p => {
              const isActive = form.cronExpr === p.expr;
              return (
                <button
                  key={p.expr}
                  onClick={() => set('cronExpr', p.expr)}
                  style={{
                    padding: '6px 14px', borderRadius: 'var(--radius-full)',
                    border: isActive ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: isActive ? 'rgba(99, 102, 241, 0.15)' : 'var(--surface)',
                    color: isActive ? 'var(--primary-light)' : 'var(--text-sub)',
                    fontSize: '12px', fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                >
                  {p.label[lang]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cron Expression Input */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
            textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px'
          }}>
            {t('sched.cron_expr')}
          </label>
          <input className="form-control" value={form.cronExpr} onChange={e => set('cronExpr', e.target.value)}
            placeholder="0 8 * * 1-5" style={{ fontFamily: 'monospace', letterSpacing: '1px' }} />
        </div>

        {/* Period + Language row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '12px', marginBottom: '14px' }}>
          <div>
            <label style={{
              fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
              textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px'
            }}>
              {t('sched.data_period')}
            </label>
            <select className="form-control" value={form.period} onChange={e => set('period', e.target.value)}>
              {PERIOD_OPTIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label[lang]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{
              fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
              textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px'
            }}>
              {t('sched.language')}
            </label>
            <select className="form-control" value={form.lang} onChange={e => set('lang', e.target.value)}>
              <option value="id">Indonesia</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        {/* Channel Selector */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
            textTransform: 'uppercase', display: 'block', marginBottom: '8px', letterSpacing: '0.5px'
          }}>
            {t('sched.channel')}
          </label>
          <div style={{ display: 'flex', gap: '10px' }}>
            {CHANNEL_OPTIONS.map(c => {
              const isActive = form.channel === c.value;
              const Icon = c.icon;
              return (
                <button
                  key={c.value}
                  onClick={() => set('channel', c.value)}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                    border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: isActive ? 'rgba(99, 102, 241, 0.12)' : 'var(--surface)',
                    color: isActive ? 'var(--primary-light)' : 'var(--text-sub)',
                    fontSize: '12px', fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.2s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}
                >
                  <Icon size={14} />
                  {c.label[lang]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Recipients */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
            textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px'
          }}>
            {t('sched.recipients')}
          </label>
          <input className="form-control" value={form.recipients} onChange={e => set('recipients', e.target.value)}
            placeholder={t('sched.recipients_placeholder')} />
        </div>

        {/* WhatsApp Gateway */}
        {(form.channel === 'whatsapp' || form.channel === 'both') && (
          <div style={{ marginBottom: '14px' }}>
            <label style={{
              fontSize: '11px', fontWeight: 700, color: 'var(--text-sub)',
              textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px'
            }}>
              {t('sched.wa_gateway')}
            </label>
            <input className="form-control" type="password" value={form.waGatewayUrl} onChange={e => set('waGatewayUrl', e.target.value)}
              placeholder="https://fonnte.com/api/send?token=xxx" autoComplete="new-password" />
            {/* Nilai gateway yang sudah tersimpan tidak pernah dikirim ke
                browser — hanya versi TERSAMAR. Kosongkan kolom ini berarti
                "tidak diubah", jadi nilai lama tetap aktif. */}
            {edit?.hasWaGatewayUrl && !form.waGatewayUrl && (
              <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Check size={12} />
                {t('settings.secret_configured') || (lang === 'id' ? 'Tersimpan di server (nilai tidak ditampilkan)' : 'Saved on server (value not displayed)')}
              </div>
            )}
            {edit?._maskedWaGatewayUrl && !form.waGatewayUrl && (
              <div style={{ fontSize: '11px', color: 'var(--text-sub)', opacity: 0.6, marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {edit._maskedWaGatewayUrl}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-outline btn-sm" onClick={onCancel}>
            {t('confirm.cancel')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{ minWidth: '80px' }}>
            {saving ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
            {t('btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SchedulerPage() {
  const { t, lang } = useLang();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editSchedule, setEditSchedule] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [toast, setToast] = useState(null);

  const toast_ = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/scheduler');
      setSchedules(Array.isArray(data) ? data : []);
    } catch (e) { toast_(e.serverMessage || e.message, false); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (s) => {
    setActionLoading(a => ({ ...a, [s.id]: true }));
    try {
      await api.post('/scheduler/' + s.id + '/toggle', { enabled: !s.enabled });
      await load();
      toast_(t('sched.toggle_' + (!s.enabled ? 'enabled' : 'disabled')));
    } catch (e) { toast_(e.serverMessage || e.message, false); }
    setActionLoading(a => ({ ...a, [s.id]: false }));
  };

  const handleTrigger = async (s) => {
    setActionLoading(a => ({ ...a, [s.id]: true }));
    try {
      await api.post('/scheduler/' + s.id + '/trigger');
      await load();
      toast_(t('sched.trigger_sending'));
    } catch (e) { toast_(e.serverMessage || e.message, false); }
    setActionLoading(a => ({ ...a, [s.id]: false }));
  };

  const handleDelete = async (s) => {
    if (!confirm(t('sched.confirm_delete') + ' "' + s.name + '"?')) return;
    try {
      // `api.delete` — bukan `api.del`. Axios tidak punya alias `del`, jadi
      // pemanggilannya melempar TypeError dan jadwal tidak pernah terhapus.
      await api.delete('/scheduler/' + s.id);
      await load();
      toast_(t('sched.deleted'));
    } catch (e) { toast_(e.serverMessage || e.message, false); }
  };

  const handleEdit = (s) => {
    setEditSchedule(s);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditSchedule(null);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditSchedule(null);
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

  const getChannelLabel = (channel) => {
    const opt = CHANNEL_OPTIONS.find(c => c.value === channel);
    return opt ? opt.label[lang] : channel;
  };

  return (
    <div style={{ padding: '20px', maxWidth: '960px', margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          padding: '12px 20px', borderRadius: 'var(--radius-md)', zIndex: 9999,
          background: toast.ok ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: '1px solid ' + (toast.ok ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'),
          color: toast.ok ? 'var(--success)' : 'var(--danger)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center',
          gap: '10px', fontSize: '13px', fontWeight: 500
        }}>
          {toast.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Page Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '20px', gap: '16px'
      }}>
        <div>
          <h1 style={{
            fontSize: '22px', fontWeight: 800, margin: 0,
            background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent', backgroundClip: 'text'
          }}>
            {t('page.scheduler.title')}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {t('page.scheduler.sub')}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleNew} style={{ flexShrink: 0 }}>
          <Plus size={14} />
          {t('sched.new_schedule')}
        </button>
      </div>

      {/* Form Panel */}
      {showForm && (
        <ScheduleForm
          edit={editSchedule}
          onSave={() => { handleCloseForm(); load(); }}
          onCancel={handleCloseForm}
        />
      )}

      {/* Cron Help Banner */}
      <div style={{
        background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)',
        borderRadius: 'var(--radius-sm)', padding: '12px 16px', fontSize: '12px',
        color: 'var(--text-sub)', marginBottom: '16px'
      }}>
        <strong style={{ color: 'var(--primary-light)' }}>{t('sched.cron_format')}:</strong>{' '}
        <code style={{
          background: 'rgba(99, 102, 241, 0.1)', padding: '2px 6px',
          borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--primary-light)', fontFamily: 'monospace'
        }}>min hour day month weekday</code>{' — '}
        {t('sched.wib_timezone')}.{' '}
        <a href="https://crontab.guru" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-light)' }}>
          crontab.guru
        </a>
      </div>

      {/* Content Area */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <Loader size={28} style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 12px' }} />
          <span style={{ fontSize: '13px' }}>{t('loading')}</span>
        </div>
      ) : schedules.length === 0 ? (
        /* Empty State */
        <div style={{
          textAlign: 'center', padding: '60px 24px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)'
        }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(99, 102, 241, 0.1)', margin: '0 auto 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Calendar size={28} style={{ stroke: 'var(--text-muted)' }} />
          </div>
          <p style={{ color: 'var(--text-sub)', margin: '0 0 6px', fontSize: '14px', fontWeight: 600 }}>
            {t('sched.empty_title')}
          </p>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '13px' }}>
            {t('sched.empty_sub')}
          </p>
        </div>
      ) : (
        /* Schedule List */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {schedules.map(s => (
            <div key={s.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: 0,
              opacity: s.enabled ? 1 : 0.55,
              transition: 'opacity 0.2s ease, border-color 0.2s ease',
              position: 'relative', overflow: 'hidden'
            }}>
              {/* Gradient top border accent */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                background: s.enabled ? 'var(--gradient-primary)' : 'var(--border)'
              }} />

              <div style={{ padding: '16px 16px 16px 18px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                {/* Main content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Name + badges row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>{s.name}</span>

                    {/* Channel badge */}
                    <span style={{
                      fontSize: '10px', padding: '3px 10px', borderRadius: 'var(--radius-full)',
                      background: 'rgba(99, 102, 241, 0.12)', color: 'var(--primary-light)',
                      fontWeight: 600, border: '1px solid rgba(99, 102, 241, 0.25)',
                      display: 'inline-flex', alignItems: 'center', gap: '4px'
                    }}>
                      {s.channel === 'email' ? <Mail size={10} /> : s.channel === 'whatsapp' ? <MessageSquare size={10} /> : <Zap size={10} />}
                      {getChannelLabel(s.channel)} {s.lang ? s.lang.toUpperCase() : ''}
                    </span>

                    <EnabledBadge enabled={s.enabled} />
                    <StatusBadge status={s.lastStatus} />
                  </div>

                  {/* Cron + period row */}
                  <div style={{
                    fontSize: '12px', color: 'var(--text-sub)', display: 'flex',
                    gap: '16px', flexWrap: 'wrap', marginBottom: '4px'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={11} style={{ stroke: 'var(--text-muted)', flexShrink: 0 }} />
                      <code style={{
                        background: 'rgba(99, 102, 241, 0.08)', padding: '2px 6px',
                        borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--primary-light)',
                        fontFamily: 'monospace', border: '1px solid rgba(99, 102, 241, 0.15)'
                      }}>{s.cronExpr}</code>
                    </span>
                    <span>{t('sched.to')}: {s.recipients || '-'}</span>
                    {s.lastRun && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {t('sched.last_run')}: {fmtDate(s.lastRun)}
                      </span>
                    )}
                  </div>

                  {/* Error message */}
                  {s.lastError && (
                    <div style={{
                      marginTop: '8px', fontSize: '11px', color: 'var(--danger)',
                      background: 'rgba(239, 68, 68, 0.08)', padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.2)',
                      display: 'flex', alignItems: 'center', gap: '6px'
                    }}>
                      <AlertCircle size={11} style={{ flexShrink: 0 }} />
                      {s.lastError}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleToggle(s)}
                    disabled={actionLoading[s.id]}
                    title={s.enabled ? t('sched.disable') : t('sched.enable')}
                    style={{
                      padding: '8px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                      background: 'var(--surface)', color: s.enabled ? 'var(--warning)' : 'var(--success)',
                      display: 'flex', alignItems: 'center', transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--border-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                  >
                    {actionLoading[s.id] ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : (s.enabled ? <Pause size={14} /> : <Play size={14} />)}
                  </button>

                  <button
                    onClick={() => handleEdit(s)}
                    title={t('btn.edit')}
                    style={{
                      padding: '8px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                      background: 'var(--surface)', color: 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--border-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                  >
                    <Edit2 size={14} />
                  </button>

                  <button
                    onClick={() => handleTrigger(s)}
                    disabled={actionLoading[s.id]}
                    title={t('sched.run_now')}
                    style={{
                      padding: '8px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                      background: 'var(--surface)', color: 'var(--primary-light)',
                      display: 'flex', alignItems: 'center', transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--border-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                  >
                    <Zap size={14} />
                  </button>

                  <button
                    onClick={() => handleDelete(s)}
                    title={t('btn.delete')}
                    style={{
                      padding: '8px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                      background: 'var(--surface)', color: 'var(--danger)',
                      display: 'flex', alignItems: 'center', transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--border-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
