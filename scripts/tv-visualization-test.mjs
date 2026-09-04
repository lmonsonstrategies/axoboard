import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [styles, app, tv, tvStyles] = await Promise.all([
  readFile(new URL('../wireframes/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../wireframes/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../wireframes/tv.js', import.meta.url), 'utf8'),
  readFile(new URL('../wireframes/tv.css', import.meta.url), 'utf8')
]);

assert.match(styles, /--aqua-400:\s*#[0-9a-f]{6};/i, 'the shared aqua-400 token must resolve');

const overrideStart = styles.indexOf('/* TV visualization paints must always resolve');
assert.ok(overrideStart > styles.indexOf('.tv-gauge {'), 'the safe TV paint contract must override legacy declarations');
const overrides = styles.slice(overrideStart);

for (const [token, fallback] of [
  ['primary', '#f08caf'],
  ['secondary', '#68c9ed'],
  ['success', '#b8f58e']
]) {
  assert.match(
    overrides,
    new RegExp(`--tv-brand-${token}:\\s*var\\(--customer-${token},\\s*var\\([^;]+${fallback}\\)\\)`, 'i'),
    `TV ${token} paint needs a customer token and literal-safe fallback`
  );
  assert.match(app, new RegExp(`setProperty\\('--customer-${token}'`), `the authenticated TV must apply brand ${token}`);
}

for (const contract of [
  /\.tv-progress-track i,[\s\S]*?\.tv-goal-pace > div i[\s\S]*?linear-gradient\([^;]+--tv-brand-primary[^;]+--tv-brand-secondary[^;]+--tv-brand-success/i,
  /\.tv-gauge[\s\S]*?conic-gradient\([^;]+--tv-brand-primary[^;]+--tv-brand-secondary/i,
  /\.tv-rep-card i b[\s\S]*?linear-gradient\([^;]+--tv-brand-primary[^;]+--tv-brand-secondary/i,
  /\.tv-category-row > i b[\s\S]*?linear-gradient\([^;]+--tv-brand-secondary[^;]+--tv-brand-primary/i,
  /\.tv-trend-current\s*\{\s*stroke:\s*var\(--tv-brand-primary\)/i,
  /\.tv-trend-comparison\s*\{\s*stroke:\s*var\(--tv-brand-secondary\)/i
]) assert.match(overrides, contract, 'every TV chart paint must use the safe brand contract');

assert.match(tvStyles, /aspect-ratio:16\/9/, 'TV stage is explicitly constrained to 16:9');
assert.match(tvStyles, /grid-template-columns:repeat\(12/, 'TV composition uses the canonical 12-column grid');
assert.match(tvStyles, /grid-template-rows:repeat\(6/, 'TV composition uses the canonical 6-row grid');
assert.match(tv, /grid\.dataset\.layout='executive'/, 'paired TV selects the authored Executive layout');
assert.match(tv, /tv-card-hero/, 'Executive layout marks the first KPI as the hero');

console.log('AxoBoard TV visualization test passed: gauge, progress, rep, category, and trend paints resolve through customer-brand fallbacks.');
