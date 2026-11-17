import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react';

/**
 * Table Component - Modern style with hover effects
 */
const Table = React.forwardRef(({ className, ...props }, ref) => (
  <div className="w-full overflow-auto scrollbar-thin">
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('bg-gradient-to-r from-[#0F172A] to-[#1E293B]', 'border-b border-white/10', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('divide-y divide-white/5', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('border-t border-white/10 bg-white/5 font-medium', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn('transition-colors duration-150', 'hover:bg-[#6366F1]/5', className)} {...props} />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef(({ className, sortable, sorted, onSort, children, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-12 px-4 text-left align-middle font-semibold uppercase tracking-wider',
      'text-[10px] text-[#8494AD]',
      'whitespace-nowrap',
      sortable && 'cursor-pointer select-none hover:text-[#94A3B8]',
      className
    )}
    onClick={sortable ? onSort : undefined}
    {...props}
  >
    <div className="flex items-center gap-1">
      {children}
      {sortable && (
        <span className="ml-1">
          {sorted === 'asc' ? (
            <ChevronUp size={12} className="text-[#6366F1]" />
          ) : sorted === 'desc' ? (
            <ChevronDown size={12} className="text-[#6366F1]" />
          ) : (
            <ChevronsUpDown size={12} className="opacity-30" />
          )}
        </span>
      )}
    </div>
  </th>
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('p-4 align-middle text-sm text-[#F1F5F9]', className)} {...props} />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-[#8494AD]', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

function TableEmpty({ columns, message = 'Tidak ada data', icon }) {
  return (
    <tr>
      <td colSpan={columns} className="h-48 text-center">
        <div className="flex flex-col items-center justify-center text-[#8494AD]">
          {icon || <Search size={48} className="mb-3 opacity-40" />}
          <p className="text-sm font-medium">{message}</p>
          <p className="text-xs mt-1">Coba ubah filter atau tanggal pencarian</p>
        </div>
      </td>
    </tr>
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, TableEmpty };
