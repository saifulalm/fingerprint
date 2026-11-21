// Scheduler routes
import { Router } from 'express';
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  triggerSchedule,
  listScheduleTemplates,
} from '../controllers/schedulerController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/',          asyncHandler(listSchedules));     // GET /api/scheduler — list all
// Template WAJIB didaftarkan SEBELUM '/:id' — kalau tidak, request
// GET /api/scheduler/templates akan tertangkap oleh route '/:id' dan
// dianggap sebagai lookup jadwal dengan id = "templates" (→ 404).
router.get('/templates', asyncHandler(listScheduleTemplates)); // GET /api/scheduler/templates — preset siap pakai
router.post('/',         asyncHandler(createSchedule));    // POST /api/scheduler — create
router.put('/:id',       asyncHandler(updateSchedule));    // PUT /api/scheduler/:id — update
router.delete('/:id',    asyncHandler(deleteSchedule));    // DELETE /api/scheduler/:id — delete
router.post('/:id/toggle', asyncHandler(toggleSchedule)); // POST /api/scheduler/:id/toggle
router.post('/:id/trigger', asyncHandler(triggerSchedule)); // POST /api/scheduler/:id/trigger — run now

export default router;
