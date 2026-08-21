import { createHash } from 'node:crypto';

const severities = ['P0', 'P1', 'P2', 'P3'];

export function createFinding({ rule, severity, route, viewport, selector = null, message, evidence = {}, screenshot = null, source = 'automated' }) {
  if (!severities.includes(severity)) throw new Error(`Unknown severity ${severity}`);
  if (!rule || !route || !viewport || !message) throw new Error('Finding is missing required identity fields.');
  const fingerprint = [rule, route, viewport, selector || '', JSON.stringify(evidence)].join('|');
  return {
    id: `${rule}-${createHash('sha256').update(fingerprint).digest('hex').slice(0, 12)}`,
    rule,
    severity,
    source,
    route,
    viewport,
    selector,
    message,
    evidence,
    screenshot
  };
}

export function detectHorizontalOverflow(snapshot, context) {
  if (snapshot.overflowPx <= context.budgets.horizontalOverflowPx) return [];
  return [createFinding({
    rule: 'layout.horizontal-overflow',
    severity: 'P1',
    ...context,
    selector: snapshot.offenders[0]?.selector || 'html',
    message: `Page exceeds viewport by ${snapshot.overflowPx}px.`,
    evidence: { overflowPx: snapshot.overflowPx, offenders: snapshot.offenders.slice(0, 10) }
  })];
}

export function detectUndersizedTargets(targets, context) {
  return targets
    .filter((target) => target.width < context.budgets.minimumTouchTargetPx || target.height < context.budgets.minimumTouchTargetPx)
    .map((target) => createFinding({
      rule: 'interaction.touch-target',
      severity: target.width < 24 || target.height < 24 ? 'P1' : 'P2',
      ...context,
      selector: target.selector,
      message: `Interactive target is ${Math.round(target.width)}×${Math.round(target.height)}px; premium minimum is ${context.budgets.minimumTouchTargetPx}×${context.budgets.minimumTouchTargetPx}px.`,
      evidence: target
    }));
}

export function detectMissingAccessibleNames(elements, context) {
  return elements
    .filter((element) => !element.accessibleName.trim())
    .map((element) => createFinding({
      rule: 'accessibility.missing-name',
      severity: 'P1',
      ...context,
      selector: element.selector,
      message: `${element.tag} has no programmatic accessible name.`,
      evidence: element
    }));
}

export function detectInvisibleFocus(focusStops, context) {
  return focusStops
    .filter((stop) => !stop.visibleIndicator)
    .map((stop) => createFinding({
      rule: 'accessibility.invisible-focus',
      severity: 'P1',
      ...context,
      selector: stop.selector,
      message: 'Keyboard focus has no reliably visible indicator.',
      evidence: stop
    }));
}

export function detectFocusTrap(focusAudit, context) {
  if (!focusAudit.trapped) return [];
  return [createFinding({
    rule: 'accessibility.keyboard-trap',
    severity: 'P0',
    ...context,
    selector: focusAudit.selector,
    message: 'Keyboard navigation is trapped on a focusable element.',
    evidence: focusAudit
  })];
}

export function detectReducedMotion(records, context) {
  return records
    .filter((record) => record.durationMs > context.budgets.maximumMotionMsReduced)
    .map((record) => createFinding({
      rule: 'motion.reduced-motion-parity',
      severity: record.durationMs > 500 ? 'P1' : 'P2',
      ...context,
      selector: record.selector,
      message: `Motion remains active for ${Math.round(record.durationMs)}ms when reduced motion is requested.`,
      evidence: record
    }));
}

export function detectImageDensity(images, context) {
  return images
    .filter((image) => !image.isVector && image.densityRatio < context.budgets.imageDensityRatio)
    .map((image) => createFinding({
      rule: 'visual.image-density',
      severity: image.densityRatio < 0.5 ? 'P1' : 'P2',
      ...context,
      selector: image.selector,
      message: `Raster image resolution is ${image.densityRatio.toFixed(2)}× the rendered high-DPI requirement.`,
      evidence: image
    }));
}

export function detectTypography(snapshot, context) {
  const findings = [];
  if (snapshot.bodyFontPx < context.budgets.minimumBodyFontPx) {
    findings.push(createFinding({
      rule: 'typography.minimum-body-size',
      severity: 'P1',
      ...context,
      selector: 'body',
      message: `Default body type is ${snapshot.bodyFontPx}px; minimum is ${context.budgets.minimumBodyFontPx}px.`,
      evidence: { bodyFontPx: snapshot.bodyFontPx, minimum: context.budgets.minimumBodyFontPx }
    }));
  }
  for (const block of snapshot.overlongTextBlocks) {
    findings.push(createFinding({
      rule: 'typography.line-length',
      severity: 'P2',
      ...context,
      selector: block.selector,
      message: `Estimated line length is ${Math.round(block.estimatedCharsPerLine)} characters; target maximum is ${context.budgets.maximumTextLineLengthCh}.`,
      evidence: block
    }));
  }
  if (context.viewport.startsWith('tv-')) {
    for (const block of snapshot.tvTextTooSmall) {
      findings.push(createFinding({
        rule: 'tv.legibility',
        severity: 'P1',
        ...context,
        selector: block.selector,
        message: `TV text is ${block.fontPx}px; ten-foot minimum is ${context.budgets.minimumTvBodyFontPx}px.`,
        evidence: block
      }));
    }
  }
  return findings;
}

export function detectStructure(snapshot, context) {
  const findings = [];
  if (snapshot.mainCount !== 1) {
    findings.push(createFinding({
      rule: 'structure.main-landmark',
      severity: 'P1',
      ...context,
      selector: 'main',
      message: `Expected exactly one main landmark; found ${snapshot.mainCount}.`,
      evidence: { mainCount: snapshot.mainCount }
    }));
  }
  if (snapshot.h1Count !== 1) {
    findings.push(createFinding({
      rule: 'structure.single-h1',
      severity: snapshot.h1Count === 0 ? 'P1' : 'P2',
      ...context,
      selector: 'h1',
      message: `Expected one page-level heading; found ${snapshot.h1Count}.`,
      evidence: { h1Count: snapshot.h1Count }
    }));
  }
  if (snapshot.headingSkips.length) {
    findings.push(createFinding({
      rule: 'structure.heading-order',
      severity: 'P2',
      ...context,
      selector: snapshot.headingSkips[0].selector,
      message: 'Heading hierarchy skips one or more levels.',
      evidence: { skips: snapshot.headingSkips }
    }));
  }
  return findings;
}

export function detectFixedCollisions(collisions, context) {
  return collisions.map((collision) => createFinding({
    rule: 'layout.fixed-content-collision',
    severity: 'P1',
    ...context,
    selector: collision.selector,
    message: 'Fixed or sticky chrome obscures primary page content.',
    evidence: collision
  }));
}

export function detectBrokenLinks(links, context) {
  return links
    .filter((link) => link.status >= 400 || link.error)
    .map((link) => createFinding({
      rule: 'navigation.broken-link',
      severity: 'P1',
      ...context,
      selector: link.selector,
      message: `Same-origin link does not resolve successfully (${link.status || link.error}).`,
      evidence: link
    }));
}

export function detectSensitiveIdentity(text, patterns, context) {
  const matches = patterns
    .map((pattern) => ({ pattern, match: text.match(new RegExp(pattern, 'i'))?.[0] }))
    .filter(({ match }) => match)
    .map(({ pattern }) => pattern);
  if (!matches.length) return [];
  return [createFinding({
    rule: 'privacy.legacy-identity-leak',
    severity: 'P0',
    ...context,
    selector: 'html',
    message: 'Public output contains a prohibited legacy identity, infrastructure marker, or secret-shaped token.',
    evidence: { matchedPatternIds: matches.map((_, index) => `pattern-${index + 1}`) }
  })];
}

export function detectPerformance(metrics, context) {
  const findings = [];
  const checks = [
    ['performance.lcp', 'LCP', metrics.lcpMs, context.budgets.lcpMs, 'P1'],
    ['performance.cls', 'CLS', metrics.cls, context.budgets.cls, 'P1'],
    ['performance.inp', 'INP', metrics.inpMs, context.budgets.inpMs, 'P1'],
    ['performance.navigation', 'Navigation', metrics.navigationMs, context.budgets.navigationMs, 'P2']
  ];
  for (const [rule, label, value, budget, severity] of checks) {
    if (value == null || value <= budget) continue;
    findings.push(createFinding({
      rule,
      severity,
      ...context,
      message: `${label} ${Math.round(value * 100) / 100} exceeds budget ${budget}.`,
      evidence: { value, budget, unit: label === 'CLS' ? 'score' : 'ms' }
    }));
  }
  return findings;
}

export function detectRuntimeErrors(runtime, context) {
  const findings = [];
  for (const error of runtime.consoleErrors) {
    findings.push(createFinding({
      rule: 'runtime.console-error',
      severity: 'P1',
      ...context,
      message: 'Browser console emitted an error.',
      evidence: { text: String(error).slice(0, 500) }
    }));
  }
  for (const resource of runtime.failedResources) {
    findings.push(createFinding({
      rule: 'runtime.failed-resource',
      severity: resource.sameOrigin ? 'P1' : 'P2',
      ...context,
      message: `Resource failed: ${resource.status || resource.error || 'network failure'}.`,
      evidence: resource
    }));
  }
  return findings;
}

export function detectAxeViolations(violations, context) {
  const severityMap = { critical: 'P1', serious: 'P1', moderate: 'P2', minor: 'P3' };
  return violations.flatMap((violation) => violation.nodes.map((node) => createFinding({
    rule: `axe.${violation.id}`,
    severity: severityMap[violation.impact] || 'P2',
    ...context,
    selector: node.target.join(' '),
    message: violation.help,
    evidence: {
      impact: violation.impact,
      helpUrl: violation.helpUrl,
      failureSummary: node.failureSummary,
      html: node.html.slice(0, 300)
    }
  })));
}

export function deduplicateFindings(findings) {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}
