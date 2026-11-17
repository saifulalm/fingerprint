// Email routes
import { Router } from 'express';
import { sendEmail } from '../controllers/emailController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.post('/', asyncHandler(sendEmail));

export default router;
