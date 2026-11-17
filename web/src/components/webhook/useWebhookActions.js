// Hook state + aksi untuk manajemen webhook OpenWA.
//
// Semua logika (memuat data, mendaftarkan, menguji, mengaktifkan,
// merotasi secret, menghapus) dipisah dari komponen supaya
// WebhookPanel.jsx murni presentational dan tetap di bawah batas 250 baris
// (aturan CLAUDE.md).
import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';

export function useWebhookActions(t) {
  // ── State data ───────────────────────────────────────────────────────────
  const [webhooks, setWebhooks] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [catalog, setCatalog] = useState([]);
  // Delivery yang GAGAL di sisi gateway (dead-letter log). Endpoint ini
  // butuh kunci role ADMIN di gateway, jadi kegagalan di sini TIDAK boleh
  // menjatuhkan seluruh panel — sisanya tetap ditampilkan.
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  // Pesan error spesifik saat gateway OpenWA belum dikonfigurasi.
  const [gatewayError, setGatewayError] = useState(null);

  // `notify` harus stabil (useCallback). Kalau bukan, `loadAll` ikut berubah
  // tiap render → useEffect memanggil loadAll tanpa henti (loop).
  const notify = useCallback((type, text) => setMessage({ type, text }), []);

  // ── Muat data ────────────────────────────────────────────────────────────
  //
  // Catatan: endpoint `/whatsapp/webhooks` membalas 400 bila gateway OpenWA
  // belum dikonfigurasi (WA_GATEWAY_URL kosong di server/.env). Error itu
  // tidak boleh hilang diam-diam — user harus tahu kenapa daftar webhook
  // kosong, bukan mengira belum pernah mendaftarkan apa pun.
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hooksRes, histRes, statsRes, catRes, failRes] = await Promise.all([
        api.get('/whatsapp/webhooks').catch(() => null),
        api.get('/whatsapp/webhooks/history?limit=25').catch(() => null),
        api.get('/whatsapp/webhooks/stats').catch(() => null),
        api.get('/whatsapp/webhooks/events').catch(() => null),
        // Dead-letter log. Kegagalan di sini sengaja diabaikan (catch → null):
        // endpoint ini butuh kunci role ADMIN di gateway, dan tidak adanya
        // daftar kegagalan bukan kondisi fatal untuk panel.
        api.get('/whatsapp/webhooks/failures?limit=20').catch(() => null),
      ]);

      if (hooksRes?.data?.success) {
        setWebhooks(hooksRes.data.webhooks || []);
        setSessionId(hooksRes.data.sessionId || null);
        setGatewayError(null);
      } else {
        setWebhooks([]);
        setGatewayError(
          hooksRes?.serverMessage
          || hooksRes?.response?.data?.error
          || t('wa.webhook_gateway_missing'),
        );
      }
      if (histRes?.data?.success) setHistory(histRes.data.events || []);
      if (statsRes?.data?.success) setStats(statsRes.data.stats || null);
      if (catRes?.data?.success) setCatalog(catRes.data.events || []);
      if (failRes?.data?.success) setFailures(failRes.data.failures || []);
    } catch (err) {
      notify('error', err.serverMessage || err.message);
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Aksi ─────────────────────────────────────────────────────────────────
  /** Mendaftarkan webhook baru ke gateway. */
  const register = useCallback(async ({ url, secret, events }) => {
    if (!url.trim()) {
      notify('error', t('wa.webhook_url_required'));
      return false;
    }
    setLoading(true);
    try {
      const payload = { url: url.trim(), events };
      if (secret.trim()) payload.secret = secret.trim();

      const res = await api.post('/whatsapp/webhooks', payload);
      if (res.data?.success) {
        notify('success', t('wa.webhook_registered'));
        await loadAll();
        return true;
      }
      notify('error', res.data?.error || t('wa.error'));
      return false;
    } catch (err) {
      notify('error', err.serverMessage || err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadAll, notify, t]);

  /** Menguji delivery webhook (test delivery dari gateway). */
  const test = useCallback(async (id) => {
    setBusyId(id);
    try {
      const res = await api.post(`/whatsapp/webhooks/${id}/test`);
      const ok = res.data?.result?.success;
      notify(
        ok ? 'success' : 'error',
        ok ? t('wa.webhook_test_ok') : (res.data?.result?.error || t('wa.error')),
      );
      await loadAll();
    } catch (err) {
      notify('error', err.serverMessage || err.message);
    } finally {
      setBusyId(null);
    }
  }, [loadAll, notify, t]);

  /** Mengaktifkan / menonaktifkan webhook. */
  const toggle = useCallback(async (wh) => {
    setBusyId(wh.id);
    try {
      await api.put(`/whatsapp/webhooks/${wh.id}`, { active: !wh.active });
      notify('success', wh.active ? t('wa.webhook_disabled') : t('wa.webhook_enabled'));
      await loadAll();
    } catch (err) {
      notify('error', err.serverMessage || err.message);
    } finally {
      setBusyId(null);
    }
  }, [loadAll, notify, t]);

  /** Menghapus webhook dari gateway. */
  const remove = useCallback(async (wh) => {
    setBusyId(wh.id);
    try {
      await api.delete(`/whatsapp/webhooks/${wh.id}`);
      notify('success', t('wa.webhook_deleted'));
      await loadAll();
    } catch (err) {
      notify('error', err.serverMessage || err.message);
    } finally {
      setBusyId(null);
    }
  }, [loadAll, notify, t]);

  /** Merotasi secret webhook di gateway. */
  const rotate = useCallback(async (wh) => {
    setBusyId(wh.id);
    try {
      await api.post('/whatsapp/webhooks/rotate-secret', { id: wh.id });
      notify('success', t('wa.webhook_rotated'));
      await loadAll();
    } catch (err) {
      notify('error', err.serverMessage || err.message);
    } finally {
      setBusyId(null);
    }
  }, [loadAll, notify, t]);

  return {
    webhooks, sessionId, history, stats, catalog, failures,
    loading, busyId, message, gatewayError,
    loadAll, register, test, toggle, remove, rotate,
  };
}
