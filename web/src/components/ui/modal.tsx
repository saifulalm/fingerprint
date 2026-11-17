import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useDialogA11y } from '@/hooks/useDialogA11y';

/**
 * Modal/Dialog Component - Glass morphism style with animations
 */
// Konteks ringan agar ModalTitle di dalam Modal otomatis memakai id yang
// sama dengan aria-labelledby pada elemen dialog. Tanpa ini, screen reader
// tidak punya nama yang bisa dibacakan untuk dialog.
const ModalTitleContext = React.createContext<string | undefined>(undefined);

const Modal = React.forwardRef(({ className, children, open = false, onOpenChange, size = 'md', closeable = true, ...props }, ref) => {
  // Aksesibilitas dialog: role/aria-modal, focus trap, Escape, kembalikan fokus.
  const innerRef = React.useRef(null);
  const dialogRef = useDialogA11y(open, () => onOpenChange?.(false));

  // Judul dialog dipakai sebagai accessible name. Hook ini membuat id unik
  // otomatis sehingga aria-labelledby selalu menunjuk elemen yang benar —
  // tanpa ini screen reader hanya membacakan "dialog".
  const titleId = React.useId();

  const setRefs = (node) => {
    innerRef.current = node;
    dialogRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  // Escape dan scroll-lock SUDAH ditangani `useDialogA11y` (lihat hook:
  // register listener keydown Escape + simpan/restore body overflow).
  //
  // SEBELUMNYA Modal menambah handler Escape sendiri DAN manages
  // document.body.style.overflow sendiri. Akibatnya:
  //   - Escape memicu onOpenChange(false) DUA KALI (hook + handler lokal),
  //   - dua pihak menulis `body.style.overflow` → race saat dialog ditutup
  //     (hook restore nilai lama, lalu effect lokal menimpanya dengan '').
  //
  // Duplikasi ini dihapus; hook menjadi satu-satunya pemilik perilaku itu.

  if (!open) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={() => closeable && onOpenChange?.(false)}
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          ref={setRefs}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            'relative w-full rounded-xl bg-[#1E293B]/95 backdrop-blur-xl',
            'border border-white/10 shadow-2xl',
            'animate-in zoom-in-95 fade-in duration-200',
            sizeClasses[size],
            className
          )}
          onClick={(e) => e.stopPropagation()}
          {...props}
        >
          <ModalTitleContext.Provider value={titleId}>
            {children}
          </ModalTitleContext.Provider>
        </div>
      </div>
    </div>
  );
});
Modal.displayName = 'Modal';

const ModalHeader = React.forwardRef(({ className, children, closeable = true, onClose, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('flex items-center justify-between p-5 border-b border-white/10', className)}
      {...props}
    >
      <div className="flex-1">{children}</div>
      {closeable && (
        <button
          onClick={onClose}
          aria-label="Tutup dialog"
          className={cn(
            'ml-4 p-1.5 rounded-lg',
            'text-[#8494AD] hover:text-[#F1F5F9]',
            'hover:bg-white/5 transition-colors'
          )}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
});
ModalHeader.displayName = 'ModalHeader';

const ModalTitle = React.forwardRef(({ className, children, id, ...props }, ref) => {
  // Pakai id dari konteks Modal bila ada, supaya aria-labelledby pada
  // elemen dialog otomatis menunjuk judul ini.
  const ctxId = React.useContext(ModalTitleContext);
  return (
    <h2 ref={ref} id={id ?? ctxId} className={cn('text-lg font-semibold text-[#F1F5F9]', className)} {...props}>
      {children}
    </h2>
  );
});
ModalTitle.displayName = 'ModalTitle';

const ModalDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-[#94A3B8] mt-1', className)} {...props} />
));
ModalDescription.displayName = 'ModalDescription';

const ModalBody = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-5 max-h-[60vh] overflow-y-auto scrollbar-thin', className)} {...props} />
));
ModalBody.displayName = 'ModalBody';

const ModalFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center justify-end gap-3 p-5 border-t border-white/10', className)} {...props} />
));
ModalFooter.displayName = 'ModalFooter';

function ConfirmDialog({
  open, onOpenChange, title, description, confirmText = 'Konfirmasi', cancelText = 'Batal',
  onConfirm, variant = 'default', loading = false,
}) {
  const buttonVariants = {
    danger: 'bg-gradient-to-r from-[#EF4444] to-[#F87171] hover:shadow-[#EF4444]/30',
    warning: 'bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] hover:shadow-[#F59E0B]/30',
    default: 'bg-gradient-to-r from-[#6366F1] to-[#818CF8] hover:shadow-[#6366F1]/30',
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm">
      <ModalHeader onClose={() => onOpenChange(false)}>
        <ModalTitle>{title}</ModalTitle>
        {description && <ModalDescription>{description}</ModalDescription>}
      </ModalHeader>
      <ModalFooter>
        <button
          onClick={() => onOpenChange(false)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-semibold',
            'bg-[#1E293B] text-[#94A3B8] border border-white/10',
            'hover:bg-[#273449] transition-colors'
          )}
          disabled={loading}
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-semibold text-white',
            'shadow-lg transition-all duration-200',
            buttonVariants[variant]
          )}
          disabled={loading}
        >
          {loading ? 'Loading...' : confirmText}
        </button>
      </ModalFooter>
    </Modal>
  );
}

export { Modal, ModalHeader, ModalTitle, ModalDescription, ModalBody, ModalFooter, ConfirmDialog };
