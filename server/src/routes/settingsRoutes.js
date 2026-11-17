// Settings routes
import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  testEmail,
  testReportEmail,
} from '../controllers/settingsController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/',                          asyncHandler(getSettings));
router.put('/',                         asyncHandler(updateSettings));
router.post('/test-email',              asyncHandler(testEmail));
router.post('/test-report',             asyncHandler(testReportEmail));

export default router;
