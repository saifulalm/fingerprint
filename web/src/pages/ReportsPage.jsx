// Reports Page - Professional Attendance Reports with Modern UI
import { useState, useEffect } from 'react';
import { useLang } from '../hooks/useLang.js';
import {
  Eye, Mail, MessageCircle, Download, FileSpreadsheet, Clock, TrendingUp,
  Globe, AlertTriangle, Loader2, CheckCircle, X, FileText, Calendar, RefreshCw, Send
} from 'lucide-react';
import { Card, Button, Badge, Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui';
import api, { apiGetText, apiGetBlob, apiGetJson } from '../services/api.js';

function LateToggle({ enabled, onToggle, label }) {
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-4 cursor-pointer transition-all border-b border-white/10 rounded-t-xl ${
        enabled ? 'bg-amber-500/10 border-amber-500/30' : 'bg-white/5 border-white/5 hover:bg-white/[0.07]'
      }`}
    >
      <AlertTriangle size={18} className={enabled ? 'text-amber-400' : 'text-slate-500'} />
      <span className={`text-sm font-medium ${enabled ? 'text-amber-400' : 'text-slate-400'}`}>
        {label}
      </span>
      <div className="ml-auto">
        <div className={`w-11 h-6 rounded-full relative transition-colors ${enabled ? 'bg-amber-500' : 'bg-slate-600'}`}>
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, color, onClick, loading, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:-translate-y-0.5 hover:shadow-lg'
      }`}
      style={{
        background: disabled ? undefined : `${color}18`,
        color: disabled ? undefined : color,
        border: disabled ? '1px solid rgba(255,255,255,0.1)' : `1px solid ${color}40`,
      }}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <Icon size={16} />
      )}
      {label}
    </button>
  );
}

export default function ReportsPage() {
  const { t, lang } = useLang();

  const [startDate, setStartDate] = useState(() => {
    const s = new Date(); s.setDate(s.getDate() - 1);
    return s.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => {
    const e = new Date(); e.setDate(e.getDate() - 1);
    return e.toISOString().slice(0, 10);
  });
  // Jam kerja, deteksi terlambat, dan penerima default diambil dari Pengaturan
  // (tab Pengaturan di halaman WhatsApp) supaya tidak ada dua sumber
  // kebenaran. Nilai hardcoded hanya jadi fallback sebelum settings termuat.
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('17:00');
  const [detectLate, setDetectLate] = useState(true);
  const [recipients, setRecipients] = useState('');
  const [reportLang, setReportLang] = useState(lang === 'id' ? 'id' : 'en');
  // Bahasa laporan harus mengikuti pilihan bahasa global. Tanpa ini, user yang
  // berganti bahasa di header tetap menerima laporan dalam bahasa awal.
  useEffect(() => {
    setReportLang(lang === 'id' ? 'id' : 'en');
  }, [lang]);
  // Muat default sistem dari Pengaturan saat halaman dibuka.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/settings');
        const s = res.data || {};
        if (cancelled) return;
        if (s.work_start) setWorkStart(s.work_start);
        if (s.work_end) setWorkEnd(s.work_end);
        if (s.detect_late !== undefined) {
          setDetectLate(s.detect_late === true || s.detect_late === 'true');
        }
        if (s.report_default_recipients && !recipients) {
          setRecipients(s.report_default_recipients);
        }
      } catch (_) {
        // Pengaturan tidak terbaca — pakai default bawaan, tidak memblokir UI.
      }
    })();
    return () => { cancelled = true; };
    // deliberately mount-once: default diisi ulang hanya saat halaman dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState({ preview: false, email: false, wa: false, excel: false, pdf: false });
  const [toast, setToast] = useState(null);

  const showToast = (msg, success = true) => {
    setToast({ msg, success });
    setTimeout(() => setToast(null), 4000);
  };

  // Parameter ini dipakai bersama oleh preview/email/whatsapp. Format HANYA
  // relevan untuk endpoint export — harus diteruskan secara eksplisit,
  // jika tidak server selalu jatuh ke default 'excel' dan file PDF berisi XLSX.
  const buildParams = (extra = {}) => ({
    startDate, endDate, lang: reportLang, detectLate: String(detectLate), workStart, workEnd,
    ...extra,
  });

  const handlePreview = async () => {
    if (new Date(endDate) < new Date(startDate)) {
      showToast(t('end_before_start'), false);
      return;
    }
    setLoading(p => ({ ...p, preview: true }));
    setPreviewHtml('');
    setPreviewOpen(true);
    try {
      // Memakai instance axios (bukan fetch mentah) supaya header auth,
      // redirect 401, dan err.serverMessage tetap berlaku.
      const html = await apiGetText('/report/preview', buildParams());
      setPreviewHtml(html);
    } catch (e) {
      setPreviewOpen(false);
      showToast(e.serverMessage || e.message || t('rep.preview_failed'), false);
    } finally {
      setLoading(p => ({ ...p, preview: false }));
    }
  };

  const handleEmail = async () => {
    if (new Date(endDate) < new Date(startDate)) {
      showToast(t('end_before_start'), false);
      return;
    }
    if (!recipients.trim()) {
      showToast(t('rep.email_empty'), false);
      return;
    }
    setLoading(p => ({ ...p, email: true }));
    try {
      const emails = recipients.split(',').map(s => s.trim()).filter(Boolean);
      // recipients HARUS dikirim: server memakai REPORT_DEFAULT_RECIPIENTS
      // bila query param ini kosong, sehingga email tidak pernah sampai ke
      // alamat yang diketik user.
      await api.get('/report/email', { params: buildParams({ recipients: emails.join(',') }) });
      showToast(t('rep.email_sent').replace('{n}', emails.length), true);
    } catch (e) {
      // Prioritaskan pesan dari server (err.serverMessage) — e.message axios
      // generik seperti "Request failed with status code 500" tidak informatif.
      showToast(e.serverMessage || e.message || t('rep.email_failed'), false);
    }
    setLoading(p => ({ ...p, email: false }));
  };

  const handleWhatsApp = async () => {
    if (new Date(endDate) < new Date(startDate)) {
      showToast(t('end_before_start'), false);
      return;
    }
    if (!recipients.trim()) {
      showToast(t('rep.wa_empty'), false);
      return;
    }
    setLoading(p => ({ ...p, wa: true }));
    try {
      const phones = recipients.split(',').map(s => s.trim()).filter(Boolean);
      // Server SEKARANG benar-benar mengirim pesan (sebelumnya hanya membuat
      // teks dan mengembalikanannya), dan mengembalikan hasil per-penerima.
      // Response-nya dibaca supaya user tahu mana yang terkirim dan mana
      // yang gagal — bukan sekadar "siap".
      const res = await api.get('/report/whatsapp', { params: buildParams({ recipients: phones.join(',') }) });
      const data = res.data || {};

      if (data.failedCount > 0) {
        // Sebagian gagal → tampilkan rincian, jangan klaim sukses.
        const failed = (data.results || [])
          .filter(r => !r.ok)
          .map(r => `${r.to}: ${r.error || 'gagal'}`)
          .join('; ');
        showToast(data.note || t('rep.wa_failed'), false);
        console.warn('[report/whatsapp] Pengiriman gagal sebagian:', failed);
      } else {
        showToast(t('rep.wa_ready').replace('{n}', phones.length), true);
      }
    } catch (e) {
      showToast(e.serverMessage || e.message || t('rep.wa_failed'), false);
    }
    setLoading(p => ({ ...p, wa: false }));
  };

  // Unduh laporan sebagai blob dari server, dengan fallback ke mode base64.
  // Fallback dipakai karena beberapa browser extension (mis. Internet Download
  // Manager) meng-intercept respons biner dan menggantinya dengan 204 kosong.
  //
  // PENTING: axios dipakai (bukan fetch mentah) supaya header auth, redirect
  // 401, dan err.serverMessage tetap berlaku. Response type 'blob' membuat
  // axios mengembalikan objek Blob; interceptor di services/api.js sudah
  //ecil membaca body error dari Blob sehingga pesan server ("Rentang tanggal
  // wajib diisi") tetap muncul, bukan sekadar "HTTP 500".
  const fetchExportBlob = async (format, encoding) => {
    const blob = await apiGetBlob('/report/export', buildParams({ format, ...(encoding ? { encoding } : {}) }));
    return blob;
  };

  // Konversi base64 -> Blob di browser tanpa fetch ke data: URL (menghindari
  // CSP dan tidak menambah satu network round-trip).
  const base64ToBlob = (b64, mime) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  const downloadFile = async (format) => {
    if (new Date(endDate) < new Date(startDate)) {
      showToast(t('end_before_start'), false);
      return;
    }
    setLoading(p => ({ ...p, [format]: true }));
    try {
      let blob;
      try {
        blob = await fetchExportBlob(format);
        // Respons kosong (204/304) berarti di-intercept extension browser.
        if (blob.size === 0) {
          const e = new Error('EMPTY');
          e.status = 204;
          throw e;
        }
      } catch (firstErr) {
        // Coba jalur base64 (JSON) yang tidak di-intercept extension.
        //
        // PENTING: error ASLI (firstErr) harus dipertahankan. Versi lama
        // menimpa pesannya dengan pesan fallback, sehingga "Rentang tanggal
        // wajib diisi" dari server hilang dan user hanya melihat "HTTP 500".
        const fallbackErr = new Error(firstErr?.serverMessage || firstErr?.message || t('rep.download_failed'));
        fallbackErr.status = firstErr?.status;
        try {
          const payload = await apiGetJson('/report/export', buildParams({ format, encoding: 'base64' }));
          blob = base64ToBlob(payload.data, payload.mime);
        } catch (base64Err) {
          // Peladen base64 gagal → tampilkan pesan server bila ada, kalau
          // tidak pakai pesan dari percobaan pertama (lebih relevan).
          throw new Error(
            base64Err?.serverMessage || fallbackErr.message
          );
        }
      }

      // Verifikasi magic bytes: server bisa balas 200 dengan tipe berbeda bila
      // parameter format tidak terbaca (mis. XLSX untuk permintaan PDF).
      const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      const isZip = head[0] === 0x50 && head[1] === 0x4b;      // PK.. = XLSX
      const isPdf = head[0] === 0x25 && head[1] === 0x50;      // %P    = PDF
      if (blob.size === 0) {
        throw new Error(t('rep.blocked_by_extension'));
      }
      if (format === 'pdf' && !isPdf) {
        throw new Error(t('rep.not_pdf'));
      }
      if (format === 'excel' && !isZip) {
        throw new Error(t('rep.not_excel'));
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-report-${startDate}-${endDate}.${format === 'excel' ? 'xlsx' : format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast(t('rep.download_ok').replace('{fmt}', format.toUpperCase()));
    } catch (e) {
      showToast(e.message, false);
    }
    setLoading(p => ({ ...p, [format]: false }));
  };

  const datePresets = [
    { label: t('rep.preset_today'), action: () => {
      const s = new Date().toISOString().slice(0, 10);
      setStartDate(s); setEndDate(s);
    }},
    { label: t('rep.preset_7days'), action: () => {
      const s = new Date(); s.setDate(s.getDate() - 6);
      setStartDate(s.toISOString().slice(0, 10));
      setEndDate(new Date().toISOString().slice(0, 10));
    }},
    { label: t('rep.preset_30days'), action: () => {
      const s = new Date(); s.setDate(s.getDate() - 29);
      setStartDate(s.toISOString().slice(0, 10));
      setEndDate(new Date().toISOString().slice(0, 10));
    }},
  ];

  return (
    <div className="page-pad space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl flex items-center gap-3 text-sm font-medium animate-in slide-in-from-bottom-4 ${
          toast.success ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
        }`}
          style={{ backdropFilter: 'blur(12px)' }}
        >
          {toast.success ? <CheckCircle size={18} /> : <X size={18} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#F1F5F9]">{t('rep.title')}</h1>
          <p className="text-sm text-[#8494AD] mt-1">{t('rep.sub')}</p>
        </div>
      </div>

      {/* Date Range Card */}
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5 w-full sm:w-auto">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.from')}</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 w-full sm:w-40"
            />
          </div>
          <div className="space-y-1.5 w-full sm:w-auto">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">{t('f.to')}</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="h-10 px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 w-full sm:w-40"
            />
          </div>
          <div className="flex gap-2 ml-auto">
            {datePresets.map(p => (
              <button
                key={p.label}
                onClick={p.action}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-[#94A3B8] hover:bg-white/10 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Work Hours & Late Detection */}
      <Card className="overflow-hidden">
        <LateToggle
          enabled={detectLate}
          onToggle={() => setDetectLate(v => !v)}
          label={t('rep.detect_late')}
        />
        {detectLate && (
          <div className="flex gap-4 p-4 bg-white/[0.02]">
            <div className="flex items-center gap-2 flex-1">
              <Clock size={16} className="text-[#8494AD]" />
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase text-[#8494AD] block mb-1">{t('rep.work_start')}</label>
                <input
                  type="time"
                  value={workStart}
                  onChange={e => setWorkStart(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <Clock size={16} className="text-[#8494AD]" />
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase text-[#8494AD] block mb-1">{t('rep.work_end')}</label>
                <input
                  type="time"
                  value={workEnd}
                  onChange={e => setWorkEnd(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Language & Recipients */}
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
              {t('rep.lang')}
            </label>
            <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
            <button
              onClick={() => setReportLang('id')}
              className={`px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                reportLang === 'id'
                  ? 'bg-[#6366F1] text-white shadow-lg'
                  : 'text-[#8494AD] hover:text-[#94A3B8]'
              }`}
            >
              Indonesia
            </button>
            <button
              onClick={() => setReportLang('en')}
              className={`px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                reportLang === 'en'
                  ? 'bg-[#6366F1] text-white shadow-lg'
                  : 'text-[#8494AD] hover:text-[#94A3B8]'
              }`}
            >
              English
            </button>
            </div>
          </div>
          <div className="flex-1 min-w-0 sm:min-w-64 space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
              {t('rep.recipients_label')}
            </label>
            <input
              className="h-10 w-full px-4 rounded-lg bg-[#0F172A]/60 border border-white/10 text-sm text-[#F1F5F9] placeholder:text-[#8494AD] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30"
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder={t('rep.recipient_placeholder')}
            />
          </div>
        </div>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <ActionButton icon={FileSpreadsheet} label={t('rep.excel_label')} color="#10B981" onClick={() => downloadFile('excel')} loading={loading.excel} />
        <ActionButton icon={FileText} label={t('rep.pdf_label')} color="#3B82F6" onClick={() => downloadFile('pdf')} loading={loading.pdf} />
        <ActionButton icon={Eye} label={t('rep.preview')} color="#8B5CF6" onClick={handlePreview} loading={loading.preview} />
        <ActionButton icon={Mail} label={t('rep.email_label')} color="#2563EB" onClick={handleEmail} loading={loading.email} disabled={!recipients.trim()} />
        <ActionButton icon={Send} label={t('rep.wa_label')} color="#EA580C" onClick={handleWhatsApp} loading={loading.wa} disabled={!recipients.trim()} />
      </div>

      {/* Features Info */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-[#F1F5F9] mb-4">{t('rep.features_title')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: TrendingUp, color: '#EF4444', text: t('rep.feature_late') },
            { icon: Globe, color: '#8B5CF6', text: t('rep.feature_bilingual') },
            { icon: FileSpreadsheet, color: '#10B981', text: t('rep.feature_sheets') },
            { icon: Clock, color: '#F59E0B', text: t('rep.feature_hours') },
            { icon: Calendar, color: '#06B6D4', text: t('rep.feature_daily') },
            { icon: AlertTriangle, color: '#EF4444', text: t('rep.feature_highlight') },
          ].map(({ icon: Icon, color, text }) => (
            <div key={text} className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Icon size={14} style={{ color }} />
              {text}
            </div>
          ))}
        </div>
      </Card>

      {/* Preview Modal */}
      <Modal open={previewOpen} onOpenChange={setPreviewOpen} size="xl">
        <ModalHeader onClose={() => setPreviewOpen(false)}>
          <ModalTitle>{t('rep.preview')}</ModalTitle>
        </ModalHeader>
        <ModalBody className="p-0 max-h-[70vh]">
          {loading.preview ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-[#6366F1] mb-4" />
              <p className="text-sm text-[#8494AD]">{t('loading_preview')}</p>
            </div>
          ) : previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              title={t('rep.report_preview')}
              sandbox="allow-same-origin"
              className="w-full border-0 min-h-[500px]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertTriangle size={40} className="text-[#8494AD] mb-4" />
              <p className="text-sm font-medium text-[#8494AD]">{t('empty.no_data')}</p>
              <p className="text-xs text-[#8494AD] mt-1">{t('try_different_date')}</p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setPreviewOpen(false)}>{t('confirm.cancel')}</Button>
          {previewHtml && (
            <Button onClick={() => {
              const w = window.open('', '_blank');
              w.document.write(previewHtml);
              w.document.close();
              w.print();
            }}>
              {t('print')}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </div>
  );
}