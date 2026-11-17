// Modern StatCard component with animations
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

const variants = {
  blue:   { accent: '#6366F1', glow: 'rgba(99,102,241,0.15)' },
  green:  { accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
  red:    { accent: '#EF4444', glow: 'rgba(239,68,68,0.15)' },
  purple: { accent: '#8B5CF6', glow: 'rgba(139,92,246,0.15)' },
  cyan:   { accent: '#06B6D4', glow: 'rgba(6,182,212,0.15)' },
  orange: { accent: '#F59E0B', glow: 'rgba(245,158,11,0.15)' },
  pink:   { accent: '#EC4899', glow: 'rgba(236,72,153,0.15)' },
};

export function StatCard({ 
  label, 
  value, 
  sub, 
  icon: Icon, 
  variant = 'blue', 
  trend,
  loading = false,
  className = '' 
}) {
  const c = variants[variant] || variants.blue;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`stat-card ${className}`}
    >
      {/* Top accent line */}
      <div className="stat-accent" style={{ background: `linear-gradient(90deg, ${c.accent}, ${c.accent}88)` }} />
      
      {/* Glow effect on hover */}
      <div className="stat-glow" style={{ background: c.glow }} />
      
      <div className="stat-body">
        {/* Icon */}
        {Icon && (
          <div className="stat-icon" style={{ background: `${c.accent}15` }}>
            <Icon size={20} style={{ stroke: c.accent }} />
          </div>
        )}
        
        {/* Trend indicator */}
        {trend !== undefined && (
          <div className={`stat-trend ${trend >= 0 ? 'up' : 'down'}`}>
            {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
        
        {/* Value */}
        <div className="stat-value" style={{ color: c.accent }}>
          {loading ? <span className="skeleton-line" /> : (value ?? '—')}
        </div>
        
        {/* Label */}
        <div className="stat-label">{label}</div>
        
        {/* Sub */}
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </motion.div>
  );
}

// Skeleton loader
export function StatSkeleton() {
  return (
    <div className="stat-card">
      <div className="stat-accent" style={{ background: '#374151' }} />
      <div className="stat-body">
        <div className="skeleton-box w-10 h-10 rounded-xl mb-3" />
        <div className="skeleton-line w-16 h-8 mb-2" />
        <div className="skeleton-line w-full h-4 mb-1" />
        <div className="skeleton-line w-2/3 h-3" />
      </div>
    </div>
  );
}

// Multi-stat row
export function StatRow({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s, i) => (
        <StatCard key={i} {...s} />
      ))}
    </div>
  );
}
