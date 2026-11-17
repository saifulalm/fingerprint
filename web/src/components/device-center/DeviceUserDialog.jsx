// Dialog ubah nama pengguna di perangkat.
// Memakai useDialogA11y agar punya role="dialog", Escape, focus trap,
// scroll lock, dan fokus kembali ke pemicu.
import { useState, useEffect, useRef } from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import { useLang } from '../../hooks/useLang.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDialogA11y } from '../../hooks/useDialogA11y.js';
import api from '../../services/api.js';

export default function DeviceUserDialog({ open, deviceKey, user, onClose, onSaved }) {
  const { t } = useLang();
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useDialogA11y(open, onClose, triggerRef);

  // Isi ulang field setiap kali user/dialog yang aktif berubah.
  // Kalau tidak, dialog reopened untuk user lain masih menampilkan nama lama.
  useEffect(() => {
    if (open && user) setName(user.name || '');
  }, [open, user]);

  if (!open || !user) return null;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast(t('dc.name_required'), 'error');
      return;
    }
    if (trimmed === (user.name || '').trim()) {
      toast(t('dc.same_name'), 'info');
      return;
    }
    setSaving(true);
    try {
      await api.put('/device-center/users', {
        device: deviceKey,
        employeeNo: user.employeeNo,
        name: trimmed,
      });
      toast(t('dc.saved_to_device'), 'success', `${deviceKey} · ${user.employeeNo}`);
      onSaved?.();
    } catch (err) {
      toast(
        err.serverMessage || err.message || t('dc.write_failed'),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAll = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast(t('dc.name_required'), 'error');
      return;
    }
    setSyncing(true);
    try {
      const res = await api.post('/device-center/sync-name', {
        employeeNo: user.employeeNo,
        name: trimmed,
      });
      const results = res.data?.results || [];
      const ok = results.filter((r) => r.success).length;
      const failed = results.filter((r) => r.success === false).length;
      if (failed === 0) {
        toast(t('dc.sync_done'), 'success', `${ok} perangkat diperbarui`);
      } else {
        toast(t('dc.sync_partial'), 'warning', `${ok} berhasil, ${failed} gagal`);
      }
      onSaved?.();
    } catch (err) {
      toast(err.serverMessage || err.message || t('dc.write_failed'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const busy = saving || syncing;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(2, 6, 16, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('dc.edit_name')}
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 24px 60px rgba(0,0,0,.45)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 18px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {t('dc.edit_name')}
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {deviceKey} · {t('dc.user_no')} {user.employeeNo}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('det.close')}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-sub)',
              cursor: 'pointer',
              padding: 6,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ padding: 18 }}>
          <label
            htmlFor="dc-user-name"
            style={{
              display: 'block',
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--text-sub)',
              marginBottom: 6,
            }}
          >
            {t('dc.user_name')}
          </label>
          <input
            id="dc-user-name"
            className="form-control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleSave(); }}
            disabled={busy}
            autoFocus
            style={{ width: '100%' }}
          />

          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
              fontSize: 11.5,
              color: 'var(--text-sub)',
            }}
          >
            {t('dc.unsupported_note')}
          </div>

          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            {t('dc.sync_all_hint')}
          </div>
        </div>

        <footer
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            padding: '14px 18px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('confirm.cancel')}
          </button>
          <button
            className="btn btn-outline"
            onClick={handleSyncAll}
            disabled={busy}
            title={t('dc.sync_all')}
          >
            <RefreshCw size={14} />
            {t('dc.sync_all')}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
            <Save size={14} />
            {saving ? t('f.loading') : t('btn.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
