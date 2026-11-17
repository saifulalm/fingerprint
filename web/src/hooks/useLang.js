// Barrel kompatibilitas untuk hook bahasa.
//
// SEBELUMNYA file ini berisi definisi LANGS + hook `useLang` dengan state
// LOKAL per-komponen (bug: ganti bahasa tidak menyinkronkan halaman lain).
// Sekarang logika dipindah ke `context/LanguageContext.jsx` (state global),
// dan file ini hanya meneruskan export supaya SELURUH import lama
// (`import { useLang } from '../hooks/useLang.js'`) tetap valid.
export { useLang, LanguageProvider, LANGS } from '../context/LanguageContext.jsx';
