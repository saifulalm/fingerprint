// Riwayat event webhook yang diterima.
//
// Menampilkan event, waktu penerimaan, isi pesan, dan status (termasuk
// jumlah percobaan bila event pernah di-retry).
import { History } from 'lucide-react';
import { STATUS_COLORS } from './webhookStyles.js';

export default function WebhookHistory({ t, history }) {
  return (
    <div
      style={{
        background: 'var(--glass-bg)', backdropFilter: 'blur(20px)',
        borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <History size={15} style={{ color: 'var(--cyan)' }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{t('wa.webhook_history_title')}</span>
      </div>

      {history.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 12px', fontSize: 13 }}>
          {t('wa.webhook_history_empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
          {history.map((ev) => (
            <div
              key={ev.id}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px',
                borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
                border: '1px solid var(--border)', fontSize: 12, flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                  color: STATUS_COLORS[ev.status] || 'var(--text-sub)',
                  flexShrink: 0, paddingTop: 1,
                }}
              >
                {ev.event}
              </span>

              <span
                style={{
                  color: 'var(--text-muted)', flexShrink: 0,
                  fontSize: 10, paddingTop: 1,
                }}
              >
                {new Date(ev.receivedAt).toLocaleString('id-ID', {
                  dateStyle: 'short', timeStyle: 'medium',
                })}
              </span>

              {ev.body && (
                <span
                  style={{
                    color: 'var(--text-sub)', wordBreak: 'break-word',
                    flex: '1 1 160px', minWidth: 0,
                  }}
                >
                  {ev.body}
                </span>
              )}

              <span
                style={{
                  fontSize: 10, color: STATUS_COLORS[ev.status] || 'var(--text-muted)',
                  paddingTop: 1, flexShrink: 0,
                }}
              >
                {ev.status}{ev.attempts > 1 ? ` ×${ev.attempts}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
