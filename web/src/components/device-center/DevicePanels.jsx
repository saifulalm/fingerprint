// Device Center — sub-komponen tampilan.
// Dipisah dari halaman utama agar tiap file tetap kecil dan fokus.
// Semua nilai visual memakai token CSS dari index.css (bukan hex hardcoded).

/** Panel kartu dengan judul + aksi di kanan. */
export function Panel({ title, subtitle, actions, children, style }) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 18,
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
            {subtitle && (
              <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{subtitle}</p>
            )}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Baris label→nilai yang dipakai di seluruh panel informasi. */
export function InfoRow({ label, value, mono = false }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '7px 0',
        borderBottom: '1px solid var(--border)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: 'var(--text)',
          fontWeight: 600,
          textAlign: 'right',
          minWidth: 0,
          wordBreak: 'break-word',
          fontFamily: mono ? 'monospace' : 'inherit',
        }}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

/** Lencana status menyala/mati. */
export function StatusPill({ active, activeText = 'Online', inactiveText = 'Offline' }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11,
        fontWeight: 600,
        background: active
          ? 'color-mix(in srgb, var(--success) 15%, transparent)'
          : 'color-mix(in srgb, var(--danger) 15%, transparent)',
        color: active ? 'var(--success)' : 'var(--danger)',
        border: `1px solid ${active
          ? 'color-mix(in srgb, var(--success) 30%, transparent)'
          : 'color-mix(in srgb, var(--danger) 30%, transparent)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? 'var(--success)' : 'var(--danger)',
        }}
      />
      {active ? activeText : inactiveText}
    </span>
  );
}

/**
 * Peta kapabilitas: daftar flag dengan tanda centang/silang.
 * Flag dibaca dari perangkat, jadi nama flag ditampilkan apa adanya —
 * tidak ada daftar hardcoded yang bisa basi.
 */
export function CapabilityGrid({ flags }) {
  if (!flags?.length) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        Tidak ada kapabilitas yang dilaporkan perangkat.
      </p>
    );
  }
  const supported = flags.filter((f) => f.supported);
  const unsupported = flags.filter((f) => !f.supported);
  const row = (f) => (
    <div
      key={f.key}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '5px 9px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        fontSize: 11.5,
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: f.supported ? 'var(--text)' : 'var(--text-muted)',
          fontFamily: 'monospace',
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {f.key}
      </span>
      <span
        style={{
          fontWeight: 700,
          fontSize: 10.5,
          flexShrink: 0,
          color: f.supported ? 'var(--success)' : 'var(--text-muted)',
        }}
      >
        {f.supported ? '✓' : '✕'}
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {supported.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--success)',
              marginBottom: 6,
            }}
          >
            Didukung ({supported.length})
          </div>
          <div style={{ display: 'grid', gap: 6 }}>{supported.map(row)}</div>
        </div>
      )}
      {unsupported.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 6,
            }}
          >
            Tidak didukung ({unsupported.length})
          </div>
          <div style={{ display: 'grid', gap: 6 }}>{unsupported.map(row)}</div>
        </div>
      )}
    </div>
  );
}

/** Empty state dengan pesan jelas — layar tidak boleh pernah kosong diam-diam. */
export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div
      style={{
        padding: '28px 20px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        background: 'var(--bg)',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {Icon && <Icon size={26} style={{ opacity: 0.5, marginBottom: 8 }} />}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-sub)' }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
