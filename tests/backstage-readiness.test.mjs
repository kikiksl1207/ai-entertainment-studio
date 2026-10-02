import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderLaunchReadiness(readiness) {');
const end = source.indexOf('function renderLaunchReadinessFallback()', start);
assert.ok(start >= 0 && end > start);
const renderSource = source.slice(start, end);

function render(categories, overall = { score: 100, belowTargetCategories: [] }) {
  const score = { textContent: '' };
  const alert = { textContent: '', clear: false, classList: { toggle(_name, value) { alert.clear = value; } } };
  const grid = { innerHTML: '' };
  const context = {
    readiness: { overall, categories },
    launchReadinessScore: score,
    launchReadinessAlert: alert,
    launchReadinessGrid: grid,
    normalizeReadinessCategories: (value) => value.categories,
    escapeHtml: (value) => value,
    formatCount: (value) => String(value),
  };
  vm.runInNewContext(`${renderSource}\nrenderLaunchReadiness(readiness);`, context);
  return { score, alert, grid };
}

test('a high score never hides a launch blocker', () => {
  const result = render([{ label: '루미나 충전/BM', score: 100, status: 'score_ready_with_blockers', blockers: ['paid order not verified'], nextActions: [], metrics: {} }]);
  assert.equal(result.score.textContent, '100점');
  assert.equal(result.alert.clear, false);
  assert.match(result.alert.textContent, /출시 차단 항목: 루미나 충전\/BM/);
  assert.match(result.grid.innerHTML, /readiness-card is-low/);
});

test('a blocker-free high score retains the clear state', () => {
  const result = render([{ label: '공개 콘텐츠', score: 100, status: 'ready_candidate', blockers: [], nextActions: [], metrics: {} }]);
  assert.equal(result.alert.clear, true);
  assert.doesNotMatch(result.alert.textContent, /출시 차단 항목/);
});
