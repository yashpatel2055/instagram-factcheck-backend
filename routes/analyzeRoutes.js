const express = require('express');
const { analyzeReel } = require('../controllers/analyzeController');

const router = express.Router();

// POST /api/analyze  — main analysis endpoint
router.post('/analyze', analyzeReel);

// GET /api/health  — health check
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

module.exports = router;
