import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 6602,
    // strictPort: Vite DILARANG diam-diam pindah ke port lain kalau 6602 sibuk.
    // Kalau pindah port, proxy /api tetap mengarah ke 6601 tetapi URL yang
    // dibuka user jadi berbeda dari yang dikonfigurasi → sumber kebingungan
    // "Tidak dapat terhubung ke server". Dengan strictPort, Vite gagal loudly.
    strictPort: true,
    // host: true → listen di semua interface (0.0.0.0 + IPv6), BUKAN hanya
    // loopback.
    //
    // SEBELUMNYA: host: 'localhost' membuat Vite listen HANYA di [::1] (IPv6
    // loopback). Reverse proxy yang resolve ke 127.0.0.1 (IPv4) lalu gagal
    // menjangkau Vite → "Tidak dapat terhubung ke server", padahal prosesnya
    // hidup. Bind ke semua interface menutup celah itu.
    //
    // CATATAN KEAMANAN: dev server kini dapat dijangkau dari jaringan lokal.
    // Ini disengaja untuk mode preview/remote-access. Untuk produksi JANGAN
    // pakai dev server — pakai `npm run build:web` + `npm start` (Express
    // menyajikan web/dist di 6601) di belakang reverse proxy.
    host: true,
    // ─── Host yang boleh mengakses dev server ─────────────────────────────────
    //
    // MASALAH:
    //   Vite memblokir request yang Host header-nya bukan localhost/IP.
    //   Aplikasi diakses lewat domain publik (mis. tunnel/reverse proxy
    //   pointing ke 6602) → browser menampilkan:
    //     "Blocked request. This host ("...") is not allowed."
    //   Padahal front-end-nya sendiri sehat.
    //
    // Aturan Vite: entri yang diawali "." dicocokkan sebagai SUFFIX, jadi
    // ".educationpartnerships.net" mengizinkan seluruh subdomain-nya.
    // Host IPv4 dan localhost selalu diizinkan tanpa perlu didaftarkan.
    allowedHosts: [
      'fingerprint.educationpartnerships.net',
      '.educationpartnerships.net',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:6601',
        changeOrigin: true,
      },
    },
  },
  // Sama untuk `vite preview` — dipakai saat smoke test hasil build.
  preview: {
    allowedHosts: [
      'fingerprint.educationpartnerships.net',
      '.educationpartnerships.net',
    ],
  },
});
