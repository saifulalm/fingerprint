// WhatsApp page — dual-mode: OpenWA gateway + Baileys
import { useState, useEffect, useRef } from 'react';
import { useLang } from '../hooks/useLang.js';
import { Plug, Unplug, Send, CheckCircle, XCircle, Loader, AlertCircle, Clock, Smartphone, RefreshCw, MessageSquare as MessageSquareIcon, Settings as SettingsIcon, Webhook as WebhookIcon } from 'lucide-react';
import SettingsPanel from '../components/SettingsPanel.jsx';
import WebhookPanel from '../components/webhook/WebhookPanel.jsx';
import api from '../services/api.js';

const STATUS_STYLES = {
  connected:    { color: 'var(--success)', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
  disconnected: { color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
  connecting:   { color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  error:       { color: 'var(--primary)', bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)' },
  gateway_ready:{ color: 'var(--cyan)', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.3)' },
};

// Wrapper request untuk halaman ini.
//
// SEBELUMNYA memakai `fetch()` mentah. Konsekuensinya:
//   1. Token kedaluwarsa (401) tidak memicu redirect ke /login.
//   2. `err.serverMessage` tidak pernah terisi, sehingga pesan error server
//      (mis. "Gateway belum dikonfigurasi") hilang dan user hanya melihat
//      "Failed to fetch" — tidak bisa membedakan "belum setup" dari
//      "server mati".
//
// Sekarang memakai instance axios yang sama dengan halaman lain, sehingga
// header auth, interceptor 401, dan err.serverMessage otomatis berlaku.
//
// Kontrak fungsi dipertahankan: mengembalikan objek { ok, status, json() }
// supaya pemanggil tidak perlu diubah.
function apiFetch(path, options = {}) {
  const { method = 'GET', body, ...rest } = options;
  // Instance axios memakai baseURL '/api', tapi pemanggil lama menulis path
  // lengkap ('/api/whatsapp/status'). Tanpa normalisasi, URL akhirnya
  // '/api/api/whatsapp/status' dan endpoint 404.
  const url = path.startsWith('/api/') ? path.slice(4) : path;
  const request = api.request({
    url,
    method,
    ...rest,
    ...(body !== undefined ? { data: body } : {}),
  });
  return request.then(
    (res) => ({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.data,
    }),
    (err) => {
      // Error dilempar apa adanya supaya pemanggil tetap bisa membaca
      // err.message / err.serverMessage (diisi interceptor).
      throw err;
    }
  );
}

export default function WhatsAppPage() {
  const { t } = useLang();
  const [status, setStatus] = useState('disconnected');
  const [mode, setMode] = useState('baileys');
  const [gatewayConfigured, setGatewayConfigured] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sendLoading, setSendLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sendResult, setSendResult] = useState(null);
  const [qrUrl, setQrUrl] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  // Tab halaman WhatsApp: 'main' = koneksi & kirim pesan, 'settings' =
  // konfigurasi sistem (SMTP, WA, Umum), 'webhook' = manajemen webhook
  // OpenWA. Ini satu-satunya tempat pengaturan — tidak ada lagi halaman
  // /settings terpisah di navigasi.
  const [tab, setTab] = useState('main');
  // Menyimpan status terakhir agar polling 5 detik tidak mengulang log.
  const prevStatusRef = useRef('disconnected');

  const cfg = STATUS_STYLES[status] || STATUS_STYLES.disconnected;

  const addLog = (msg, type) => {
    const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ message: msg, type: type || 'info', timestamp: ts }, ...prev].slice(0, 20));
  };

  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/api/whatsapp/status');
      const data = await res.json();
      if (res.ok) {
        const newStatus = data.status || 'disconnected';
        // Bandingkan dengan status TERAKHIR yang disimpan di ref — bukan closure
        // `status` yang basi, supaya log tidak mengulang tiap 5 detik.
        // Ref (bukan setState updater) dipakai karena addLog() adalah side effect
        // dan updater React boleh dipanggil dua kali di StrictMode.
        if (newStatus !== prevStatusRef.current) {
          const prev = prevStatusRef.current;
          prevStatusRef.current = newStatus;
          if (newStatus === 'connected') addLog(t('wa.connected_log'), 'success');
          else if (newStatus === 'disconnected' && prev === 'connected') addLog(t('wa.disconnected_log'), 'error');
          else if (newStatus === 'connecting') addLog(t('wa.connecting_log') || 'Connecting...', 'info');
        }
        setStatus(newStatus);
        setMode(data.mode || 'baileys');
        setGatewayConfigured(data.isGatewayConfigured || false);
        // URL gateway diambil dari gatewayStatus.gateway. SEBELUMNYA field ini
        // tidak pernah diisi backend, sehingga blok "OpenWA Gateway" tidak
        // pernah tampil walau gateway sudah terkonfigurasi.
        setGatewayUrl(data.gatewayStatus?.gateway || null);
        setDeviceInfo(data.deviceInfo || null);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  const fetchQR = async () => {
    setQrLoading(true);
    try {
      const res = await apiFetch('/api/whatsapp/qr');
      const data = await res.json();
      if (res.ok && data.qr) {
        setQrUrl(data.qr);
      } else if (data.status === 'connected') {
        setQrUrl(null);
        addLog(t('wa.connected'), 'success');
      }
    } catch {
      setQrUrl(null);
    }
    setQrLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Ambil QR saat belum terhubung, sedang menghubungkan, atau gateway siap
    if (status === 'disconnected' || status === 'connecting' || status === 'gateway_ready') {
      fetchQR();
    }
  }, [status]);

  const handleConnect = async (fresh = false) => {
    // PENTING: `fresh` HARUS boolean. Kalau handler langsung dipasang sebagai
    // onClick={handleConnect}, React akan meneruskan SyntheticEvent ke sini dan
    // JSON.stringify({ fresh: event }) meledak dengan
    // "Converting circular structure to JSON" (React Fiber membulat).
    const useFresh = fresh === true;
    setLoading(true);
    addLog(t('wa.connecting'), 'info');
    try {
      const res = await apiFetch('/api/whatsapp/connect', {
        method: 'POST',
        body: { fresh: useFresh },
      });
      const data = await res.json();
      const msg = data.message || (res.ok ? t('wa.connected_log') : t('wa.error'));
      const type = res.ok ? 'success' : 'error';
      addLog(msg, type);
      if (data.gatewayUrl) setGatewayUrl(data.gatewayUrl);
      if (data.mode) setMode(data.mode);
      // Server mengembalikan QR langsung pada response connect (mode Baileys)
      if (data.qr) {
        setQrUrl(data.qr);
        addLog(t('wa.qr_ready'), 'info');
      }
      await fetchStatus();
    } catch (err) {
      addLog(t('wa.error') + ': ' + err.message, 'error');
    }
    setLoading(false);
  };

  /** Hapus sesi pairing lama lalu buat QR baru dari nol */
  const handleResetPairing = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/whatsapp/reset', { method: 'POST' });
      setQrUrl(null);
      addLog(t('wa.session_reset'), 'info');
      await handleConnect(true);
    } catch (err) {
      addLog(t('wa.error') + ': ' + err.message, 'error');
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    addLog(t('wa.disconnecting'), 'info');
    try {
      const res = await apiFetch('/api/whatsapp/disconnect', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setQrUrl(null);
        addLog(t('wa.disconnected_log'), 'success');
      } else {
        addLog(data.message || t('wa.error'), 'error');
      }
    } catch (err) {
      addLog(t('wa.error') + ': ' + err.message, 'error');
    }
    setLoading(false);
    await fetchStatus();
  };

  const handleSend = async () => {
    if (!phone.trim() || !message.trim()) return;
    setSendLoading(true);
    setSendResult(null);
    try {
      const res = await apiFetch('/api/whatsapp/send', {
        method: 'POST',
        body: { to: phone.trim(), text: message.trim() },
      });
      const data = await res.json();
      if (res.ok) {
        setSendResult({ ok: true, msg: t('wa.send_success') });
        addLog(t('wa.send_success') + ' → ' + phone.trim(), 'success');
        setPhone('');
        setMessage('');
      } else {
        setSendResult({ ok: false, msg: data.error || t('wa.send_failed') });
        addLog(t('wa.send_failed') + ': ' + (data.error || t('wa.error')), 'error');
      }
    } catch (err) {
      setSendResult({ ok: false, msg: err.message });
      addLog(t('wa.error') + ': ' + err.message, 'error');
    }
    setSendLoading(false);
  };

  const isConnected = status === 'connected';
  const logType = (type) => {
    if (type === 'success') return 'var(--success)';
    if (type === 'error') return 'var(--danger)';
    return 'var(--text-sub)';
  };

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{t('wa.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 6 }}>{t('wa.sub')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Switcher tab: WhatsApp vs Pengaturan (satu-satunya tempat pengaturan). */}
          <div style={{
            display: 'inline-flex', gap: '4px', padding: '4px', borderRadius: 'var(--radius-md)',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
          }}>
            {[
              { key: 'main', label: t('wa.tab_main'), icon: MessageSquareIcon },
              { key: 'webhook', label: t('wa.tab_webhook') || 'Webhook', icon: WebhookIcon },
              { key: 'settings', label: t('wa.tab_settings') || 'Pengaturan', icon: SettingsIcon },
            ].map(tb => {
              const Icon = tb.icon;
              const active = tab === tb.key;
              return (
                <button
                  key={tb.key}
                  onClick={() => setTab(tb.key)}
                  aria-pressed={active}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '7px',
                    padding: '8px 14px', border: 'none', borderRadius: 'var(--radius-sm)',
                    background: active ? 'var(--gradient-primary)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-sub)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                    boxShadow: active ? '0 4px 14px rgba(99,102,241,0.35)' : 'none',
                  }}
                >
                  <Icon size={15} />
                  {tb.label}
                </button>
              );
            })}
          </div>

          {tab === 'main' && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 'var(--radius-full)',
              background: cfg.bg, border: '1px solid ' + cfg.border, fontSize: 13, fontWeight: 700, color: cfg.color
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, boxShadow: '0 0 8px ' + cfg.color }} />
              {(t('wa.' + status) || status)}
              {mode === 'gateway' && ' (Gateway)'}
            </div>
          )}
        </div>
      </div>

      {tab === 'main' && (
      <>
      {/* Status Card */}
      <div style={{
        background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', borderRadius: 'var(--radius)',
        border: '1px solid var(--glass-border)', borderTop: '3px solid ' + cfg.color, padding: 24, marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap'
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 'var(--radius-lg)', background: cfg.bg, border: '1px solid ' + cfg.border,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          {status === 'connecting' && <Loader size={26} style={{ color: cfg.color, animation: 'spin 1s linear infinite' }} />}
          {status === 'connected' && <CheckCircle size={26} style={{ color: cfg.color }} />}
          {status === 'error' && <AlertCircle size={26} style={{ color: cfg.color }} />}
          {(status === 'disconnected' || status === 'gateway_ready') && <XCircle size={26} style={{ color: cfg.color }} />}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            {t('wa.status') || 'Connection Status'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>
            {(t('wa.' + status) || status)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 4 }}>
            {t('wa.' + status + '_desc')}
          </div>
          {deviceInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              <Smartphone size={13} />
              {deviceInfo.name || deviceInfo.gateway || deviceInfo.session || '-'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isConnected ? (
            <button onClick={handleDisconnect} disabled={loading} className="btn btn-danger" style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Unplug size={14} />}
              {t('wa.disconnect')}
            </button>
          ) : (
            <button onClick={() => handleConnect()} disabled={loading || status === 'connecting'} className="btn btn-success" style={{ opacity: (loading || status === 'connecting') ? 0.6 : 1 }}>
              {loading ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={14} />}
              {status === 'connecting' ? (t('wa.connecting') || 'Connecting...') : t('wa.connect') || 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Gateway Info */}
      {gatewayUrl && (
        <div style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 20, fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--cyan)', fontWeight: 600, marginBottom: 4 }}>OpenWA Gateway</div>
          <div style={{ color: 'var(--text-sub)', marginBottom: 4 }}>{gatewayUrl}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('wa.openwa_desc')}</div>
        </div>
      )}

      {/* QR Section — tampil saat belum terhubung, sedang pairing, atau gateway siap */}
      {(status === 'disconnected' || status === 'connecting' || status === 'gateway_ready') && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RefreshCw size={16} style={{ color: 'var(--cyan)' }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{t('wa.qr_title')}</span>
            </div>
            {qrUrl ? (
              <div style={{ background: 'white', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 12, fontWeight: 600 }}>
                  {t('wa.scan_instruction')}
                </div>
                <img src={qrUrl} alt="QR" style={{ width: 180, height: 180, display: 'block', margin: '0 auto', borderRadius: 'var(--radius-sm)' }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                  <button onClick={fetchQR} disabled={qrLoading} style={{
                    padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)', color: 'var(--text)', cursor: qrLoading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: qrLoading ? 0.6 : 1
                  }}>
                    {qrLoading ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
                    {t('wa.refresh_qr') || 'Refresh QR'}
                  </button>
                  <button onClick={handleResetPairing} disabled={loading} style={{
                    padding: '8px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)', color: 'var(--text)', cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: loading ? 0.6 : 1
                  }}>
                    {loading ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
                    {t('wa.restart_pairing') || 'Mulai Ulang Pairing'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: 13 }}>
                <div>{t('wa.no_qr') || 'QR code akan muncul setelah gateway siap'}</div>
                <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => handleConnect(true)} disabled={loading} className="btn btn-primary btn-sm" style={{ opacity: loading ? 0.6 : 1 }}>
                    {loading ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={12} />}
                    {t('wa.start_pairing') || 'Mulai Pairing'}
                  </button>
                </div>
                {!gatewayConfigured && (
                  <div style={{ marginTop: 8, fontSize: 11, background: 'rgba(245,158,11,0.08)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', color: 'var(--warning)' }}>
                    {t('wa.gateway_hint') || 'Configure WA_GATEWAY_URL in server .env for OpenWA gateway'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 20 }}>
        {/* Send Card */}
        <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Send size={16} style={{ color: 'var(--primary)' }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{t('wa.send_test')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>{t('wa.phone') || 'Phone Number'}</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('wa.phone_placeholder') || '6281234567890'} className="form-control" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>{t('wa.message')}</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={t('wa.message_placeholder') || 'Type message...'} rows={4} className="form-control" style={{ minHeight: 100, resize: 'vertical' }} />
            </div>
            {sendResult && (
              <div style={{
                padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                background: sendResult.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                color: sendResult.ok ? 'var(--success)' : 'var(--danger)',
                border: '1px solid ' + (sendResult.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'),
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                {sendResult.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
                {sendResult.msg}
              </div>
            )}
            <button onClick={handleSend} disabled={sendLoading || !phone.trim() || !message.trim() || !isConnected}
              className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', opacity: (sendLoading || !isConnected) ? 0.5 : 1 }}>
              {sendLoading ? <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
              {t('wa.send')}
            </button>
            {!isConnected && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0', margin: 0 }}>
                {t('wa.connect_first')}
              </p>
            )}
          </div>
        </div>

        {/* Logs Card */}
        <div style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', padding: 24, maxHeight: 400, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={16} style={{ color: 'var(--cyan)' }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{t('wa.log') || 'Connection Log'}</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {logs.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                {t('wa.log_empty') || 'No activity yet'}
              </div>
            ) : logs.map((log, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'monospace' }}>{log.timestamp}</span>
                <span style={{ color: logType(log.type) }}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      </>
      )}

      {/* Tab Webhook — manajemen webhook OpenWA (registrasi, uji, riwayat).
          Komponen dipisah ke file sendiri supaya halaman ini tidak
          melewati batas 250 baris. */}
      {tab === 'webhook' && (
        <WebhookPanel />
      )}

      {/* Tab Pengaturan — satu-satunya tempat konfigurasi sistem
          (SMTP/Email, WhatsApp, Umum). Tidak ada lagi halaman
          /settings terpisah di navigasi sidebar. */}
      {tab === 'settings' && (
        <SettingsPanel showHeader={false} />
      )}

    </div>
  );
}
