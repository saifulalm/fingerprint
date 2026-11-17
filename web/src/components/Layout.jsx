// Layout — Modern 2026 Design with Glass Morphism
import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, Users, Monitor, FileText, Calendar,
  MessageSquare, LogOut, RefreshCw, Menu, X, Shield,
  Fingerprint, ChevronRight, Cpu
} from 'lucide-react';
import api from '../services/api.js';
import { useLang } from '../hooks/useLang.js';

// Navigation items
const NAV = [
  { path: '/dashboard', icon: LayoutDashboard, key: 'nav.dashboard' },
  { path: '/admin', icon: Shield, key: 'nav.admin' },
  { path: '/attendance', icon: ClipboardList, key: 'nav.attendance' },
  { path: '/rekap', icon: Users, key: 'nav.rekap' },
  { path: '/devices', icon: Monitor, key: 'nav.devices' },
  { path: '/device-center', icon: Cpu, key: 'nav.device_center' },
  { path: '/employees', icon: Fingerprint, key: 'nav.employees' },
  { path: '/reports', icon: FileText, key: 'nav.reports' },
  { path: '/scheduler', icon: Calendar, key: 'nav.scheduler' },
  { path: '/whatsapp', icon: MessageSquare, key: 'nav.whatsapp' },
];

// Sidebar component
function Sidebar({ devices, onClose, open, sidebarRef }) {
  const navigate = useNavigate();
  const { t } = useLang();
  const [user, setUser] = useState(null);
  // Deteksi viewport: sidebar di desktop (>= lg) selalu tampil, tidak pernah
  // "tertutup". Tanpa ini, atribut inert/aria-hidden akan menyembunyikan
  // sidebar dari screen reader even though user melihatnya.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    setIsDesktop(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data?.user)).catch(() => {});
  }, []);

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch (_) {}
    localStorage.removeItem('fp_token');
    navigate('/login');
  };

  // Posisi drawer dikendalikan lewat inline style. Alasannya:
  // 1. Chrome tidak bisa transition properti `left` pada elemen `position: fixed`.
  // 2. Tailwind v4 memakai properti CSS `translate` dan Lightning CSS menghapus
  //    satuan pada nilai nol, sehingga `translate` gagal di-interpolasi.
  // Inline style kebal minifier dan satuannya konsisten (px).
  // Di desktop (>= lg) sidebar selalu terlihat, jadi Translasi diabaikan lewat
  // media query `.drawer-desktop` yang menetralkan transform.
  const drawerStyle = {
    transform: open ? 'translateX(0px)' : 'translateX(-256px)',
  };

  return (
    <aside
      ref={sidebarRef}
      id="app-sidebar"
      // A11y drawer mobile: saat terbuka, sidebar berfungsi sebagai dialog
      // overlay — konten di belakangnya tidak boleh bisa difokus.
      // Di desktop sidebar selalu tampil, jadi atribut dialog HANYA dipasang
      // saat mode mobile DAN drawer sedang terbuka.
      {...(open && !isDesktop ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('nav.main') } : {})}
      className={`
        drawer
        w-64 min-h-screen bg-[#0B0F1A] flex flex-col border-r border-white/5
        fixed top-0 bottom-0 left-0 z-50
        ${open ? '' : 'pointer-events-none lg:pointer-events-auto'}
      `}
      style={drawerStyle}
      // A11y: saat drawer tertutup di mobile, seluruh isinya harus keluar dari
      // urutan focus keyboard dan dari accessibility tree. Tanpa ini, 10 link
      // navigasi masih bisa difokuskan dengan Tab walau sidebar tak terlihat
      // (screen reader & keyboard user bisa "hilang" ke navigasi tersembunyi).
      // Di desktop sidebar selalu tampil, jadi atribut ini TIDAK boleh dipasang.
      aria-hidden={!open && !isDesktop ? 'true' : undefined}
      {...(!open && !isDesktop ? { inert: '' } : {})}
    >
      {/* Logo */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] rounded-xl flex items-center justify-center shadow-lg shadow-[#6366F1]/30">
              <Fingerprint size={22} className="text-white" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#10B981] rounded-full border-2 border-[#0B0F1A] animate-pulse" />
          </div>
          <div>
            <h1 className="text-base font-bold text-[#F1F5F9] tracking-tight">BioClock</h1>
            <p className="text-[10px] font-semibold text-[#8494AD] uppercase tracking-wider">v2.0</p>
          </div>
          <button
            className="ml-auto p-2 rounded-lg text-[#8494AD] hover:text-[#F1F5F9] hover:bg-white/5 transition-colors lg:hidden"
            onClick={onClose}
            aria-label={t('nav.aria_close_menu')}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 scrollbar-thin">
        {/* Main Section */}
        <div className="mb-6">
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-[#7C8CA6]">{t('nav.main')}</p>
          <div className="space-y-1">
            {NAV.slice(0, 4).map(({ path, icon: NavIcon, key }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
                    isActive
                      ? 'bg-gradient-to-r from-[#6366F1]/20 to-[#6366F1]/10 text-[#F1F5F9] border border-[#6366F1]/30'
                      : 'text-[#94A3B8] hover:bg-white/5 hover:text-[#F1F5F9] border border-transparent'
                  }`
                }
                onClick={onClose}
              >
                <NavIcon size={18} />
                <span className="flex-1">{t(key)}</span>
              </NavLink>
            ))}
          </div>
        </div>

        {/* System Section */}
        <div className="mb-6">
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-[#7C8CA6]">{t('nav.system')}</p>
          <div className="space-y-1">
            {NAV.slice(4).map(({ path, icon: NavIcon, key }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
                    isActive
                      ? 'bg-gradient-to-r from-[#6366F1]/20 to-[#6366F1]/10 text-[#F1F5F9] border border-[#6366F1]/30'
                      : 'text-[#94A3B8] hover:bg-white/5 hover:text-[#F1F5F9] border border-transparent'
                  }`
                }
                onClick={onClose}
              >
                <NavIcon size={18} />
                <span className="flex-1">{t(key)}</span>
              </NavLink>
            ))}
          </div>
        </div>

        {/* Device Status */}
        <div className="px-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#7C8CA6]">{t('dev.name')}</p>
          <div className="space-y-2">
            {Object.entries(devices).map(([key, d]) => {
              const isOnline = d?.status === 'online';
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/5"
                >
                  <span className="relative flex h-2.5 w-2.5">
                    {isOnline && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Label device mengikuti bahasa UI. Nilai `d.label` dari
                        server selalu Bahasa Indonesia, jadi tanpa terjemahan
                        di sini sidebar tetap menampilkan "Fingerprint Masuk"
                        saat UI sedang dalam mode English. */}
                    <p className="text-xs font-medium text-[#F1F5F9] truncate">
                      {key === 'masuk' ? t('dev.masuk') : key === 'keluar' ? t('dev.keluar') : (d?.label || key)}
                    </p>
                    <p className="text-[10px] text-[#8494AD] font-mono">{d?.ip || '—'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 mb-3 p-3 rounded-xl bg-white/5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] flex items-center justify-center text-white font-bold text-sm">
            {user?.username?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#F1F5F9] truncate">{user?.username || 'Administrator'}</p>
            <p className="text-[10px] text-[#8494AD]">{t('rek.admin')}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-[#F87171] bg-[#EF4444]/10 border border-[#EF4444]/20 hover:bg-[#EF4444]/20 transition-colors"
        >
          <LogOut size={16} />
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </aside>
  );
}

// Main Layout
export default function Layout() {
  const { t, lang, toggleLang } = useLang();
  const navigate = useNavigate();
  const [devices, setDevices] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clock, setClock] = useState(new Date());

  // Deteksi viewport. Sidebar di desktop (>= lg) selalu tampil dan TIDAK
  // pernah jadi overlay — sehingga kunci scroll body dan focus trap hanya
  // boleh aktif di mode mobile. Tanpa state ini, `isDesktop` undefined
  // dan seluruh aplikasi gagal render.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    setIsDesktop(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Real-time clock
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api.get('/auth/me').catch(() => navigate('/login'));
    api.get('/devices').then(r => setDevices(r.data)).catch(() => {});
  }, [navigate]);

  // A11y drawer (mobile):
  // 1. Escape menutup drawer yang sedang terbuka.
  // 2. Fokus dipindah ke sidebar saat dibuka dan dikembalikan ke tombol
  //    pemicu saat ditutup — tanpa ini, keyboard user kehilangan konteks
  //    dan focus bisa jatuh ke elemen yang sudah di-unmount.
  const menuBtnRef = useRef(null);
  const sidebarRef = useRef(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        menuBtnRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;

      // Focus trap: keep Tab inside the sidebar while the drawer is open.
      const focusables = sidebarRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Fokus ke sidebar begitu drawer terbuka.
    const t = setTimeout(() => {
      const target = sidebarRef.current?.querySelector('a[href], button');
      target?.focus();
    }, 60);

    // Kunci scroll body saat drawer terbuka. Tanpa ini, halaman di
    // belakang ikut ter-scroll saat user swipe di layar sentuh — drawer
    // terasa "melepet" dan konten di bawahnya bergerak.
    const prevOverflow = document.body.style.overflow;
    if (!isDesktop) document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [sidebarOpen, isDesktop]);

  const handleRefresh = () => window.location.reload();
  // Ganti bahasa TANPA reload: `toggleLang` dari context/language provider
  // menyiarkan perubahan ke seluruh pohon React sekaligus. Versi lama
  // menulis ke localStorage lalu `window.location.reload()`, yang membuang
  // state halaman (filter, scroll, data yang belum termuat).
  const handleToggleLang = () => toggleLang();

  const timeStr = clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = clock.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="flex min-h-screen bg-[#080B14]">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed di semua ukuran; digeser keluar layar di mobile via transform */}
      <Sidebar devices={devices} open={sidebarOpen} onClose={() => setSidebarOpen(false)} sidebarRef={sidebarRef} />

      {/* Main Content
          `min-w-0` wajib: tanpa itu, flex anak yang lebar (mis. tabel atau
          strip tab) memaksa kontainer melebar dan halaman ikut overflow
          horizontal di mobile. */}
      <div className="flex-1 min-w-0 lg:ml-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-16 bg-[#0F172A]/80 backdrop-blur-xl border-b border-white/5 flex items-center px-6 gap-4">
          <button
            ref={menuBtnRef}
            className="lg:hidden p-2 rounded-lg text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5 transition-colors"
            onClick={() => {
              // Toggle, bukan selalu `true`: bila drawer sedang terbuka, klik
              // ulang tombol ini harus menutupnya. Tombol X dan overlay sudah
              // menyediakan cara tutup, tetapi tombol menu adalah kontrol
              // utama yang selalu terlihat di topbar.
              setSidebarOpen((v) => !v);
              if (sidebarOpen) menuBtnRef.current?.focus();
            }}
            aria-label={sidebarOpen ? t('nav.aria_close_menu') : t('nav.aria_open_menu')}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
          >
            <Menu size={20} />
          </button>

          {/* Clock */}
          <div className="flex flex-col">
            <span className="text-sm font-bold text-[#F1F5F9] font-mono">{timeStr}</span>
            <span className="text-[10px] text-[#8494AD] capitalize">{dateStr}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Language Toggle */}
            <button
              onClick={handleToggleLang}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#6366F1]/10 text-[#818CF8] border border-[#6366F1]/20 hover:bg-[#6366F1]/20 transition-colors"
              aria-label={lang === 'id' ? t('nav.aria_switch_lang') : t('nav.aria_switch_lang_en')}
            >
              {lang === 'id' ? 'EN' : 'ID'}
            </button>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/5 transition-colors"
              title={t('top.refresh')}
              aria-label={t('top.refresh')}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="min-h-[calc(100vh-4rem)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
