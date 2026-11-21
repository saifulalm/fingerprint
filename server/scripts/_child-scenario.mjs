// Child process untuk skenario scheduler yang butuh env benar-benar kosong.
//
// Dipanggil oleh `test-scheduler-email.mjs` (bukan untuk dipakai langsung).
//
// KENAPA SUB-PROSES:
//   `config.smtp` di `config/index.js` dihitung SEKALI saat modul di-load.
//   Jadi `process.env.SMTP_HOST = ''` di proses yang sama tidak mengubah
//   `config.smtp` — nilainya sudah ter-snapshot. Untuk menguji "tidak ada
//   kredensial sama sekali", env harus kosong SEBELUM modul di-load, dan
//   itu hanya bisa dijamin oleh proses baru.
//
// OUTPUT:
//   Satu baris JSON berprefiks "__RESULT__" yang dibaca parent.

import { PrismaClient } from '@prisma/client';

const scenario = process.argv[2] || process.env.SCENARIO || '';

const prisma = new PrismaClient();
const result = {
  scenario,
  threw: false,
  message: '',
  lastStatus: null,
  emailsSent: 0,
};

try {
  if (scenario === 'smtp-kosong') {
    // Kosongkan kredensial SMTP di DB supaya TIDAK ada sumber yang bisa
    // dipakai — dan env juga kosong (diberikan oleh parent).
    for (const key of ['smtp_host', 'smtp_user', 'smtp_pass', 'smtp_from']) {
      await prisma.systemSetting.upsert({
        where: { id: key },
        create: { id: key, value: '' },
        update: { value: '' },
      });
    }

    const { schedulerService } = await import('../src/services/schedulerService.js');

    // Jadwal uji: channel email, penerima ada (agar satu-satunya alasan
    // gagal adalah SMTP yang belum dikonfigurasi).
    const schedule = await prisma.reportSchedule.create({
      data: {
        name: '[UJI-CHILD] SMTP Kosong',
        cronExpr: '0 3 * * *',
        period: 'last_30d',
        channel: 'email',
        recipients: 'penerima-uji@example.com',
        lang: 'id',
        enabled: false,
      },
    });

    try {
      await schedulerService.trigger(schedule.id);
    } catch (err) {
      result.threw = true;
      result.message = err.message;
    }

    const after = await prisma.reportSchedule.findUnique({ where: { id: schedule.id } });
    result.lastStatus = after?.lastStatus ?? null;

    await prisma.reportSchedule.deleteMany({ where: { id: schedule.id } });
  } else {
    result.message = `Skenario tidak dikenal: ${scenario}`;
  }
} catch (err) {
  result.threw = true;
  result.message = err.message;
} finally {
  await prisma.$disconnect();
}

process.stdout.write(`__RESULT__${JSON.stringify(result)}\n`);
process.exit(0);
