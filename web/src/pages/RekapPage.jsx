// RekapPage — unified dark glass theme
import { useState } from 'react';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import { useLang } from '../hooks/useLang.js';
import { FilterBar } from '../components/Shared.jsx';
import api from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { dayName, fmtDateShort, userTypeLabel } from '../lib/i18nData.js';

function RekapCard({ emp, t, lang }) {
  const [open, setOpen] = useState(false);

  const hariHadirLabel = t('rek.hari_hadir');
  const daysCountLabel = t('rek.days_count');
  const moreDaysLabel = t('rek.more_days');
  const perDayLabel = t('rek.per_day');
  const dayHeader = t('rek.per_day').split(' ')[0];
  const thDay = t('th.day');
  const firstInLabel = t('rek.first_in');
  const lastOutLabel = t('rek.last_out');
  const allInLabel = t('rek.all_in');
  const allOutLabel = t('rek.all_out');
  const durationLabel = t('rek.duration');
  const totalLabel = t('rek.total');

  return (
    <div
      className="card"
      style={{
        overflow: 'hidden',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Gradient Header */}
      <div
        style={{
          padding: '16px 20px',
          background: 'var(--gradient-primary)',
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 700,
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
            color: 'var(--text)',
          }}
        >
          {emp.name[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'var(--text)',
            }}
          >
            {emp.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{userTypeLabel(emp.userType, lang)}</div>
        </div>
        <div
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 14px',
            textAlign: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: 'var(--text)' }}>
            {emp.hariHadir}
          </div>
          <div
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              marginTop: 4,
              color: 'var(--text)',
            }}
          >
            {hariHadirLabel}
          </div>
        </div>
      </div>

      {/* Meta Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(15, 23, 42, 0.4)',
        }}
      >
        {[
          {
            lbl: t('rek.id_in'),
            val: emp.idMasuk !== '-' ? emp.idMasuk : '-',
            color: 'var(--success)',
          },
          {
            lbl: t('rek.id_out'),
            val: emp.idKeluar !== '-' ? emp.idKeluar : '-',
            color: 'var(--danger)',
          },
          {
            lbl: t('rek.hadir'),
            val:
              emp.days.length > 1
                ? `${emp.days[0]} — ${emp.days[emp.days.length - 1]}`
                : emp.days[0] || '-',
            color: '',
          },
        ].map((m, i) => (
          <div
            key={i}
            style={{
              padding: '12px 16px',
              borderRight: i < 2 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                whiteSpace: 'nowrap',
              }}
            >
              {m.lbl}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: m.color || 'var(--text)',
                marginTop: 4,
                fontFamily:
                  m.val !== '-' && m.val !== emp.idKeluar && m.val !== emp.idMasuk
                    ? 'monospace'
                    : 'inherit',
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {m.val}
            </div>
          </div>
        ))}
      </div>

      {/* Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100px, 100%), 1fr))',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {[
          { val: emp.totalEvents, lbl: t('rek.total'), color: 'var(--primary)' },
          { val: emp.totalMasuk, lbl: t('rek.in'), color: 'var(--success)' },
          { val: emp.totalKeluar, lbl: t('rek.out'), color: 'var(--danger)' },
          { val: emp.hariHadir, lbl: t('rek.days'), color: 'var(--purple)' },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              padding: '14px 16px',
              textAlign: 'center',
              borderRight: i < 3 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                marginTop: 4,
                textTransform: 'uppercase',
                letterSpacing: '.03em',
              }}
            >
              {s.lbl}
            </div>
          </div>
        ))}
      </div>

      {/* Daily Pills */}
      <div style={{ padding: '14px 20px' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-sub)',
            textTransform: 'uppercase',
            letterSpacing: '.04em',
            marginBottom: 10,
          }}
        >
          {perDayLabel}{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>
            ({emp.perHari.length} {daysCountLabel})
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {emp.perHari.slice(0, 5).map((h, i) => (
            <div
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(99, 102, 241, 0.08)',
                fontSize: 12,
                color: 'var(--text-sub)',
                border: '1px solid rgba(99, 102, 241, 0.15)',
              }}
            >
              <strong style={{ color: 'var(--text)' }}>{fmtDateShort(h.dateKey, lang)}</strong>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dayName(h.dateKey, lang)}</span>
              {h.jamMasuk !== '-' && (
                <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 11 }}>
                  {h.jamMasuk}
                </span>
              )}
              {h.jamKeluar !== '-' && (
                <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 11 }}>
                  {h.jamKeluar}
                </span>
              )}
              {h.durasi && h.durasi !== '-' && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.durasi}</span>
              )}
            </div>
          ))}
          {emp.perHari.length > 5 && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--primary)',
                cursor: 'pointer',
                padding: '6px 10px',
              }}
            >
              +{emp.perHari.length - 5} {moreDaysLabel}
            </span>
          )}
        </div>
      </div>

      {/* Toggle Button */}
      {emp.perHari.length > 0 && (
        <button
          onClick={() => setOpen(!open)}
          style={{
            width: '100%',
            padding: 12,
            border: 'none',
            background: 'rgba(15, 23, 42, 0.4)',
            color: 'var(--text-sub)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'Inter, sans-serif',
            transition: 'background .15s',
            borderTop: '1px solid var(--border)',
          }}
          onMouseOver={(e) => (e.target.style.background = 'rgba(99, 102, 241, 0.1)')}
          onMouseOut={(e) => (e.target.style.background = 'rgba(15, 23, 42, 0.4)')}
        >
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {open ? t('rek.hide_detail') : t('rek.show_detail')}
        </button>
      )}

      {/* Detail Table */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
                {[dayHeader, thDay, firstInLabel, lastOutLabel, allInLabel, allOutLabel, durationLabel, totalLabel].map(
                  (h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {emp.perHari.map((h, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td
                    style={{
                      padding: '10px 12px',
                      fontWeight: 600,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fmtDateShort(h.dateKey, lang)}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      color: 'var(--text-sub)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {dayName(h.dateKey, lang)}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      color: 'var(--success)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h.jamMasuk}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      color: 'var(--danger)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h.jamKeluar}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      color: 'var(--success)',
                      fontSize: 11,
                    }}
                  >
                    {h.semuaMasuk?.join(', ') || '-'}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      color: 'var(--danger)',
                      fontSize: 11,
                    }}
                  >
                    {h.semuaKeluar?.join(', ') || '-'}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: 'var(--primary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h.durasi || '-'}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      textAlign: 'center',
                      color: 'var(--text-sub)',
                    }}
                  >
                    {h.totalAkses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RekapPage() {
  const { t, lang } = useLang();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [startDate, setStartDate] = useState(() => {
    const s = new Date();
    s.setDate(s.getDate() - 1);
    s.setHours(0, 0, 0, 0);
    return s.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => {
    const e = new Date();
    e.setDate(e.getDate() - 1);
    return e.toISOString().slice(0, 10);
  });
  const [device, setDevice] = useState('all');

  const load = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const res = await api.post('/attendance/rekap', { startDate, endDate, device });
      setData(res.data?.data || []);
    } catch (err) {
      // Error harus terlihat user, bukan hanya di console browser.
      toast(err.serverMessage || err.message || 'Gagal memuat rekap absensi', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text)',
            marginBottom: 4,
          }}
        >
          {t('page.rekap.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-sub)' }}>{t('page.rekap.sub')}</p>
      </div>

      {/* FilterBar */}
      <FilterBar onSubmit={load} submitLabel={t('f.show_rekap')}>
        <div className="form-group">
          <label className="form-label">{t('f.from')}</label>
          <input
            type="date"
            className="form-control"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ width: 150 }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('f.to')}</label>
          <input
            type="date"
            className="form-control"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ width: 150 }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('f.device')}</label>
          <select
            className="form-control"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="all">{t('f.all')}</option>
            <option value="masuk">{t('f.masuk')}</option>
            <option value="keluar">{t('f.keluar')}</option>
          </select>
        </div>
      </FilterBar>

      {/* Content Area */}
      <div style={{ position: 'relative' }}>
        {loading && (
          <div
            className="loading-overlay"
            // Aksesibilitas: tanpa role="status", screen reader tidak
            // mengumumkan apa pun selama overlay ini menutupi seluruh layar.
            // User yang buta akan mengira aplikasi beku.
            role="status"
            aria-live="polite"
            aria-busy="true"
            aria-label={t('rek.loading')}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(11, 15, 26, 0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
            }}
          >
            <div className="spinner" />
            {/* Teks untuk screen reader — spinner visual tidak terbaca. */}
            <span className="sr-only">{t('rek.loading')}</span>
          </div>
        )}

        {data.length === 0 ? (
          <div
            className="card"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="empty-state">
              <Users size={52} style={{ color: 'var(--text-muted)' }} />
              <h3>{t('empty.select_period')}</h3>
              <p>{t('empty.rekap_hint')}</p>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))',
              gap: 20,
            }}
          >
            {/* Summary Banner */}
            <div
              style={{
                gridColumn: '1/-1',
                background: 'var(--gradient-primary)',
                color: 'var(--text)',
                borderRadius: 'var(--radius)',
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 14,
                boxShadow: '0 4px 20px rgba(99, 102, 241, 0.3)',
              }}
            >
              <Users size={18} />
              <span>
                <strong>{data.length}</strong> {t('rek.employees_found')}
              </span>
              <span style={{ marginLeft: 'auto', opacity: 0.8, fontSize: 13 }}>
                {startDate} — {endDate}
              </span>
            </div>

            {/* Employee Cards */}
            {data.map((emp, i) => (
              <RekapCard key={i} emp={emp} t={t} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
