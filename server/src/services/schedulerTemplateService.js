// Scheduler templates — preset jadwal siap pakai.
//
// TUJUAN:
//   User tidak perlu menghafal cron expression. Template memberi nama
//   jadwal, cron, periode data, kanal, dan penjelasan singkat — tinggal
//   klik, isi penerima, simpan.
//
// DESAIN:
//   Template TIDAK disimpan di database. Ini daftar statis yang dikirim ke
//   frontend lewat `GET /api/scheduler/templates`. Alasannya:
//     - Template adalah titik awal, bukan data bisnis.
//     - Tidak perlu CRUD, tidak perlu migrasi, tidak perlu seed.
//     - Satu sumber kebenaran (file ini) untuk backend dan frontend.
//
//   Kalau suatu saat user butuh template sendiri, barulah ini dipindah
//   ke tabel — dan endpointnya tidak berubah bentuk responsnya.

/**
 * Daftar template jadwal.
 *
 * Field:
 *   - id            : pengenal stabil (dipakai frontend sebagai React key)
 *   - nameId/nameEn : nama jadwal dalam bahasa Indonesia / Inggris
 *   - descId/descEn : penjelasan singkat — APA yang dikirim & kapan
 *   - cronExpr      : cron expression (timezone Asia/Jakarta / WIB)
 *   - period        : periode data laporan (harus ada di ALLOWED_PERIODS)
 *   - channel       : kanal pengiriman ('email' | 'whatsapp' | 'both')
 *   - lang          : bahasa laporan ('id' | 'en')
 *   - recommended   : template yang disarankan untuk kebanyakan instalasi
 *
 * CATATAN PENTING:
 *   `period` WAJIB salah satu dari nilai yang diizinkan server
 *   (ALLOWED_PERIODS di controllers/schedulerController.js):
 *   yesterday | last_week | last_month | last_7d | last_30d
 *
 *   Cron yang dipakai:
 *     - `0 7 * * *`     → setiap hari 07:00 WIB
 *     - `0 7 * * 1-5`   → Senin–Jumat 07:00 WIB
 *     - `0 16 * * 5`    → Jumat 16:00 WIB
 *     - `0 7 1 * *`     → tanggal 1 setiap bulan 07:00 WIB
 */
export const SCHEDULE_TEMPLATES = [
  {
    id: 'daily-hr',
    nameId: 'Rekap Harian HRD',
    nameEn: 'Daily HR Report',
    descId: 'Dikirim setiap hari kerja (Senin–Jumat) jam 07:00 WIB, berisi rekap absensi hari sebelumnya.',
    descEn: 'Sent every working day (Mon–Fri) at 07:00 WIB, containing the previous day attendance summary.',
    cronExpr: '0 7 * * 1-5',
    period: 'yesterday',
    channel: 'email',
    lang: 'id',
    recommended: true,
  },
  {
    id: 'daily-all',
    nameId: 'Rekap Harian Semua Karyawan',
    nameEn: 'Daily All-Staff Report',
    descId: 'Dikirim setiap hari (termasuk akhir pekan) jam 07:00 WIB. Gunakan bila laporan harian harus selalu terkirim.',
    descEn: 'Sent every day (including weekends) at 07:00 WIB. Use when the daily report must always be delivered.',
    cronExpr: '0 7 * * *',
    period: 'yesterday',
    channel: 'email',
    lang: 'id',
    recommended: false,
  },
  {
    id: 'weekly-hr',
    nameId: 'Rekap Mingguan HRD',
    nameEn: 'Weekly HR Report',
    descId: 'Dikirim setiap Jumat jam 16:00 WIB, berisi rekap 7 hari terakhir. Cocok untuk rekap mingguan.',
    descEn: 'Sent every Friday at 16:00 WIB, containing the last 7 days summary. Suitable for weekly reviews.',
    cronExpr: '0 16 * * 5',
    period: 'last_7d',
    channel: 'email',
    lang: 'id',
    recommended: false,
  },
  {
    id: 'monthly-management',
    nameId: 'Rekap Bulanan Management',
    nameEn: 'Monthly Management Report',
    descId: 'Dikirim setiap tanggal 1 bulan berikutnya jam 07:00 WIB, berisi rekap 30 hari terakhir.',
    descEn: 'Sent on the 1st of each following month at 07:00 WIB, containing the last 30 days summary.',
    cronExpr: '0 7 1 * *',
    period: 'last_30d',
    channel: 'email',
    lang: 'id',
    recommended: false,
  },
  {
    id: 'daily-whatsapp',
    nameId: 'Rekap Harian via WhatsApp',
    nameEn: 'Daily Report via WhatsApp',
    descId: 'Dikirim tiap hari kerja jam 07:00 WIB ke nomor WhatsApp. Pastikan URL gateway sudah diisi di tab Pengaturan.',
    descEn: 'Sent every working day at 07:00 WIB to WhatsApp numbers. Make sure the gateway URL is set in the Settings tab.',
    cronExpr: '0 7 * * 1-5',
    period: 'yesterday',
    channel: 'whatsapp',
    lang: 'id',
    recommended: false,
  },
  {
    id: 'daily-both',
    nameId: 'Rekap Harian Email + WhatsApp',
    nameEn: 'Daily Report — Email + WhatsApp',
    descId: 'Dikirim tiap hari kerja jam 07:00 WIB ke email DAN WhatsApp sekaligus.',
    descEn: 'Sent every working day at 07:00 WIB to BOTH email and WhatsApp.',
    cronExpr: '0 7 * * 1-5',
    period: 'yesterday',
    channel: 'both',
    lang: 'id',
    recommended: false,
  },
  {
    id: 'weekly-bilingual',
    nameId: 'Rekap Mingguan (Indonesia + English)',
    nameEn: 'Weekly Report (Indonesia + English)',
    descId: 'Dikirim setiap Jumat jam 16:00 WIB dalam bahasa Inggris — untuk cabang yang butuh laporan berbahasa Inggris.',
    descEn: 'Sent every Friday at 16:00 WIB in English — for branches that need an English report.',
    cronExpr: '0 16 * * 5',
    period: 'last_7d',
    channel: 'email',
    lang: 'en',
    recommended: false,
  },
];

/**
 * Validasi internal: setiap template harus memakai nilai yang diizinkan
 * server. Kalau ada template yang salah, lebih baik ketahuan saat boot /
 * saat guard jalan daripada diam-diam menghasilkan jadwal yang ditolak
 * server saat user mengeklik template.
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateScheduleTemplates() {
  const errors = [];

  const ALLOWED_PERIODS = new Set([
    'yesterday', 'last_week', 'last_month', 'last_7d', 'last_30d',
  ]);
  const ALLOWED_CHANNELS = new Set(['email', 'whatsapp', 'both']);
  const ALLOWED_LANGS = new Set(['id', 'en']);

  const seenIds = new Set();

  for (const tpl of SCHEDULE_TEMPLATES) {
    const label = `template "${tpl.id}"`;

    if (!tpl.id) errors.push(`${label}: id kosong`);
    if (seenIds.has(tpl.id)) errors.push(`${label}: id duplikat`);
    seenIds.add(tpl.id);

    if (!tpl.nameId || !tpl.nameEn) errors.push(`${label}: nama id/en wajib diisi`);
    if (!tpl.descId || !tpl.descEn) errors.push(`${label}: deskripsi id/en wajib diisi`);
    if (!ALLOWED_PERIODS.has(tpl.period)) {
      errors.push(`${label}: period "${tpl.period}" tidak diizinkan (${[...ALLOWED_PERIODS].join(', ')})`);
    }
    if (!ALLOWED_CHANNELS.has(tpl.channel)) {
      errors.push(`${label}: channel "${tpl.channel}" tidak diizinkan (${[...ALLOWED_CHANNELS].join(', ')})`);
    }
    if (!ALLOWED_LANGS.has(tpl.lang)) {
      errors.push(`${label}: lang "${tpl.lang}" tidak diizinkan (${[...ALLOWED_LANGS].join(', ')})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Template dalam bentuk siap kirim ke frontend.
 * @param {string} lang 'id' | 'en'
 */
export function getScheduleTemplates(lang = 'id') {
  const useEn = lang === 'en';
  return SCHEDULE_TEMPLATES.map((tpl) => ({
    id: tpl.id,
    name: useEn ? tpl.nameEn : tpl.nameId,
    description: useEn ? tpl.descEn : tpl.descId,
    cronExpr: tpl.cronExpr,
    period: tpl.period,
    channel: tpl.channel,
    lang: tpl.lang,
    recommended: !!tpl.recommended,
  }));
}
