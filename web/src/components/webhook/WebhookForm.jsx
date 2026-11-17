// Formulir pendaftaran webhook OpenWA.
//
// Memisahkan form dari panel utama supaya WebhookPanel.jsx tetap ringkas
// (aturan CLAUDE.md: file > 250 baris harus dipecah).
import { Loader, Plus } from 'lucide-react';
import { btnStyle, cardStyle } from './webhookStyles.js';

export default function WebhookForm({
  t,
  url,
  setUrl,
  secret,
  setSecret,
  useWildcard,
  setUseWildcard,
  selectedEvents,
  toggleEvent,
  catalog,
  loading,
  onRegister,
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
        {t('wa.webhook_form_title')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* URL receiver — wajib diisi */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>
            {t('wa.webhook_url')}
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://domain-anda.com/api/webhooks/openwa"
            className="form-control"
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('wa.webhook_url_hint')}
          </div>
        </div>

        {/* Secret HMAC — opsional tapi sangat disarankan */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>
            {t('wa.webhook_secret')}
          </label>
          <input
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={t('wa.webhook_secret_placeholder')}
            className="form-control"
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('wa.webhook_secret_hint')}
          </div>
        </div>

        {/* Wildcard event */}
        <div>
          <label
            style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-sub)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <input
              type="checkbox"
              checked={useWildcard}
              onChange={(e) => setUseWildcard(e.target.checked)}
              style={{ width: 'auto' }}
            />
            {t('wa.webhook_all_events')}
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('wa.webhook_wildcard_hint')}
          </div>
        </div>

        {/* Pilihan event — disembunyikan bila wildcard aktif */}
        {!useWildcard && catalog.length > 0 && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>
              {t('wa.webhook_events')}
            </label>
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6,
                maxHeight: 150, overflowY: 'auto',
              }}
            >
              {catalog.map((ev) => {
                const on = selectedEvents.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => toggleEvent(ev)}
                    aria-pressed={on}
                    style={{
                      padding: '4px 10px', borderRadius: 'var(--radius-full)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: on ? 'rgba(99,102,241,0.15)' : 'var(--surface)',
                      color: on ? 'var(--primary)' : 'var(--text-sub)',
                      border: '1px solid ' + (on ? 'rgba(99,102,241,0.35)' : 'var(--border)'),
                    }}
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={onRegister}
          disabled={loading || !url.trim()}
          className="btn btn-success"
          style={{
            ...btnStyle('var(--success)'),
            opacity: (loading || !url.trim()) ? 0.6 : 1,
            alignSelf: 'flex-start',
          }}
        >
          {loading
            ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <Plus size={14} />}
          {t('wa.webhook_register')}
        </button>
      </div>
    </div>
  );
}
