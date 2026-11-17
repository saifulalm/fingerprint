// API service — axios client with auth interceptor + React Query helpers
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Ekstrak pesan error dari body respons ─────────────────────────────────
//
// Body error bisa berupa tiga bentuk tergantung tipe respons yang diminta:
//   1. Objek JSON  → { error: '...' } atau { message: '...' }
//   2. Teks biasa  → body HTML/teks dari proxy atau error server
//   3. Blob        → respons biner (export Excel/PDF) yang dikembalikan
//                    axios sebagai Blob saat responseType: 'blob'
//
// SEBELUMNYA hanya bentuk 1 yang dibaca. Request biner yang gagal (mis.
// "Rentang tanggal wajib diisi") kehilangan pesannya, dan user hanya melihat
// "HTTP 500" — padahal server sudah menjelaskan penyebabnya dengan jelas.
async function extractServerMessage(data) {
  if (data == null) return null;

  // Bentuk 1: objek JSON
  if (typeof data === 'object' && !(data instanceof Blob)) {
    return data.error || data.message || null;
  }

  // Bentuk 3: Blob — baca teksnya lalu coba parse sebagai JSON.
  if (data instanceof Blob) {
    const text = await data.text().catch(() => '');
    if (!text) return null;
    try {
      const j = JSON.parse(text);
      return j?.error || j?.message || null;
    } catch {
      // Body HTML dari SPA fallback — terlalu besar untuk ditampilkan apa
      // adanya, jadi biometric atau pesan teknis dibuang.
      return null;
    }
  }

  // Bentuk 2: teks biasa
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return null;
    // Coba JSON dulu (server mungkin kirim JSON sebagai teks).
    try {
      const j = JSON.parse(trimmed);
      return j?.error || j?.message || null;
    } catch {
      // HTML → jangan tampilkan mentah ke user.
      if (trimmed.startsWith('<')) return null;
      return trimmed.slice(0, 500);
    }
  }

  return null;
}

// Always parse response body — even for non-2xx so we never get "Unexpected end of JSON input"
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    // 401 → redirect to login
    if (err.response?.status === 401) {
      localStorage.removeItem('fp_token');
      window.location.href = '/login';
      return Promise.reject(err);
    }
    // Extract error message from response body if available
    if (err.response?.data) {
      const msg = await extractServerMessage(err.response.data);
      if (msg) err.serverMessage = msg;
    } else if (err.request && !err.response) {
      // Request made, no response received — network error or timeout
      err.serverMessage = 'Server tidak merespons. Periksa koneksi ke server.';
    }
    return Promise.reject(err);
  }
);

// ─── Instance terpisah untuk halaman login ─────────────────────────────────
//
// Halaman login TIDAK boleh memakai instance utama: interceptor 401 di atas
// menghapus token dan me-redirect ke /login. Saat user salah mengetik
// password (server membalas 401), halaman login akan memuat ulang dirinya
// sendiri dan pesan "Username atau password salah" tidak pernah terlihat.
//
// Instance ini sengaja TANPA interceptor 401 — biarkan halaman yang
// menentukan apa yang terjadi.
export const authApi = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Helper respons non-JSON ────────────────────────────────────────────────
//
// Untuk endpoint yang mengembalikan HTML (pratinjau) atau berkas biner
// (export Excel/PDF), axios tetap dipakai — bukan fetch() mentah — supaya
// header auth, interceptor 401, dan err.serverMessage tetap berlaku.
//
// Catatan: `useApi.js` pernah memakai fetch() mentah untuk endpoint export.
// Konsekuensinya: token kedaluwarsa tidak memicu redirect ke /login dan
// pesan error server hilang. Semua request sekarang lewat instance axios.
export async function apiGetText(url, params) {
  const res = await api.get(url, { params, responseType: 'text' });
  return res.data;
}

export async function apiGetBlob(url, params) {
  const res = await api.get(url, { params, responseType: 'blob' });
  return res.data;
}

export async function apiGetJson(url, params) {
  const res = await api.get(url, { params });
  return res.data;
}

// ─── React Query Key Factory ────────────────────────────────────────────────────────
// Centralized query keys for consistent cache management
export const queryKeys = {
  // Attendance
  attendance: (filters) => ['attendance', filters],
  attendanceList: (params) => ['attendance-list', params],
  attendanceStats: (dates) => ['attendance-stats', dates],
  
  // Dashboard
  dashboard: (dates) => ['dashboard', dates],
  dashboardStats: ['dashboard-stats'],
  
  // Devices
  devices: ['devices'],
  deviceUsers: ['device-users'],
  
  // Employees
  employees: ['employees'],
  employee: (id) => ['employee', id],
  
  // Reports
  reportPreview: (params) => ['report-preview', params],
  
  // Schedules
  schedules: ['schedules'],
  schedule: (id) => ['schedule', id],
  
  // Settings
  settings: ['settings'],
  
  // Admin
  adminDashboard: ['admin-dashboard'],
  auditLogs: (filters) => ['audit-logs', filters],
  
  // Auth
  auth: ['auth'],
  authMe: ['auth-me'],
};

export default api;
