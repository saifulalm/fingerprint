import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Skeleton Component - Shimmer loading effect
 */
function Skeleton({ className, variant = 'rounded', width, height, style, ...props }) {
  const variants = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-none',
    rounded: 'rounded-lg',
  };

  return (
    <div
      className={cn('animate-shimmer', variants[variant], className)}
      style={{ width, height, ...style }}
      {...props}
    />
  );
}

function SkeletonRow({ columns = 5 }) {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="p-3">
          <Skeleton height={16} className="w-full" />
        </td>
      ))}
    </tr>
  );
}

function TableSkeleton({ rows = 5, columns = 5 }) {
  return (
    <div className="rounded-lg border border-white/10 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-white/5">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="p-3 text-left">
                <Skeleton height={12} className="w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl bg-[#1E293B] border border-white/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton height={14} className="w-24" />
        <Skeleton variant="circular" width={40} height={40} />
      </div>
      <Skeleton height={32} className="w-16" />
      <Skeleton height={12} className="w-32" />
    </div>
  );
}

function StatsGridSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton height={28} className="w-48" />
          <Skeleton height={16} className="w-32" />
        </div>
        <Skeleton height={40} width={120} />
      </div>
      <StatsGridSkeleton count={4} />
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}

export { Skeleton, SkeletonRow, TableSkeleton, CardSkeleton, StatsGridSkeleton, PageSkeleton };
