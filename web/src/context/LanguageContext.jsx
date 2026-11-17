// Global language context — SATU-SATUNYA sumber kebenaran bahasa UI.
//
// MASALAH YANG DISELESAIKAN (bug class "useLang bukan context"):
//   Hook `useLang()` lama menyimpan `lang` di state LOKAL tiap komponen.
//   Akibatnya `setLang()` di satu komponen tidak pernah mengupdate komponen
//   lain, dan tombol ganti bahasa harus memaksa `window.location.reload()`.
//   Dengan context, satu `setLang` langsung menyiarkan ke seluruh pohon.
//
// PERUBAHAN: `web/src/hooks/useLang.js` sekarang mengekspor hook yang sama
// lewat barrel ini, sehingga SELURUH call site lama (`import { useLang }
// from '../hooks/useLang.js'`) tetap berfungsi tanpa perubahan.
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { LANGS } from '../hooks/langData.js';

const STORAGE_KEY = 'fp_lang';
const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  // Bahasa awal: dari localStorage, default 'id'.
  const [lang, setLangState] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === 'en' ? 'en' : 'id';
  });

  // Simpan ke localStorage setiap kali berubah.
  useMemo(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage penuh/terblokir */ }
  }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next === 'en' ? 'en' : 'id');
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'id' ? 'en' : 'id'));
  }, []);

  // Terjemahkan key. Fallback berjenjang: bahasa aktif → English → Indonesia → key.
  // Tanpa fallback English, satu key yang hilang di `en` akan menampilkan teks
  // Indonesia ke user yang memilih English (lihat bug class "lbl() fallback").
  const t = useCallback((key) => {
    if (!key) return key;
    const active = LANGS[lang];
    if (active && active[key] != null) return active[key];
    if (LANGS.en && LANGS.en[key] != null) return LANGS.en[key];
    if (LANGS.id && LANGS.id[key] != null) return LANGS.id[key];
    return key;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, toggleLang, t }), [lang, setLang, toggleLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Hook akses bahasa global.
 * Bila dipanggil DI LUAR provider (mis. unit test), tetap berfungsi —
 * mengembalikan bahasa default 'id' tanpa crash.
 */
export function useLang() {
  const ctx = useContext(LanguageContext);
  const fallback = useMemo(() => ({
    lang: 'id',
    setLang: () => {},
    toggleLang: () => {},
    t: (key) => (LANGS.id && LANGS.id[key] != null ? LANGS.id[key] : key),
  }), []);
  return ctx || fallback;
}

export { LANGS };
