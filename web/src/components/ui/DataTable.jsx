// Modern DataTable component with sorting, pagination, search
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

const PAGE_SIZES = [10, 25, 50, 100];

export function DataTable({
  columns = [],
  data = [],
  loading = false,
  selectable = false,
  selectedRows = [],
  onSelectRows,
  emptyMessage = 'Tidak ada data',
  emptyIcon: EmptyIcon = null,
  className = '',
  // Pagination
  pagination = true,
  page = 1,
  totalPages = 1,
  total = 0,
  pageSize = 25,
  onPage,
  onPageSize,
  // Search
  searchable = false,
  searchPlaceholder = 'Cari...',
  searchValue = '',
  onSearch,
  // Sort
  sortable = false,
  defaultSort,
  onSort,
}) {
  const [sortCol, setSortCol] = useState(defaultSort?.col || null);
  const [sortDir, setSortDir] = useState(defaultSort?.dir || 'asc');
  const [internalSearch, setInternalSearch] = useState('');

  const search = searchable ? (searchValue ?? internalSearch) : '';

  // Filter + sort
  const processed = useMemo(() => {
    let rows = [...data];
    if (search) {
      rows = rows.filter(row =>
        columns.some(col =>
          String(row[col.key] ?? '').toLowerCase().includes(search.toLowerCase())
        )
      );
    }
    if (sortable && sortCol) {
      rows.sort((a, b) => {
        const va = a[sortCol] ?? '';
        const vb = b[sortCol] ?? '';
        return va < vb ? (sortDir === 'asc' ? -1 : 1) : va > vb ? (sortDir === 'asc' ? 1 : -1) : 0;
      });
    }
    return rows;
  }, [data, search, sortable, sortCol, sortDir]);

  const handleSort = (col) => {
    if (!sortable) return;
    const dir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc';
    setSortCol(col);
    setSortDir(dir);
    onSort?.({ col, dir });
  };

  const pageSizes = PAGE_SIZES;
  const from = pagination ? (page - 1) * pageSize + 1 : 0;
  const to = pagination ? Math.min(page * pageSize, total || processed.length) : processed.length;

  return (
    <div className={`table-container ${className}`}>
      {/* Toolbar */}
      {(searchable || pagination) && (
        <div className="table-toolbar">
          {searchable && (
            <div className="table-search">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder={searchPlaceholder}
                value={search}
                onChange={e => {
                  const v = e.target.value;
                  setInternalSearch(v);
                  onSearch?.(v);
                }}
              />
              {search && (
                <button className="search-clear" aria-label="Bersihkan pencarian" onClick={() => { setInternalSearch(''); onSearch?.(''); }}>
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          <div className="table-meta">
            {pagination && (
              <span className="table-count">
                Menampilkan {from}–{to} dari {total || processed.length}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Table wrapper */}
      <div className="table-scroll">
        <motion.table className="data-table">
          <thead>
            <tr>
              {selectable && (
                <th className="th-check">
                  <input type="checkbox" className="checkbox" />
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`th ${sortable && col.sortable !== false ? 'sortable' : ''} ${col.align === 'right' ? 'text-right' : ''} ${col.w ? `w-${col.w}` : ''}`}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  <span className="th-content">
                    {col.label}
                    {sortable && col.sortable !== false && (
                      <span className="th-sort">
                        {sortCol === col.key
                          ? sortDir === 'asc' ? <ChevronUp size={12} />
                          : <ChevronDown size={12} />
                          : <ChevronsUpDown size={12} className="muted" />}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="tr-skeleton">
                  <td colSpan={columns.length + (selectable ? 1 : 0)}>
                    <div className="skeleton-row" />
                  </td>
                </tr>
              ))
            ) : processed.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="td-empty">
                  {EmptyIcon && <EmptyIcon size={48} className="empty-icon" />}
                  <p className="empty-title">{emptyMessage}</p>
                </td>
              </tr>
            ) : (
              processed.map((row, i) => (
                <motion.tr
                  key={row.id ?? i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.01 }}
                  className="tr-row"
                >
                  {selectable && (
                    <td className="td-check">
                      <input type="checkbox" className="checkbox" />
                    </td>
                  )}
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={`td ${col.align === 'right' ? 'text-right' : ''} ${col.mono ? 'mono' : ''}`}
                    >
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </tbody>
        </motion.table>
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="table-pagination">
          <div className="pagination-info">
            <span>Menampilkan {from}–{to} dari {total}</span>
            <select
              className="page-size-select"
              value={pageSize}
              onChange={e => onPageSize?.(parseInt(e.target.value))}
            >
              {pageSizes.map(s => <option key={s} value={s}>{s} / halaman</option>)}
            </select>
          </div>
          <div className="pagination-controls">
            {/* Tombol ikon-only WAJIB punya accessible name — tanpa itu
                screen reader hanya membacakan "button" tanpa tujuan. */}
            <button
              className="page-btn"
              disabled={page <= 1}
              onClick={() => onPage?.(page - 1)}
              aria-label="Halaman sebelumnya"
              title="Halaman sebelumnya"
            >
              <ChevronLeft size={16} />
            </button>
            {[...Array(Math.min(7, totalPages))].map((_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  className={`page-btn ${p === page ? 'active' : ''}`}
                  onClick={() => onPage?.(p)}
                  aria-label={`Halaman ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </button>
              );
            })}
            <button
              className="page-btn"
              disabled={page >= totalPages}
              onClick={() => onPage?.(page + 1)}
              aria-label="Halaman berikutnya"
              title="Halaman berikutnya"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
