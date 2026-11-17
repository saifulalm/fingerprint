// Daftar webhook yang terdaftar di gateway OpenWA.
//
// Setiap baris menyediakan aksi: uji delivery, aktif/nonaktif, rotasi
// secret, dan hapus.
import {
  CheckCircle, XCircle, Loader, Play, ShieldCheck, Trash2,
} from 'lucide-react';
import { smallBtnStyle } from './webhookStyles.js';

export default function WebhookList({ t, webhooks, busyId, onTest, onToggle, onRotate, onDelete }) {
  return (
    <div
      style={{
        background: 'var(--glass-bg)', backdropFilter: 'blur(20px)',
        borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', padding: 20,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
        {t('wa.webhook_list_title')}
      </div>

      {webhooks.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px 12px', fontSize: 13 }}>
          {t('wa.webhook_empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {webhooks.map((wh) => (
            <WebhookRow
              key={wh.id}
              wh={wh}
              busy={busyId === wh.id}
              onTest={onTest}
              onToggle={onToggle}
              onRotate={onRotate}
              onDelete={onDelete}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Satu baris webhook dalam daftar. */
function WebhookRow({ wh, busy, onTest, onToggle, onRotate, onDelete, t }) {
  const btn = (bg, color = '#fff') =>
    smallBtnStyle(bg, color, {
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.6 : 1,
    });

  return (
    <div
      style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '12px 14px', background: 'var(--surface)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700,
            padding: '3px 9px', borderRadius: 'var(--radius-full)',
            background: wh.active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            color: wh.active ? 'var(--success)' : 'var(--danger)',
            border: '1px solid ' + (wh.active ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'),
          }}
        >
          {wh.active ? <CheckCircle size={11} /> : <XCircle size={11} />}
          {wh.active ? t('wa.webhook_active') : t('wa.webhook_inactive')}
        </span>

        <span
          style={{
            fontSize: 12, fontFamily: 'monospace', color: 'var(--text-sub)',
            wordBreak: 'break-all', minWidth: 0, flex: '1 1 200px',
          }}
        >
          {wh.url}
        </span>

        {wh.managed && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'var(--cyan)', flexShrink: 0,
            }}
          >
            <ShieldCheck size={11} />
            {t('wa.webhook_managed')}
          </span>
        )}
      </div>

      {/* Daftar event yang disubscribe */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(wh.events || []).map((ev) => (
          <span
            key={ev}
            style={{
              fontSize: 10, fontFamily: 'monospace', padding: '2px 7px',
              borderRadius: 'var(--radius-xs)', background: 'rgba(99,102,241,0.1)',
              color: 'var(--primary)', border: '1px solid rgba(99,102,241,0.2)',
            }}
          >
            {ev}
          </span>
        ))}
      </div>

      {/* Aksi baris */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button
          onClick={() => onTest(wh.id)}
          disabled={busy}
          style={btn('var(--primary)')}
          aria-label={t('wa.webhook_test')}
        >
          {busy
            ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} />
            : <Play size={11} />}
          {t('wa.webhook_test')}
        </button>

        <button
          onClick={() => onToggle(wh)}
          disabled={busy}
          style={btn('var(--surface)', 'var(--text)')}
          aria-label={t('wa.webhook_toggle')}
        >
          {t('wa.webhook_toggle')}
        </button>

        <button
          onClick={() => onRotate(wh)}
          disabled={busy}
          style={btn('var(--surface)', 'var(--text)')}
          aria-label={t('wa.webhook_rotate')}
        >
          <ShieldCheck size={11} />
          {t('wa.webhook_rotate')}
        </button>

        <button
          onClick={() => onDelete(wh)}
          disabled={busy}
          style={btn('var(--danger)')}
          aria-label={t('wa.webhook_delete')}
        >
          {busy
            ? <Loader size={11} style={{ animation: 'spin 1s linear infinite' }} />
            : <Trash2 size={11} />}
          {t('wa.webhook_delete')}
        </button>
      </div>
    </div>
  );
}
