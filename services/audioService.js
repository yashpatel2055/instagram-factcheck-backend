const { exec } = require('child_process');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const log = require('../utils/logger');

/**
 * Extracts audio from video using ffmpeg
 * Returns path to the .mp3 file
 */
function extractAudio(videoPath) {
  return new Promise((resolve, reject) => {
    const audioPath = videoPath.replace(/\.\w+$/, '.mp3');

    log.step(`Extracting audio from: ${path.basename(videoPath)}`);

    // 16kHz mono — optimal for Whisper
    const cmd = `"${ffmpegPath}" -i "${videoPath}" -vn -ar 16000 -ac 1 -q:a 0 "${audioPath}" -y -loglevel error`;

    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        log.error('Audio extraction failed', stderr);
        return reject(new Error(`FFmpeg failed: ${stderr || err.message}`));
      }
      log.done(`Audio extracted: ${path.basename(audioPath)}`);
      resolve(audioPath);
    });
  });
}

module.exports = { extractAudio };
