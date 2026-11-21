// Employees management page — mobile-first modern design
// Full sync with Hikvision API data, modern UI, responsive
import { useState, useEffect, useRef } from 'react';
import { useLang } from '../hooks/useLang.js';
import { useDialogA11y } from '../hooks/useDialogA11y.js';
import { UserPlus, Trash2, Edit3, Search, X, Check, Users, RefreshCw, AlertCircle, CheckCircle, Info } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

// ─── API helper ─────────────────────────────────────────────────────────────────
// Uses axios with baseURL=/api (no need to prefix paths)

const avatarColors = ['#1D4ED8', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D'];

function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
  return avatarColors[h % avatarColors.length];
}

function getDisplayName(name) {
  if (!name) return null;
  if (name.startsWith('ID ')) return null;
  return name.trim();
}

function needsName(name) {
  return !getDisplayName(name);
}

// Employee Card (mobile-first)
function EmployeeCard({ emp, onEdit, onDelete }) {
  const { t } = useLang();
  const displayName = getDisplayName(emp.name);
  const ac = avatarColor(emp.name || 'X');
  const hasWarning = needsName(emp.name);
  // Karyawan yang sudah dinonaktifkan (soft-delete) harus TERLIHAT berbeda.
  //
  // MASALAH YANG DISELESAIKAN:
  //   Perangkat menolak hard-delete, jadi "Hapus" berarti soft-delete
  //   (enabled=false). Barisnya tetap ada dan tetap tampil di daftar dengan
  //   tampilan IDENTIK dengan karyawan aktif. Akibatnya user menekan
  //   "Hapus", tidak ada error, tapi juga tidak ada perubahan yang terlihat
  //   — dia mengira tombolnya tidak bekerja.
  const isDisabled = emp.enabled === false;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius)',
      border: `1px solid ${hasWarning ? 'var(--warning)' : 'var(--border)'}`,
      padding: '14px',
      marginBottom: '10px',
      position: 'relative',
      overflow: 'hidden',
      // Nonaktif → redupkan supaya jelas berbeda dari karyawan aktif.
      opacity: isDisabled ? 0.55 : 1,
    }}>
      {hasWarning && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: 'var(--gradient-primary)'
        }}>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{
          width: '48px', height: '48px', borderRadius: 'var(--radius-md)',
          background: ac, color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', fontWeight: '700', flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}>
          {(emp.name || '?')[0].toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '15px', fontWeight: '600',
            color: displayName ? 'var(--text)' : 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {displayName || <span style={{ fontStyle: 'italic' }}>{t('rek.guest')}</span>}
          </div>
          <div style={{
            fontSize: '12px', color: 'var(--text-sub)',
            fontFamily: 'monospace', fontWeight: '600',
            marginTop: '4px'
          }}>
            ID: {emp.employeeNo}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 10px', borderRadius: 'var(--radius-md)', fontSize: '11px', fontWeight: '600',
              background: 'rgba(99, 102, 241, 0.15)',
              color: 'var(--primary-light)',
              border: '1px solid rgba(99, 102, 241, 0.3)'
            }}>
              {emp.deviceKey === 'masuk' ? t('f.masuk') : t('f.keluar')}
            </span>
            {emp.cardNo && (
              <span style={{
                padding: '3px 10px', borderRadius: 'var(--radius-md)', fontSize: '11px', fontWeight: '600',
                background: 'rgba(139, 92, 246, 0.15)',
                color: 'var(--purple)',
                border: '1px solid rgba(139, 92, 246, 0.3)'
              }}>
                {emp.cardNo}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
          <button
            aria-label={t('emp.aria_edit')}
            onClick={() => onEdit(emp)}
            style={{
              // 44x44 = target sentuh minimum yang direkomendasikan
              // WCAG 2.5.5 / Apple HIG untuk layar sentuh.
              width: '44px', height: '44px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)', background: 'var(--surface)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s'
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <Edit3 size={15} style={{ color: 'var(--primary)' }} />
          </button>
          <button aria-label={t('emp.aria_delete')}
            onClick={() => onDelete(emp)}
            style={{
              // 44x44 = target sentuh minimum yang direkomendasikan
              // WCAG 2.5.5 / Apple HIG untuk layar sentuh.
              width: '44px', height: '44px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)', background: 'var(--surface)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s'
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.borderColor = 'var(--danger)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <Trash2 size={15} style={{ color: 'var(--danger)' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Employee Modal
function EmployeeModal({ onClose, onSave, editing, initialData, triggerRef }) {
  const { t } = useLang();
  const [form, setForm] = useState(initialData);
  const [error, setError] = useState('');
  // Aksesibilitas dialog: focus trap, Escape, kembalikan fokus ke pemicu.
  const panelRef = useDialogA11y(true, onClose, triggerRef);

  const handleSave = () => {
    if (!form.employeeNo || !form.name) {
      setError('ID Fingerprint dan Nama wajib diisi!');
      return;
    }
    if (form.name.startsWith('ID ')) {
      setError('Nama tidak boleh dimulai dengan "ID ". Masukkan nama lengkap!');
      return;
    }
    onSave(form);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', backdropFilter: 'blur(8px)'
    }} onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? t('btn.edit_employee', 'Edit Karyawan') : t('btn.add_employee', 'Tambah Karyawan')}
        tabIndex={-1}
        style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-full)', width: '100%', maxWidth: '420px',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', overflow: 'hidden',
        border: '1px solid var(--border)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          padding: '20px 24px',
          background: editing
            ? 'var(--gradient-success)'
            : 'var(--gradient-primary)',
          color: 'white'
        }}>
          <div style={{ fontSize: '18px', fontWeight: '700' }}>
            {editing ? t('btn.edit_employee', 'Edit Karyawan') : t('btn.add_employee', 'Tambah Karyawan')}
          </div>
          <div style={{ fontSize: '13px', opacity: 0.85, marginTop: '4px' }}>
            {editing
              ? `Update data untuk ID ${initialData.employeeNo}`
              : 'Tambah karyawan baru ke sistem'}
          </div>
        </div>

        <div style={{ padding: '24px' }}>
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: '16px',
              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <AlertCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: 'var(--danger)' }}>{error}</span>
            </div>
          )}

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-sub)', marginBottom: '8px' }}>
              ID Fingerprint *
            </label>
            <input
              type="text"
              value={form.employeeNo}
              onChange={e => { setForm(p => ({ ...p, employeeNo: e.target.value })); setError(''); }}
              placeholder={t('emp.placeholder_id')}
              disabled={editing}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', fontSize: '15px',
                background: editing ? 'var(--bg)' : 'var(--surface)',
                color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                fontFamily: 'monospace'
              }}
            />
            {editing && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                ID tidak dapat diubah
              </div>
            )}
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-sub)', marginBottom: '8px' }}>
              Nama Lengkap *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => { setForm(p => ({ ...p, name: e.target.value })); setError(''); }}
              placeholder={t('emp.placeholder_name')}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', fontSize: '15px',
                background: 'var(--surface)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-sub)', marginBottom: '8px' }}>
              Device
            </label>
            <select
              value={form.deviceKey}
              onChange={e => setForm(p => ({ ...p, deviceKey: e.target.value }))}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', fontSize: '15px',
                background: 'var(--surface)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box'
              }}
            >
              <option value="masuk">{t('f.masuk')}</option>
              <option value="keluar">{t('f.keluar')}</option>
            </select>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-sub)', marginBottom: '8px' }}>
              No. Kartu (opsional)
            </label>
            <input
              type="text"
              value={form.cardNo}
              onChange={e => setForm(p => ({ ...p, cardNo: e.target.value }))}
              placeholder={t('emp.placeholder_card')}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', fontSize: '15px',
                background: 'var(--surface)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                fontFamily: 'monospace'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '14px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'var(--surface)',
                fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                color: 'var(--text)', transition: 'all .15s'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseOut={e => e.currentTarget.style.background = 'var(--surface)'}
            >
              Batal
            </button>
            <button
              onClick={handleSave}
              style={{
                flex: 1, padding: '14px', borderRadius: 'var(--radius-md)',
                border: 'none',
                background: editing
                  ? 'var(--gradient-success)'
                  : 'var(--gradient-primary)',
                fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
            >
              <Check size={18} /> Simpan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Info Panel
function InfoPanel() {
  const { t } = useLang();
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius)',
      border: '1px solid var(--border)', padding: '20px'
    }}>
      <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)' }}>
        <Info size={16} style={{ color: 'var(--primary)' }} />
        Informasi Sistem Karyawan
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{
          padding: '14px', borderRadius: 'var(--radius-md)', background: 'var(--bg)',
          border: '1px solid var(--border)'
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '6px' }}>
            Sync dari Device
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Klik "Sync dari Device" untuk mengambil data karyawan langsung dari fingerprint Hikvision.
            Nama yang tersimpan di device akan otomatis tersinkronisasi.
          </div>
        </div>

        <div style={{
          padding: '14px', borderRadius: 'var(--radius-md)', background: 'var(--bg)',
          border: '1px solid var(--border)'
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '6px' }}>
            Edit Nama Karyawan
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Nama yang diedit di halaman ini akan lebih diutamakan digunakan di laporan dan WhatsApp.
            Sistem secara otomatis merge data dari kedua device (Masuk & Keluar).
          </div>
        </div>

        <div style={{
          padding: '14px', borderRadius: 'var(--radius-md)', background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)'
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--warning)', marginBottom: '6px' }}>
            Karyawan Tanpa Nama
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Karyawan dengan nama "ID X" perlu diedit manual. Nama mereka akan
            tampil di laporan dan WhatsApp setelah diisi dengan nama lengkap.
          </div>
        </div>

        <div style={{
          padding: '14px', borderRadius: 'var(--radius-md)', background: 'var(--bg)',
          border: '1px solid var(--border)'
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '6px' }}>
            Merge Data Otomatis
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Satu karyawan bisa punya data di device Masuk dan device Keluar.
            Sistem otomatis merge berdasarkan employeeNo sehingga tampil sebagai satu kartu.
          </div>
        </div>
      </div>
    </div>
  );
}

// Main Page
export default function EmployeesPage() {
  const toast = useToast();
  const { t } = useLang();
  // api is imported from '../services/api.js' above — no need to instantiate
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('list');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  // Ref tombol pemicu — dipakai agar fokus kembali ke pemicu setelah modal ditutup.
  const addBtnRef = useRef(null);
  const [initialForm, setInitialForm] = useState({
    employeeNo: '', name: '', deviceKey: 'masuk', cardNo: ''
  });
  const [syncResult, setSyncResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/employees');
      setEmployees(res.data?.data || []);
    } catch(e) {
      toast(e.serverMessage || e.message || 'Gagal memuat daftar karyawan', 'error');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post('/devices/users/refresh', {});
      // axios wraps response in .data
      const cached = res.data?.cached ?? res.cached ?? 0;
      setSyncResult({ success: true, count: cached });
      await load();
    } catch(e) {
      // Prioritize server-extracted message; fallback to browser error text
      const msg = e.serverMessage || e.message || 'Gagal sinkronisasi';
      setSyncResult({ success: false, error: msg });
    }
    setSyncing(false);
    setTimeout(() => setSyncResult(null), 5000);
  };

  const handleSave = async (formData) => {
    try {
      if (editing) {
        await api.put(`/employees/${formData.employeeNo}`, formData);
      } else {
        await api.post('/employees', formData);
      }
      setShowModal(false);
      load();
    } catch(e) {
      toast(e.serverMessage || e.message || 'Gagal menyimpan karyawan', 'error');
    }
  };

  const handleDelete = async (emp) => {
    const name = getDisplayName(emp.name) || `ID ${emp.employeeNo}`;
    if (!window.confirm(`Hapus ${name}?\n\nID: ${emp.employeeNo}`)) return;
    try {
      // PENTING: gunakan `api.delete`, bukan `api.del`. Axios TIDAK punya
      // alias `del` — memanggilnya melempar "api.del is not a function",
      // yang ditangkap catch dan diterjemahkan jadi toast generik. Akibatnya
      // "Hapus karyawan" tampak berhasil padahal data tidak pernah terhapus.
      await api.delete(`/employees/${emp.employeeNo}`);
      load();
    } catch(e) {
      toast(e.serverMessage || e.message || 'Gagal menghapus karyawan', 'error');
    }
  };

  const openAdd = () => {
    setInitialForm({ employeeNo: '', name: '', deviceKey: 'masuk', cardNo: '' });
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (emp) => {
    setInitialForm({
      employeeNo: emp.employeeNo,
      name: getDisplayName(emp.name) || '',
      deviceKey: emp.deviceKey || 'masuk',
      cardNo: emp.cardNo || ''
    });
    setEditing(emp);
    setShowModal(true);
  };

  const filtered = employees.filter(e => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (e.name || '').toLowerCase().includes(s) ||
      e.employeeNo.toLowerCase().includes(s) ||
      (e.cardNo || '').toLowerCase().includes(s)
    );
  });

  const employeeMap = new Map();
  filtered.forEach(emp => {
    const key = emp.employeeNo;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, { ...emp, devices: new Set([emp.deviceKey]) });
    } else {
      employeeMap.get(key).devices.add(emp.deviceKey);
    }
  });
  const mergedEmployees = Array.from(employeeMap.values()).map(e => ({
    ...e,
    devices: Array.from(e.devices)
  }));

  const total = mergedEmployees.length;
  const named = mergedEmployees.filter(e => getDisplayName(e.name)).length;
  const needName = total - named;

  return (
    <div className="page-pad">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: '20px', flexWrap: 'wrap', gap: '16px'
      }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', margin: 0, color: 'var(--text)' }}>
            Kelola Karyawan
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-sub)', margin: '6px 0 0' }}>
            Sinkronisasi nama dari fingerprint device Hikvision
          </p>
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: '600',
              background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary-light)',
              border: '1px solid rgba(99, 102, 241, 0.3)'
            }}>
              {total} Total
            </span>
            <span style={{
              padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: '600',
              background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)',
              border: '1px solid rgba(16, 185, 129, 0.3)'
            }}>
              {named} Bernama
            </span>
            {needName > 0 && (
              <span style={{
                padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: '600',
                background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)',
                border: '1px solid rgba(245, 158, 11, 0.3)'
              }}>
                {needName} Perlu Nama
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-outline"
            onClick={handleSync}
            disabled={syncing}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 16px', fontSize: '13px'
            }}
          >
            <RefreshCw size={15} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync dari Device'}
          </button>
          <button
            ref={addBtnRef}
            className="btn btn-primary"
            onClick={openAdd}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 18px', fontSize: '13px'
            }}
          >
            <UserPlus size={15} />Tambah Karyawan
          </button>
        </div>
      </div>

      {syncResult && (
        <div style={{
          padding: '14px 18px', borderRadius: 'var(--radius-md)', marginBottom: '20px',
          background: syncResult.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${syncResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          display: 'flex', alignItems: 'center', gap: '12px',
          animation: 'slideDown 0.3s ease'
        }}>
          {syncResult.success ? (
            <CheckCircle size={20} style={{ color: 'var(--success)', flexShrink: 0 }} />
          ) : (
            <AlertCircle size={20} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: '14px', color: syncResult.success ? 'var(--success)' : 'var(--danger)', fontWeight: '500' }}>
            {syncResult.success
              ? `Berhasil sync ${syncResult.count} karyawan dari Hikvision device!`
              : `Gagal sync: ${syncResult.error}`}
          </span>
          <button
            onClick={() => setSyncResult(null)}
            aria-label={t('emp.aria_close_sync')}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}
          >
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
      )}

      {/* Semantik tab: tanpa role="tab"/"aria-selected", screen reader
          membacakan dua tombol biasa tanpa tahu mana tab aktif. */}
      <div
        role="tablist"
        aria-label="Tampilan karyawan"
        style={{
          display: 'flex', gap: '4px', marginBottom: '20px',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <button
          role="tab"
          aria-selected={tab === 'list'}
          onClick={() => setTab('list')}
          style={{
            padding: '10px 20px', border: 'none',
            borderBottom: tab === 'list' ? '2px solid var(--primary)' : '2px solid transparent',
            color: tab === 'list' ? 'var(--primary)' : 'var(--text-muted)',
            background: 'transparent', cursor: 'pointer',
            fontSize: '14px', fontWeight: tab === 'list' ? '600' : '400',
            transition: 'all .15s'
          }}
        >
          Daftar ({total})
        </button>
        <button
          role="tab"
          aria-selected={tab === 'info'}
          onClick={() => setTab('info')}
          style={{
            padding: '10px 20px', border: 'none',
            borderBottom: tab === 'info' ? '2px solid var(--primary)' : '2px solid transparent',
            color: tab === 'info' ? 'var(--primary)' : 'var(--text-muted)',
            background: 'transparent', cursor: 'pointer',
            fontSize: '14px', fontWeight: tab === 'info' ? '600' : '400',
            transition: 'all .15s'
          }}
        >
          Info
        </button>
      </div>

      {tab === 'list' && (
        <>
          <div style={{
            background: 'var(--surface)', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px'
          }}>
            <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              style={{
                border: 'none', background: 'transparent', fontSize: '15px',
                color: 'var(--text)', outline: 'none', flex: 1
              }}
              placeholder={t('emp.placeholder_search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label={t('emp.aria_clear_search')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}
              >
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{t('empty.no_data')}</div>
            </div>
          ) : mergedEmployees.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '60px 24px',
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)'
            }}>
              <Users size={56} style={{ opacity: 0.3, margin: '0 auto 16px', display: 'block', color: 'var(--text-muted)' }} />
              <div style={{ fontWeight: '600', fontSize: '15px', color: 'var(--text)', marginBottom: '6px' }}>
                {search ? 'Tidak ada hasil pencarian' : 'Belum ada karyawan'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {search
                  ? `Tidak ada karyawan matching "${search}"`
                  : 'Klik "Sync dari Device" untuk mengambil data dari fingerprint Hikvision'}
              </div>
              {!search && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="btn btn-primary"
                  style={{ marginTop: '20px' }}
                >
                  <RefreshCw size={14} /> Sync dari Device
                </button>
              )}
            </div>
          ) : (
            <div className="employee-grid">
              {mergedEmployees.map((emp, i) => (
                <EmployeeCard
                  key={emp.employeeNo}
                  emp={emp}
                  index={i}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'info' && <InfoPanel />}

      {showModal && (
        <EmployeeModal
          editing={editing}
          initialData={initialForm}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
          triggerRef={addBtnRef}
        />
      )}

      <style>{`
        .employee-grid {
          display: flex;
          flex-direction: column;
        }

        @media (min-width: 768px) {
          .employee-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
          }
        }

        @media (min-width: 1200px) {
          .employee-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @media (max-width: 640px) {
          .btn {
            min-height: 44px;
            min-width: 44px;
          }
        }
      `}</style>
    </div>
  );
}
