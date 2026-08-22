import { assertVerifiedExpertReview } from './expert-review.mjs';

const clamp = (value) => Math.max(0, Math.min(5, Math.round(value * 10) / 10));

function findingCount(findings, prefixes) {
  return findings.filter((finding) => prefixes.some((prefix) => finding.rule.startsWith(prefix))).length;
}

function dimension(id, score, evidence, rationale) {
  return { id, score: clamp(score), evidence, rationale };
}

export function scoreQualitativeRubric(result, policy, expertReview = null) {
  const snapshot = result.qualitativeSnapshot || {};
  const findings = result.findings || [];
  const styles = snapshot.styleSample || [];
  const headingSizes = (snapshot.headingSizes || []).filter(Number.isFinite);
  const gaps = styles.map((style) => style.gapPx).filter((value) => value > 0);
  const leftEdges = new Set(styles.map((style) => style.x).filter(Number.isFinite));
  const surfaceColors = new Set(styles.map((style) => style.backgroundColor).filter((value) => value && value !== 'rgba(0, 0, 0, 0)'));
  const radii = new Set(styles.map((style) => Math.round(style.borderRadiusPx)).filter((value) => value > 0));
  const typeErrors = findingCount(findings, ['typography.', 'structure.heading']);
  const layoutErrors = findingCount(findings, ['layout.']);
  const interactionErrors = findingCount(findings, ['interaction.', 'accessibility.']);
  const motionErrors = findingCount(findings, ['motion.']);
  const hardFailureCount = findings.filter((finding) => ['P0', 'P1'].includes(finding.severity)).length;
  const viewportArea = Math.max(1, result.viewport.width * result.viewport.height);
  const density = (snapshot.visibleElementCount || 0) / (viewportArea / 100_000);
  const alignmentRatio = styles.length ? 1 - Math.min(1, leftEdges.size / styles.length) : 0;

  const automated = [
    dimension('hierarchy', headingSizes.length ? 5 - Math.min(4, typeErrors) : 1, { headingSizes, headingCount: headingSizes.length, structuralFindings: typeErrors }, 'Clear page hierarchy requires a visible heading scale and valid structure.'),
    dimension('typography', 5 - Math.min(5, typeErrors * 1.5), { fontFamilies: [...new Set(styles.map((style) => style.fontFamily).filter(Boolean))], typographyFindings: typeErrors }, 'Type size, line length, loading, and hierarchy are weighted together.'),
    dimension('spacing-rhythm', gaps.length ? (new Set(gaps.map((value) => Math.round(value / 4) * 4)).size <= 8 ? 4.8 : 3.2) : 3, { sampledGaps: gaps.slice(0, 30), tokenCount: new Set(gaps.map((value) => Math.round(value / 4) * 4)).size }, 'A small, repeatable spacing vocabulary scores higher than arbitrary gaps.'),
    dimension('alignment-grid', 2.5 + alignmentRatio * 2.5 - Math.min(2, layoutErrors), { sampledElements: styles.length, uniqueLeftEdges: leftEdges.size, alignmentRatio, layoutFindings: layoutErrors }, 'Repeated edges and absence of collisions/overflow indicate grid discipline.'),
    dimension('density', density >= 2 && density <= 45 ? 4.7 : density <= 70 ? 3.5 : 2, { visibleElements: snapshot.visibleElementCount || 0, elementsPer100kPx: Math.round(density * 10) / 10 }, 'Density is evaluated against viewport area, not by element count alone.'),
    dimension('surface-material', surfaceColors.size >= 1 && surfaceColors.size <= 12 && radii.size <= 8 ? 4.6 : 3, { surfaceColorCount: surfaceColors.size, radiusTokenCount: radii.size, radii: [...radii].slice(0, 20) }, 'Coherent surface colors and radius tokens support a deliberate material system.'),
    dimension('icon-consistency', snapshot.inlineSvgCount && snapshot.emojiIconCount ? 3 : 4.5, { inlineSvgCount: snapshot.inlineSvgCount || 0, emojiIconCount: snapshot.emojiIconCount || 0 }, 'Mixing unrelated SVG and emoji icon languages lowers consistency.'),
    dimension('microcopy', 5 - Math.min(4, findingCount(findings, ['accessibility.missing-name'])), { wordCount: snapshot.wordCount || 0, missingNameFindings: findingCount(findings, ['accessibility.missing-name']) }, 'Concise visible copy must remain programmatically named and actionable.'),
    dimension('interaction-states', 5 - Math.min(5, interactionErrors), { interactiveTargets: result.counts.interactiveTargets, focusStops: result.counts.focusStops, interactionFindings: interactionErrors }, 'Touch geometry, focus visibility, order, and semantics are non-negotiable interaction evidence.'),
    dimension('motion-intent', 5 - Math.min(5, motionErrors * 2), { reducedMotionFindings: motionErrors }, 'Motion must communicate state while respecting reduced-motion preference.'),
    dimension('brand-distinctiveness', snapshot.brandMentions > 0 ? 4.5 : 2.5, { brandMentions: snapshot.brandMentions || 0, surfaceColorCount: surfaceColors.size }, 'Brand presence is treated as evidence, not proof of distinctiveness.'),
    dimension('perceived-polish', 5 - Math.min(5, hardFailureCount * 0.75 + findingCount(findings, ['visual.']) * 0.5), { hardFailureCount, totalFindings: findings.length }, 'Polish cannot score above unresolved hard failures or visual instability.')
  ];

  const dimensions = automated.map((item) => {
    const reviewDimension = expertReview?.dimensions?.find((candidate) => candidate.id === item.id);
    return reviewDimension ? { ...item, expertScore: reviewDimension.score, expertEvidence: reviewDimension.evidence } : item;
  });
  const scoreSource = expertReview ? dimensions.map((item) => item.expertScore ?? item.score) : dimensions.map((item) => item.score);
  const score = clamp(scoreSource.reduce((sum, value) => sum + value, 0) / Math.max(1, scoreSource.length));
  const expertReviewStatus = expertReview?.approved === true ? 'approved' : 'pending';
  const eligibleForPremium = hardFailureCount === 0
    && findings.filter((finding) => finding.severity === 'P2').length <= policy.maximumP2ForPremiumAcceptance
    && score >= policy.minimumQualitativeScore
    && (!policy.expertReviewRequired || expertReviewStatus === 'approved');

  return {
    score,
    scale: '0-5',
    scoreType: expertReview ? 'expert-reviewed' : 'automated-proxy',
    expertReviewStatus,
    reviewer: expertReview?.reviewerId || null,
    dimensions,
    hardFailureCount,
    cannotOverrideHardFailures: true,
    eligibleForPremium
  };
}

export function validateExpertReview(review, result, policy, expected = {}) {
  return assertVerifiedExpertReview(review, result, policy, expected);
}
