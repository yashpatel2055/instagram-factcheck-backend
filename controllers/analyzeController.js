const { downloadReel, cleanupJob } = require('../services/downloadService');
const { extractAudio }            = require('../services/audioService');
const { transcribeAudio }         = require('../ai/transcribeService');
const { detectClaims }            = require('../ai/claimService');
const { verifyAllClaims }         = require('../ai/verifyService');
const { calculateScore }          = require('../services/scoreService');
const { v4: uuidv4 }              = require('uuid');
const log                         = require('../utils/logger');

// ── In-memory job store ───────────────────────────────────────────────────────
// { jobId: { status: 'pending'|'complete'|'error', step, result, error } }
const jobs = new Map();

// Clean up completed jobs after 10 minutes
function scheduleCleanup(jobId) {
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
}

// ── Background analysis runner ────────────────────────────────────────────────
async function runAnalysis(jobId, url) {
  let downloadJobId = null;

  const setStep = (step) => {
    const job = jobs.get(jobId);
    if (job) { job.step = step; job.stepLabel = step; }
  };

  try {
    setStep('Downloading reel...');
    const { jobId: id, videoPath, meta, mediaType } = await downloadReel(url);
    downloadJobId = id;

    let transcript = '';
    let language   = 'en';

    if (mediaType === 'video' && videoPath) {
      setStep('Extracting audio...');
      const audioPath = await extractAudio(videoPath);

      setStep('Transcribing speech...');
      const result = await transcribeAudio(audioPath);
      transcript   = result.transcript;
      language     = result.language;
    } else {
      setStep('Extracting caption text...');
      const parts = [meta.title, meta.description].filter(Boolean);
      transcript  = parts.join(' ').trim() || 'No text content found in this post.';
      log.done(`Caption text: "${transcript.slice(0, 100)}..."`);
    }

    setStep('Detecting claims...');
    const claims = await detectClaims(transcript);

    setStep('Verifying claims...');
    const verifiedClaims = claims.length > 0 ? await verifyAllClaims(claims) : [];

    setStep('Calculating score...');
    const scoreData = calculateScore(verifiedClaims);

    if (downloadJobId) cleanupJob(downloadJobId);

    const result = {
      url,
      mediaType,
      meta,
      language,
      transcript,
      claims:    verifiedClaims,
      score:     scoreData.score,
      risk:      scoreData.risk,
      summary: {
        total:      scoreData.total,
        true:       scoreData.trueCount,
        false:      scoreData.falseCount,
        misleading: scoreData.misleadCount,
        unverified: scoreData.unverified,
      },
      analyzedAt: new Date().toISOString(),
    };

    jobs.set(jobId, { status: 'complete', result });
    scheduleCleanup(jobId);
    log.done(`Job ${jobId} complete — Score: ${scoreData.score}% (${scoreData.risk} risk)`);

  } catch (err) {
    if (downloadJobId) cleanupJob(downloadJobId);
    jobs.set(jobId, { status: 'error', error: err.message || 'Analysis failed' });
    scheduleCleanup(jobId);
    log.error(`Job ${jobId} failed`, err.message);
  }
}

// ── POST /api/analyze — start job, return jobId immediately ──────────────────
async function analyzeReel(req, res) {
  const { url } = req.body;

  if (!url || !url.match(/instagram\.com\/(reel|p)\//i)) {
    return res.status(400).json({ error: 'Invalid Instagram Reel or Post URL' });
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'pending', step: 'Starting...', result: null, error: null });

  // Start analysis in background (don't await)
  runAnalysis(jobId, url);

  // Return jobId immediately — client will poll /status/:jobId
  return res.json({ jobId, status: 'pending' });
}

// ── GET /api/status/:jobId — poll for result ─────────────────────────────────
async function getStatus(req, res) {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }

  return res.json(job);
}

module.exports = { analyzeReel, getStatus };
