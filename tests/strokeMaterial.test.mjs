import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateStrokeMetrics,
  createStrokeMaterial,
  rewetStrokeMaterialAtPoint,
  sampleStrokeMaterial
} from '../src/strokeMaterial.js';
import { WORKLOAD_LIMITS, chooseRenderBudget, prepareTrackPoints } from '../src/workloadLimits.js';

const stroke = [
  { x: 0, y: 0 },
  { x: 90, y: -12 },
  { x: 180, y: 0 }
];

function compact(material) {
  return {
    bounds: material.bounds,
    canvasScale: Math.round(material.canvasScale * 10000) / 10000,
    samples: material.samples.map((sample) => ({
      x: Math.round(sample.x * 1000) / 1000,
      y: Math.round(sample.y * 1000) / 1000,
      radius: Math.round(sample.radius * 1000) / 1000
    })),
    trails: material.trails.length,
    grain: material.grain.length,
    metrics: Object.fromEntries(
      Object.entries(material.metrics).map(([key, value]) => [key, Math.round(value * 10000) / 10000])
    )
  };
}

function denseWave(count) {
  return Array.from({ length: count }, (_, index) => ({
    x: index * 2,
    y: 100 + Math.sin(index * 0.37) * 42
  }));
}

test('procedural stroke material is deterministic without grid simulation fields', () => {
  const a = compact(createStrokeMaterial(stroke, { seed: 11, sampleCount: 24, water: 1.1, pigment: 1 }));
  const b = compact(createStrokeMaterial(stroke, { seed: 11, sampleCount: 24, water: 1.1, pigment: 1 }));

  assert.deepEqual(a, b);
  assert.equal('water' in a, false);
  assert.equal('deposited' in a, false);
});

test('stroke material sampling stays under the render budget for dense strokes', () => {
  const prepared = prepareTrackPoints(denseWave(2600));
  const budget = chooseRenderBudget(prepared.points);
  const material = createStrokeMaterial(prepared.points, {
    seed: 22,
    sampleCount: budget.sampleCount,
    canvasScale: budget.canvasScale,
    water: 1.1,
    pigment: 1
  });

  assert.ok(prepared.points.length <= WORKLOAD_LIMITS.maxTrackPoints);
  assert.ok(material.samples.length <= WORKLOAD_LIMITS.maxRenderSamples);
  assert.ok(material.metrics.renderSampleCount <= WORKLOAD_LIMITS.maxRenderSamples);
  assert.ok(budget.canvasPixels <= WORKLOAD_LIMITS.maxMaterialCanvasPixels);
});

test('rewet material marks add visible metadata without creating pigment mass', () => {
  const material = createStrokeMaterial(stroke, { seed: 33, sampleCount: 30, water: 0.7, pigment: 1 });
  const beforePigment = material.metrics.totalPigmentMass;
  const beforeMarks = material.metrics.rewetMarkCount;
  const result = rewetStrokeMaterialAtPoint(material, { x: 90, y: -2 }, { speed: 180, radius: 18, water: 0.14 });

  assert.ok(result.affectedCellCount > 0);
  assert.ok(result.addedWater > 0);
  assert.equal(material.metrics.totalPigmentMass, beforePigment);
  assert.equal(material.metrics.rewetMarkCount, beforeMarks + 1);
  assert.equal(material.rewetMarks.length, 1);
});

test('faster rider contact records stronger rewet moisture', () => {
  const slow = createStrokeMaterial(stroke, { seed: 44, sampleCount: 30, water: 0.7, pigment: 1 });
  const fast = createStrokeMaterial(stroke, { seed: 44, sampleCount: 30, water: 0.7, pigment: 1 });
  const slowResult = rewetStrokeMaterialAtPoint(slow, { x: 90, y: 0 }, { speed: 20, radius: 18, water: 0.12 });
  const fastResult = rewetStrokeMaterialAtPoint(fast, { x: 90, y: 0 }, { speed: 260, radius: 18, water: 0.12 });

  assert.ok(fastResult.addedWater > slowResult.addedWater * 1.5);
});

test('aggregate stroke metrics summarize rendered material cost', () => {
  const first = createStrokeMaterial(stroke, { seed: 55, sampleCount: 20, water: 0.8, pigment: 1 });
  const second = createStrokeMaterial(
    stroke.map((point) => ({ x: point.x, y: point.y + 40 })),
    { seed: 56, sampleCount: 18, water: 0.4, pigment: 0.5 }
  );
  const aggregate = aggregateStrokeMetrics([first, second]);

  assert.equal(aggregate.renderSampleCount, first.samples.length + second.samples.length);
  assert.equal(aggregate.rewetMarkCount, 0);
  assert.ok(aggregate.renderUnitCount >= aggregate.renderSampleCount);
  assert.ok(aggregate.totalPigmentMass > 0);
});

test('sampleStrokeMaterial returns stable sample counts for short and long strokes', () => {
  assert.equal(sampleStrokeMaterial(stroke, 12, 7).length, 12);
  assert.equal(sampleStrokeMaterial(denseWave(60), 48, 7).length, 48);
});
