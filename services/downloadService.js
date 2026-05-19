const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const log = require('../utils/logger');

const DOWNLOADS_DIR = path.join(__dirname, '../downloads');

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

/**
 * Downloads a file from a URL to a local path (follows redirects)
 */
function downloadFile(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        file.close();
        fs.unlink(destPath, () => {});
        return downloadFile(res.headers.location, destPath, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`File download HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Make a JSON POST request
 */
function jsonPost(hostname, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Download Instagram reel via cobalt.tools (free, no auth required)
 */
async function downloadViaCobalt(url, jobId) {
  log.step('Trying cobalt.tools...');

  const { status, body } = await jsonPost('api.cobalt.tools', '/', { url, videoQuality: '720' }, {
    'User-Agent': 'factcheck-app/1.0',
  });

  log.info(`Cobalt status: ${status} | response: ${body.substring(0, 300)}`);

  const json = JSON.parse(body);

  // cobalt returns: { status: 'redirect'|'tunnel'|'picker', url }
  let videoUrl = null;

  if ((json.status === 'redirect' || json.status === 'tunnel') && json.url) {
    videoUrl = json.url;
  } else if (json.status === 'picker' && json.picker && json.picker.length > 0) {
    // picker returns multiple items (e.g. carousel) — grab first video
    const videoItem = json.picker.find(p => p.type === 'video') || json.picker[0];
    videoUrl = videoItem.url;
  }

  if (!videoUrl) {
    throw new Error(`Cobalt: no video URL. Response: ${body.substring(0, 200)}`);
  }

  const videoPath = path.join(DOWNLOADS_DIR, `${jobId}.mp4`);
  log.step(`Downloading video from cobalt...`);
  await downloadFile(videoUrl, videoPath);

  log.done('Downloaded via cobalt.tools');
  return {
    jobId,
    videoPath,
    meta: { title: '', description: '', uploader: '', duration: 0, thumbnail: '', viewCount: 0 },
    mediaType: 'video',
  };
}

/**
 * Downloads an Instagram reel using yt-dlp (fallback)
 */
function downloadViaYtDlp(url, jobId) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
    const metaFile = path.join(DOWNLOADS_DIR, `${jobId}.info.json`);

    const python = process.env.PYTHON_PATH || 'python3';

    // Auth strategy:
    // 1. If INSTAGRAM_COOKIES env var set → write to temp file (used on Render)
    // 2. Else if running locally (not on Render) → read cookies from Chrome browser automatically
    let cookiesFlag = '';
    const cookiesEnv = process.env.INSTAGRAM_COOKIES;
    const isRender = !!process.env.RENDER;

    if (cookiesEnv) {
      const cookiesPath = path.join(DOWNLOADS_DIR, `${jobId}_cookies.txt`);
      fs.writeFileSync(cookiesPath, cookiesEnv, 'utf8');
      cookiesFlag = `--cookies "${cookiesPath}"`;
      log.info('Using cookies from INSTAGRAM_COOKIES env var');
    } else if (!isRender) {
      // Local dev: read from Chrome automatically (user must be logged in to Instagram in Chrome)
      cookiesFlag = '--cookies-from-browser chrome';
      log.info('Using cookies from local Chrome browser');
    }

    const cmd = [
      `${python} -m yt_dlp`,
      `"${url}"`,
      `-o "${outputTemplate}"`,
      '--write-info-json',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      '--no-check-certificate',
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
      // Deprecation warning causes non-zero exit but download may still succeed
      const isOnlyDeprecation = err && stderr && stderr.includes('Deprecated Feature') && !stderr.includes('ERROR:');

      if (isPhotoPost) {
        log.info('Photo post detected — will fact-check caption & description');
        return resolve({ jobId, videoPath: null, meta, mediaType: 'photo' });
      }

      // Check if file was actually downloaded (deprecation warning can cause false errors)
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const videoFile = files.find(f =>
        f.startsWith(jobId) && !f.endsWith('.json') && !f.endsWith('.mp3') && !f.endsWith('_cookies.txt')
      );

      if (err && !isOnlyDeprecation && !videoFile) {
        return reject(new Error(`Download failed: ${stderr || err.message}`));
      }

      if (!videoFile) {
        return reject(new Error(`Download failed: ${stderr || err?.message || 'File not found'}`));
      }

      const videoPath = path.join(DOWNLOADS_DIR, videoFile);
      log.done(`Downloaded via yt-dlp: ${videoFile}`);
      resolve({ jobId, videoPath, meta, mediaType });
    });
  });
}

/**
 * Main download — uses yt-dlp with Chrome cookies (local) or env cookies (server)
 */
async function downloadReel(url) {
  const jobId = uuidv4();
  log.step(`Starting download for: ${url}`);
  return downloadViaYtDlp(url, jobId);
}

/**
 * Cleans up all files for a given jobId
 */
function cleanupJob(jobId) {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    files.filter(f => f.startsWith(jobId)).forEach(f => {
      try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)); } catch (_) {}
    });
    log.info(`Cleaned up job: ${jobId}`);
  } catch (_) {}
}

module.exports = { downloadReel, cleanupJob };
