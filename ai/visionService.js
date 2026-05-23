const Groq = require('groq-sdk');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Downloads an image from URL and returns it as base64
 */
function imageUrlToBase64(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const chunks = [];

    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return imageUrlToBase64(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Image download failed: HTTP ${res.statusCode}`));
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    }).on('error', reject);
  });
}

/**
 * Uses Groq vision model to read text and describe an image.
 * Returns { visibleText, description, rawContent }
 */
async function analyzeImage(imageUrl) {
  log.step('Analyzing image with Groq Vision...');

  const base64 = await imageUrlToBase64(imageUrl);
  const mimeType = imageUrl.includes('.png') ? 'image/png' : 'image/jpeg';

  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: 'text',
            text: `Analyze this image and provide:
1. ALL text visible in the image (signs, shirts, banners, captions, overlays, subtitles)
2. A brief description of what the image shows
3. Any factual claims or statements being made (health tips, news, statistics, etc.)

Format your response as:
VISIBLE TEXT: [all text you can read]
DESCRIPTION: [brief description]
CLAIMS: [any factual claims made]`,
          },
        ],
      },
    ],
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content || '';
  log.done(`Vision analysis complete`);

  // Parse sections from response
  const visibleText = (content.match(/VISIBLE TEXT:\s*([\s\S]*?)(?=DESCRIPTION:|$)/i)?.[1] || '').trim();
  const description = (content.match(/DESCRIPTION:\s*([\s\S]*?)(?=CLAIMS:|$)/i)?.[1] || '').trim();
  const claims      = (content.match(/CLAIMS:\s*([\s\S]*?)$/i)?.[1] || '').trim();

  const fullText = [visibleText, description, claims].filter(Boolean).join('\n');

  log.info(`Visible text: "${visibleText.slice(0, 100)}"`);

  return { visibleText, description, claims, fullText };
}

module.exports = { analyzeImage };
