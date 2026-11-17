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
    host: 'localhost',
    proxy: {
      '/api': {
        target: 'http://localhost:6601',
        changeOrigin: true,
      },
    },
  },
});
