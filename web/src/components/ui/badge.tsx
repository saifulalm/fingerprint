import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Badge Component - Neon glow style with dot indicator
 */
const badgeVariants = (props) => {
  const { variant = 'default', size = 'default', className } = props || {};

  const baseClass = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors';

  const variants = {
    default: `${baseClass} bg-[#6366F1]/15 text-[#A5B4FC] border border-[#6366F1]/30`,
    success: `${baseClass} bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30`,
    danger: `${baseClass} bg-[#EF4444]/15 text-[#F87171] border border-[#EF4444]/30`,
    warning: `${baseClass} bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30`,
    purple: `${baseClass} bg-[#8B5CF6]/15 text-[#A78BFA] border border-[#8B5CF6]/30`,
    cyan: `${baseClass} bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/30`,
    outline: `${baseClass} border border-white/20 text-[#94A3B8] bg-transparent`,
    secondary: `${baseClass} bg-[#1E293B] text-[#94A3B8] border border-white/10`,
  };

  const sizes = {
    default: 'px-2.5 py-1 text-xs',
    sm: 'px-2 py-0.5 text-[10px]',
    lg: 'px-3 py-1.5 text-sm',
  };

  return cn(variants[variant] || variants.default, sizes[size] || sizes.default, className);
};

function Badge({ className, variant, size, dot, pulse, children, ...props }) {
  const dotColors = {
    default: 'bg-[#6366F1]',
    success: 'bg-[#10B981]',
    danger: 'bg-[#EF4444]',
    warning: 'bg-[#F59E0B]',
    purple: 'bg-[#8B5CF6]',
    cyan: 'bg-[#06B6D4]',
    outline: 'bg-[#94A3B8]',
    secondary: 'bg-[#64748B]',
  };

  return (
    <div className={badgeVariants({ variant, size, className })} {...props}>
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            dotColors[variant] || dotColors.default,
            pulse && 'animate-pulse'
          )}
        />
      )}
      {children}
    </div>
  );
}

/**
 * Status Badge - Special badge for status indicators
 */
function StatusBadge({ status, className, ...props }) {
  const statusConfig = {
    online: { variant: 'success', label: 'Online', pulse: true },
    offline: { variant: 'danger', label: 'Offline', pulse: false },
    pending: { variant: 'warning', label: 'Pending', pulse: true },
    active: { variant: 'success', label: 'Active', pulse: false },
    inactive: { variant: 'secondary', label: 'Inactive', pulse: false },
  };

  const config = statusConfig[status] || statusConfig.offline;

  return (
    <Badge variant={config.variant} dot pulse={config.pulse} className={className} {...props}>
      {config.label}
    </Badge>
  );
}

/**
 * Direction Badge - Special badge for Masuk/Keluar
 */
function DirectionBadge({ direction, className, ...props }) {
  const isMasuk = direction === 'Masuk';

  return (
    <Badge variant={isMasuk ? 'success' : 'danger'} className={cn('gap-1', className)} {...props}>
      <span className="font-bold">{isMasuk ? '↑' : '↓'}</span>
      {direction}
    </Badge>
  );
}

export { Badge, badgeVariants, StatusBadge, DirectionBadge };
