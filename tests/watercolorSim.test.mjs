import assert from 'node:assert/strict';
import test from 'node:test';
import { rewetGlazeAtPoint, simulateWatercolorStroke } from '../src/watercolorSim.js';

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

function sumField(field) {
  return Array.from(field).reduce((sum, value) => sum + value, 0);
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

test('rider contact rewetting adds moisture without creating pigment', () => {
  const glaze = simulateWatercolorStroke(stroke, { seed: 16, steps: 26, water: 0.72, pigment: 1 });
  const beforeWater = sumField(glaze.water);
  const beforePigment = glaze.metrics.totalPigmentMass;
  const beforeWetCells = glaze.metrics.wetCellCount;
  const result = rewetGlazeAtPoint(glaze, { x: 90, y: 0 }, { speed: 160, radius: 18, water: 0.14, steps: 2 });
  const afterWater = sumField(glaze.water);
  const pigmentDrift = Math.abs(glaze.metrics.totalPigmentMass - beforePigment);

  assert.ok(result.affectedCellCount > 0);
  assert.ok(result.addedWater > 0);
  assert.ok(afterWater > beforeWater);
  assert.ok(glaze.metrics.wetCellCount >= beforeWetCells);
  assert.ok(pigmentDrift / beforePigment < 0.001);
});

test('faster rider contact adds more bleed moisture', () => {
  const slow = simulateWatercolorStroke(stroke, { seed: 17, steps: 26, water: 0.72, pigment: 1 });
  const fast = simulateWatercolorStroke(stroke, { seed: 17, steps: 26, water: 0.72, pigment: 1 });
  const slowResult = rewetGlazeAtPoint(slow, { x: 90, y: 0 }, { speed: 20, radius: 18, water: 0.12, steps: 1 });
  const fastResult = rewetGlazeAtPoint(fast, { x: 90, y: 0 }, { speed: 260, radius: 18, water: 0.12, steps: 1 });

  assert.ok(fastResult.addedWater > slowResult.addedWater * 1.5);
});
