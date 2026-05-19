const express = require('express');
const { analyzeReel, getStatus } = require('../controllers/analyzeController');

const router = express.Router();

// POST /api/analyze  — start analysis, returns { jobId } immediately
router.post('/analyze', analyzeReel);

// GET /api/status/:jobId  — poll for result
router.get('/status/:jobId', getStatus);

// GET /api/health  — health check
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

module.exports = router;
