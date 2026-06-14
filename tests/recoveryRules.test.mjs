import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGINE_FPS } from '../src/ridePhysics.js';
import { getRideRecovery } from '../src/recoveryRules.js';

const bounds = {
  minX: 0,
  maxX: 500,
  minY: 0,
  maxY: 240
};

test('crashed rider maps to explicit recovery pause without changing lr-core constants', () => {
  const recovery = getRideRecovery(
    { status: 'crashed', frame: 44 },
    { position: { x: 120.4, y: 80.7 } },
    bounds
  );

  assert.equal(recovery.reason, 'crashed');
  assert.equal(recovery.status, 'crashed');
  assert.deepEqual(recovery.detail, { frame: 44, x: 120, y: 81 });
  assert.equal(ENGINE_FPS, 40);
});

test('out-of-bounds rider maps to rinse recovery pause', () => {
  const recovery = getRideRecovery(
    { status: 'airborne', frame: 12 },
    { position: { x: 540, y: 820 } },
    bounds,
    { bottom: 520, left: 520, right: 700 }
  );

  assert.equal(recovery.reason, 'out-of-bounds');
  assert.equal(recovery.status, 'rinse');
  assert.deepEqual(recovery.detail, { x: 540, y: 820 });
});

test('normal riding does not request recovery', () => {
  assert.equal(
    getRideRecovery({ status: 'riding', frame: 2 }, { position: { x: 220, y: 190 } }, bounds),
    null
  );
});
