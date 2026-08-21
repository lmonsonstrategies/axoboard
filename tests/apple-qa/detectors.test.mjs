import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectFocusOrder,
  detectHorizontalOverflow,
  detectMutationAttempts,
  detectStateSemantics,
  detectUndersizedTargets
} from '../../src/detectors.mjs';

const context = {
  route: 'fixture', state: 'empty', theme: 'light', viewport: 'phone-375',
  budgets: { horizontalOverflowPx: 1, minimumTouchTargetPx: 44, maximumPositiveTabIndex: 0 }
};

test('hard layout and touch gates classify deterministic violations', () => {
  assert.equal(detectHorizontalOverflow({ overflowPx: 50, offenders: [{ selector: '.wide' }] }, context)[0].severity, 'P1');
  const targets = detectUndersizedTargets([{ selector: 'button', width: 20, height: 20 }], context);
  assert.equal(targets[0].rule, 'interaction.touch-target');
  assert.equal(targets[0].severity, 'P1');
});

test('focus order and read-only mutation attempts are release blockers', () => {
  const focus = detectFocusOrder({ focusableCount: 1, stops: [{ selector: '#save', inViewport: true }] }, [{ selector: '#save', tabIndex: 4 }], context);
  assert.equal(focus[0].rule, 'accessibility.positive-tabindex');
  assert.equal(detectMutationAttempts({ blockedMutations: [{ method: 'POST', url: 'http://127.0.0.1/action' }] }, context)[0].severity, 'P0');
});

test('critical loading and error states require live-region semantics', () => {
  const loading = detectStateSemantics({ statusRegionCount: 0, busyRegionCount: 0, alertRegionCount: 0, targets: [] }, { ...context, state: 'loading' });
  const error = detectStateSemantics({ statusRegionCount: 0, busyRegionCount: 0, alertRegionCount: 0, targets: [] }, { ...context, state: 'error' });
  assert.equal(loading[0].rule, 'state.loading-semantics');
  assert.equal(error[0].rule, 'state.error-semantics');
});
