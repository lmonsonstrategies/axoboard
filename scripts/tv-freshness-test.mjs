import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual player functions with a controlled clock and DOM/storage.
const now = Date.parse('2026-09-15T12:00:00Z');
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector, {
    textContent: '', hidden: false, dataset: {}, style: { setProperty() {} },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll() { return []; }, focus() {}
  });
  return nodes.get(selector);
}
const storage = new Map();
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  Date: Clock, Intl, console,
  document: { querySelector: node, createElement: () => node(`element-${nodes.size}`), documentElement: node('root') },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  window: { clearTimeout() {}, clearInterval() {} },
});
const source = readFileSync(new URL('../wireframes/tv.js', import.meta.url), 'utf8');
vm.runInContext(source.slice(0, source.indexOf("pairingCode.addEventListener('input'")), context);
const run = code => vm.runInContext(code, context);
context.kpi = { status: 'active', certification: { status: 'certified' }, fetchedAt: new Date(now - 60_000).toISOString(), staleAfterSeconds: 300, name: 'Revenue' };
assert.equal(run('metricFreshness(kpi)'), 'Fresh');
assert.equal(run('metricFreshness({...kpi, fetchedAt: new Date(Date.now()-300000).toISOString()})'), 'Stale');
assert.equal(run('metricFreshness({...kpi, status:"degraded"})'), 'Needs attention');
assert.equal(run('metricFreshness({...kpi, certification:{status:"suspended"}})'), 'Needs attention');
assert.equal(run('metricFreshness({...kpi, fetchedAt:null})'), 'Unknown');
assert.equal(run('metricFreshness({...kpi, fetchedAt:new Date(Date.now()+1000).toISOString()})'), 'Unknown');
assert.equal(run('metricFreshness({...kpi, staleAfterSeconds:0})'), 'Unknown');
assert.doesNotMatch(run('heading({...kpi,status:"degraded"})'), /● Live/);
run('runtime={kpis:[kpi,{...kpi,id:"old",fetchedAt:new Date(Date.now()-3600000).toISOString()}]}; updateFreshness()');
assert.match(node('#runtimeFreshness').textContent, /1 of 2 need attention/);
assert.match(node('#runtimeFreshness').textContent, /Oldest update 1h ago/);
run('runtimeVerifiedAt=Date.now()-cacheLifetimeMs+1;enforceRuntimeLifetime()');
assert.equal(run('Boolean(runtime)'), true, 'valid in-memory runtime is retained');
run('runtimeVerifiedAt=Date.now()-cacheLifetimeMs;enforceRuntimeLifetime()');
assert.equal(run('runtime'), null, 'expiry is enforced without reloading the browser');
assert.equal(node('#customerMark').textContent, 'TV');
assert.match(node('#runtimeGrid').children[0].textContent, /expired/);
assert.equal(node('#automationCelebration').hidden, true);
assert.equal(node('#previousPage').disabled, true);
run('localStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now()+1000,runtime:{kpis:[]}}))');
assert.equal(run('restoreCache()'), false, 'future-dated cache cannot extend its lease');
run('localStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now()-cacheLifetimeMs,runtime:{kpis:[]}}))');
assert.equal(run('restoreCache()'), false, 'expired persisted cache is rejected');
console.log('TV runtime passed: real freshness functions, oldest-source summary, running-cache expiry and invalid cache clocks.');
