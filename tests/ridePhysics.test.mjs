import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addRideTrack,
  createRideWorld,
  nearestTrackContact,
  removeRideTrack,
  resetRide,
  stepRide
} from '../src/ridePhysics.js';

function stepMany(world, seconds) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepRide(world, dt);
  }
}

test('downhill rail contact accelerates the rider', () => {
  const world = createRideWorld({ gravity: 840 });
  addRideTrack(world, 'hill', [
    { x: 0, y: 100 },
    { x: 400, y: 260 }
  ]);
  resetRide(world, { x: 50, y: 102 });
  world.rider.velocity = { x: 120, y: 0 };

  const startSpeed = Math.hypot(world.rider.velocity.x, world.rider.velocity.y);
  stepMany(world, 0.8);

  assert.equal(world.rider.status, 'riding');
  assert.ok(Math.hypot(world.rider.velocity.x, world.rider.velocity.y) > startSpeed);
  assert.ok(world.rider.distance > 80);
});

test('smooth multi-segment rail does not stall at a seam', () => {
  const world = createRideWorld({ gravity: 760 });
  addRideTrack(world, 'seam', [
    { x: 0, y: 100 },
    { x: 180, y: 165 },
    { x: 360, y: 220 },
    { x: 540, y: 235 }
  ]);
  resetRide(world, { x: 40, y: 72 });
  world.rider.velocity = { x: 180, y: 0 };

  stepMany(world, 1.6);

  assert.notEqual(world.rider.status, 'stalled');
  assert.ok(world.rider.distance > 180);
});

test('slow grounded rider becomes stalled', () => {
  const world = createRideWorld({ gravity: 0, stallMs: 250, stallSpeed: 15 });
  addRideTrack(world, 'flat', [
    { x: 0, y: 100 },
    { x: 400, y: 100 }
  ]);
  resetRide(world, { x: 80, y: 82 });
  world.rider.velocity = { x: 2, y: 0 };

  stepMany(world, 0.5);

  assert.equal(world.rider.status, 'stalled');
});

test('nearest contact and removal update the world track index', () => {
  const world = createRideWorld();
  addRideTrack(world, 'a', [
    { x: 0, y: 100 },
    { x: 100, y: 100 }
  ]);
  addRideTrack(world, 'b', [
    { x: 0, y: 220 },
    { x: 100, y: 220 }
  ]);

  assert.equal(nearestTrackContact(world, { x: 20, y: 102 }).trackId, 'a');
  removeRideTrack(world, 'a');
  assert.equal(nearestTrackContact(world, { x: 20, y: 102 }).trackId, 'b');
});
