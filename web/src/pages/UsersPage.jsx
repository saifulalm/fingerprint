// Users page — list from DB
import { useState, useEffect } from 'react';
import { useLang } from '../hooks/useLang.js';
import { Users, RefreshCw } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

export default function UsersPage() {
  const { t } = useLang();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/devices/users');
      setUsers(res.data.data || []);
    } catch (err) {
      // Error HARUS terlihat oleh user. Sebelumnya hanya `console.error`,
      // sehingga halaman tampil kosong tanpa penjelasan apa pun.
      toast(err.serverMessage || err.message || 'Gagal memuat daftar pengguna perangkat', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post('/devices/users/refresh');
      await load();
      // Server kini melaporkan kegagalan per perangkat dengan `success: false`.
      // Tanpa pemeriksaan ini, refresh yang separuh gagal tetap terlihat
      // "berhasil" di mata user.
      if (res.data?.success === false) {
        toast(
          res.data?.error || 'Sebagian perangkat gagal diakses. Data mungkin tidak lengkap.',
          'error',
        );
      } else {
        toast(t('top.refresh_done') || 'Data perangkat diperbarui', 'success');
      }
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal menyinkronkan pengguna dari perangkat', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const grouped = {};
  users.forEach(u => {
    if (!grouped[u.name]) grouped[u.name] = [];
    grouped[u.name].push(u);
  });
  const uniqueEmployees = Object.values(grouped);

  return (
    <div className="users-page page-pad">
      <div className="page-header">
        <div className="page-header-text">
          <h2 className="page-title">{t('page.users.title')}</h2>
          <p className="page-subtitle">{t('page.users.sub')}</p>
        </div>
        <button className="btn glass-btn" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
          {refreshing ? t('f.loading') : t('btn.refresh_device')}
        </button>
      </div>

      <div className="glass-card">
        <div className="table-header">
          <span className="table-header-label">{t('rek.total')}</span>
          <span className="table-count-badge">{users.length} {t('label.users')}</span>
        </div>

        <div className="table-wrap">
          <table className="glass-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('th.name')}</th>
                <th>{t('th.type')}</th>
                <th>{t('rek.id_in')}</th>
                <th>{t('rek.id_out')}</th>
                <th>{t('th.valid')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="spinner" />
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state glass-empty-state">
                      <Users size={48} className="empty-icon" />
                      <h3>{t('empty.no_data')}</h3>
                      <p>{t('top.refresh')} {t('f.from')} {t('f.device')}</p>
                    </div>
                  </td>
                </tr>
              ) : users.map((u, i) => (
                <tr key={i} className="glass-row">
                  <td className="row-number">{i + 1}</td>
                  <td>
                    <div className="user-cell">
                      <div className="avatar">{u.name?.[0]?.toUpperCase() || '?'}</div>
                      <div className="user-info">
                        <div className="user-name">{u.name}</div>
                        <div className="user-id">{u.employeeNo}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${u.userType === 'administrator' ? 'badge-orange' : u.userType === 'visitor' ? 'badge-cyan' : 'badge-gray'}`}>
                      {u.userType === 'administrator' ? t('role.administrator') : u.userType === 'visitor' ? t('role.visitor') : t('role.normal')}
                    </span>
                  </td>
                  <td className={u.devMasukId && u.devMasukId !== '-' ? 'id-active' : 'id-muted'}>{u.devMasukId || '-'}</td>
                  <td className={u.devKeluarId && u.devKeluarId !== '-' ? 'id-exit-active' : 'id-muted'}>{u.devKeluarId || '-'}</td>
                  <td className="valid-cell">{u.validEnd !== '-' ? u.validEnd : <span className="normal-label">{t('rek.normal')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        /* Memakai keyframes 'spin' global (index.css) — mendefinisikan ulang
           di sini hanya mengulang sumber kebenaran yang sama. */
        .spinning { animation: spin 1s linear infinite; }

        .users-page {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-md);
        }

        .page-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--spacing-md);
          flex-wrap: wrap;
          padding: var(--spacing-md) var(--spacing-lg);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          backdrop-filter: blur(12px);
        }

        /* Wrapper judul: min-w-0 + flex-1 supaya teks panjang dapat
           menyusut dan tombol di sebelahnya tetap terlihat di layar
           sempit, bukan terdorong keluarviewport. */
        .page-header-text {
          flex: 1 1 220px;
          min-width: 0;
        }

        .page-title {
          font-size: 19px;
          font-weight: 700;
          color: var(--text);
          margin: 0;
        }

        .page-subtitle {
          font-size: 12.5px;
          color: var(--text-sub);
          margin: 3px 0 0 0;
        }

        .glass-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--text);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          backdrop-filter: blur(8px);
        }

        .glass-btn:hover:not(:disabled) {
          border-color: var(--border-hover);
          background: var(--bg);
        }

        .glass-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .glass-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          overflow: hidden;
          backdrop-filter: blur(16px);
        }

        .table-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border);
          background: rgba(0, 0, 0, 0.2);
        }

        .table-header-label {
          font-size: 14px;
          font-weight: 700;
          color: var(--text);
        }

        .table-count-badge {
          font-size: 11.5px;
          color: var(--text-sub);
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 3px 10px;
          border-radius: var(--radius-full);
        }

        .table-wrap {
          overflow-x: auto;
        }

        .glass-table {
          width: 100%;
          border-collapse: collapse;
        }

        .glass-table thead {
          background: rgba(0, 0, 0, 0.15);
        }

        .glass-table thead th {
          padding: 12px 16px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .glass-table tbody td {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
          color: var(--text);
        }

        .glass-row {
          transition: background 0.2s ease;
        }

        .glass-row:hover {
          background: rgba(99, 102, 241, 0.06);
        }

        .glass-row:last-child td {
          border-bottom: none;
        }

        .row-number {
          text-align: center;
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 600;
          width: 40px;
        }

        .user-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar {
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          background: var(--gradient-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 13px;
          flex-shrink: 0;
        }

        .user-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .user-name {
          font-weight: 600;
          color: var(--text);
        }

        .user-id {
          font-size: 11px;
          color: var(--text-muted);
          font-family: monospace;
        }

        .id-active {
          font-family: monospace;
          font-size: 12px;
          color: var(--success);
        }

        .id-exit-active {
          font-family: monospace;
          font-size: 12px;
          color: var(--danger);
        }

        .id-muted {
          font-family: monospace;
          font-size: 12px;
          color: var(--text-muted);
        }

        .valid-cell {
          font-size: 12px;
          color: var(--text);
        }

        .normal-label {
          color: var(--text-muted);
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          text-align: center;
        }

        .glass-empty-state {
          background: rgba(0, 0, 0, 0.15);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 48px 24px;
          width: 100%;
        }

        .empty-icon {
          color: var(--text-muted);
          margin-bottom: 16px;
        }

        .empty-state h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 8px 0;
        }

        .empty-state p {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0;
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto;
        }

      `}</style>
    </div>
  );
}
