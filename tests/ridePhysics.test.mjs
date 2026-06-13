import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENGINE_FPS,
  LINE_RIDER_CONSTANTS,
  addRideTrack,
  createRideWorld,
  getRideTelemetry,
  nearestTrackContact,
  pointsToLineRiderSegments,
  removeRideTrack,
  resetRide,
  spawnRider,
  stepRide
} from '../src/ridePhysics.js';

function stepFrames(world, frames) {
  for (let i = 0; i < frames; i += 1) {
    stepRide(world, 1 / ENGINE_FPS);
  }
}

test('adapter preserves lr-core legacy constants', () => {
  assert.equal(LINE_RIDER_CONSTANTS.iterations, 6);
  assert.deepEqual(LINE_RIDER_CONSTANTS.gravity, { x: 0, y: 0.175 });
  assert.deepEqual(LINE_RIDER_CONSTANTS.defaultStartVelocity, { x: 0.4, y: 0 });
});

test('polyline conversion creates solid Line Rider segments', () => {
  const segments = pointsToLineRiderSegments(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ],
    20
  );

  assert.deepEqual(segments, [
    { id: 20, type: 0, x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 21, type: 0, x1: 10, y1: 0, x2: 10, y2: 10 }
  ]);
});

test('flat rail preserves glide instead of skidding to a halt', () => {
  const world = createRideWorld();
  addRideTrack(world, 'flat', [
    { x: 0, y: 100 },
    { x: 400, y: 100 }
  ]);
  resetRide(world, { x: 0, y: 95 });

  const startSpeed = getRideTelemetry(world).speed;
  stepFrames(world, 240);
  const telemetry = getRideTelemetry(world);

  assert.equal(telemetry.status, 'riding');
  assert.ok(telemetry.grounded);
  assert.ok(telemetry.speed > startSpeed * 0.95);
  assert.ok(telemetry.distance > 90);
});

test('downhill rail accelerates under Line Rider engine gravity', () => {
  const world = createRideWorld();
  addRideTrack(world, 'hill', [
    { x: 0, y: 100 },
    { x: 800, y: 200 }
  ]);
  resetRide(world, { x: 0, y: 95 });

  const startSpeed = getRideTelemetry(world).speed;
  stepFrames(world, 60);
  const telemetry = getRideTelemetry(world);

  assert.equal(telemetry.status, 'riding');
  assert.ok(telemetry.speed > startSpeed * 3);
  assert.ok(telemetry.contacts.some((contact) => contact.trackId === 'hill'));
});

test('airborne rider follows lr-core frame gravity without custom air drag', () => {
  const world = createRideWorld();
  const startY = world.rider.position.y;

  stepFrames(world, 10);
  const telemetry = getRideTelemetry(world);

  assert.equal(telemetry.status, 'airborne');
  assert.equal(Math.round(world.rider.velocity.y), 70);
  assert.ok(world.rider.position.y > startY);
});

test('rider exposes Line Rider body points and mounted state', () => {
  const world = createRideWorld();

  assert.equal(world.rider.mounted, true);
  assert.equal(world.rider.framesSinceUnbind, -1);
  assert.ok(world.rider.points.NOSE);
  assert.ok(world.rider.points.TAIL);
  assert.ok(world.rider.points.PEG);
  assert.ok(world.rider.points.SHOULDER);
});

test('spawnRider sets the lr-core start position and resets to frame zero', () => {
  const world = createRideWorld();
  addRideTrack(world, 'flat', [
    { x: 0, y: 100 },
    { x: 400, y: 100 }
  ]);
  stepFrames(world, 20);

  const rider = spawnRider(world, { x: 160, y: 80 });

  assert.equal(rider.frame, 0);
  assert.equal(world.frameIndex, 0);
  assert.equal(world.startPosition.x, 160);
  assert.equal(world.startPosition.y, 80);
  assert.ok(Math.abs(rider.position.x - 168.83) < 0.05);
  assert.ok(Math.abs(rider.position.y - 79.08) < 0.05);
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
