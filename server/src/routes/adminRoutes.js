// Admin routes — system dashboard, stats, audit log
import { Router } from 'express';
import {
  getDashboard,
  getStats,
  createAudit,
  clearAuditLogs,
} from '../controllers/adminController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/dashboard',  asyncHandler(getDashboard));  // GET /api/admin/dashboard
router.get('/stats',      asyncHandler(getStats));      // GET /api/admin/stats
router.post('/audit',     asyncHandler(createAudit));   // POST /api/admin/audit
router.delete('/audit',   asyncHandler(clearAuditLogs)); // DELETE /api/admin/audit?days=30

export default router;
