// Dead-letter log — delivery webhook yang GAGAL di sisi gateway.
//
// Terpisah dari WebhookHistory (yang menampilkan event yang BERHASIL
// diterima aplikasi). Kegagalan delivery adalah masalah di sisi gateway:
// receiver mungkin mati, URL salah, atau signature ditolak. User harus
// bisa melihatnya tanpa perlu membuka dashboard gateway.
import { AlertTriangle } from 'lucide-react';

export default function WebhookFailures({ t, failures }) {
  return (
    <div
      style={{
        background: 'var(--glass-bg)', backdropFilter: 'blur(20px)',
        borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <AlertTriangle size={15} style={{ color: 'var(--danger)' }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{t('wa.webhook_failures_title')}</span>
        {failures.length > 0 && (
          <span
            style={{
              fontSize: 10, fontWeight: 700, color: 'var(--danger)',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-full)', padding: '2px 8px',
            }}
          >
            {failures.length}
          </span>
        )}
      </div>

      {failures.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 12px', fontSize: 13 }}>
          {t('wa.webhook_failures_empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {failures.map((f, i) => (
            <div
              key={f.deliveryId || `fail_${i}`}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px',
                borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
                border: '1px solid var(--border)', fontSize: 12, flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                  color: 'var(--danger)', flexShrink: 0, paddingTop: 1,
                }}
              >
                {f.event || '—'}
              </span>

              <span
                style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--danger)',
                  background: 'rgba(239, 68, 68, 0.12)', borderRadius: 'var(--radius-full)',
                  padding: '1px 7px', flexShrink: 0,
                }}
              >
                {f.status || 'ERR'}
              </span>

              <span
                style={{
                  color: 'var(--text-sub)', wordBreak: 'break-word',
                  flex: '1 1 160px', minWidth: 0,
                }}
              >
                {f.url || f.error || '—'}
              </span>

              <span
                style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  paddingTop: 1, flexShrink: 0,
                }}
              >
                {f.failedAt
                  ? new Date(f.failedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' })
                  : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
