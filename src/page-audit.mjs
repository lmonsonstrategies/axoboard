import AxeBuilder from '@axe-core/playwright';
import {
  deduplicateFindings,
  detectAxeViolations,
  detectBrokenLinks,
  detectFixedCollisions,
  detectFocusOrder,
  detectFocusTrap,
  detectFontReadiness,
  detectHorizontalOverflow,
  detectImageDensity,
  detectInvisibleFocus,
  detectMissingAccessibleNames,
  detectMutationAttempts,
  detectPerformance,
  detectReducedMotion,
  detectRuntimeErrors,
  detectSensitiveIdentity,
  detectStateSemantics,
  detectStructure,
  detectTypography,
  detectUndersizedTargets
} from './detectors.mjs';

export async function installPerformanceObservers(page) {
  await page.addInitScript(() => {
    window.__AXO_QA_VITALS__ = { lcpMs: null, cls: 0, inpMs: null };
    window.__AXO_QA_FONT_LAYOUT__ = { before: [], after: [], shiftCount: 0 };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const latest = entries.at(-1);
        if (latest) window.__AXO_QA_VITALS__.lcpMs = latest.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__AXO_QA_VITALS__.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.interactionId && entry.duration > (window.__AXO_QA_VITALS__.inpMs || 0)) {
            window.__AXO_QA_VITALS__.inpMs = entry.duration;
          }
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {}
    document.addEventListener('DOMContentLoaded', () => {
      const sample = () => [...document.querySelectorAll('h1,h2,h3,p,button,label')].slice(0, 40).map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      window.__AXO_QA_FONT_LAYOUT__.before = sample();
      document.fonts?.ready.then(() => {
        window.__AXO_QA_FONT_LAYOUT__.after = sample();
        window.__AXO_QA_FONT_LAYOUT__.shiftCount = window.__AXO_QA_FONT_LAYOUT__.after.reduce((count, item, index) => {
          const before = window.__AXO_QA_FONT_LAYOUT__.before[index];
          if (!before || before.tag !== item.tag) return count + 1;
          return count + (Math.abs(before.x - item.x) > 1 || Math.abs(before.y - item.y) > 1 || Math.abs(before.width - item.width) > 1 || Math.abs(before.height - item.height) > 1 ? 1 : 0);
        }, 0);
      }).catch(() => {});
    }, { once: true });
  });
}

export function attachRuntimeObservers(page, baseOrigin) {
  const runtime = { consoleErrors: [], failedResources: [], blockedMutations: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') runtime.consoleErrors.push(message.text().slice(0, 500));
  });
  page.on('pageerror', (error) => runtime.consoleErrors.push(`pageerror: ${error.message}`.slice(0, 500)));
  page.on('requestfailed', (request) => {
    const url = safeUrl(request.url());
    runtime.failedResources.push({
      url,
      error: request.failure()?.errorText || 'request failed',
      sameOrigin: sameOrigin(request.url(), baseOrigin)
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) return;
    runtime.failedResources.push({
      url: safeUrl(response.url()),
      status: response.status(),
      sameOrigin: sameOrigin(response.url(), baseOrigin)
    });
  });
  return runtime;
}

export async function enforceReadOnlyNetwork(page, runtime) {
  await page.route('**/*', async (route) => {
    const method = route.request().method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      runtime.blockedMutations.push({ method, url: safeUrl(route.request().url()) });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

export async function collectDomSnapshot(page, viewport, budgets) {
  return page.evaluate(({ viewport, budgets }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const selectorFor = (element) => {
      if (!element || element === document.documentElement) return 'html';
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const stableClass = [...current.classList].find((name) => /^[a-z][a-z0-9_-]{2,40}$/i.test(name));
        if (stableClass) part += `.${CSS.escape(stableClass)}`;
        const siblings = current.parentElement ? [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        current = current.parentElement;
        if (current?.id) {
          parts.unshift(`#${CSS.escape(current.id)}`);
          break;
        }
      }
      return parts.join(' > ');
    };
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (label) return label;
      }
      const direct = element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title');
      if (direct?.trim()) return direct.trim();
      if (element.labels?.length) {
        const associatedLabel = [...element.labels].map((label) => label.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
        if (associatedLabel) return associatedLabel;
      }
      const enclosingLabel = element.closest('label');
      if (enclosingLabel) {
        const clone = enclosingLabel.cloneNode(true);
        clone.querySelectorAll('input,select,textarea,button').forEach((control) => control.remove());
        const labelText = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        if (labelText) return labelText;
      }
      return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    };

    const layoutViewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const overflowPx = Math.max(0, document.documentElement.scrollWidth - layoutViewportWidth);
    const overflowOffenders = [...document.querySelectorAll('body *')]
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > layoutViewportWidth + budgets.horizontalOverflowPx || rect.left < -budgets.horizontalOverflowPx)
      .slice(0, 30)
      .map(({ element, rect }) => ({
        selector: selectorFor(element),
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10
      }));

    const interactiveSelector = 'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
    const targets = [...document.querySelectorAll(interactiveSelector)]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: selectorFor(element),
          tag: element.tagName.toLowerCase(),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          tabIndex: element.tabIndex,
          role: element.getAttribute('role') || null,
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
          accessibleName: accessibleName(element).slice(0, 100)
        };
      });

    const missingNameCandidates = targets
      .filter((target) => !target.accessibleName)
      .map((target) => ({ selector: target.selector, tag: target.tag, accessibleName: target.accessibleName }));

    const images = [...document.images]
      .filter(visible)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        const isVector = /\.svg(?:\?|$)/i.test(image.currentSrc || image.src);
        const requiredWidth = Math.max(1, rect.width * viewport.dpr);
        const requiredHeight = Math.max(1, rect.height * viewport.dpr);
        return {
          selector: selectorFor(image),
          url: new URL(image.currentSrc || image.src, location.href).pathname,
          isVector,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
          densityRatio: Math.min(image.naturalWidth / requiredWidth, image.naturalHeight / requiredHeight)
        };
      });

    const textBlocks = [...document.querySelectorAll('p,li,dd,article')]
      .filter((element) => visible(element) && (element.textContent || '').trim().length > 75)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const fontPx = Number.parseFloat(getComputedStyle(element).fontSize);
        return {
          selector: selectorFor(element),
          fontPx,
          estimatedCharsPerLine: rect.width / Math.max(1, fontPx * 0.52),
          sample: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        };
      });

    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
    const headingSkips = [];
    let previousLevel = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      if (previousLevel && level > previousLevel + 1) {
        headingSkips.push({ selector: selectorFor(heading), from: previousLevel, to: level });
      }
      previousLevel = level;
    }

    const fixedCollisions = [];
    const main = document.querySelector('main');
    const mainRect = main?.getBoundingClientRect();
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      if (!['fixed', 'sticky'].includes(style.position)) continue;
      const rect = element.getBoundingClientRect();
      if (!mainRect || rect.height <= 0 || rect.width <= 0) continue;
      const overlapWidth = Math.max(0, Math.min(rect.right, mainRect.right) - Math.max(rect.left, mainRect.left));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, mainRect.bottom) - Math.max(rect.top, mainRect.top));
      const overlapArea = overlapWidth * overlapHeight;
      if (overlapArea > Math.min(rect.width * rect.height, 4_000) && style.pointerEvents !== 'none') {
        const topChrome = rect.top <= 1 && mainRect.top < rect.bottom - 2;
        const bottomChrome = rect.bottom >= window.innerHeight - 1 && mainRect.bottom > rect.top + 2;
        if (topChrome || bottomChrome) fixedCollisions.push({
          selector: selectorFor(element),
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          mainTop: mainRect.top,
          overlapArea: Math.round(overlapArea)
        });
      }
    }

    const bodyFontPx = Number.parseFloat(getComputedStyle(document.body).fontSize);
    const tvTextTooSmall = viewport.id.startsWith('tv-')
      ? [...document.querySelectorAll('p,li,dd,dt,button,label,input,select,textarea,small,span')]
        .filter((element) => visible(element) && (element.textContent || element.value || '').trim())
        .map((element) => ({ selector: selectorFor(element), fontPx: Number.parseFloat(getComputedStyle(element).fontSize), sample: (element.textContent || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 100) }))
        .filter((block) => block.fontPx < budgets.minimumTvBodyFontPx)
        .slice(0, 30)
      : [];

    const visibleElements = [...document.querySelectorAll('body *')].filter(visible);
    const styleSample = visibleElements.slice(0, 250).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        x: Math.round(rect.x),
        width: Math.round(rect.width),
        fontPx: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        lineHeightPx: Number.parseFloat(style.lineHeight) || null,
        fontFamily: style.fontFamily,
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderRadiusPx: Number.parseFloat(style.borderRadius) || 0,
        gapPx: Number.parseFloat(style.gap) || 0
      };
    });

    const links = [...document.querySelectorAll('a[href]')]
      .filter(visible)
      .map((anchor) => ({ selector: selectorFor(anchor), href: anchor.href }))
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.href === entry.href) === index);

    return {
      title: document.title,
      bodyText: document.body.innerText.slice(0, 500_000),
      overflowPx,
      overflowOffenders,
      targets,
      missingNameCandidates,
      images,
      bodyFontPx,
      overlongTextBlocks: textBlocks.filter((block) => block.estimatedCharsPerLine > budgets.maximumTextLineLengthCh).slice(0, 30),
      tvTextTooSmall,
      mainCount: [...document.querySelectorAll('main')].filter(visible).length,
      h1Count: headings.filter((heading) => heading.tagName === 'H1').length,
      headingSkips,
      fixedCollisions,
      links,
      statusRegionCount: document.querySelectorAll('[role="status"],[aria-live="polite"]').length,
      alertRegionCount: document.querySelectorAll('[role="alert"],[aria-live="assertive"]').length,
      busyRegionCount: document.querySelectorAll('[aria-busy="true"]').length,
      qualitative: {
        visibleElementCount: visibleElements.length,
        sectionCount: document.querySelectorAll('main section,main article').length,
        wordCount: (document.body.innerText.match(/\S+/g) || []).length,
        headingSizes: headings.map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize)),
        styleSample,
        inlineSvgCount: document.querySelectorAll('svg').length,
        emojiIconCount: [...document.querySelectorAll('[aria-hidden="true"],button,a')].filter((element) => /[\u2190-\u2BFF\u{1F300}-\u{1FAFF}]/u.test(element.textContent || '')).length,
        brandMentions: (document.body.innerText.match(/AxoBoard/gi) || []).length
      }
    };
  }, { viewport, budgets });
}

export async function auditKeyboard(page, maxStops = 35) {
  await page.addStyleTag({ content: 'html,*{scroll-behavior:auto!important}' });
  const focusableCount = await page.locator('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])').count();
  const stops = [];
  const sequence = [];
  let repeated = 0;
  let previous = null;
  let trapped = false;
  let escapeProbeMoved = null;
  const iterations = Math.min(maxStops, focusableCount + 2);
  for (let index = 0; index < iterations; index += 1) {
    await page.keyboard.press('Tab');
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    await page.waitForFunction(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return true;
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < (document.documentElement.clientWidth || innerWidth);
    }, null, { timeout: 400 }).catch(() => {});
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const selector = (() => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const parts = [];
        let current = element;
        while (current && current !== document.body && parts.length < 6) {
          let part = current.tagName.toLowerCase();
          const siblings = current.parentElement ? [...current.parentElement.children].filter((candidate) => candidate.tagName === current.tagName) : [];
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          parts.unshift(part);
          current = current.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      })();
      const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
      const hasOutline = style.outlineStyle !== 'none' && outlineWidth >= 1;
      const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      return {
        selector,
        visibleIndicator: hasOutline || hasShadow,
        outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
        boxShadow: style.boxShadow,
        inViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
      };
    });
    if (!stop) continue;
    stops.push(stop);
    sequence.push(stop.selector);
    if (stop.selector === previous) repeated += 1;
    else repeated = 0;
    previous = stop.selector;
    if (repeated >= 2 && focusableCount > 1) break;
  }
  if (repeated >= 2 && focusableCount > 1) {
    const repeatedElement = await page.evaluateHandle(() => document.activeElement);
    await page.keyboard.press('Shift+Tab');
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(resolveFrame)));
    escapeProbeMoved = await page.evaluate((before) => document.activeElement !== before, repeatedElement);
    await repeatedElement.dispose();
    trapped = !escapeProbeMoved;
  }
  return {
    stops,
    trapped,
    selector: trapped ? previous : null,
    focusableCount,
    sequence,
    escapeProbeMoved
  };
}

export async function collectReducedMotion(page, maximumMs) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(75);
  const records = await page.evaluate((maximum) => {
    const output = [];
    const selectorFor = (element) => element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase();
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      const durations = [...style.animationDuration.split(','), ...style.transitionDuration.split(',')]
        .map((value) => value.trim())
        .map((value) => value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000)
        .filter(Number.isFinite);
      const durationMs = Math.max(0, ...durations);
      if (durationMs > maximum) output.push({
        selector: selectorFor(element),
        durationMs,
        animationName: style.animationName,
        transitionProperty: style.transitionProperty
      });
    }
    return output.slice(0, 50);
  }, maximumMs);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return records;
}

export async function collectPerformance(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const vitals = window.__AXO_QA_VITALS__ || {};
    return {
      lcpMs: vitals.lcpMs ?? null,
      cls: vitals.cls ?? null,
      inpMs: vitals.inpMs ?? null,
      navigationMs: navigation?.duration ?? null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      transferBytes: navigation?.transferSize ?? null
    };
  });
}

export async function collectFontReadiness(page) {
  return page.evaluate(() => {
    const layout = window.__AXO_QA_FONT_LAYOUT__ || {};
    const bodyFamily = getComputedStyle(document.body).fontFamily;
    const heading = document.querySelector('h1,h2,h3');
    return {
      status: document.fonts?.status || 'unsupported',
      bodyFamily,
      headingFamily: heading ? getComputedStyle(heading).fontFamily : null,
      loadedFaceCount: document.fonts ? [...document.fonts].filter((font) => font.status === 'loaded').length : null,
      failedFaceCount: document.fonts ? [...document.fonts].filter((font) => font.status === 'error').length : null,
      layoutShiftCount: layout.shiftCount || 0
    };
  });
}

export async function checkSameOriginLinks(requestContext, links, baseOrigin) {
  const safeLinks = links.filter(({ href }) => {
    try {
      const url = new URL(href);
      return url.origin === baseOrigin && ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  });
  const output = [];
  for (const link of safeLinks.slice(0, 50)) {
    try {
      const url = new URL(link.href);
      url.hash = '';
      const response = await requestContext.get(url.toString(), { timeout: 10_000, failOnStatusCode: false });
      output.push({ selector: link.selector, url: safeUrl(url.toString()), status: response.status() });
    } catch (error) {
      output.push({ selector: link.selector, url: safeUrl(link.href), error: error.message.slice(0, 200) });
    }
  }
  return output;
}

export async function runPageAudit({ page, requestContext, route, viewport, theme = 'light', browserEngine = 'unknown', config, baseOrigin, checkLinks = false }) {
  const context = { route: route.id, state: route.state, theme, viewport: viewport.id, browserEngine, budgets: config.budgets };
  const runtime = attachRuntimeObservers(page, baseOrigin);
  await enforceReadOnlyNetwork(page, runtime);
  await installPerformanceObservers(page);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
  const response = await page.goto(new URL(route.path, baseOrigin).toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(250);

  const snapshot = await collectDomSnapshot(page, viewport, config.budgets);
  const keyboard = await auditKeyboard(page);
  const reducedMotion = await collectReducedMotion(page, config.budgets.maximumMotionMsReduced);
  const metrics = await collectPerformance(page);
  const fonts = await collectFontReadiness(page);
  const axe = await new AxeBuilder({ page }).analyze();
  const linkResults = checkLinks ? await checkSameOriginLinks(requestContext, snapshot.links, baseOrigin) : [];

  const findings = [
    ...detectHorizontalOverflow({ overflowPx: snapshot.overflowPx, offenders: snapshot.overflowOffenders }, context),
    ...detectUndersizedTargets(snapshot.targets, context),
    ...detectMissingAccessibleNames(snapshot.missingNameCandidates, context),
    ...detectInvisibleFocus(keyboard.stops, context),
    ...detectFocusOrder(keyboard, snapshot.targets, context),
    ...detectFocusTrap(keyboard, context),
    ...detectReducedMotion(reducedMotion, context),
    ...detectImageDensity(snapshot.images, context),
    ...detectTypography(snapshot, context),
    ...detectStructure(snapshot, context),
    ...detectStateSemantics(snapshot, context),
    ...detectFixedCollisions(snapshot.fixedCollisions, context),
    ...detectSensitiveIdentity(snapshot.bodyText, config.sensitivePatterns, context),
    ...detectPerformance(metrics, context),
    ...detectFontReadiness(fonts, context),
    ...detectRuntimeErrors(runtime, context),
    ...detectMutationAttempts(runtime, context),
    ...detectAxeViolations(axe.violations, context),
    ...detectBrokenLinks(linkResults, context)
  ];

  if (!response || response.status() >= 400) {
    findings.push({
      id: `navigation-route-${route.id}-${viewport.id}-${theme}`,
      rule: 'navigation.route-status',
      severity: 'P1',
      source: 'automated',
      route: route.id,
      state: route.state,
      theme,
      viewport: viewport.id,
      browserEngine,
      selector: null,
      message: `Route returned ${response?.status() || 'no response'}.`,
      evidence: { status: response?.status() || null },
      screenshot: null
    });
  }

  const finalUrl = new URL(page.url());
  if (route.expectedPath && finalUrl.pathname !== route.expectedPath) {
    findings.push({
      id: `navigation-redirect-${route.id}-${viewport.id}-${theme}`,
      rule: 'navigation.redirect-contract',
      severity: 'P1',
      source: 'automated',
      route: route.id,
      state: route.state,
      theme,
      viewport: viewport.id,
      browserEngine,
      selector: null,
      message: `Expected navigation to ${route.expectedPath}; finished at ${finalUrl.pathname}.`,
      evidence: { expectedPath: route.expectedPath, actualPath: finalUrl.pathname },
      screenshot: null
    });
  }

  return {
    route: route.path,
    routeId: route.id,
    state: route.state,
    theme,
    browserEngine,
    surface: route.surface,
    viewport,
    title: snapshot.title,
    status: response?.status() || null,
    metrics,
    fonts,
    finalPath: finalUrl.pathname,
    blockedMutations: runtime.blockedMutations,
    counts: {
      interactiveTargets: snapshot.targets.length,
      focusStops: keyboard.stops.length,
      axeViolations: axe.violations.length,
      linksChecked: linkResults.length
    },
    findings: deduplicateFindings(findings),
    qualitativeSnapshot: snapshot.qualitative
  };
}

function sameOrigin(candidate, baseOrigin) {
  try {
    return new URL(candidate).origin === baseOrigin;
  } catch {
    return false;
  }
}

function safeUrl(candidate) {
  try {
    const url = new URL(candidate);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(candidate).slice(0, 200);
  }
}
