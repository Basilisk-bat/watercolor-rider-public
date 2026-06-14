import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENGINE_FPS,
  LINE_RIDER_CONSTANTS,
  RIDE_LINE_TYPES,
  addRideTrack,
  createRideWorld,
  getRideTelemetry,
  isRideCollisionUpdate,
  nearestTrackContact,
  pointsToLineRiderSegments,
  removeRideTrack,
  resetRide,
  setRideTracks,
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

test('scenery line stays visible in world data but does not create ride contacts', () => {
  const world = createRideWorld();
  addRideTrack(
    world,
    'guide',
    [
      { x: 0, y: 100 },
      { x: 400, y: 100 }
    ],
    RIDE_LINE_TYPES.SCENERY
  );
  resetRide(world, { x: 0, y: 95 });

  assert.equal(world.tracks[0].lineType, RIDE_LINE_TYPES.SCENERY);
  assert.equal(world.lines[0].type, RIDE_LINE_TYPES.SCENERY);

  stepFrames(world, 90);
  const telemetry = getRideTelemetry(world);

  assert.equal(telemetry.contacts.some((contact) => contact.trackId === 'guide'), false);
  assert.notEqual(telemetry.status, 'riding');
});

test('accelerator line produces native speed gain versus equivalent solid line', () => {
  const solid = createRideWorld();
  const marker = createRideWorld();
  const points = [
    { x: 0, y: 100 },
    { x: 520, y: 100 }
  ];

  addRideTrack(solid, 'solid', points, RIDE_LINE_TYPES.SOLID);
  addRideTrack(marker, 'marker', points, RIDE_LINE_TYPES.ACC);
  resetRide(solid, { x: 0, y: 95 });
  resetRide(marker, { x: 0, y: 95 });

  stepFrames(solid, 80);
  stepFrames(marker, 80);
  const solidTelemetry = getRideTelemetry(solid);
  const markerTelemetry = getRideTelemetry(marker);

  assert.ok(markerTelemetry.distance > solidTelemetry.distance + 12);
  assert.ok(markerTelemetry.speed > solidTelemetry.speed);
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

test('polyline conversion preserves requested native Line Rider line types', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 30, y: 0 }
  ];

  assert.equal(pointsToLineRiderSegments(points, 1, RIDE_LINE_TYPES.SOLID)[0].type, RIDE_LINE_TYPES.SOLID);
  assert.equal(pointsToLineRiderSegments(points, 1, RIDE_LINE_TYPES.ACC)[0].type, RIDE_LINE_TYPES.ACC);
  assert.equal(pointsToLineRiderSegments(points, 1, RIDE_LINE_TYPES.SCENERY)[0].type, RIDE_LINE_TYPES.SCENERY);
  assert.equal(pointsToLineRiderSegments(points, 1, 999)[0].type, RIDE_LINE_TYPES.SOLID);
});

test('ride world retains per-track line types and defaults missing types to solid', () => {
  const world = createRideWorld();

  setRideTracks(world, [
    {
      id: 'guide',
      lineType: RIDE_LINE_TYPES.SCENERY,
      points: [
        { x: 0, y: 100 },
        { x: 80, y: 100 }
      ]
    },
    {
      id: 'legacy',
      points: [
        { x: 100, y: 100 },
        { x: 180, y: 100 }
      ]
    }
  ]);

  assert.equal(world.tracks[0].lineType, RIDE_LINE_TYPES.SCENERY);
  assert.equal(world.tracks[1].lineType, RIDE_LINE_TYPES.SOLID);
  assert.equal(world.lines[0].type, RIDE_LINE_TYPES.SCENERY);
  assert.equal(world.lines[1].type, RIDE_LINE_TYPES.SOLID);

  addRideTrack(
    world,
    'boost',
    [
      { x: 200, y: 100 },
      { x: 280, y: 100 }
    ],
    RIDE_LINE_TYPES.ACC
  );

  assert.equal(world.tracks.at(-1).lineType, RIDE_LINE_TYPES.ACC);
  assert.equal(world.lines.at(-1).type, RIDE_LINE_TYPES.ACC);
});

test('collision update detection survives production constructor minification', () => {
  const lineToTrack = new Map([[7, 'flat']]);

  assert.equal(isRideCollisionUpdate({ id: 7, updated: [{}], constructor: { name: 't' } }, lineToTrack), true);
  assert.equal(isRideCollisionUpdate({ id: 'PEG_TAIL', updated: [{}, {}], constructor: { name: 't' } }, lineToTrack), false);
  assert.equal(isRideCollisionUpdate({ id: 8, updated: [{}], constructor: { name: 't' } }, lineToTrack), false);
  assert.equal(isRideCollisionUpdate({ updated: [{}], constructor: { name: 't' } }, lineToTrack), false);
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
