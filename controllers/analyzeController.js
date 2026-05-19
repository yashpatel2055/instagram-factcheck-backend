const { downloadReel, cleanupJob } = require('../services/downloadService');
const { extractAudio }            = require('../services/audioService');
const { transcribeAudio }         = require('../ai/transcribeService');
const { detectClaims }            = require('../ai/claimService');
const { verifyAllClaims }         = require('../ai/verifyService');
const { calculateScore }          = require('../services/scoreService');
const log                         = require('../utils/logger');

async function analyzeReel(req, res) {
  const { url } = req.body;

  // ── Validate URL ────────────────────────────────────────────────────────────
  if (!url || !url.match(/instagram\.com\/(reel|p)\//i)) {
    return res.status(400).json({ error: 'Invalid Instagram Reel or Post URL' });
  }

  let jobId = null;

  try {
    // ── Step 1: Download / fetch metadata ────────────────────────────────────
    log.step('Step 1 — Fetching content');
    const { jobId: id, videoPath, meta, mediaType } = await downloadReel(url);
    jobId = id;

    let transcript = '';
    let language   = 'en';

    if (mediaType === 'video' && videoPath) {
      // ── Step 2: Extract audio ───────────────────────────────────────────────
      log.step('Step 2 — Extracting audio');
      const audioPath = await extractAudio(videoPath);

      // ── Step 3: Transcribe ──────────────────────────────────────────────────
      log.step('Step 3 — Transcribing speech');
      const result = await transcribeAudio(audioPath);
      transcript   = result.transcript;
      language     = result.language;

    } else {
      // ── Photo post: use caption + description as text source ────────────────
      log.step('Step 2 — Extracting text from caption');
      const parts = [meta.title, meta.description].filter(Boolean);
      transcript  = parts.join(' ').trim();
      language    = 'en';

      if (!transcript) {
        transcript = 'No text content found in this post.';
      }

      log.done(`Caption text: "${transcript.slice(0, 100)}..."`);
    }

    // ── Step 4: Detect claims ─────────────────────────────────────────────────
    log.step('Step 4 — Detecting claims');
    const claims = await detectClaims(transcript);

    // ── Step 5: Verify claims ─────────────────────────────────────────────────
    log.step('Step 5 — Verifying claims');
    const verifiedClaims = claims.length > 0 ? await verifyAllClaims(claims) : [];

    // ── Step 6: Calculate score ───────────────────────────────────────────────
    log.step('Step 6 — Scoring');
    const scoreData = calculateScore(verifiedClaims);

    // ── Cleanup ───────────────────────────────────────────────────────────────
    if (jobId) cleanupJob(jobId);

    // ── Response ──────────────────────────────────────────────────────────────
    const response = {
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

    log.done(`Analysis complete — Score: ${scoreData.score}% (${scoreData.risk} risk)`);
    return res.json(response);

  } catch (err) {
    if (jobId) cleanupJob(jobId);
    log.error('Analysis failed', err.message);
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}

module.exports = { analyzeReel };
