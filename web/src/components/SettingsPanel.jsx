// SettingsPanel — komponen pengaturan sistem (SMTP/Email, WhatsApp, Umum).
//
// Modul ini TIDAK lagi menjadi halaman /settings terpisah. Semua
// konfigurasi dipanggil dari dalam halaman WhatsApp (tab "Pengaturan"),
// sehingga tidak ada lagi menu Pengaturan di navigasi sidebar.
//
// Ekspor `showHeader=false` supaya bisa di-embed tanpa judul halaman
// (dipakai di dalam tab WhatsApp).
import { useState, useEffect, useRef } from 'react';
import { useLang } from '../hooks/useLang.js';
import { useDialogA11y } from '../hooks/useDialogA11y.js';
import {
  Settings as SettingsIcon, Mail, MessageSquare, Globe, Save,
  Loader, CheckCircle, AlertCircle, Eye, EyeOff, RefreshCw, Send, FileText, X, Info
} from 'lucide-react';
import api from '../services/api.js';

// Definisi field pengaturan.
//
// Label & hint ditulis bilingual sebagai { id, en } karena `FIELD_DEFS` berada
// di luar komponen (module scope) — hook `useLang()` TIDAK boleh dipanggil di
// sini. Resolved ke teks yang sesuai di dalam komponen melalui helper `L()`.
const GROUPS = [
  { key: 'email',     label: { id: 'Email / SMTP',   en: 'Email / SMTP' }, icon: Mail },
  { key: 'whatsapp', label: { id: 'WhatsApp',        en: 'WhatsApp' },      icon: MessageSquare },
  { key: 'general',   label: { id: 'Umum',            en: 'General' },       icon: Globe },
];

const FIELD_DEFS = {
  email: [
    { key: 'smtp_host',     label: { id: 'SMTP Host',        en: 'SMTP Host' },        placeholder: 'smtp.gmail.com',    type: 'text', hint: { id: 'Hostname server SMTP', en: 'SMTP server hostname' } },
    { key: 'smtp_port',     label: { id: 'Port',              en: 'Port' },              placeholder: '587',              type: 'number', hint: { id: '587=STARTTLS, 465=SSL/TLS', en: '587=STARTTLS, 465=SSL/TLS' } },
    { key: 'smtp_secure',   label: { id: 'Use SSL/TLS',       en: 'Use SSL/TLS' },       placeholder: '',                type: 'checkbox', hint: { id: 'Aktifkan jika menggunakan port 465 atau 993', en: 'Enable when using port 465 or 993' } },
    { key: 'smtp_user',     label: { id: 'Email Pengirim',    en: 'Sender Email' },     placeholder: 'noreply@company.com', type: 'text', hint: { id: 'Email atau username SMTP', en: 'SMTP email or username' } },
    { key: 'smtp_pass',     label: { id: 'App Password',     en: 'App Password' },     placeholder: 'xxxx xxxx xxxx xxxx', type: 'password', hint: { id: 'App Password, BUKAN password biasa. Gmail → akun.google.com → Keamanan → App Password', en: 'App Password, NOT a regular password. Gmail → myaccount.google.com → Security → App Password' } },
    { key: 'smtp_from',     label: { id: 'Nama Pengirim',    en: 'Sender Name' },      placeholder: 'Fingerprint System <noreply@company.com>', type: 'text', hint: { id: 'Nama yang tampil di inbox penerima', en: 'Name shown in the recipient inbox' } },
  ],
  whatsapp: [
    // `secret: true` → kolom ditampilkan sebagai password (tidak terbaca
    // sekilas), tidak pernah diisi ulang dari server, dan menampilkan
    // versi TERSAMAR + penanda "sudah dikonfigurasi" di bawahnya.
    { key: 'wa_gateway_url', label: { id: 'WA Gateway URL', en: 'WA Gateway URL' }, placeholder: 'https://fonnte.com/api/send?token=xxx', type: 'password', secret: true, hint: { id: 'URL API gateway WhatsApp (Fonnte, WaBlas, dll.). Bisa mengandung token API — nilainya tidak pernah ditampilkan.', en: 'WhatsApp gateway API URL (Fonnte, WaBlas, etc.). May contain an API token — the value is never displayed.' } },
    { key: 'wa_default_to',  label: { id: 'Nomor Default',  en: 'Default Number' },  placeholder: '6281234567890', type: 'text', hint: { id: 'Nomor HP default penerima (format: 62xxx tanpa +)', en: 'Default recipient phone number (format: 62xxx without +)' } },
  ],
  general: [
    { key: 'company_name',               label: { id: 'Nama Perusahaan',        en: 'Company Name' },        placeholder: 'PT. Nama Perusahaan', type: 'text', hint: { id: 'Muncul di subject email dan judul laporan', en: 'Shown in the report email subject and report title' } },
    { key: 'report_title',               label: { id: 'Judul Laporan',          en: 'Report Title' },        placeholder: 'Laporan Absensi', type: 'text', hint: { id: 'Judul utama di PDF/HTML/Excel. Kosong = judul bawaan + nama perusahaan', en: 'Main title in PDF/HTML/Excel. Empty = default title + company name' } },
    { key: 'report_subtitle',            label: { id: 'Subjudul Laporan',       en: 'Report Subtitle' },     placeholder: 'Rekap Absensi Karyawan', type: 'text', hint: { id: 'Teks kecil di bawah judul (opsional)', en: 'Small text under the title (optional)' } },
    { key: 'report_footer',              label: { id: 'Footer Laporan',         en: 'Report Footer' },       placeholder: 'Rahasia — hanya untuk internal', type: 'text', hint: { id: 'Teks kaki halaman laporan (opsional)', en: 'Report footer text (optional)' } },
    { key: 'report_lang',                label: { id: 'Bahasa Default Laporan', en: 'Default Report Language' }, placeholder: 'id', type: 'select', options: [{ value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }], hint: { id: 'Bahasa default saat generate laporan', en: 'Default language when generating a report' } },
    { key: 'work_start',                 label: { id: 'Jam Masuk Normal',       en: 'Normal Start Time' },    placeholder: '09:00', type: 'text', hint: { id: 'Threshold deteksi terlambat (HH:MM WIB)', en: 'Late detection threshold (HH:MM WIB)' } },
    { key: 'work_end',                   label: { id: 'Jam Pulang Normal',      en: 'Normal End Time' },      placeholder: '17:00', type: 'text', hint: { id: 'Threshold deteksi pulang awal (HH:MM WIB)', en: 'Early leave detection threshold (HH:MM WIB)' } },
    { key: 'late_threshold_minutes',     label: { id: 'Menit Toleransi',        en: 'Tolerance Minutes' },   placeholder: '0', type: 'number', hint: { id: 'Menit toleransi keterlambatan (0 = tanpa toleransi)', en: 'Late tolerance minutes (0 = no tolerance)' } },
    { key: 'detect_late',                label: { id: 'Deteksi Terlambat',     en: 'Detect Late Arrival' }, placeholder: '', type: 'checkbox', hint: { id: 'Tandai karyawan yang datang setelah jam masuk normal sebagai terlambat', en: 'Mark employees arriving after the normal start time as late' } },
    { key: 'report_default_recipients',  label: { id: 'Penerima Default',       en: 'Default Recipients' },  placeholder: 'hrd@company.com, finance@company.com', type: 'text', hint: { id: 'Koma-separated, digunakan scheduler otomatis', en: 'Comma-separated, used by the automatic scheduler' } },
  ],
};

/**
 * Resolve teks bilingual { id, en } menjadi string.
 * Nilai string biasa diteruskan apa adanya — sehingga definisi lama tetap jalan.
 */
function L(text, lang) {
  if (text && typeof text === 'object') return text[lang] ?? text.id ?? text.en ?? '';
  return text;
}

// ── SMTP Provider recommendation guide ─────────────────────────────────────────
function SmtpGuide({ onClose, t, triggerRef }) {
  // Aksesibilitas dialog: focus trap, Escape, kembalikan fokus ke pemicu.
  const panelRef = useDialogA11y(true, onClose, triggerRef);
  const providers = [
    {
      name: 'Gmail / Google Workspace', color: '#EA4335', recommended: true,
      host: 'smtp.gmail.com', port: '587', secure: 'false (STARTTLS)',
      steps: [
        'Buka https://myaccount.google.com → Keamanan',
        'Aktifkan Verifikasi 2 Langkah jika belum',
        'Cari "App Passwords" → Buat baru (app: "Mail", device: "Other")',
        'Copy password 16 karakter → isi di kolom App Password',
        'Gunakan email lengkap Anda sebagai SMTP User',
      ],
      note: 'GRATIS untuk akun biasa. App Password wajib (tidak bisa pakai password akun). Limit 500 email/hari.',
    },
    {
      name: 'Zoho Mail', color: '#CC3232', recommended: false,
      host: 'smtp.zoho.com', port: '587', secure: 'false (STARTTLS)',
      steps: [
        'Daftar gratis di zoho.com/mail',
        'Verifikasi domain atau gunakan domain bawaan',
        'Admin Console → Mail → SMTP Settings',
        'Ambil SMTP credentials',
      ],
      note: 'GRATIS 5 user, 5 GB/user. Lebih reliable dari Gmail untuk automation.',
    },
    {
      name: 'SendGrid', color: '#1A82E2', recommended: false,
      host: 'smtp.sendgrid.net', port: '587', secure: 'false (STARTTLS)',
      steps: [
        'Daftar di sendgrid.com (free tier: 100 email/hari)',
        'Settings → API Keys → Create API Key (Full Access)',
        'Gunakan apikey sebagai username',
        'API Key sebagai password',
      ],
      note: 'Best untuk high-volume. Free tier 100k email/bulan pertama.',
    },
    {
      name: 'Mailgun', color: '#FF9933', recommended: false,
      host: 'smtp.mailgun.org', port: '587', secure: 'false (STARTTLS)',
      steps: [
        'Daftar di mailgun.com (free tier: 5000 email)',
        'Domain Settings → SMTP Credentials',
        'Default credentials atau buat custom',
      ],
      note: 'Good untuk transactional email. Free tier cukup untuk kebanyakan kasus.',
    },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)',
      zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', backdropFilter: 'blur(8px)',
    }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.smtp_guide_title') || 'Panduan Konfigurasi SMTP'}
        tabIndex={-1}
        style={{
        background: 'var(--surface)',
        backdropFilter: 'blur(24px)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        width: '100%', maxWidth: '640px',
        maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(99, 102, 241, 0.08)',
      }}>
        {/* Gradient Header */}
        <div style={{
          padding: '18px 22px',
          background: 'var(--gradient-primary)',
          borderRadius: 'var(--radius) var(--radius) 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 700, fontSize: '15px', color: '#fff' }}>
            {t('settings.smtp_guide_title') || 'Panduan Konfigurasi SMTP'}
          </span>
          <button
            onClick={onClose}
            aria-label={t('settings.aria_close_smtp')}
            style={{
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', transition: 'all 0.2s',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', fontSize: '13px', lineHeight: 1.7, color: 'var(--text)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {providers.map(p => (
              <div key={p.name} style={{
                border: '1px solid var(--border)',
                borderRadius: 'calc(var(--radius) / 2)',
                padding: '14px',
                background: p.recommended ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255,255,255,0.02)',
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
                  <strong style={{ fontSize: '13px', color: 'var(--text)' }}>{p.name}</strong>
                  {p.recommended && (
                    <span style={{
                      fontSize: '10px', background: 'var(--success)', color: '#fff',
                      padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600,
                    }}>
                      {t('settings.recommended') || 'Disarankan'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text)', marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <code style={{ background: 'var(--surface)', padding: '2px 6px', borderRadius: 'var(--radius-xs)', fontFamily: 'monospace', border: '1px solid var(--border)' }}>Host: {p.host}</code>
                  <code style={{ background: 'var(--surface)', padding: '2px 6px', borderRadius: 'var(--radius-xs)', fontFamily: 'monospace', border: '1px solid var(--border)' }}>Port: {p.port}</code>
                  <code style={{ background: 'var(--surface)', padding: '2px 6px', borderRadius: 'var(--radius-xs)', fontFamily: 'monospace', border: '1px solid var(--border)' }}>TLS: {p.secure}</code>
                </div>
                <ol style={{ margin: '0 0 8px', paddingLeft: '18px', fontSize: '12px', color: 'var(--text)' }}>
                  {p.steps.map((s, i) => <li key={i} style={{ marginBottom: '2px' }}>{s}</li>)}
                </ol>
                <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.6, fontStyle: 'italic' }}>{p.note}</div>
              </div>
            ))}
          </div>

          {/* Security Tips */}
          <div style={{
            marginTop: '16px', padding: '14px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: 'calc(var(--radius) / 2)',
            fontSize: '12px',
          }}>
            <strong style={{ color: 'var(--warning)' }}>
              <AlertCircle size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
              {t('settings.security_tips') || 'Tips Keamanan:'}
            </strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px', color: 'var(--text)' }}>
              <li>{t('settings.smtp_tip_1')}</li>
              <li>{t('settings.smtp_tip_2')}</li>
              <li>{t('settings.smtp_tip_3')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, placeholder, t }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        className="form-control"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ paddingRight: '40px', fontFamily: show ? 'monospace' : '' }}
      />
      <button aria-label={t('settings.aria_show_password')}
        type="button"
        onClick={() => setShow(s => !s)}
        style={{
          position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
          color: 'var(--text)', opacity: 0.5, display: 'flex', alignItems: 'center',
          transition: 'opacity 0.2s',
        }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function CheckboxField({ checked, onChange, label, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        style={{
          width: '18px', height: '18px', marginTop: '1px', cursor: 'pointer',
          flexShrink: 0, accentColor: 'var(--primary)',
        }}
      />
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.5, marginTop: '2px' }}>{hint}</div>}
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange, t, lang, maskedValue, isConfigured }) {
  if (field.type === 'checkbox') {
    return <CheckboxField checked={!!value} onChange={onChange} label={L(field.label, lang)} hint={L(field.hint, lang)} />;
  }
  if (field.type === 'select') {
    return (
      <div>
        <select
          className="form-control"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          style={{ cursor: 'pointer' }}
        >
          {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {field.hint && <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.5, marginTop: '4px' }}>{L(field.hint, lang)}</div>}
      </div>
    );
  }
  if (field.type === 'password') {
    return (
      <div>
        <PasswordField value={value || ''} onChange={onChange} placeholder={field.placeholder} t={t} />
        {/* Penanda bahwa nilai lama masih tersimpan di server. Nilai aslinya
            tidak pernah dikirim ke browser — hanya versi TERSAMAR. */}
        {isConfigured && (
          <div style={{ fontSize: '11px', color: 'var(--success)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle size={12} />
            {t('settings.secret_configured') || (lang === 'id' ? 'Tersimpan di server (nilai tidak ditampilkan)' : 'Saved on server (value not displayed)')}
          </div>
        )}
        {maskedValue && (
          <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.5, marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {maskedValue}
          </div>
        )}
        {field.hint && <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.5, marginTop: '4px' }}>{L(field.hint, lang)}</div>}
      </div>
    );
  }
  return (
    <div>
      <input
        type={field.type || 'text'}
        className="form-control"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={field.placeholder}
      />
      {field.hint && <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.5, marginTop: '4px' }}>{L(field.hint, lang)}</div>}
    </div>
  );
}

export default function SettingsPanel({ showHeader = true }) {
  const { lang, t } = useLang();
  const [activeTab, setActiveTab] = useState('email');
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  // Ref tombol pemicu panduan SMTP — fokus kembali ke sana setelah guide ditutup.
  const guideBtnRef = useRef(null);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testReportLoading, setTestReportLoading] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');

  const toast_ = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  // Field bertipe boolean (checkbox) disimpan di DB sebagai string 'true'/'false'.
  // Nilai string 'false' masih TRUTHY di JS — tanpa normalisasi ini checkbox
  // "Use SSL/TLS" akan selalu tampil TERCEKLIM padahal server menyimpan false.
  const BOOLEAN_FIELDS = new Set(['smtp_secure', 'detect_late']);

  // Field rahasia: nilainya TIDAK pernah dikirim balik oleh server.
  // `_configured` memberi tahu apakah nilai lama masih tersimpan, dan
  // `_masked` berisi tampilan tersamar (mis. URL gateway dengan token
  // dibullet-kan).
  const SECRET_FIELDS = new Set(['smtp_pass', 'wa_gateway_url']);

  const normalizeSettings = (raw) => {
    const out = { ...raw };
    for (const key of BOOLEAN_FIELDS) {
      if (!(key in out)) continue;
      const v = out[key];
      out[key] = v === true || v === 'true' || v === 1 || v === '1';
    }
    return out;
  };

  // Peta key → nilai tersamar, untuk ditampilkan di bawah kolom rahasia.
  const [masked, setMasked] = useState({});
  // Peta key → boolean "sudah terkonfigurasi".
  const [configured, setConfigured] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/settings');
      const body = data.data || data;
      setMasked(body._masked || {});
      setConfigured(body._configured || {});
      // Metadata `_masked` / `_configured` bukan setting — jangan ikut
      // disimpan sebagai payload.
      const { _masked, _configured, ...rest } = body;
      setSettings(normalizeSettings(rest));
    } catch (e) { toast_(e.message, false); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Field rahasia yang dikosongkan TIDAK boleh ikut dikirim.
      //
      // Server tidak pernah mengembalikan password SMTP / URL gateway ke
      // browser, jadi kolomnya selalu kosong di form. Kalau string kosong
      // itu ikut dikirim, server akan menimpanya dan MENGHAPUS nilai
      // lama yang sudah benar.
      //
      // Nilai kosong = "tidak diubah" (dihapus dari payload).
      const payload = { ...settings };
      for (const key of SECRET_FIELDS) {
        if (!payload[key]) delete payload[key];
      }

      const res = await api.put('/settings', payload);
      const body = res.data;
      if (body?.success) {
        toast_(t('settings.saved') || (lang === 'id' ? 'Pengaturan tersimpan!' : 'Settings saved!'));
        // Muat ulang supaya tampilan tersamar & penanda "sudah
        // dikonfigurasi" mencerminkan nilai terbaru di DB.
        await load();
      } else {
        // `api.put()` mengembalikan object axios — pesan error server ada di
        // `res.data.error`, BUKAN di `res.error`.
        //
        // SEBELUMNYA: `toast_(res.error || ...)`. `res.error` tidak pernah
        // ada pada axios response → kalau server menolak (mis. URL gateway
        // ditolak guard SSRF), user hanya melihat "Gagal menyimpan" tanpa
        // penjelasan apa pun.
        toast_(body?.error || t('settings.save_failed') || 'Gagal menyimpan', false);
      }
    } catch (e) {
      // Interceptor axios sudah mengekstrak pesan server ke `err.serverMessage`.
      toast_(e.serverMessage || e.response?.data?.error || e.message, false);
    }
    setSaving(false);
  };

  const set = (key, value) => setSettings(s => ({ ...s, [key]: value }));

  const handleTestEmail = async () => {
    if (!testEmailTo.trim()) { toast_(t('settings.enter_test_email') || 'Masukkan email tujuan test', false); return; }
    setTestEmailLoading(true);
    try {
      const res = await api.post('/settings/test-email', {
        smtp_host: settings.smtp_host,
        smtp_port: settings.smtp_port,
        smtp_secure: settings.smtp_secure,
        smtp_user: settings.smtp_user,
        smtp_pass: settings.smtp_pass,
        smtp_from: settings.smtp_from,
        test_to: testEmailTo,
      });
      toast_(res.data?.message || t('settings.test_email_sent') || 'Test email terkirim!');
    } catch (e) {
      const err = e.response?.data || {};
      toast_(err.error || e.message, false);
    }
    setTestEmailLoading(false);
  };

  const handleTestReport = async () => {
    setTestReportLoading(true);
    try {
      const recipients = settings.report_default_recipients || testEmailTo;
      if (!recipients) { toast_(t('settings.enter_recipients') || 'Isi "Penerima Default" atau email test terlebih dahulu', false); return; }
      const res = await api.post('/settings/test-report', {
        recipients,
        lang: settings.report_lang || 'id',
      });
      toast_(res.data?.message || t('settings.test_report_sent') || 'Laporan test terkirim!');
    } catch (e) {
      toast_(e.response?.data?.error || e.message, false);
    }
    setTestReportLoading(false);
  };

  const activeGroup = GROUPS.find(g => g.key === activeTab);
  const fields = FIELD_DEFS[activeTab] || [];

  // Tombol Simpan TIDAK boleh terikat pada blok header. Saat modul ini
  // dipakai sebagai tab "Pengaturan" di halaman WhatsApp (showHeader=false),
  // blok header disembunyikan — bila tombol Simpan ikut di dalamnya,
  // pengaturan tidak pernah bisa disimpan dari sana.
  const saveButton = (
    <button
      className="btn btn-primary"
      onClick={handleSave}
      disabled={saving}
      style={{ flexShrink: 0 }}
      aria-label={t('settings.save') || 'Save'}
    >
      {saving ? (
        <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
      ) : (
        <Save size={14} />
      )}
      {t('settings.save') || (lang === 'id' ? 'Simpan' : 'Save')}
    </button>
  );

  // Tab labels via t()
  const TAB_LABELS = {
    email: t('settings.tab_email') || 'Email / SMTP',
    whatsapp: t('settings.tab_whatsapp') || 'WhatsApp',
    general: t('settings.tab_general') || 'Umum',
  };

  return (
    <div style={{
      padding: showHeader ? 'clamp(12px, 4vw, 24px)' : 0,
      maxWidth: showHeader ? '760px' : 'none',
      margin: showHeader ? '0 auto' : 0,
      width: '100%',
    }}>
      {showGuide && <SmtpGuide onClose={() => setShowGuide(false)} t={t} triggerRef={guideBtnRef} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          padding: '14px 20px', borderRadius: 'var(--radius)', zIndex: 999,
          background: toast.ok ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: '1px solid ' + (toast.ok ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'),
          backdropFilter: 'blur(12px)',
          boxShadow: toast.ok ? '0 8px 32px rgba(16, 185, 129, 0.2)' : '0 8px 32px rgba(239, 68, 68, 0.2)',
          color: toast.ok ? 'var(--success)' : 'var(--danger)',
          display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: 600,
        }}>
          {toast.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {showHeader && (
      <div style={{
        marginBottom: '24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: '16px', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            fontSize: '22px', fontWeight: 800, margin: 0,
            color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: 'var(--radius-md)',
              background: 'var(--gradient-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)',
            }}>
              <SettingsIcon size={20} color="#fff" />
            </div>
            {t('settings.page_title') || (lang === 'id' ? 'Pengaturan Sistem' : 'System Settings')}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text)', opacity: 0.5, margin: '6px 0 0 50px' }}>
            {t('settings.page_subtitle') || (lang === 'id' ? 'SMTP, WhatsApp, dan konfigurasi laporan' : 'SMTP, WhatsApp, and report configuration')}
          </p>
        </div>
        {saveButton}
      </div>

      )}

      {/* Bilah aksi (Simpan) untuk mode embedded (tanpa header).
          Mode ini dipakai pada tab "Pengaturan" di halaman WhatsApp. */}
      {!showHeader && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '12px',
          marginBottom: '16px', flexWrap: 'wrap',
        }}>
          {saveButton}
        </div>
      )}
      {/* Dark Glass Tabs
          Catatan responsif: `width: fit-content` membuat strip tab selebar
          gabungan semua tombol (581px pada 390px viewport) sehingga halaman
          ikut melebar dan terjadi overflow horizontal. Karena itu lebar
          dibatasi max 100% dan strip bisa digeser mendatar (overflow-x auto)
          tanpa memaksa halaman melebar. Tombol memakai whiteSpace nowrap
          agar teks tidak terpotong saat digeser. */}
      <div style={{
        display: 'flex', gap: '4px', marginBottom: '20px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '4px',
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      }}>
        {GROUPS.map(g => {
          const Icon = g.icon;
          const isActive = activeTab === g.key;
          return (
            <button
              key={g.key}
              onClick={() => setActiveTab(g.key)}
              style={{
                padding: '10px 18px', border: 'none', borderRadius: 'calc(var(--radius) / 2)',
                background: isActive ? 'var(--gradient-primary)' : 'transparent',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                color: isActive ? '#fff' : 'var(--text)',
                opacity: isActive ? 1 : 0.5,
                display: 'flex', alignItems: 'center', gap: '8px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'all 0.25s',
                boxShadow: isActive ? '0 4px 20px rgba(99, 102, 241, 0.35)' : 'none',
              }}
            >
              <Icon size={15} />
              {TAB_LABELS[g.key]}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '60px 20px', gap: '16px',
        }}>
          <div className="spinner" />
          <span style={{ fontSize: '13px', color: 'var(--text)', opacity: 0.5 }}>
            {t('settings.loading') || 'Memuat...'}
          </span>
        </div>
      ) : (
        <>
          {/* Dark Glass Card - Form Fields */}
          <div style={{
            background: 'var(--surface)',
            backdropFilter: 'blur(24px)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '24px',
            marginBottom: '16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}>
            {/* Card Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              marginBottom: '20px', paddingBottom: '16px',
              borderBottom: '1px solid var(--border)',
            }}>
              {activeGroup && (() => {
                const Icon = activeGroup.icon;
                return <Icon size={18} style={{ stroke: 'var(--primary)', opacity: 0.8 }} />;
              })()}
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                {TAB_LABELS[activeTab]}
              </h2>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {fields.map(field => (
                <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{
                    display: 'block', fontSize: '11px', fontWeight: 700,
                    color: 'var(--text)', textTransform: 'uppercase',
                    letterSpacing: '.5px', opacity: 0.5,
                  }}>
                    {L(field.label, lang)}
                  </label>
                  <FieldInput
                    field={field}
                    value={settings[field.key]}
                    onChange={v => set(field.key, v)}
                    t={t}
                    lang={lang}
                    maskedValue={masked[field.key]}
                    isConfigured={!!configured[field.key]}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Email Tab: Test Actions */}
          {activeTab === 'email' && (
            <div style={{
              background: 'var(--surface)',
              backdropFilter: 'blur(24px)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '20px',
              marginBottom: '16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                marginBottom: '14px',
              }}>
                <Send size={16} style={{ stroke: 'var(--primary)', opacity: 0.8 }} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                  {t('email.send') || (lang === 'id' ? 'Kirim Test' : 'Send Test')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px', minWidth: '0' }}>
                  <label style={{
                    fontSize: '11px', fontWeight: 700, color: 'var(--text)',
                    textTransform: 'uppercase', display: 'block', marginBottom: '6px', opacity: 0.5,
                  }}>
                    {t('settings.test_recipient') || (lang === 'id' ? 'Email Tujuan Test' : 'Test Recipient Email')}
                  </label>
                  <input
                    className="form-control"
                    value={testEmailTo}
                    onChange={e => setTestEmailTo(e.target.value)}
                    placeholder="hrd@company.com"
                    type="email"
                  />
                </div>
                <button
                  className="btn btn-outline"
                  onClick={handleTestEmail}
                  disabled={testEmailLoading}
                  style={{ flexShrink: 0 }}
                >
                  {testEmailLoading ? (
                    <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Mail size={14} />
                  )}
                  {t('settings.test_connection') || (lang === 'id' ? 'Test Koneksi' : 'Test Connection')}
                </button>
                <button
                  className="btn btn-outline"
                  onClick={handleTestReport}
                  disabled={testReportLoading}
                  style={{ flexShrink: 0 }}
                >
                  {testReportLoading ? (
                    <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <FileText size={14} />
                  )}
                  {t('settings.test_report') || (lang === 'id' ? 'Test Laporan' : 'Test Report')}
                </button>
              </div>

              {/* SMTP Guide Button */}
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                <button
                  ref={guideBtnRef}
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowGuide(true)}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <RefreshCw size={14} />
                  {t('settings.smtp_guide') || (lang === 'id' ? 'Panduan Setup SMTP (Rekomendasi Provider)' : 'SMTP Setup Guide (Provider Recommendations)')}
                </button>
              </div>
            </div>
          )}

          {/* WhatsApp Tab: Info Card */}
          {activeTab === 'whatsapp' && (
            <div style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: 'var(--radius)',
              padding: '18px',
              fontSize: '12px', color: 'var(--success)',
            }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MessageSquare size={14} />
                {t('settings.wa_info_title') || 'Integrasi WhatsApp:'}
              </strong>
              <p style={{ margin: '8px 0 0', lineHeight: 1.6, color: 'var(--text)', opacity: 0.8 }}>
                {t('settings.wa_info_desc') || 'Untuk mengirim laporan via WhatsApp, Anda butuh WA Gateway seperti Fonnte (fonnte.com) atau WaBlas (wablabs.com). Daftar, ambil API URL, dan masukkan di kolom WA Gateway URL. Scheduler akan otomatis kirim pesan ke nomor yang terdaftar.'}
              </p>
            </div>
          )}

          {/* General Tab: Tip Card */}
          {activeTab === 'general' && (
            <div style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: 'var(--radius)',
              padding: '18px',
              fontSize: '12px', color: 'var(--primary)',
            }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Info size={14} />
                {t('settings.general_tip') || 'Tip:'}
              </strong>
              <p style={{ margin: '8px 0 0', lineHeight: 1.6, color: 'var(--text)', opacity: 0.8 }}>
                {t('settings.general_tip_desc') || 'Pengaturan Jam Kerja dan Toleransi digunakan untuk deteksi keterlambatan di laporan. Periode default laporan yang di-generate manual juga mengikuti pengaturan ini.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}