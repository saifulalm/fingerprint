// Login Page - Modern 2026 Design with Glass Morphism
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fingerprint, Eye, EyeOff, AlertCircle, CheckCircle, Loader2, Shield, Zap, Database } from 'lucide-react';
import { Button } from '@/components/ui';
import { useLang } from '../hooks/useLang.js';
import { authApi } from '../services/api.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('fp_token');
    if (token) {
      // Memakai authApi (tanpa interceptor 401) — kalau token kedaluwarsa,
      // halaman ini cukup menghapus token lokal, bukan memuat ulang diri.
      authApi.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => {
          if (r.data?.authenticated) navigate('/');
          else localStorage.removeItem('fp_token');
        })
        .catch(() => localStorage.removeItem('fp_token'));
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username.trim()) { setError('Username wajib diisi'); return; }
    if (!password) { setError('Password wajib diisi'); return; }
    setError('');
    setLoading(true);
    try {
      // authApi tanpa interceptor 401: response 401 (password salah) harus
      // TETAP dibacakan agar pesan "Username atau password salah" muncul.
      // Dengan instance utama, 401 akan memicu redirect ke /login dan
      // pesan error tidak pernah terlihat.
      const res = await authApi.post('/auth/login', {
        username: username.trim(),
        password,
      });
      const data = res.data;
      if (data?.success) {
        const token = data.token || data.username;
        localStorage.setItem('fp_token', token);
        setSuccess(true);
        setTimeout(() => navigate('/'), 800);
      } else {
        setError(data?.error || 'Username atau password salah');
      }
    } catch (err) {
      // Bedakan "server mati" dari "server hidup tapi error lain" supaya
      // pesan tidak menyesatkan. err.type 'Failed to fetch' = tidak ada
      // koneksi sama sekali ke backend.
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error;
      if (status === 401) {
        setError(serverMsg || 'Username atau password salah');
      } else if (err?.name === 'TypeError' || err?.message?.includes('Failed to fetch') || !err?.response) {
        setError(
          'Tidak dapat terhubung ke server API (port 6601). Pastikan `npm run dev` berjalan di terminal dan port 6601 bebas.'
        );
      } else {
        setError(serverMsg || 'Terjadi kesalahan saat menghubungi server. Coba lagi.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#080B14]">
      {/* Animated Background Orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-[#6366F1]/20 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-[#8B5CF6]/20 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-[#06B6D4]/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '4s' }} />

        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* Login Card */}
      <div className="relative w-full max-w-md mx-4">
        <div className="absolute inset-0 bg-gradient-to-r from-[#6366F1] via-[#8B5CF6] to-[#06B6D4] rounded-2xl blur opacity-30" />

        <div className="relative bg-[#0F172A]/90 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
          {/* Top Gradient Bar */}
          <div className="h-1.5 bg-gradient-to-r from-[#6366F1] via-[#8B5CF6] to-[#06B6D4]" />

          {/* Logo Section */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="relative inline-flex">
              <div className="w-20 h-20 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-2xl flex items-center justify-center shadow-xl shadow-[#6366F1]/30">
                <Fingerprint size={40} className="text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-[#10B981] rounded-full flex items-center justify-center shadow-lg shadow-[#10B981]/50">
                <CheckCircle size={14} className="text-white" />
              </div>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-[#F1F5F9] tracking-tight">BioClock</h1>
            <p className="mt-1 text-sm text-[#8494AD]">Attendance Management System v2.0</p>
          </div>

          {/* Form Section */}
          <div className="px-8 pb-8">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-[#F1F5F9]">{lang === 'id' ? 'Selamat Datang' : 'Welcome'}</h2>
              <p className="text-sm text-[#8494AD] mt-1">{lang === 'id' ? 'Masuk untuk mengakses sistem absensi' : 'Sign in to access the attendance system'}</p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center gap-3 animate-shake">
                <AlertCircle size={18} className="text-[#EF4444] shrink-0" />
                <span className="text-sm text-[#F87171] font-medium">{error}</span>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="mb-4 p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center gap-3">
                <CheckCircle size={18} className="text-[#10B981] shrink-0" />
                <span className="text-sm text-[#34D399] font-medium">{lang === 'id' ? 'Login berhasil! Mengalihkan...' : 'Login successful! Redirecting...'}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              {/* Username Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                  {lang === 'id' ? 'Username' : 'Username'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8494AD]">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setError(''); }}
                    placeholder={lang === 'id' ? 'Masukkan username' : 'Enter username'}
                    autoComplete="username"
                    disabled={loading || success}
                    className="w-full h-12 pl-11 pr-4 rounded-xl bg-[#0F172A]/60 border border-white/10 text-[#F1F5F9] placeholder:text-[#8494AD] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 focus:border-[#6366F1] disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
                  {lang === 'id' ? 'Password' : 'Password'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8494AD]">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    placeholder={lang === 'id' ? 'Masukkan password' : 'Enter password'}
                    autoComplete="current-password"
                    disabled={loading || success}
                    className="w-full h-12 pl-11 pr-12 rounded-xl bg-[#0F172A]/60 border border-white/10 text-[#F1F5F9] placeholder:text-[#8494AD] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 focus:border-[#6366F1] disabled:opacity-50"
                  />
                  <button aria-label={t('login.aria_show_password')}
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8494AD] hover:text-[#94A3B8] transition-colors"
                    disabled={loading || success}
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={loading || success}
                className={`w-full h-12 mt-2 text-sm font-semibold ${
                  success ? 'bg-gradient-to-r from-[#10B981] to-[#34D399]' : ''
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {lang === 'id' ? 'Memverifikasi...' : 'Verifying...'}
                  </>
                ) : success ? (
                  <>
                    <CheckCircle size={18} />
                    {lang === 'id' ? 'Berhasil!' : 'Success!'}
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    {lang === 'id' ? 'Masuk ke Sistem' : 'Sign In'}
                  </>
                )}
              </Button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-[#0F172A]/50 border-t border-white/5">
            <div className="flex items-center justify-center gap-6">
              <div className="flex items-center gap-2 text-xs text-[#8494AD]">
                <Shield size={14} className="text-[#10B981]" />
                <span>{t('login.secure_auth')}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#8494AD]">
                <Zap size={14} className="text-[#6366F1]" />
                <span>{t('login.fast_api')}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#8494AD]">
                <Database size={14} className="text-[#8B5CF6]" />
                <span>{t('login.postgresql')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Version */}
        <p className="text-center text-xs text-[#8494AD] mt-4">
          BioClock Attendance System v2.0 • {new Date().getFullYear()}
        </p>
      </div>

      <style>{`
      `}</style>
    </div>
  );
}
