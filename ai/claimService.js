const Groq = require('groq-sdk');
const log = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are an expert fact-checker. Extract ONLY verifiable factual claims from the text.

Rules:
- Extract statements that can be verified as TRUE or FALSE
- Skip opinions, jokes, emotions, greetings, and personal stories
- Each claim must be a standalone sentence
- Categorize each claim: Health, Science, Politics, History, Technology, Economy, or Other
- Return ONLY valid JSON — no markdown, no extra text

Output format:
[
  { "claim": "...", "category": "..." }
]

If no verifiable claims exist, return: []`;

/**
 * Detects factual claims using Groq LLaMA 3 (free)
 */
async function detectClaims(transcript) {
  log.step('Detecting claims with Groq LLaMA 3...');

  if (!transcript || transcript.trim().length < 10) {
    log.info('Text too short, skipping claim detection');
    return [];
  }

  const response = await groq.chat.completions.create({
    model:       'llama-3.3-70b-versatile',
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Extract factual claims from:\n\n"${transcript}"` },
    ],
  });

  const raw = response.choices[0]?.message?.content?.trim() || '[]';

  try {
    // Strip markdown code blocks if model adds them
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const claims = JSON.parse(cleaned);
    log.done(`Found ${claims.length} claims`);
    return Array.isArray(claims) ? claims : [];
  } catch (e) {
    log.error('Failed to parse claims JSON', raw);
    return [];
  }
}

module.exports = { detectClaims };
