const axios = require('axios');
const Groq  = require('groq-sdk');
const log   = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Google Fact Check API ────────────────────────────────────────────────────
async function searchFactCheckAPI(claim) {
  try {
    const res = await axios.get('https://factchecktools.googleapis.com/v1alpha1/claims:search', {
      params: { query: claim, key: process.env.GOOGLE_FACTCHECK_KEY, languageCode: 'en' },
      timeout: 8000,
    });
    const reviews = res.data?.claims?.[0]?.claimReview || [];
    return reviews.map(r => ({
      title:     r.title || claim,
      url:       r.url || '',
      publisher: r.publisher?.name || 'Fact Check',
      rating:    r.textualRating || '',
      snippet:   r.textualRating || '',
      type:      'factcheck',
    }));
  } catch (_) { return []; }
}

// ─── SerpAPI Google Search ────────────────────────────────────────────────────
async function searchWeb(claim) {
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { q: claim, api_key: process.env.SERPAPI_KEY, num: 3, hl: 'en' },
      timeout: 8000,
    });
    return (res.data?.organic_results || []).slice(0, 3).map(r => ({
      title:     r.title || '',
      url:       r.link || '',
      publisher: r.displayed_link || '',
      snippet:   r.snippet || '',
      type:      'web',
    }));
  } catch (_) { return []; }
}

// ─── Wikipedia ───────────────────────────────────────────────────────────────
async function searchWikipedia(claim) {
  try {
    const res = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: { action: 'query', list: 'search', srsearch: claim, format: 'json', srlimit: 1 },
      timeout: 8000,
    });
    const page = res.data?.query?.search?.[0];
    if (!page) return [];
    return [{
      title:     page.title,
      url:       `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      publisher: 'Wikipedia',
      snippet:   page.snippet?.replace(/<[^>]+>/g, '') || '',
      type:      'wiki',
    }];
  } catch (_) { return []; }
}

// ─── Groq LLaMA Verdict ───────────────────────────────────────────────────────
async function getAIVerdict(claim, sources) {
  const sourceSummary = sources
    .map((s, i) => `${i + 1}. [${s.publisher}] ${s.title}: ${s.snippet || s.rating || ''}`)
    .join('\n');

  const prompt = `You are a fact-checker. Evaluate this claim based on the evidence.

CLAIM: "${claim}"

EVIDENCE:
${sourceSummary || 'No external sources found.'}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIED",
  "confidence": <number 0-100>,
  "explanation": "<1-2 sentence explanation>"
}`;

  const response = await groq.chat.completions.create({
    model:       'llama-3.3-70b-versatile',
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.choices[0]?.message?.content?.trim() || '{}';
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { verdict: 'UNVERIFIED', confidence: 0, explanation: 'Could not evaluate this claim.' };
  }
}

// ─── Main verify function ─────────────────────────────────────────────────────
async function verifyClaim(claim, category) {
  log.step(`Verifying: "${claim.slice(0, 60)}"`);

  const [factCheckSources, webSources, wikiSources] = await Promise.all([
    searchFactCheckAPI(claim),
    searchWeb(claim),
    searchWikipedia(claim),
  ]);

  const allSources = [...factCheckSources, ...webSources, ...wikiSources];
  const verdict    = await getAIVerdict(claim, allSources);

  log.done(`Verdict: ${verdict.verdict} (${verdict.confidence}%)`);

  return {
    claim,
    category,
    verdict:     verdict.verdict     || 'UNVERIFIED',
    confidence:  verdict.confidence  || 0,
    explanation: verdict.explanation || '',
    sources:     allSources.slice(0, 4),
  };
}

async function verifyAllClaims(claims) {
  log.step(`Verifying ${claims.length} claims...`);
  const results = await Promise.all(
    claims.map(c => verifyClaim(c.claim, c.category))
  );
  return results;
}

module.exports = { verifyAllClaims };
