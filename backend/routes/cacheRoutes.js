import express from 'express';
import { cacheController } from '../controllers/cacheController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/cache/stats - Retrieve real-time cache telemetry
router.get('/stats', cacheController.getStats);

// DELETE /api/cache/flush - Clear entire in-memory cache
router.delete('/flush', cacheController.flushAll);

// POST /api/cache/reset-stats - Reset hit/miss counters
router.post('/reset-stats', cacheController.resetStats);

// DELETE /api/cache/user - Clear user specific cache entries
router.delete('/user', protect, cacheController.clearUserCache);

export default router;
