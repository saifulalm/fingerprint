// Auth routes
import { Router } from 'express';
import { login, logout, me } from '../controllers/authController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';
import { loginRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Rate limiter DILETAKKAN SEBELUM controller: percobaan login yang gagal
// dibatasi 5x per 10 menit per (IP + username). Tanpa ini, password admin
// bisa di-bruteforce tanpa batas.
router.post('/login', loginRateLimiter, asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', asyncHandler(me));

export default router;
