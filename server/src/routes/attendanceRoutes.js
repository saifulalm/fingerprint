// Attendance routes
import { Router } from 'express';
import { getAttendance, getAttendanceFromDb, syncAttendanceToDb, getRekap, repairStoredTimes } from '../controllers/attendanceController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.post('/',        asyncHandler(getAttendance));        // live from Hikvision (slow)
router.post('/db',     asyncHandler(getAttendanceFromDb));  // from DB cache (fast, for frontend)
router.post('/sync',   asyncHandler(syncAttendanceToDb));   // sync Hikvision → DB (manual trigger)
router.post('/rekap',  asyncHandler(getRekap));
router.post('/repair', asyncHandler(repairStoredTimes));    // fix timezone on existing DB records

export default router;
