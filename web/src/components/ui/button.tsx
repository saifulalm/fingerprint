import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Button Component with multiple variants
 * Modern 2026 design with glass effect and glow
 */
const buttonVariants = (props) => {
  const { variant = 'default', size = 'default', className } = props || {};

  const baseClass = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080B14] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]';

  const variants = {
    default: `${baseClass} bg-gradient-to-r from-[#6366F1] via-[#8B5CF6] to-[#06B6D4] text-white shadow-lg hover:shadow-xl hover:shadow-[#6366F1]/30 hover:scale-[1.02] hover:-translate-y-0.5`,
    secondary: `${baseClass} bg-[#1E293B] text-[#F1F5F9] border border-white/10 hover:bg-[#273449] hover:border-white/20`,
    ghost: `${baseClass} text-[#94A3B8] hover:bg-white/5 hover:text-[#F1F5F9]`,
    outline: `${baseClass} border border-white/10 text-[#94A3B8] hover:bg-white/5 hover:border-white/20 hover:text-[#F1F5F9]`,
    success: `${baseClass} bg-gradient-to-r from-[#10B981] to-[#34D399] text-white shadow-lg hover:shadow-xl hover:shadow-[#10B981]/30 hover:scale-[1.02] hover:-translate-y-0.5`,
    danger: `${baseClass} bg-gradient-to-r from-[#EF4444] to-[#F87171] text-white shadow-lg hover:shadow-xl hover:shadow-[#EF4444]/30 hover:scale-[1.02] hover:-translate-y-0.5`,
    link: `${baseClass} text-[#6366F1] underline-offset-4 hover:text-[#818CF8] hover:underline`,
  };

  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 rounded-md px-3 text-xs',
    lg: 'h-12 rounded-lg px-8 text-base',
    xl: 'h-14 rounded-xl px-10 text-lg',
    icon: 'h-10 w-10',
    'icon-sm': 'h-8 w-8',
    'icon-lg': 'h-12 w-12',
  };

  return cn(variants[variant] || variants.default, sizes[size] || sizes.default, className);
};

function Button({ className, variant, size, loading, children, disabled, ...props }) {
  return (
    <button
      className={buttonVariants({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
