// Banner-banner informasi pada panel webhook.
//
// Dipisah dari WebhookPanel supaya berkas utama tetap di bawah batas
// 250 baris (aturan CLAUDE.md).
import { Webhook, CheckCircle, AlertCircle } from 'lucide-react';
import { cardStyle } from './webhookStyles.js';

/** Banner utama: judul, deskripsi, dan endpoint receiver. */
export function WebhookIntro({ t, sessionId }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Webhook size={16} style={{ color: 'var(--cyan)' }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>{t('wa.webhook_title')}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '0 0 6px', lineHeight: 1.6 }}>
        {t('wa.webhook_desc')}
      </p>
      <div
        style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontFamily: 'monospace', wordBreak: 'break-all',
        }}
      >
        {t('wa.webhook_endpoint')}:{' '}
        {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/openwa
      </div>
      {sessionId && (
        <div
          style={{
            fontSize: 11, color: 'var(--text-muted)',
            fontFamily: 'monospace', marginTop: 4,
          }}
        >
          {t('wa.webhook_session')}: {sessionId}
        </div>
      )}
    </div>
  );
}

/** Notifikasi hasil aksi (sukses / error). */
export function WebhookNotice({ message }) {
  if (!message) return null;
  const isOk = message.type === 'success';
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
        background: isOk ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
        color: isOk ? 'var(--success)' : 'var(--danger)',
        border: '1px solid ' + (isOk ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'),
      }}
    >
      {isOk ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
      {message.text}
    </div>
  );
}

/**
 * Peringatan gateway OpenWA belum dikonfigurasi.
 * Penyebab error harus terlihat, bukan sekadar daftar webhook kosong.
 */
export function WebhookGatewayWarning({ t, gatewayError }) {
  if (!gatewayError) return null;
  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
        borderRadius: 'var(--radius-sm)', fontSize: 13,
        background: 'rgba(245,158,11,0.12)', color: 'var(--warning)',
        border: '1px solid rgba(245,158,11,0.35)',
      }}
    >
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {t('wa.webhook_gateway_missing_title')}
        </div>
        <div style={{ color: 'var(--text-sub)', lineHeight: 1.6 }}>{gatewayError}</div>
      </div>
    </div>
  );
}
