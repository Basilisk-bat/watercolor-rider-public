import {
  CustomLineRiderEngine,
  LineTypes,
  createLineFromJson
} from 'lr-core/line-rider-engine/index.js';
import {
  DEFAULT_START_POSITION,
  DEFAULT_START_VELOCITY,
  GRAVITY,
  ITERATE
} from 'lr-core/line-rider-engine/constants.js';

export const ENGINE_FPS = 40;
export const MIN_LINE_LENGTH = 0.5;
export const RIDE_LINE_TYPES = Object.freeze({
  SOLID: LineTypes.SOLID,
  ACC: LineTypes.ACC,
  SCENERY: LineTypes.SCENERY
});
export const LINE_RIDER_CONSTANTS = {
  iterations: ITERATE,
  gravity: GRAVITY,
  defaultStartPosition: DEFAULT_START_POSITION,
  defaultStartVelocity: DEFAULT_START_VELOCITY
};

const POINT_IDS = [
  'PEG',
  'TAIL',
  'NOSE',
  'STRING',
  'BUTT',
  'SHOULDER',
  'RHAND',
  'LHAND',
  'RFOOT',
  'LFOOT',
  'SCARF_0',
  'SCARF_1',
  'SCARF_2',
  'SCARF_3',
  'SCARF_4',
  'SCARF_5',
  'SCARF_6'
];

export function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneVelocity(velocity) {
  return { x: velocity.x, y: velocity.y };
}

function makeEngine(startPosition, startVelocity) {
  return new CustomLineRiderEngine({ legacy: true }).setStart(startPosition, startVelocity);
}

export function normalizeLineType(lineType = RIDE_LINE_TYPES.SOLID) {
  return Object.values(RIDE_LINE_TYPES).includes(lineType) ? lineType : RIDE_LINE_TYPES.SOLID;
}

export function pointsToLineRiderSegments(points, firstLineId = 1, type = LineTypes.SOLID) {
  const segments = [];
  let nextId = firstLineId;
  const normalizedType = normalizeLineType(type);

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);

    if (length < MIN_LINE_LENGTH) {
      continue;
    }

    segments.push({
      id: nextId,
      type: normalizedType,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y
    });
    nextId += 1;
  }

  return segments;
}

function buildLineData(tracks) {
  let nextLineId = 1;
  const lines = [];
  const lineToTrack = new Map();

  for (const track of tracks) {
    const trackLines = pointsToLineRiderSegments(track.points, nextLineId, track.lineType);
    for (const line of trackLines) {
      lines.push(line);
      lineToTrack.set(line.id, track.id);
    }
    nextLineId += trackLines.length;
  }

  return { lines, lineToTrack };
}

function rebuildEngine(world) {
  const { lines, lineToTrack } = buildLineData(world.tracks);
  let engine = makeEngine(world.startPosition, world.startVelocity);

  if (lines.length > 0) {
    engine = engine.addLine(lines.map(createLineFromJson));
  }

  world.engine = engine;
  world.lines = lines;
  world.lineToTrack = lineToTrack;
}

function getPoint(body, id) {
  const point = body.get(id);
  if (!point?.pos) {
    return null;
  }

  return {
    x: point.pos.x,
    y: point.pos.y,
    velocity: point.vel
      ? {
          x: point.vel.x * ENGINE_FPS,
          y: point.vel.y * ENGINE_FPS
        }
      : { x: 0, y: 0 }
  };
}

export function isRideCollisionUpdate(update, lineToTrack) {
  if (!update) {
    return false;
  }

  if (update.type === 'CollisionUpdate' || update.constructor?.name === 'CollisionUpdate') {
    return true;
  }

  return Number.isInteger(update.id) && lineToTrack.has(update.id) && Array.isArray(update.updated);
}

function getCollisionContacts(world, frameIndex) {
  if (frameIndex <= 0) {
    return [];
  }

  const updates = world.engine.getUpdatesAtFrame(frameIndex);
  const seen = new Set();
  const contacts = [];

  for (const update of updates) {
    if (!isRideCollisionUpdate(update, world.lineToTrack)) {
      continue;
    }

    if (seen.has(update.id)) {
      continue;
    }

    seen.add(update.id);
    contacts.push({
      lineId: update.id,
      trackId: world.lineToTrack.get(update.id) ?? null,
      distance: 0,
      arc: 0
    });
  }

  return contacts;
}

function bodyAngle(points) {
  const tail = points.TAIL;
  const nose = points.NOSE;

  if (tail && nose) {
    return Math.atan2(nose.y - tail.y, nose.x - tail.x);
  }

  return 0;
}

function makeRiderSnapshot(world, frameIndex, previousRider = null) {
  const body = world.engine.getRider(frameIndex);
  const points = {};

  for (const id of POINT_IDS) {
    const point = getPoint(body, id);
    if (point) {
      points[id] = point;
    }
  }

  const mounted = body.get('RIDER_MOUNTED');
  const crashed = mounted?.framesSinceUnbind >= 0;
  const contacts = getCollisionContacts(world, frameIndex);
  const bodyVelocity = body.velocity
    ? {
        x: body.velocity.x * ENGINE_FPS,
        y: body.velocity.y * ENGINE_FPS
      }
    : { x: 0, y: 0 };
  const position = clonePoint(body.position);
  const velocity =
    previousRider && previousRider.frame !== frameIndex
      ? {
          x: (position.x - previousRider.position.x) * ENGINE_FPS,
          y: (position.y - previousRider.position.y) * ENGINE_FPS
        }
      : bodyVelocity;
  const distance = Math.max(previousRider?.distance ?? 0, position.x - world.startBodyPosition.x);

  return {
    frame: frameIndex,
    position,
    velocity,
    engineVelocity: bodyVelocity,
    angle: bodyAngle(points),
    grounded: contacts.length > 0,
    status: crashed ? 'crashed' : contacts.length > 0 ? 'riding' : 'airborne',
    mounted: !crashed,
    framesSinceUnbind: mounted?.framesSinceUnbind ?? -1,
    distance,
    contacts,
    points
  };
}

export function createRideWorld(options = {}) {
  const startPosition = clonePoint(options.start ?? DEFAULT_START_POSITION);
  const startVelocity = cloneVelocity(options.startVelocity ?? DEFAULT_START_VELOCITY);
  const world = {
    engine: makeEngine(startPosition, startVelocity),
    tracks: [],
    lines: [],
    lineToTrack: new Map(),
    startPosition,
    startVelocity,
    startBodyPosition: { x: 0, y: 0 },
    frameFloat: 0,
    frameIndex: 0,
    rider: null,
    telemetry: {
      status: 'ready',
      grounded: false,
      speed: 0,
      distance: 0,
      contacts: []
    }
  };

  world.rider = makeRiderSnapshot(world, 0);
  world.rider.status = 'ready';
  world.startBodyPosition = clonePoint(world.rider.position);
  world.telemetry = getRideTelemetry(world);
  return world;
}

export function createRider(start) {
  const world = createRideWorld({ start });
  return world.rider;
}

export function setRideTracks(world, tracks) {
  world.tracks = tracks.map((track) => ({
    id: track.id,
    points: track.points.map(clonePoint),
    lineType: normalizeLineType(track.lineType)
  }));
  rebuildEngine(world);
  world.rider = makeRiderSnapshot(world, world.frameIndex, world.rider);
  world.telemetry = getRideTelemetry(world);
  return world;
}

export function addRideTrack(world, id, points, lineType = RIDE_LINE_TYPES.SOLID) {
  world.tracks.push({
    id,
    points: points.map(clonePoint),
    lineType: normalizeLineType(lineType)
  });
  rebuildEngine(world);
  world.rider = makeRiderSnapshot(world, world.frameIndex, world.rider);
  world.telemetry = getRideTelemetry(world);
}

export function removeRideTrack(world, id) {
  world.tracks = world.tracks.filter((track) => track.id !== id);
  rebuildEngine(world);
  world.rider = makeRiderSnapshot(world, world.frameIndex, world.rider);
  world.telemetry = getRideTelemetry(world);
}

export function resetRide(world, start = world.startPosition, startVelocity = world.startVelocity) {
  world.startPosition = clonePoint(start);
  world.startVelocity = cloneVelocity(startVelocity);
  world.frameFloat = 0;
  world.frameIndex = 0;
  rebuildEngine(world);
  world.rider = makeRiderSnapshot(world, 0);
  world.rider.status = 'ready';
  world.rider.distance = 0;
  world.startBodyPosition = clonePoint(world.rider.position);
  world.telemetry = getRideTelemetry(world);
  return world.rider;
}

export function spawnRider(world, point) {
  return resetRide(world, point, world.startVelocity);
}

export function nearestTrackContact(world, point) {
  let nearest = null;

  for (const track of world.tracks) {
    let arcStart = 0;

    for (let i = 1; i < track.points.length; i += 1) {
      const a = track.points[i - 1];
      const b = track.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
      const projected = {
        x: a.x + dx * t,
        y: a.y + dy * t
      };
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      const length = Math.sqrt(lengthSquared);

      if (!nearest || distance < nearest.distance) {
        nearest = {
          trackId: track.id,
          point: projected,
          distance,
          tangent: length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 },
          arc: arcStart + length * t
        };
      }

      arcStart += length;
    }
  }

  return nearest;
}

export function stepRide(world, dt) {
  const previousRider = world.rider;
  world.frameFloat += Math.max(0, dt) * ENGINE_FPS;
  world.frameIndex = Math.max(0, Math.floor(world.frameFloat));
  world.rider = makeRiderSnapshot(world, world.frameIndex, previousRider);
  world.telemetry = getRideTelemetry(world);
  return world.telemetry;
}

export function getRideTelemetry(world) {
  const { rider } = world;
  return {
    status: rider.status,
    grounded: rider.grounded,
    mounted: rider.mounted,
    framesSinceUnbind: rider.framesSinceUnbind,
    speed: vectorLength(rider.velocity),
    engineSpeed: vectorLength(rider.engineVelocity ?? rider.velocity),
    distance: rider.distance,
    frame: rider.frame,
    contacts: rider.contacts.map((contact) => ({ ...contact }))
  };
}
