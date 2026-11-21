// Device Center — hub administrasi perangkat Hikvision.
//
// Alur yang disajikan di sini:
//   1. Ringkasan  → identitas, status pintu, jam, jaringan, peta kapabilitas
//   2. Karyawan   → daftar user per perangkat + ubah nama langsung ke perangkat
//   3. Konflik   → nomor ID yang menunjuk nama berbeda antar perangkat
//   4. Riwayat   → jejak aksi perangkat terakhir
//
// CATATAN KAPABILITAS: perangkat ini MENOLAK penambahan & penghapusan user
// lewat ISAPI (`Add` → notSupport, `Delete` → badParameters). UI karena itu
// tidak menampilkan tombol tambah/hapus — hanya perubahan data.
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Monitor, RefreshCw, Users, AlertTriangle, History, Cpu, Clock,
  Network, ShieldCheck, Pencil, CheckCircle2, XCircle, DoorOpen,
  Power, PowerOff, Trash2,
} from 'lucide-react';
import { useLang } from '../hooks/useLang.js';
import { useToast } from '../context/ToastContext.jsx';
import api from '../services/api.js';
import { Panel, InfoRow, StatusPill, CapabilityGrid, EmptyState } from '../components/device-center/DevicePanels.jsx';
import DeviceUserDialog from '../components/device-center/DeviceUserDialog.jsx';
import IdMappingPanel from '../components/device-center/IdMappingPanel.jsx';

const TABS = ['overview', 'users', 'conflicts', 'audit'];

export default function DeviceCenterPage() {
  const { t } = useLang();
  const toast = useToast();

  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState({});
  const [conflicts, setConflicts] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyDevice, setBusyDevice] = useState(null);
  const [busyKey, setBusyKey] = useState(null); // "deviceKey:employeeNo" yang sedang diproses
  const [dialog, setDialog] = useState(null); // { deviceKey, user }

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/device-center/overview');
      setOverview(res.data);
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal memuat ringkasan perangkat', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadUsers = useCallback(async (deviceKey) => {
    setBusyDevice(deviceKey);
    try {
      const res = await api.get('/device-center/users', { params: { device: deviceKey } });
      setUsers((prev) => ({ ...prev, [deviceKey]: res.data?.data || [] }));
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal memuat pengguna perangkat', 'error');
    } finally {
      setBusyDevice(null);
    }
  }, [toast]);

  const loadConflicts = useCallback(async () => {
    try {
      const res = await api.get('/device-center/conflicts');
      setConflicts(res.data);
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal memuat data konflik', 'error');
    }
  }, [toast]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await api.get('/device-center/audit');
      setAudit(res.data?.data || []);
    } catch (err) {
      toast(err.serverMessage || err.message || 'Gagal memuat riwayat', 'error');
    }
  }, [toast]);

  // Muat data sesuai tab yang aktif — jangan ambil semuanya sekaligus,
  // setiap panggilan menyentuh perangkat fisik dan butuh waktu.
  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'users') {
      const keys = overview?.devices?.map((d) => d.key) || ['masuk', 'keluar'];
      keys.forEach((k) => loadUsers(k));
    } else if (tab === 'conflicts') loadConflicts();
    else if (tab === 'audit') loadAudit();
  }, [tab, loadOverview, loadUsers, loadConflicts, loadAudit]);

  const devices = overview?.devices || [];

  const conflictCount = useMemo(
    () => (conflicts?.conflicts || []).filter((c) => c.reason === 'conflict').length,
    [conflicts]
  );

  const handleRefresh = () => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'users') {
      const keys = Object.keys(users);
      (keys.length ? keys : ['masuk', 'keluar']).forEach((k) => loadUsers(k));
    } else if (tab === 'conflicts') loadConflicts();
    else if (tab === 'audit') loadAudit();
  };

  const handleSaved = () => {
    setDialog(null);
    const keys = Object.keys(users);
    (keys.length ? keys : ['masuk', 'keluar']).forEach((k) => loadUsers(k));
    loadAudit();
  };

  /**
   * Aktifkan / nonaktifkan user DI PERANGKAT.
   *
   * INI adalah padanan "hapus" yang benar-benar bisa dijalankan — firmware
   * menolak hard-delete (UserInfo/Delete → badParameters), tapi
   * Modify dengan Valid.enable=false terbukti berhasil (probe live).
   */
  const handleToggleStatus = async (user, enabled, deviceKey) => {
    const key = `${deviceKey}:${user.employeeNo}`;
    setBusyKey(key);
    try {
      await api.put('/device-center/users/status', {
        device: deviceKey,
        employeeNo: user.employeeNo,
        enabled,
      });
      toast(
        enabled ? t('dc.enable_user') : t('dc.disable_user'),
        'success',
        `${deviceKey} · ${user.employeeNo}`,
      );
      await loadUsers(deviceKey);
      loadAudit();
    } catch (err) {
      toast(err.serverMessage || err.message || t('dc.status_failed'), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Hapus user dari DAFTAR APLIKASI (baris device_users).
   *
   * PENTING: user di perangkat TIDAK ikut terhapus. Kalau yang diinginkan
   * adalah menolak akses, pakai handleToggleStatus dengan enabled=false.
   */
  const handleRemove = async (user, deviceKey) => {
    const name = user.name || `ID ${user.employeeNo}`;
    if (!window.confirm(String(t('dc.remove_confirm')).replace('{name}', name))) return;

    const key = `${deviceKey}:${user.employeeNo}`;
    setBusyKey(key);
    try {
      await api.delete('/device-center/users', {
        params: { device: deviceKey, employeeNo: user.employeeNo },
      });
      toast(t('dc.removed_from_list'), 'success', `${deviceKey} · ${user.employeeNo}`);
      await loadUsers(deviceKey);
      loadAudit();
    } catch (err) {
      toast(err.serverMessage || err.message || t('dc.write_failed'), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="page-pad">
      {/* ── Header halaman ─────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>
            {t('dc.title')}
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            {t('dc.subtitle')}
          </p>
        </div>
        <button className="btn btn-outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCw size={15} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          {t('dc.refresh')}
        </button>
      </header>

      {/* ── Tab ───────────────────────────────────────────────────── */}
      <nav
        role="tablist"
        aria-label={t('dc.title')}
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 8,
        }}
      >
        {TABS.map((key) => {
          const active = tab === key;
          const label = t(`dc.tab_${key}`);
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: active ? 'var(--primary)' : 'transparent',
                background: active
                  ? 'color-mix(in srgb, var(--primary) 16%, transparent)'
                  : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              {key === 'overview' && <Monitor size={15} />}
              {key === 'users' && <Users size={15} />}
              {key === 'conflicts' && <AlertTriangle size={15} />}
              {key === 'audit' && <History size={15} />}
              {label}
              {key === 'conflicts' && conflictCount > 0 && (
                <span
                  style={{
                    background: 'var(--danger)',
                    color: '#fff',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 7px',
                  }}
                >
                  {conflictCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Konten tab ────────────────────────────────────────────── */}
      {loading && tab === 'overview' && (
        <Panel title={t('dc.loading')}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        </Panel>
      )}

      {!loading && tab === 'overview' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {devices.map((d) => (
            <DeviceOverviewCard key={d.key} device={d} t={t} />
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {devices.length === 0 && (
            <Panel title={t('dc.tab_users')}>
              {/* BUKAN t('dc.loading') — string itu berbunyi "Membaca
                  perangkat…" dan akan diumumkan tanpa henti saat daftar
                  memang kosong. Empty state harus menyatakan kondisi nyata. */}
              <EmptyState icon={Monitor} title={t('dc.no_devices')} />
            </Panel>
          )}
          {devices.map((d) => (
            <DeviceUserTable
              key={d.key}
              deviceKey={d.key}
              label={d.key === 'masuk' ? t('dev.masuk') : t('dev.keluar')}
              users={users[d.key]}
              loading={busyDevice === d.key}
              t={t}
              busyKey={busyKey}
              onEdit={(u) => setDialog({ deviceKey: d.key, user: u })}
              onToggleStatus={(u, enabled) => handleToggleStatus(u, enabled, d.key)}
              onRemove={(u) => handleRemove(u, d.key)}
            />
          ))}
        </div>
      )}

      {tab === 'conflicts' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <ConflictPanel conflicts={conflicts} t={t} onEdit={setDialog} />
          <IdMappingPanel conflicts={conflicts} t={t} onChanged={loadConflicts} />
        </div>
      )}

      {tab === 'audit' && (
        <Panel title={t('dc.tab_audit')}>
          {audit.length === 0 ? (
            <EmptyState icon={History} title={t('dc.audit_empty')} />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {audit.map((log) => (
                <div
                  key={log.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: '10px 12px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    minWidth: 0,
                  }}
                >
                  <History size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', wordBreak: 'break-word' }}>
                      {log.detail}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {log.action} · {new Date(log.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {dialog && (
        <DeviceUserDialog
          open={!!dialog}
          deviceKey={dialog.deviceKey}
          user={dialog.user}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

/* ── Kartu ringkasan satu perangkat ─────────────────────────────── */
function DeviceOverviewCard({ device, t }) {
  const d = device;
  const work = d.work || {};
  const time = d.time || {};
  const net = d.network || {};
  const info = d.deviceInfo;

  const doorOpen = Array.isArray(work.doorStatus)
    ? work.doorStatus.some((v) => Number(v) === 1 || v === 'open')
    : work.doorStatus === 1;

  return (
    <Panel
      title={d.key === 'masuk' ? t('dev.masuk') : t('dev.keluar')}
      subtitle={`${d.ip} · ${d.direction}`}
      actions={<StatusPill active={!!work.online} activeText={t('dev.online')} inactiveText={t('dc.offline')} />}
    >
      {d.errors?.length > 0 && (
        <div
          style={{
            marginBottom: 14,
            padding: '9px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            fontSize: 11.5,
            color: 'var(--text-sub)',
          }}
        >
          {d.errors.join(' · ')}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: 16,
        }}
      >
        {/* Identitas */}
        <div>
          <SubHead icon={Cpu} label={t('dc.section_identity')} />
          <InfoRow label={t('dc.device_name')} value={info?.deviceName} />
          <InfoRow label={t('dev.model')} value={info?.model} />
          <InfoRow label={t('dc.serial')} value={info?.serialNumber} mono />
          <InfoRow label={t('dc.firmware')} value={info?.firmwareVersion} mono />
          <InfoRow label={t('dc.hardware')} value={info?.hardwareVersion} mono />
        </div>

        {/* Pintu */}
        <div>
          <SubHead icon={DoorOpen} label={t('dc.section_door')} />
          {!work.online ? (
            <InfoRow label={t('dc.door_status')} value={t('dc.offline')} />
          ) : (
            <>
              <InfoRow
                label={t('dc.door_status')}
                value={doorOpen ? t('dc.door_open') : t('dc.door_closed')}
              />
              <InfoRow label={t('dc.lock_status')} value={fmtArray(work.doorLockStatus)} />
              <InfoRow label={t('dc.power')} value={work.powerSupplyStatus} />
              <InfoRow label={t('dc.tamper')} value={work.hostAntiDismantleStatus} />
              <InfoRow label={t('dc.card_reader')} value={fmtArray(work.cardReaderOnlineStatus)} />
            </>
          )}
        </div>

        {/* Jam & jaringan */}
        <div>
          <SubHead icon={Clock} label={t('dc.section_clock')} />
          {!time.online ? (
            <InfoRow label={t('dc.clock')} value={t('dc.offline')} />
          ) : (
            <>
              <InfoRow label={t('dc.clock')} value={time.localTime} mono />
              <InfoRow label={t('dc.time_mode')} value={time.timeMode} />
              <InfoRow label={t('dc.timezone')} value={time.timeZone} mono />
            </>
          )}

          <div style={{ height: 14 }} />
          <SubHead icon={Network} label={t('dc.section_network')} />
          {net.interfaces?.length ? (
            net.interfaces.map((it, i) => (
              <div key={i}>
                <InfoRow label="IP" value={it.ipAddress} mono />
                <InfoRow label={t('dc.mac')} value={it.macAddress} mono />
                <InfoRow label={t('dc.addressing')} value={it.addressingType} />
                <InfoRow label={t('dc.gateway')} value={it.gateway} mono />
              </div>
            ))
          ) : (
            <InfoRow label={t('dc.network')} value={t('dc.offline')} />
          )}
        </div>
      </div>

      {/* Batas query event */}
      {d.eventCapabilities && (
        <>
          <div style={{ height: 16 }} />
          <SubHead icon={ShieldCheck} label={t('dc.event_limits')} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
              gap: 10,
            }}
          >
            <InfoRow label={t('dc.max_results')} value={d.eventCapabilities.maxResults} />
            <InfoRow label={t('dc.search_position')} value={d.eventCapabilities.searchResultPositionMax} />
            <InfoRow label={t('dc.search_id')} value={d.eventCapabilities.searchIDMax} />
            <InfoRow label={t('dc.major_options')} value={d.eventCapabilities.majorOptions} mono />
          </div>
        </>
      )}

      {/* Peta kapabilitas */}
      <div style={{ height: 16 }} />
      <SubHead icon={ShieldCheck} label={t('dc.section_caps')} />
      <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-muted)' }}>{t('dc.caps_hint')}</p>
      <CapabilityGrid flags={[...(d.systemCapabilities || []), ...(d.accessCapabilities || [])]} />
    </Panel>
  );
}

/* ── Tabel pengguna per perangkat ───────────────────────────────── */

/**
 * Tabel user per perangkat.
 *
 * Kolom aksi offering dua operasi yang BENAR-BENARN bisa dijalankan:
 *   - Ubah nama  → Modify di perangkat (terverifikasi berhasil)
 *   - Aktifkan/Nonaktifkan → Modify dengan Valid.enable (padanan "hapus",
 *     karena firmware menolak hard-delete)
 *
 * Ketiga operasi itu memanggil API; status loading dikelola di parent
 * supaya tabel bisa menampilkan spinner per baris.
 */
function DeviceUserTable({ deviceKey, label, users, loading, t, onEdit, onToggleStatus, onRemove, busyKey }) {
  return (
    <Panel
      title={label}
      subtitle={deviceKey}
      actions={
        <span className="badge badge-cyan">
          {t('dc.user_total')}: {users?.length ?? '—'}
        </span>
      }
    >
      {loading && !users ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <div className="spinner" />
        </div>
      ) : !users?.length ? (
        <EmptyState icon={Users} title={t('dc.no_users')} />
      ) : (
        <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <Th>{t('dc.user_no')}</Th>
                <Th>{t('dc.user_name')}</Th>
                <Th>{t('dc.user_type')}</Th>
                <Th>{t('dc.valid_until')}</Th>
                <Th>{t('dc.user_enabled')}</Th>
                <Th style={{ width: 108 }} aria-label={t('dc.edit_name')} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const key = `${deviceKey}:${u.employeeNo}`;
                const busy = busyKey === key;
                // Status efektif = status di perangkat. Kolom appEnabled
                // menandai user yang dinonaktifkan dari menu lain.
                const deviceOn = u.valid !== false;
                const appOn = u.appEnabled !== false;

                return (
                  <tr key={u.employeeNo} style={{ borderTop: '1px solid var(--border)' }}>
                    <Td mono>{u.employeeNo}</Td>
                    <Td>
                      {u.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </Td>
                    <Td>
                      <span className="badge badge-gray">{u.userType}</span>
                    </Td>
                    <Td mono>{fmtDate(u.validEnd)}</Td>
                    <Td>
                      {!deviceOn ? (
                        <span className="badge badge-gray" style={{ opacity: 0.85 }}>
                          {t('dc.user_disabled_device')}
                        </span>
                      ) : !appOn ? (
                        <span className="badge badge-gray" style={{ opacity: 0.85 }}>
                          {t('dc.user_disabled')}
                        </span>
                      ) : (
                        <span className="badge badge-green">{t('dc.user_enabled')}</span>
                      )}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => onEdit(u)}
                          disabled={busy}
                          aria-label={`${t('dc.edit_name')} ${u.employeeNo}`}
                          title={t('dc.edit_name')}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-sub)',
                            cursor: 'pointer',
                            padding: 6,
                            display: 'inline-flex',
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => onToggleStatus(u, !deviceOn)}
                          disabled={busy}
                          aria-label={`${deviceOn ? t('dc.disable_user') : t('dc.enable_user')} ${u.employeeNo}`}
                          title={deviceOn ? t('dc.disable_user') : t('dc.enable_user')}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: deviceOn ? 'var(--danger)' : 'var(--success)',
                            cursor: 'pointer',
                            padding: 6,
                            display: 'inline-flex',
                          }}
                        >
                          {deviceOn ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        <button
                          onClick={() => onRemove(u)}
                          disabled={busy}
                          aria-label={`${t('dc.remove_from_list')} ${u.employeeNo}`}
                          title={t('dc.remove_from_list')}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 6,
                            display: 'inline-flex',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── Panel konflik ───────────────────────────────────────────────── */
function ConflictPanel({ conflicts, t, onEdit }) {
  const list = conflicts?.conflicts || [];
  const hardConflicts = list.filter((c) => c.reason === 'conflict');
  const onlyOne = list.filter((c) => c.reason === 'only_one_device');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title={t('dc.conflict_title')} subtitle={t('dc.conflict_hint')}>
        {hardConflicts.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t('dc.no_conflict')} hint={t('dc.no_conflict_hint')} />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {hardConflicts.map((c) => (
              <ConflictRow key={c.employeeNo} conflict={c} t={t} onEdit={onEdit} />
            ))}
          </div>
        )}
      </Panel>

      {onlyOne.length > 0 && (
        <Panel title={t('dc.only_one')}>
          <div style={{ display: 'grid', gap: 10 }}>
            {onlyOne.map((c) => (
              <ConflictRow key={c.employeeNo} conflict={c} t={t} onEdit={onEdit} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function ConflictRow({ conflict, t, onEdit }) {
  const isHard = conflict.reason === 'conflict';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        background: isHard
          ? 'color-mix(in srgb, var(--danger) 10%, transparent)'
          : 'color-mix(in srgb, var(--warning) 10%, transparent)',
        border: `1px solid ${isHard
          ? 'color-mix(in srgb, var(--danger) 28%, transparent)'
          : 'color-mix(in srgb, var(--warning) 28%, transparent)'}`,
      }}
    >
      {isHard ? (
        <XCircle size={17} style={{ color: 'var(--danger)', flexShrink: 0 }} />
      ) : (
        <AlertTriangle size={17} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
          {t('dc.user_no')} {conflict.employeeNo}
          <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8, fontSize: 11.5 }}>
            {isHard ? t('dc.conflict_reason') : t('dc.only_one')}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 6,
          }}
        >
          {conflict.names.map((n) => (
            <span
              key={n.deviceKey}
              className="badge badge-gray"
              style={{ fontFamily: 'monospace' }}
            >
              {n.deviceKey}: {n.name}
            </span>
          ))}
        </div>
      </div>
      <button
        className="btn btn-outline btn-sm"
        onClick={() =>
          onEdit({ deviceKey: conflict.names[0].deviceKey, user: {
            employeeNo: conflict.employeeNo,
            name: conflict.names[0].name,
          } })
        }
      >
        <Pencil size={13} />
        {t('dc.edit_name')}
      </button>
    </div>
  );
}

/* ── Helper kecil ────────────────────────────────────────────────── */
function SubHead({ icon: Icon, label }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        marginBottom: 8,
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--text-muted)',
      }}
    >
      <Icon size={13} />
      {label}
    </div>
  );
}

function Th({ children, style }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '9px 10px',
        fontSize: 10.5,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono = false }) {
  return (
    <td
      style={{
        padding: '9px 10px',
        fontSize: 12.5,
        color: 'var(--text)',
        fontFamily: mono ? 'monospace' : 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  );
}

/** Ubah array status perangkat ("[1]") menjadi teks yang enak dibaca. */
function fmtArray(v) {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}

/** Tampilkan tanggal perangkat apa adanya (format ISAPI sudah ISO). */
function fmtDate(v) {
  if (!v) return '—';
  return String(v).replace('T', ' ').replace(/\+.*$/, '');
}
