import * as React from 'react';
import { cn, getAvatarColor } from '@/lib/utils';

/**
 * Avatar Component - With gradient background and fallback
 */
const Avatar = React.forwardRef(({ className, src, alt, name, size = 'md', status, ...props }, ref) => {
  const [imageError, setImageError] = React.useState(false);
  const initial = name?.[0]?.toUpperCase() || '?';
  const bgColor = getAvatarColor(name || alt || 'X');

  const sizeClasses = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-12 w-12 text-base',
    xl: 'h-16 w-16 text-xl',
  };

  const statusSizeClasses = {
    xs: 'h-2 w-2 border',
    sm: 'h-2.5 w-2.5 border',
    md: 'h-3 w-3 border-2',
    lg: 'h-3.5 w-3.5 border-2',
    xl: 'h-4 w-4 border-2',
  };

  const statusColors = {
    online: 'bg-[#10B981] border-[#080B14]',
    offline: 'bg-[#64748B] border-[#080B14]',
    busy: 'bg-[#EF4444] border-[#080B14]',
    away: 'bg-[#F59E0B] border-[#080B14]',
  };

  return (
    <div ref={ref} className={cn('relative inline-flex shrink-0', className)} {...props}>
      <div
        className={cn(
          'flex items-center justify-center rounded-lg font-bold text-white',
          'bg-gradient-to-br from-[#6366F1] to-[#8B5CF6]',
          sizeClasses[size]
        )}
        style={!src || imageError ? { background: bgColor } : undefined}
      >
        {src && !imageError ? (
          <img
            src={src}
            alt={alt || name || 'Avatar'}
            className="h-full w-full rounded-lg object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          initial
        )}
      </div>

      {status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full',
            statusSizeClasses[size],
            statusColors[status]
          )}
        />
      )}
    </div>
  );
});
Avatar.displayName = 'Avatar';

/**
 * Avatar Group - Multiple avatars stacked
 */
function AvatarGroup({ className, avatars, max = 4, size = 'sm', ...props }) {
  const displayed = avatars.slice(0, max);
  const remaining = avatars.length - max;

  const sizeClasses = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-12 w-12 text-base',
  };

  return (
    <div className={cn('flex -space-x-2', className)} {...props}>
      {displayed.map((avatar, index) => (
        <Avatar
          key={index}
          src={avatar.src}
          name={avatar.name}
          alt={avatar.alt}
          size={size}
          className="ring-2 ring-[#080B14]"
        />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg',
            'bg-[#1E293B] border-2 border-[#080B14]',
            'text-xs font-semibold text-[#94A3B8]',
            sizeClasses[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}

export { Avatar, AvatarGroup };
