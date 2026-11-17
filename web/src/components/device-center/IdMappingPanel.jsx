// Panel pemetaan nomor ID (Device Center → tab "Konflik Data").
//
// MASALAH YANG DISELESAIKAN:
//   Nomor employee adalah kunci LOKAL di tiap perangkat. Probe live ke dua
//   perangkat nyata menunjukkan nomor yang sama menunjuk orang berbeda:
//
//     masuk : 5=Juanto  6=Adit
//     keluar: 5=Adit    6=Chika
//
//   Perangkat tidak bisa mengganti employeeNo (Modify → badParameters), jadi
//   satu-satunya perbaikan adalah pemetaan di sisi APLIKASI: catat bahwa
//   "nomor X di perangkat D sebenarnya orang bernomor Y".
//
// ARAH PEMETAAN:
//   Nilai pemetaan SELALU nomor canonical yang dipakai di perangkat
//   REFERENSI (default "masuk"). Saran dihitung otomatis dengan mencocokkan
//   NAMA orang di perangkat referensi — nama tidak pernah konflik antar
//   perangkat karena perangkat menyimpan nama asli.
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Link2, Trash2, Wand2, AlertTriangle } from 'lucide-react';
import { useLang } from '../../hooks/useLang.js';
import { useToast } from '../../context/ToastContext.jsx';
import api from '../../services/api.js';
import { Panel, EmptyState } from './DevicePanels.jsx';

export default function IdMappingPanel({ conflicts, t, onChanged }) {
  const toast = useToast();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/device-center/id-alias/suggestions');
      setSuggestions(res.data?.data || []);
    } catch (err) {
      toast(err.serverMessage || err.message || t('dc.write_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const applyMapping = async (row) => {
    const key = `${row.deviceKey}:${row.deviceEmployeeNo}`;
    setBusyKey(key);
    try {
      await api.post('/device-center/id-alias', {
        device: row.deviceKey,
        deviceEmployeeNo: row.deviceEmployeeNo,
        employeeNo: row.employeeNo,
        note: `${row.name} — nomor ${row.deviceEmployeeNo} di ${row.deviceKey} → ${row.employeeNo}`,
      });
      toast(t('dc.id_map_applied_toast'), 'success', `${row.deviceKey}:${row.deviceEmployeeNo} → ${row.employeeNo}`);
      await loadSuggestions();
      onChanged?.();
    } catch (err) {
      toast(err.serverMessage || err.message || t('dc.write_failed'), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const removeMapping = async (row) => {
    const key = `${row.deviceKey}:${row.deviceEmployeeNo}`;
    setBusyKey(key);
    try {
      await api.delete('/device-center/id-alias', {
        params: { device: row.deviceKey, deviceEmployeeNo: row.deviceEmployeeNo },
      });
      toast(t('dc.id_map_removed'), 'success');
      await loadSuggestions();
      onChanged?.();
    } catch (err) {
      toast(err.serverMessage || err.message || t('dc.write_failed'), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const applyAll = async () => {
    const pending = suggestions.filter((s) => !s.applied);
    if (pending.length === 0) return;

    setBusyKey('__all__');
    let ok = 0;
    let fail = 0;
    for (const row of pending) {
      try {
        await api.post('/device-center/id-alias', {
          device: row.deviceKey,
          deviceEmployeeNo: row.deviceEmployeeNo,
          employeeNo: row.employeeNo,
          note: `${row.name} — nomor ${row.deviceEmployeeNo} di ${row.deviceKey} → ${row.employeeNo}`,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setBusyKey(null);

    if (fail === 0) toast(t('dc.id_map_bulk_done'), 'success', `${ok} pemetaan`);
    else toast(t('dc.id_map_bulk_done'), 'warning', `${ok} berhasil, ${fail} gagal`);
    await loadSuggestions();
    onChanged?.();
  };

  const pending = suggestions.filter((s) => !s.applied);
  const applied = suggestions.filter((s) => s.applied);
  const refKey = conflicts?.canonicalDeviceKey || 'masuk';

  if (loading && suggestions.length === 0) {
    return (
      <Panel title={t('dc.id_map_title')} subtitle={t('dc.id_map_hint')}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <div className="spinner" />
        </div>
      </Panel>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Panel title={t('dc.id_map_title')} subtitle={t('dc.id_map_hint')}>
        <EmptyState icon={CheckCircle2} title={t('dc.id_map_none')} hint={t('dc.id_map_none_hint')} />
      </Panel>
    );
  }

  const row = (s) => {
    const key = `${s.deviceKey}:${s.deviceEmployeeNo}`;
    const busy = busyKey === key || busyKey === '__all__';
    const isConflict = s.reason === 'conflict';

    return (
      <div
        key={key}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: s.applied
            ? 'color-mix(in srgb, var(--success) 8%, transparent)'
            : isConflict
              ? 'color-mix(in srgb, var(--danger) 8%, transparent)'
              : 'color-mix(in srgb, var(--warning) 8%, transparent)',
          border: `1px solid ${s.applied
            ? 'color-mix(in srgb, var(--success) 26%, transparent)'
            : isConflict
              ? 'color-mix(in srgb, var(--danger) 26%, transparent)'
              : 'color-mix(in srgb, var(--warning) 26%, transparent)'}`,
        }}
      >
        {s.applied ? (
          <CheckCircle2 size={17} style={{ color: 'var(--success)', flexShrink: 0 }} />
        ) : isConflict ? (
          <AlertTriangle size={17} style={{ color: 'var(--danger)', flexShrink: 0 }} />
        ) : (
          <Link2 size={17} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
            {s.name}
            <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8, fontSize: 11.5 }}>
              {s.applied
                ? t('dc.id_map_applied')
                : isConflict
                  ? t('dc.id_map_conflict')
                  : t('dc.id_map_only_one')}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            <span className="badge badge-gray" style={{ fontFamily: 'monospace' }}>
              {s.deviceKey}:{s.deviceEmployeeNo}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span className="badge badge-cyan" style={{ fontFamily: 'monospace' }}>
              {refKey}:{s.employeeNo}
            </span>
          </div>
        </div>

        {s.applied ? (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => removeMapping(s)}
            disabled={busy}
            title={t('dc.id_map_remove')}
          >
            <Trash2 size={13} />
            {t('dc.id_map_remove')}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => applyMapping(s)}
            disabled={busy}
          >
            <Link2 size={13} />
            {t('dc.id_map_apply')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel
        title={t('dc.id_map_title')}
        subtitle={t('dc.id_map_hint')}
        actions={
          pending.length > 0 && (
            <button
              className="btn btn-primary btn-sm"
              onClick={applyAll}
              disabled={busyKey !== null}
            >
              <Wand2 size={13} />
              {t('dc.id_map_bulk_apply')} ({pending.length})
            </button>
          )
        }
      >
        <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-muted)' }}>
          {/* t() hanya menerima key — placeholder diisi manual di sini. */}
          {String(t('dc.id_map_canonical_hint')).replace('{device}', refKey)}
        </p>

        {pending.length === 0 ? (
          // Semua pemetaan sudah diterapkan — jangan tampilkan "tidak ada
          // konflik", karena konflik NYATA masih ada, hanya sudah diperbaiki.
          <EmptyState
            icon={CheckCircle2}
            title={t('dc.id_map_all_applied')}
            hint={t('dc.id_map_all_applied_hint')}
          />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.map(row)}
          </div>
        )}
      </Panel>

      {applied.length > 0 && (
        <Panel title={`${t('dc.id_map_applied')} (${applied.length})`}>
          <div style={{ display: 'grid', gap: 10 }}>
            {applied.map(row)}
          </div>
        </Panel>
      )}
    </div>
  );
}
