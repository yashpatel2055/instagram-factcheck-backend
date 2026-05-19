const fs = require('fs');
const Groq = require('groq-sdk');
const log = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Transcribes audio using Groq Whisper (free)
 * Returns { transcript, language }
 */
async function transcribeAudio(audioPath) {
  log.step('Transcribing audio with Groq Whisper...');

  const audioStream = fs.createReadStream(audioPath);

  const response = await groq.audio.transcriptions.create({
    file:            audioStream,
    model:           'whisper-large-v3',
    response_format: 'verbose_json',
  });

  const transcript = response.text?.trim() || '';
  const language   = response.language || 'en';

  log.done(`Transcribed (${language}): "${transcript.slice(0, 80)}..."`);
  return { transcript, language };
}

module.exports = { transcribeAudio };
