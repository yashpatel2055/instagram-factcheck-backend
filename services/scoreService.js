/**
 * Calculates trust score from verified claims
 * Trust Score = Verified TRUE claims / Total claims * 100
 */
function calculateScore(verifiedClaims) {
  if (!verifiedClaims.length) return { score: 100, risk: 'LOW' };

  const trueCount      = verifiedClaims.filter(c => c.verdict === 'TRUE').length;
  const falseCount     = verifiedClaims.filter(c => c.verdict === 'FALSE').length;
  const misleadCount   = verifiedClaims.filter(c => c.verdict === 'MISLEADING').length;
  const unverified     = verifiedClaims.filter(c => c.verdict === 'UNVERIFIED').length;
  const total          = verifiedClaims.length;

  // Weighted score: TRUE=1, UNVERIFIED=0.5, MISLEADING=0.25, FALSE=0
  const weightedScore =
    (trueCount * 1 + unverified * 0.5 + misleadCount * 0.25 + falseCount * 0) / total;

  const score = Math.round(weightedScore * 100);

  const risk =
    score >= 70 ? 'LOW'
    : score >= 40 ? 'MEDIUM'
    : 'HIGH';

  return { score, risk, trueCount, falseCount, misleadCount, unverified, total };
}

module.exports = { calculateScore };
