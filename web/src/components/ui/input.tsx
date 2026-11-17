import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Input Component - Modern glass style with focus glow
 */
const Input = React.forwardRef(({ className, type, error, icon, iconPosition = 'left', ...props }, ref) => {
  return (
    <div className="relative w-full">
      {icon && iconPosition === 'left' && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8494AD]">
          {icon}
        </div>
      )}
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-lg border bg-[#0F172A]/60 backdrop-blur-sm',
          'px-4 py-2 text-sm text-[#F1F5F9] placeholder:text-[#8494AD]',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 focus:border-[#6366F1]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error
            ? 'border-[#EF4444] focus:ring-[#EF4444]/30 focus:border-[#EF4444]'
            : 'border-white/10 hover:border-white/20',
          icon && iconPosition === 'left' && 'pl-10',
          icon && iconPosition === 'right' && 'pr-10',
          className
        )}
        ref={ref}
        {...props}
      />
      {icon && iconPosition === 'right' && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8494AD]">
          {icon}
        </div>
      )}
    </div>
  );
});
Input.displayName = 'Input';

const Textarea = React.forwardRef(({ className, error, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border bg-[#0F172A]/60 backdrop-blur-sm',
        'px-4 py-3 text-sm text-[#F1F5F9] placeholder:text-[#8494AD]',
        'transition-all duration-200 resize-none',
        'focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 focus:border-[#6366F1]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        error
          ? 'border-[#EF4444] focus:ring-[#EF4444]/30 focus:border-[#EF4444]'
          : 'border-white/10 hover:border-white/20',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

const Label = React.forwardRef(({ className, required, children, ...props }, ref) => {
  return (
    <label
      ref={ref}
      className={cn('text-xs font-semibold uppercase tracking-wider text-[#94A3B8] mb-1.5 block', className)}
      {...props}
    >
      {children}
      {required && <span className="text-[#EF4444] ml-1">*</span>}
    </label>
  );
});
Label.displayName = 'Label';

const FormGroup = React.forwardRef(({ className, label, error, hint, children, ...props }, ref) => {
  return (
    <div ref={ref} className={cn('space-y-1.5', className)} {...props}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && !error && <p className="text-xs text-[#8494AD]">{hint}</p>}
      {error && <p className="text-xs text-[#EF4444]">{error}</p>}
    </div>
  );
});
FormGroup.displayName = 'FormGroup';

const Select = React.forwardRef(({ className, error, options, placeholder, ...props }, ref) => {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-lg border bg-[#0F172A]/60 backdrop-blur-sm',
        'px-4 py-2 text-sm text-[#F1F5F9]',
        'transition-all duration-200 cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 focus:border-[#6366F1]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        error
          ? 'border-[#EF4444] focus:ring-[#EF4444]/30 focus:border-[#EF4444]'
          : 'border-white/10 hover:border-white/20',
        className
      )}
      ref={ref}
      {...props}
    >
      {placeholder && (
        <option value="" className="text-[#8494AD]">{placeholder}</option>
      )}
      {options && options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-[#1E293B]">
          {opt.label}
        </option>
      ))}
    </select>
  );
});
Select.displayName = 'Select';

export { Input, Textarea, Label, FormGroup, Select };
