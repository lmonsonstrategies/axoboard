import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreQualitativeRubric } from '../../src/qualitative-rubric.mjs';

const policy = {
  maximumP2ForPremiumAcceptance: 0,
  minimumQualitativeScore: 4,
  expertReviewRequired: false
};

function result(findings = []) {
  return {
    routeId: 'fixture', state: 'default', theme: 'light', viewport: { id: 'desktop', width: 1440, height: 900 },
    counts: { interactiveTargets: 3, focusStops: 3 }, findings,
    qualitativeSnapshot: {
      visibleElementCount: 30, sectionCount: 3, wordCount: 120, headingSizes: [64, 32], inlineSvgCount: 2, emojiIconCount: 0, brandMentions: 2,
      styleSample: Array.from({ length: 20 }, (_, index) => ({ tag: index < 2 ? 'h1' : 'div', x: index % 2 ? 40 : 80, gapPx: 16, backgroundColor: index % 2 ? 'rgb(255, 255, 255)' : 'rgb(240, 244, 250)', borderRadiusPx: 16, fontWeight: 600 }))
    }
  };
}

test('evidence-backed score cannot override a hard failure', () => {
  const rubric = scoreQualitativeRubric(result([{ rule: 'layout.horizontal-overflow', severity: 'P1' }]), policy);
  assert.ok(rubric.score >= 3);
  assert.equal(rubric.hardFailureCount, 1);
  assert.equal(rubric.cannotOverrideHardFailures, true);
  assert.equal(rubric.eligibleForPremium, false);
});

test('rubric includes every Apple-level qualitative dimension', () => {
  const rubric = scoreQualitativeRubric(result(), policy);
  assert.deepEqual(new Set(rubric.dimensions.map((item) => item.id)), new Set(['hierarchy', 'typography', 'spacing-rhythm', 'alignment-grid', 'density', 'surface-material', 'icon-consistency', 'microcopy', 'interaction-states', 'motion-intent', 'brand-distinctiveness', 'perceived-polish']));
});
