const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const log = require('../utils/logger');

const DOWNLOADS_DIR = path.join(__dirname, '../downloads');

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

/**
 * Downloads a file from a URL to a local path
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Downloads Instagram reel via RapidAPI (no login required)
 */
function downloadViaRapidAPI(url, jobId) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) return reject(new Error('RAPIDAPI_KEY not set'));

    const encodedUrl = encodeURIComponent(url);
    const options = {
      method: 'GET',
      hostname: 'social-media-video-downloader.p.rapidapi.com',
      path: `/smvd/get/all?url=${encodedUrl}`,
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'social-media-video-downloader.p.rapidapi.com',
      },
    };

    log.step('Fetching video URL via RapidAPI...');

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);

          if (!json.success || !json.links || json.links.length === 0) {
            return reject(new Error('RapidAPI returned no download links'));
          }

          // Pick the best quality video link
          const videoLink = json.links.find(l => l.type === 'video/mp4') || json.links[0];
          const videoUrl = videoLink.link || videoLink.url;

          if (!videoUrl) return reject(new Error('No valid video URL from RapidAPI'));

          const videoPath = path.join(DOWNLOADS_DIR, `${jobId}.mp4`);
          log.step('Downloading video file...');
          await downloadFile(videoUrl, videoPath);

          // Build meta from RapidAPI response
          const meta = {
            title:       json.title || '',
            description: json.title || '',
            uploader:    json.author || '',
            duration:    0,
            thumbnail:   json.thumbnail || '',
            viewCount:   0,
          };

          log.done('Video downloaded via RapidAPI');
          resolve({ jobId, videoPath, meta, mediaType: 'video' });
        } catch (e) {
          reject(new Error(`RapidAPI parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('RapidAPI request timed out'));
    });
    req.end();
  });
}

/**
 * Downloads an Instagram reel using yt-dlp (fallback)
 */
function downloadViaYtDlp(url, jobId) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
    const metaFile = path.join(DOWNLOADS_DIR, `${jobId}.info.json`);

    const python = process.env.PYTHON_PATH || 'python3';

    // Use cookies file if provided
    const cookiesEnv = process.env.INSTAGRAM_COOKIES;
    let cookiesFlag = '';
    if (cookiesEnv) {
      const cookiesPath = path.join(DOWNLOADS_DIR, `${jobId}_cookies.txt`);
      fs.writeFileSync(cookiesPath, cookiesEnv, 'utf8');
      cookiesFlag = `--cookies "${cookiesPath}"`;
    }

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

      const isPhotoPost = stderr && stderr.includes('There is no video in this post');

      if (err && !isPhotoPost) {
        return reject(new Error(`Download failed: ${stderr || err.message}`));
      }

      if (isPhotoPost) {
        log.info('Photo post detected — will fact-check caption & description');
        mediaType = 'photo';
        return resolve({ jobId, videoPath: null, meta, mediaType });
      }

      const files = fs.readdirSync(DOWNLOADS_DIR);
      const videoFile = files.find(f => f.startsWith(jobId) && !f.endsWith('.json') && !f.endsWith('.mp3') && !f.endsWith('_cookies.txt'));

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
 * Main download function — tries RapidAPI first, falls back to yt-dlp
 */
async function downloadReel(url) {
  const jobId = uuidv4();
  log.step(`Starting download for: ${url}`);

  // Try RapidAPI first (no Instagram login needed)
  if (process.env.RAPIDAPI_KEY) {
    try {
      return await downloadViaRapidAPI(url, jobId);
    } catch (e) {
      log.warn(`RapidAPI failed: ${e.message} — falling back to yt-dlp`);
    }
  }

  // Fallback to yt-dlp
  return downloadViaYtDlp(url, jobId);
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

module.exports = { downloadReel, cleanupJob };
