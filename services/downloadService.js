const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const log = require('../utils/logger');

const DOWNLOADS_DIR = path.join(__dirname, '../downloads');

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

/**
 * Writes Instagram cookies from env var to a temp file and returns the path.
 * Returns null if no cookies configured.
 */
function getCookiesFilePath(jobId) {
  const cookies = process.env.INSTAGRAM_COOKIES;
  if (!cookies) return null;

  const cookiesPath = path.join(DOWNLOADS_DIR, `${jobId}_cookies.txt`);
  fs.writeFileSync(cookiesPath, cookies, 'utf8');
  return cookiesPath;
}

/**
 * Downloads an Instagram reel using yt-dlp
 * Returns { jobId, videoPath, metaPath }
 */
function downloadReel(url) {
  return new Promise((resolve, reject) => {
    const jobId = uuidv4();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
    const metaFile = path.join(DOWNLOADS_DIR, `${jobId}.info.json`);

    log.step(`Downloading reel: ${url}`);

    const python = process.env.PYTHON_PATH || 'python3';

    // Write cookies to temp file if available
    const cookiesPath = getCookiesFilePath(jobId);
    const cookiesFlag = cookiesPath ? `--cookies "${cookiesPath}"` : '';

    const cmd = [
      `${python} -m yt_dlp`,
      `"${url}"`,
      `-o "${outputTemplate}"`,
      '--write-info-json',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      cookiesFlag,
    ].filter(Boolean).join(' ');

    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      // Parse metadata first (available even on error)
      let meta = {};
      let mediaType = 'video';

      if (fs.existsSync(metaFile)) {
        try {
          const raw = fs.readFileSync(metaFile, 'utf8');
          const parsed = JSON.parse(raw);
          meta = {
            title:       parsed.title || '',
            description: parsed.description || '',
            uploader:    parsed.uploader || parsed.channel || '',
            duration:    parsed.duration || 0,
            thumbnail:   parsed.thumbnail || '',
            viewCount:   parsed.view_count || 0,
          };
        } catch (_) {}
      }

      // Check if it's a "no video" error → treat as photo post
      const isPhotoPost = stderr && stderr.includes('There is no video in this post');

      if (err && !isPhotoPost) {
        log.error('Download failed', stderr);
        return reject(new Error(`Download failed: ${stderr || err.message}`));
      }

      if (isPhotoPost) {
        log.info('Photo post detected — will fact-check caption & description');
        mediaType = 'photo';
        return resolve({ jobId, videoPath: null, meta, mediaType });
      }

      // Find the downloaded video file
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const videoFile = files.find(f => f.startsWith(jobId) && !f.endsWith('.json') && !f.endsWith('.mp3'));

      if (!videoFile) {
        return reject(new Error('Downloaded file not found'));
      }

      const videoPath = path.join(DOWNLOADS_DIR, videoFile);
      log.done(`Downloaded: ${videoFile}`);
      resolve({ jobId, videoPath, meta, mediaType });
    });
  });
}

/**
 * Cleans up all files for a given jobId
 */
function cleanupJob(jobId) {
  const files = fs.readdirSync(DOWNLOADS_DIR);
  files
    .filter(f => f.startsWith(jobId))
    .forEach(f => {
      try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)); } catch (_) {}
    });
  log.info(`Cleaned up job: ${jobId}`);
}

module.exports = { downloadReel, cleanupJob, getCookiesFilePath };
