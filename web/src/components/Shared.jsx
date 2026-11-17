// StatCard component — reusable dashboard stat tile
import { TrendingUp, TrendingDown, Users, Calendar, Activity } from 'lucide-react';

export function StatCard({ value, label, sub, color = 'blue', icon: Icon }) {
  const colors = {
    blue:   { bg: '#EFF6FF', stroke: 'var(--primary)',   border: '#DBEAFE' },
    green:  { bg: '#F0FDF4', stroke: 'var(--success)',  border: '#DCFCE7' },
    red:    { bg: '#FEF2F2', stroke: 'var(--danger)',    border: '#FEE2E2' },
    purple: { bg: '#F5F3FF', stroke: 'var(--purple)',    border: '#EDE9FE' },
    cyan:   { bg: '#ECFEFF', stroke: 'var(--cyan)',      border: '#CFFAFE' },
    orange: { bg: '#FFF7ED', stroke: 'var(--warning)',   border: '#FFEDD5' },
  };
  const c = colors[color] || colors.blue;

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, transition: 'all .2s', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${c.stroke}, ${c.stroke}88)`, borderRadius: 'var(--radius) var(--radius) 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {Icon && (
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={20} style={{ stroke: c.stroke }} />
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, letterSpacing: '-.5px', color: 'var(--text)' }}>{value ?? '—'}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 5, color: 'var(--text)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// FilterBar component
export function FilterBar({ children, onSubmit, submitLabel = 'Tampilkan', submitIcon }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        {children}
        {onSubmit && (
          <button className="btn btn-primary" onClick={onSubmit} style={{ height: 36, alignSelf: 'flex-end' }}>
            {submitIcon}
            {submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// Section header
export function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 12.5, color: 'var(--text-sub)', marginTop: 3 }}>{subtitle}</p>}
    </div>
  );
}

// Loading overlay wrapper
export function LoadingOverlay({ loading, children }) {
  return (
    <div style={{ position: 'relative' }}>
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
        </div>
      )}
      {children}
    </div>
  );
}
