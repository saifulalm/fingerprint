// Device routes
import { Router } from 'express';
import { getDevices, getUsers, refreshUsers } from '../controllers/deviceController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(getDevices));
router.get('/users', asyncHandler(getUsers));
router.post('/users/refresh', asyncHandler(refreshUsers));

export default router;
