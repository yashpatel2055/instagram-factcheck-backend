require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const routes  = require('./routes/analyzeRoutes');
const log     = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  log.error('Unhandled error', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  log.info(`FactCheck backend running on http://0.0.0.0:${PORT}`);
  log.info(`POST http://192.168.29.20:${PORT}/api/analyze`);
});
