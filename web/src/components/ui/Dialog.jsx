// Radix UI Dialog Component - Modern accessible modal
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Dialog Root ────────────────────────────────────────────────────
export function Dialog({ children, open, onOpenChange }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export function DialogTrigger({ children, asChild = false }) {
  return <RadixDialog.Trigger asChild={asChild}>{children}</RadixDialog.Trigger>;
}

// ─── Dialog Content with Framer Motion ──────────────────────────────
export function DialogContent({ children, title, description, size = 'default', showClose = true }) {
  const sizeClasses = {
    sm: 'max-w-md',
    default: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw]',
  };

  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay asChild>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        />
      </RadixDialog.Overlay>
      <RadixDialog.Title className="hidden">{title}</RadixDialog.Title>
      {description && <RadixDialog.Description className="hidden">{description}</RadixDialog.Description>}
      <AnimatePresence mode="wait">
        <RadixDialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${sizeClasses[size]} bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl z-50 focus:outline-none`}
          >
            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-700/30">
                <RadixDialog.Title className="text-lg font-bold text-slate-100">
                  {title}
                </RadixDialog.Title>
                {showClose && (
                  <RadixDialog.Close aria-label="Tutup dialog" className="rounded-lg p-1.5 hover:bg-slate-800 transition-colors">
                    <X className="w-4 h-4 text-slate-400" />
                  </RadixDialog.Close>
                )}
              </div>
            )}
            {/* Body */}
            <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </RadixDialog.Content>
      </AnimatePresence>
    </RadixDialog.Portal>
  );
}

// ─── Simple Alert Dialog ────────────────────────────────────────────
export function AlertDialog({ open, onOpenChange, title, description, children, footer }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} size="sm">
        {description && (
          <p className="text-slate-400 text-sm mb-4">{description}</p>
        )}
        {children}
        {footer && <div className="flex justify-end gap-3 mt-6">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
