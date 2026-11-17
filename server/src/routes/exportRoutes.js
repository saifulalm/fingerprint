// Export routes
import { Router } from 'express';
import { exportExcel, exportPDF, exportCSV } from '../controllers/exportController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.post('/excel', asyncHandler(exportExcel));
router.post('/pdf', asyncHandler(exportPDF));
router.post('/csv', asyncHandler(exportCSV));

export default router;
