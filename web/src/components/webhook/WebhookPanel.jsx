// WebhookPanel — manajemen webhook OpenWA di halaman WhatsApp.
//
// Fungsinya:
//   - menampilkan daftar webhook yang terdaftar di gateway,
//   - mendaftarkan webhook baru (URL receiver + daftar event + secret),
//   - menguji, mengaktifkan/menonaktifkan, menghapus webhook,
//   - menampilkan riwayat event yang diterima beserta statistiknya.
//
// Komponen ini dipecah menjadi beberapa file supaya tiap berkas tetap di
// bawah batas 250 baris (aturan CLAUDE.md):
//   - useWebhookActions.js → seluruh state + logika aksi
//   - WebhookForm.jsx      → formulir pendaftaran
//   - WebhookList.jsx      → daftar webhook + aksi
//   - WebhookHistory.jsx   → riwayat event
//   - WebhookBanners.jsx   → banner info, notifikasi, peringatan
//   - webhookStyles.js     → gaya bersama
import { useState } from 'react';
import { Plus, XCircle, RefreshCw, Loader } from 'lucide-react';
import { useLang } from '../../hooks/useLang.js';
import WebhookForm from './WebhookForm.jsx';
import WebhookList from './WebhookList.jsx';
import WebhookHistory from './WebhookHistory.jsx';
import WebhookFailures from './WebhookFailures.jsx';
import {
  WebhookIntro, WebhookNotice, WebhookGatewayWarning,
} from './WebhookBanners.jsx';
import { useWebhookActions } from './useWebhookActions.js';
import { btnStyle } from './webhookStyles.js';

export default function WebhookPanel() {
  const { t } = useLang();

  // Form state (lokal di panel — hook menangani data server)
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [useWildcard, setUseWildcard] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState(['message.received']);
  const [showForm, setShowForm] = useState(false);

  const {
    webhooks, sessionId, history, stats, catalog, failures,
    loading, busyId, message, gatewayError,
    loadAll, register, test, toggle, remove, rotate,
  } = useWebhookActions(t);

  const toggleEvent = (ev) => {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  };

  const handleRegister = async () => {
    const events = useWildcard ? ['*'] : selectedEvents;
    const ok = await register({ url, secret, events });
    if (ok) {
      setUrl('');
      setSecret('');
      setShowForm(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Banner informasi endpoint receiver */}
      <WebhookIntro t={t} sessionId={sessionId} />

      {/* Notifikasi aksi */}
      <WebhookNotice message={message} />

      {/* Peringatan gateway OpenWA belum dikonfigurasi */}
      <WebhookGatewayWarning t={t} gatewayError={gatewayError} />

      {/* Statistik event */}
      {stats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))',
            gap: 12,
          }}
        >
          <StatCard label={t('wa.webhook_stat_total')} value={stats.total} />
          <StatCard
            label={t('wa.webhook_stat_processed')}
            value={stats.byStatus?.find((s) => s.status === 'processed')?.count || 0}
            color="var(--success)"
          />
          <StatCard
            label={t('wa.webhook_stat_failed')}
            value={stats.byStatus?.find((s) => s.status === 'failed')?.count || 0}
            color="var(--danger)"
          />
          <StatCard
            label={t('wa.webhook_stat_duplicate')}
            value={stats.byStatus?.find((s) => s.status === 'duplicate')?.count || 0}
            color="var(--cyan)"
          />
        </div>
      )}

      {/* Tombol tambah & muat ulang */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
          style={{ ...btnStyle('var(--gradient-primary)'), opacity: showForm ? 0.7 : 1 }}
          aria-expanded={showForm}
        >
          {showForm ? <XCircle size={14} /> : <Plus size={14} />}
          {t('wa.webhook_add')}
        </button>
        <button
          onClick={loadAll}
          disabled={loading}
          style={btnStyle('var(--surface)', 'var(--text)')}
        >
          {loading
            ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <RefreshCw size={14} />}
          {t('wa.webhook_refresh')}
        </button>
      </div>

      {/* Formulir pendaftaran */}
      {showForm && (
        <WebhookForm
          t={t}
          url={url}
          setUrl={setUrl}
          secret={secret}
          setSecret={setSecret}
          useWildcard={useWildcard}
          setUseWildcard={setUseWildcard}
          selectedEvents={selectedEvents}
          toggleEvent={toggleEvent}
          catalog={catalog}
          loading={loading}
          onRegister={handleRegister}
        />
      )}

      {/* Daftar webhook */}
      <WebhookList
        t={t}
        webhooks={webhooks}
        busyId={busyId}
        onTest={test}
        onToggle={toggle}
        onRotate={rotate}
        onDelete={remove}
      />

      {/* Riwayat event */}
      <WebhookHistory t={t} history={history} />

      {/* Dead-letter log — delivery yang gagal di sisi gateway */}
      <WebhookFailures t={t} failures={failures} />
    </div>
  );
}

/** Kartu statistik kecil. */
function StatCard({ label, value, color }) {
  return (
    <div
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '12px 14px',
      }}
    >
      <div
        style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text)', marginTop: 4 }}>
        {value ?? 0}
      </div>
    </div>
  );
}
