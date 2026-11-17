import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card Component - Glass morphism style with hover effects
 */
const Card = React.forwardRef(({ className, variant = 'default', hover = false, glow = 'none', children, ...props }, ref) => {
  const variants = {
    default: 'bg-[#1E293B] border border-white/10',
    glass: 'bg-white/5 backdrop-blur-xl border border-white/10',
    elevated: 'bg-[#273449] border border-white/15 shadow-xl',
    outline: 'bg-transparent border border-white/20',
  };

  const glows = {
    primary: 'hover:shadow-[0_0_30px_rgba(99,102,241,0.25)]',
    success: 'hover:shadow-[0_0_30px_rgba(16,185,129,0.25)]',
    danger: 'hover:shadow-[0_0_30px_rgba(239,68,68,0.25)]',
    none: '',
  };

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl transition-all duration-300',
        variants[variant],
        hover && 'hover:-translate-y-1 hover:border-white/20',
        hover && glows[glow],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
Card.displayName = 'Card';

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight text-[#F1F5F9]', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-[#94A3B8]', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

/**
 * Stat Card - Special card for dashboard statistics
 */
const StatCard = React.forwardRef(({ className, label, value, trend, icon, color = 'primary', ...props }, ref) => {
  const colors = {
    primary: { accent: 'bg-gradient-to-r from-[#6366F1] to-[#818CF8]', text: 'text-[#818CF8]', bg: 'bg-[#6366F1]/10' },
    success: { accent: 'bg-gradient-to-r from-[#10B981] to-[#34D399]', text: 'text-[#34D399]', bg: 'bg-[#10B981]/10' },
    danger: { accent: 'bg-gradient-to-r from-[#EF4444] to-[#F87171]', text: 'text-[#F87171]', bg: 'bg-[#EF4444]/10' },
    warning: { accent: 'bg-gradient-to-r from-[#F59E0B] to-[#FBBF24]', text: 'text-[#FBBF24]', bg: 'bg-[#F59E0B]/10' },
    purple: { accent: 'bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA]', text: 'text-[#A78BFA]', bg: 'bg-[#8B5CF6]/10' },
    cyan: { accent: 'bg-gradient-to-r from-[#06B6D4] to-[#22D3EE]', text: 'text-[#22D3EE]', bg: 'bg-[#06B6D4]/10' },
  };

  return (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-xl bg-[#1E293B] border border-white/10 p-5',
        'transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-xl',
        'animate-enter',
        className
      )}
      {...props}
    >
      <div className={cn('absolute top-0 left-0 right-0 h-1', colors[color].accent)} />

      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#94A3B8] mb-1 truncate">{label}</p>
          <p className={cn('text-3xl font-bold tracking-tight truncate', colors[color].text)}>
            {value}
          </p>
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              <span className={cn('inline-flex items-center text-xs font-semibold', trend.positive ? 'text-[#10B981]' : 'text-[#EF4444]')}>
                {trend.positive ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
              <span className="text-xs text-[#8494AD]">vs last period</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('p-2.5 rounded-lg', colors[color].bg)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
});
StatCard.displayName = 'StatCard';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, StatCard };
