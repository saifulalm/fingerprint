// Halaman Pengaturan — tempat semua konfigurasi sistem.
//
// SEBELUMNYA tidak ada halaman Pengaturan sendiri. `SettingsPanel` hanya
// di-embed di dalam halaman WhatsApp (tab "Pengaturan"), sehingga:
//   - menu sidebar tidak punya entri Pengaturan sama sekali
//   - "Nama Perusahaan" (yang dipakai di judul laporan & subjek email)
//     berada di tab "Umum" — 3 klik dari menu: WhatsApp → Pengaturan → Umum
//
// Sekarang halaman ini jadi pintu masuk langsung ke tab "Umum", dan panel
// tetap bisa dipakai di tempat lain lewat `initialTab`.
import { useState } from 'react';
import { useLang } from '../hooks/useLang.js';
import { Settings as SettingsIcon, Globe, Mail, MessageSquare } from 'lucide-react';
import SettingsPanel from '../components/SettingsPanel.jsx';

// Tab yang bisa dipilih dari halaman ini. "Umum" jadi default karena di
// situulah "Nama Perusahaan" berada — tujuan paling sering dicari user.
const TABS = [
  { key: 'general',   label: { id: 'Umum',            en: 'General' },        icon: Globe },
  { key: 'email',     label: { id: 'Email / SMTP',   en: 'Email / SMTP' },   icon: Mail },
  { key: 'whatsapp',  label: { id: 'WhatsApp',        en: 'WhatsApp' },        icon: MessageSquare },
];

export default function SettingsPage() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState('general');

  const L = (o) => (o && typeof o === 'object' ? (o[lang] ?? o.id ?? '') : (o ?? ''));

  return (
    <div className="space-y-5">
      {/* Judul halaman */}
      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center rounded-lg"
          style={{ width: 36, height: 36, background: 'rgba(99, 102, 241, 0.15)' }}
        >
          <SettingsIcon size={18} className="text-[#818CF8]" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-[#F1F5F9]">
            {t('settings.page_title') || 'Pengaturan'}
          </h1>
          <p className="text-xs text-[#8494AD]">
            {t('settings.page_subtitle') ||
              'Nama perusahaan, judul laporan, email, dan WhatsApp — semuanya di satu tempat.'}
          </p>
        </div>
      </div>

      {/* Pemilih tab — dibuat sendiri supaya tab awal bisa dipilih SEBELUM
          panel dirender (panel punya tab internal sendiri). */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('settings.page_title') || 'Pengaturan'}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                background: active ? 'rgba(99, 102, 241, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                color: active ? '#A5B4FC' : '#8494AD',
                border: '1px solid ' + (active ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255,255,255,0.08)'),
              }}
            >
              <Icon size={14} />
              {L(label)}
            </button>
          );
        })}
      </div>

      {/* Panel — key dipakai agar tab internal ikut berubah saat tab di atas
          diklik (remount dengan initialTab baru).

          showHeader={false} karena halaman ini sudah punya judul sendiri;
          kalau header panel ikut tampil, "Pengaturan" muncul dua kali. */}
      <SettingsPanel key={tab} initialTab={tab} showHeader={false} />
    </div>
  );
}
