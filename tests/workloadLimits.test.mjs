import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKLOAD_LIMITS,
  chooseWatercolorBudget,
  createTimedCache,
  estimateGlazeCellCount,
  prepareTrackPoints
} from '../src/workloadLimits.js';

function denseWave(count) {
  return Array.from({ length: count }, (_, index) => ({
    x: index * 2,
    y: 100 + Math.sin(index * 0.37) * 42
  }));
}

test('dense strokes are capped while preserving endpoints', () => {
  const raw = denseWave(2600);
  const prepared = prepareTrackPoints(raw);

  assert.ok(prepared.limited);
  assert.equal(prepared.points.length, WORKLOAD_LIMITS.maxTrackPoints);
  assert.deepEqual(prepared.points[0], raw[0]);
  assert.deepEqual(prepared.points.at(-1), raw.at(-1));
  assert.ok(prepared.preLimitPointCount > prepared.points.length);
});

test('normal strokes stay visually unchanged by workload caps', () => {
  const raw = denseWave(40);
  const prepared = prepareTrackPoints(raw);

  assert.equal(prepared.limited, false);
  assert.ok(prepared.points.length > raw.length);
  assert.deepEqual(prepared.points[0], raw[0]);
  assert.deepEqual(prepared.points.at(-1), raw.at(-1));
});

test('large watercolor strokes choose adaptive cell sizes under the glaze budget', () => {
  const raw = denseWave(2600).map((point) => ({ x: point.x, y: point.y * 1.8 }));
  const prepared = prepareTrackPoints(raw);
  const budget = chooseWatercolorBudget(prepared.points, { steps: 36 });

  assert.ok(budget.limited);
  assert.ok(budget.cellSize >= 4);
  assert.ok(budget.steps <= 36);
  assert.ok(budget.cellCount <= WORKLOAD_LIMITS.maxGlazeCells);
  assert.equal(estimateGlazeCellCount(prepared.points, budget.cellSize), budget.cellCount);
});

test('timed cache invalidates explicitly and skips recompute inside cadence', () => {
  let now = 0;
  let computes = 0;
  const cache = createTimedCache(
    () => {
      computes += 1;
      return { computes };
    },
    { now: () => now, ttlMs: 250 }
  );

  assert.equal(cache.get().computes, 1);
  assert.equal(cache.get().computes, 1);
  now = 249;
  assert.equal(cache.get().computes, 1);
  now = 250;
  assert.equal(cache.get().computes, 2);
  cache.invalidate();
  assert.equal(cache.get().computes, 3);
  assert.equal(cache.stats().recomputes, 3);
});
