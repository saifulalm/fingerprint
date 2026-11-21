// Template jadwal — panel preset siap pakai.
//
// Komponen ini terpisah dari SchedulerPage supaya file utama tidak
// membengkak (CLAUDE.md: pecah komponen > 250 baris).
//
// Alur:
//   1. Halaman ambil daftar template dari GET /api/scheduler/templates.
//   2. User klik satu template → form jadwal terisi otomatis.
//   3. User tinggal adjusting penerima & klik Simpan.
//
// Template TIDAK membuat jadwal sendiri — form tetap harus disimpan
// supaya nama & penerima bisa disesuaikan. Ini disengaja: template
// adalah titik awal, bukan jadwal jadi.
import { useState } from 'react';
import { Loader, Check, Sparkles, X } from 'lucide-react';

export default function TemplatePanel({ templates, loading, onApply, onClose, t, lang }) {
  const [activeId, setActiveId] = useState(null);

  const apply = (tpl) => {
    setActiveId(tpl.id);
    onApply(tpl);
    // Tutup panel setelah Choosing template supaya form langsung terlihat.
    // Timeout singkat supaya state "dipilih" sempat ter-render.
    setTimeout(() => setActiveId(null), 600);
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid rgba(99, 102, 241, 0.25)',
      borderRadius: 'var(--radius)',
      marginBottom: '16px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.04))',
        padding: '14px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <span style={{
            width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(99, 102, 241, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--primary-light)', flexShrink: 0,
          }}>
            <Sparkles size={15} />
          </span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              {t('sched.templates_title') || 'Template Jadwal'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
              {t('sched.templates_sub') || 'Pilih template, form akan terisi otomatis.'}
            </div>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            aria-label={t('sched.aria_close_templates') || 'Tutup template'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '5px',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '16px 18px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
            <Loader size={22} style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 10px' }} />
            <span style={{ fontSize: '12px' }}>{t('loading')}</span>
          </div>
        ) : !templates?.length ? (
          <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)', fontSize: '13px' }}>
            {t('sched.templates_empty') || 'Belum ada template jadwal.'}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
            gap: '12px',
          }}>
            {templates.map((tpl) => {
              const isApplied = activeId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => apply(tpl)}
                  disabled={isApplied}
                  aria-label={`${t('sched.templates_use') || 'Gunakan template'} ${tpl.name}`}
                  style={{
                    textAlign: 'left',
                    cursor: isApplied ? 'default' : 'pointer',
                    padding: '13px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: isApplied
                      ? '1px solid var(--success)'
                      : '1px solid var(--border)',
                    background: isApplied ? 'rgba(16, 185, 129, 0.08)' : 'var(--surface)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '7px',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    if (!isApplied) e.currentTarget.style.borderColor = 'var(--primary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isApplied) e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  {/* Nama + badge recommended */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>
                      {tpl.name}
                    </span>
                    {tpl.recommended && (
                      <span style={{
                        fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
                        padding: '2px 7px', borderRadius: 'var(--radius-full)',
                        background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)',
                        border: '1px solid rgba(16, 185, 129, 0.3)', flexShrink: 0,
                      }}>
                        {t('sched.templates_recommended') || 'Disarankan'}
                      </span>
                    )}
                  </div>

                  {/* Deskripsi */}
                  <div style={{
                    fontSize: '11.5px', color: 'var(--text-sub)', lineHeight: 1.5,
                    fontWeight: 400,
                  }}>
                    {tpl.description}
                  </div>

                  {/* Cron + kanal */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap',
                    marginTop: '2px',
                  }}>
                    <code style={{
                      background: 'rgba(99, 102, 241, 0.08)', padding: '2px 6px',
                      borderRadius: 'var(--radius-xs)', fontSize: '10.5px',
                      color: 'var(--primary-light)', fontFamily: 'monospace',
                      border: '1px solid rgba(99, 102, 241, 0.15)',
                    }}>
                      {tpl.cronExpr}
                    </code>
                    <span style={{
                      fontSize: '10px', color: 'var(--text-muted)',
                      padding: '2px 7px', borderRadius: 'var(--radius-full)',
                      background: 'var(--border)', fontWeight: 600,
                    }}>
                      {tpl.lang.toUpperCase()}
                    </span>
                    {isApplied && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                        fontSize: '10.5px', color: 'var(--success)', fontWeight: 600,
                      }}>
                        <Check size={11} />
                        {t('sched.templates_applied') || 'Dipakai'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
