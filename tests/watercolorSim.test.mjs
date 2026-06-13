import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateWatercolorStroke } from '../src/watercolorSim.js';

const stroke = [
  { x: 0, y: 0 },
  { x: 180, y: 0 }
];

function compact(glaze) {
  return {
    bounds: glaze.bounds,
    width: glaze.width,
    height: glaze.height,
    deposited: Array.from(glaze.deposited).map((value) => Math.round(value * 10000) / 10000),
    wet: Array.from(glaze.wetMask),
    metrics: Object.fromEntries(
      Object.entries(glaze.metrics).map(([key, value]) => [key, Math.round(value * 10000) / 10000])
    )
  };
}

test('watercolor simulation is deterministic for the same stroke and seed', () => {
  const a = compact(simulateWatercolorStroke(stroke, { seed: 11, steps: 18, water: 1.1, pigment: 1 }));
  const b = compact(simulateWatercolorStroke(stroke, { seed: 11, steps: 18, water: 1.1, pigment: 1 }));

  assert.deepEqual(a, b);
});

test('water spreads beyond the original stroke mask', () => {
  const glaze = simulateWatercolorStroke(stroke, { seed: 12, steps: 24, water: 1.1, pigment: 1 });

  assert.ok(glaze.metrics.wetCellCount > glaze.metrics.seedCellCount);
  assert.ok(glaze.metrics.spreadCells > 0);
});

test('pigment is conserved across mobile and deposited fields within tolerance', () => {
  const glaze = simulateWatercolorStroke(stroke, { seed: 13, steps: 30, water: 1.15, pigment: 1 });
  const drift = Math.abs(glaze.metrics.totalPigmentMass - glaze.metrics.initialPigmentMass);

  assert.ok(drift / glaze.metrics.initialPigmentMass < 0.001);
});

test('high-water strokes produce downward runs while dry strokes do not', () => {
  const wet = simulateWatercolorStroke(stroke, { seed: 14, steps: 36, water: 1.5, pigment: 1.05 });
  const dry = simulateWatercolorStroke(stroke, { seed: 14, steps: 18, water: 0.22, pigment: 1.05 });

  assert.ok(wet.metrics.runoffCellCount > 0);
  assert.equal(dry.metrics.runoffCellCount, 0);
});

test('edge darkening and granulation exceed the stroke center baseline', () => {
  const glaze = simulateWatercolorStroke(stroke, { seed: 15, steps: 30, water: 1.2, pigment: 1 });

  assert.ok(glaze.metrics.edgeDepositedAverage > glaze.metrics.centerDepositedAverage);
  assert.ok(glaze.metrics.granulationMass > 0);
});
