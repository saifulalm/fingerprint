// Style bersama untuk komponen webhook.
//
// Dipisah ke file sendiri supaya tiap komponen webhook tetap di bawah
// batas 250 baris (aturan CLAUDE.md) dan gaya tidak diduplikasi.

/** Gaya kartu utama (kontainer panel). */
export const cardStyle = {
  background: 'var(--glass-bg)', backdropFilter: 'blur(20px)',
  borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', padding: 20,
};

/**
 * Pembuat gaya tombol.
 * @param {string} bg - warna latar
 * @param {string} color - warna teks
 * @param {object} extra - gaya tambahan
 */
export const btnStyle = (bg, color = '#fff', extra = {}) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px',
  border: 'none', borderRadius: 'var(--radius-sm)', background: bg, color,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  ...extra,
});

/** Gaya tombol versi kecil (untuk baris daftar). */
export const smallBtnStyle = (bg, color = '#fff', extra = {}) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
  border: 'none', borderRadius: 'var(--radius-sm)', background: bg, color,
  fontSize: 11, fontWeight: 600, ...extra,
});

/** Warna status event pada riwayat. */
export const STATUS_COLORS = {
  processed: 'var(--success)',
  received: 'var(--warning)',
  duplicate: 'var(--cyan)',
  ignored: 'var(--text-muted)',
  failed: 'var(--danger)',
};
