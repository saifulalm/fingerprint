// Devices page — unified dark glass theme
import { useState, useEffect } from 'react';
import { useLang } from '../hooks/useLang.js';
import { Monitor, Clock } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

export default function DevicesPage() {
  const toast = useToast();
  const { t } = useLang();
  const [devices, setDevices] = useState({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/devices');
      setDevices(res.data);
    } catch (err) {
      // Error harus terlihat user, bukan hanya di console browser.
      toast(err.serverMessage || err.message || 'Gagal memuat status perangkat', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const items = [
    { key: 'masuk', label: t('dev.masuk') || 'Fingerprint Masuk', color: 'var(--success)' },
    { key: 'keluar', label: t('dev.keluar') || 'Fingerprint Keluar', color: 'var(--danger)' },
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', margin: 0, marginBottom: 6 }}>
          {t('page.devices') || 'Perangkat'}
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
          {t('dev.header.subtitle') || 'Monitor status perangkat fingerprint absensi'}
        </p>
      </div>

      {/* Device Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {items.map(({ key, label, color }) => {
          const d = devices[key];
          const online = d?.status === 'online';

          return (
            <div
              key={key}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '24px',
                position: 'relative',
                overflow: 'hidden',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              {/* Gradient left-border accent */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '3px',
                background: online ? color : 'var(--border)',
                borderRadius: 'var(--radius-xs) 0 0 var(--radius-xs)',
              }} />

              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                {/* Device icon with glow */}
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 'var(--radius-md)',
                  background: online ? `color-mix(in srgb, ${color} 15%, transparent)` : 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: online ? `0 0 20px color-mix(in srgb, ${color} 30%, transparent)` : 'none',
                  flexShrink: 0,
                }}>
                  <Monitor
                    size={26}
                    style={{
                      stroke: online ? color : 'var(--text-muted)',
                      filter: online ? `drop-shadow(0 0 6px ${color})` : 'none',
                    }}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                    {label}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    color: 'var(--text-muted)',
                    marginTop: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {d?.ip || '—'}
                  </div>
                </div>

                {/* Status badge */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: online
                      ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                      : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                    color: online ? 'var(--success)' : 'var(--danger)',
                    border: `1px solid ${online ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--danger) 30%, transparent)'}`,
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: online ? 'var(--success)' : 'var(--danger)',
                    boxShadow: online ? '0 0 6px var(--success)' : 'none',
                    animation: online ? 'pulse-dot-opacity 2s ease-in-out infinite' : 'none',
                  }} />
                  {online
                    ? (t('dev.online') || 'Online')
                    : (t('dev.offline') || 'Offline')}
                </span>
              </div>

              {/* Info grid — online */}
              {online ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    { lbl: t('dev.name') || 'Nama Device', val: d?.deviceName || '—' },
                    { lbl: t('dev.model') || 'Model', val: d?.model || '—' },
                    { lbl: t('dev.serial') || 'Serial Number', val: d?.serialNumber || '—', mono: true },
                    { lbl: t('dev.firmware') || 'Firmware', val: d?.firmwareVersion || '—', mono: true },
                  ].map(({ lbl, val, mono }, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '12px 14px',
                        background: 'var(--bg)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        marginBottom: 5,
                      }}>
                        {lbl}
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        color: 'var(--text)',
                        wordBreak: 'break-all',
                        fontFamily: mono ? 'monospace' : 'inherit',
                        lineHeight: 1.4,
                      }}>
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Warning message — offline */
                <div style={{
                  padding: 16,
                  background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
                }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
                    {t('dev.offline') || 'Offline'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {d?.error || (t('dev.check_connection') || 'Periksa koneksi jaringan ke perangkat')}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer info bar */}
      <div style={{
        marginTop: 20,
        padding: '12px 18px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        backdropFilter: 'blur(8px)',
      }}>
        <Clock size={15} style={{ stroke: 'var(--text-muted)', flexShrink: 0 }} />
        {t('dev.footer.note') || 'Status terakhir diperbarui secara otomatis saat halaman dimuat. Refresh halaman untuk memperbarui.'}
      </div>

      {/* Animations */}
      <style>{`
        /* PENTING: nama keyframes ini HARUS berbeda dari 'pulse-dot' global
           di index.css (yang menganimasikan box-shadow glow). Kalau nama sama,
           definisi halaman ini menimpa yang global dan glow hilang.
           'pulse-dot-opacity' hanya mengubah opasitas titik status. */
        @keyframes pulse-dot-opacity {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
