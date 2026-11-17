import { useEffect, useRef } from 'react';

/**
 * useDialogA11y —-hook aksesibilitas untuk dialog kustom (overlay `position: fixed`).
 *
 * Menambahkan perilaku yang sering hilang pada modal buatan sendiri:
 * 1. `role="dialog"` + `aria-modal="true"` — pembaca layar mengetahuinya sebagai dialog.
 * 2. Fokus otomatis masuk ke dialog saat terbuka.
 * 3. Escape menutup dialog.
 * 4. Focus trap — Tab memutar di dalam dialog, tidak pernah keluar ke konten di belakang.
 * 5. Fokus dikembalikan ke elemen pemicu saat dialog ditutup.
 * 6. Scroll body dikunci selama dialog terbuka.
 *
 * *_usage_:
 *   const dialogRef = useDialogA11y(open, onClose);
 *   <div ref={dialogRef} role="dialog" aria-modal="true">…</div>
 *
 * CATATAN PENTING — pemicu yang dirender kondisional:
 * Kalau komponen dialog hanya di-render saat terbuka (`{showModal && <Modal/>}`),
 * `document.activeElement` sudah bernilai `BODY` saat hook effect berjalan, sehingga
 * fokus TIDAK bisa dikembalikan ke tombol pemicu. Untuk kasus itu, teruskan ref
 * elemen pemicu secara eksplisit:
 *   const dialogRef = useDialogA11y(open, onClose, triggerRef);
 *
 * Hook ini hanya menambah ATRIBUT dan PERILAKU; pemanggil tetap menulis
 * `role="dialog"` sendiri agar bisa menentukan label (aria-label/aria-labelledby).
 */

// Pencatatan pemicu global: elemen terakhir yang diklik pengguna.
// Di-daftarkan sekali pada level modul, dipasang saat hook pertama kali jalan.
let lastPointerTarget = null;
let pointerListenerInstalled = false;

function installPointerListener() {
  if (pointerListenerInstalled || typeof document === 'undefined') return;
  pointerListenerInstalled = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPointerTarget = e.target;
    },
    true
  );
}

export function useDialogA11y(open, onClose, triggerRef) {
  const ref = useRef(null);
  const fallbackTriggerRef = useRef(null);

  // onClose disimpan di ref agar effect utama tidak re-run tiap render.
  // `onClose` yang dibuat inline (`() => …`) berganti identitas tiap render —
  // kalau dipakai langsung sebagai dependency, effect cleanup berjalan berulang
  // kali dan capture pemicu menjadi tidak stabil.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    installPointerListener();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const node = ref.current;
    if (!node) return undefined;

    // ── 1) Tentukan pemicu SEBELUM fokus dipindahkan ke dalam dialog ──────
    // Kandidat urut: triggerRef eksplisit → capture sebelumnya → elemen yang
    // terakhir diklik (pointerdown). Semua diverifikasi masih ada di DOM dan
    // berada DI LUAR dialog.
    const candidates = [triggerRef?.current, fallbackTriggerRef.current, lastPointerTarget];
    for (const cand of candidates) {
      if (!cand) continue;
      if (!document.contains(cand)) continue; // sudah ter-unmount
      if (node.contains(cand)) continue; // sudah berada di dalam dialog
      fallbackTriggerRef.current = cand;
      break;
    }

    // Fokus ke elemen pertama yang bisa difokus di dalam dialog.
    const focusables = () =>
      Array.from(
        node.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusables()[0];
    if (first) {
      first.focus();
    } else {
      node.focus();
    }

    const onKeyDown = (e) => {
      // Escape → tutup dialog.
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      // Tab → focus trap, fokus tidak boleh keluar dari dialog.
      if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && (active === firstEl || !node.contains(active))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (active === lastEl || !node.contains(active))) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    // Kunci scroll body selama dialog terbuka (mencegah halaman di belakang
    // ikut ter-scroll saat pengguna wheel di dalam dialog).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Kembalikan fokus ke pemicu.
      const trigger = fallbackTriggerRef.current;
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [open, triggerRef]);

  return ref;
}
