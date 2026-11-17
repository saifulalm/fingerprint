// Report routes
import { Router } from 'express';
import { getReportPreview, getReportExport, sendReportEmail, sendReportWhatsApp } from '../controllers/reportController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/preview',   asyncHandler(getReportPreview));    // GET /api/report/preview   — HTML preview in browser
router.get('/export',   asyncHandler(getReportExport));     // GET /api/report/export    — Excel/PDF/HTML download
router.get('/email',     asyncHandler(sendReportEmail));     // GET /api/report/email     — send HTML email
router.get('/whatsapp',  asyncHandler(sendReportWhatsApp)); // GET /api/report/whatsapp  — WhatsApp text summary

export default router;
