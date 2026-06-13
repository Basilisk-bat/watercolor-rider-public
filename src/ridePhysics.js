const DEFAULT_CONFIG = {
  gravity: 840,
  runnerSpacing: 36,
  runnerDrop: 18,
  snapDistance: 22,
  railDrag: 0.18,
  airDrag: 0.045,
  maxSpeed: 920,
  stallSpeed: 14,
  stallMs: 900
};

export function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector, fallback = { x: 1, y: 0 }) {
  const length = vectorLength(vector);
  if (length === 0) {
    return { ...fallback };
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createRideWorld(options = {}) {
  return {
    config: { ...DEFAULT_CONFIG, ...options },
    tracks: [],
    rider: createRider(options.start ?? { x: 120, y: 120 }),
    telemetry: {
      status: 'ready',
      grounded: false,
      speed: 0,
      distance: 0,
      contacts: []
    }
  };
}

export function createRider(start) {
  return {
    position: { x: start.x, y: start.y },
    velocity: { x: 250, y: 0 },
    angle: 0,
    angularVelocity: 0,
    grounded: false,
    status: 'ready',
    stallMs: 0,
    distance: 0,
    startX: start.x,
    contacts: []
  };
}

export function resetRide(world, start) {
  world.rider = createRider(start);
  world.telemetry = getRideTelemetry(world);
  return world.rider;
}

export function addRideTrack(world, id, points) {
  const segments = [];
  let arcStart = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    if (length < 1) {
      continue;
    }

    const tangent = { x: dx / length, y: dy / length };
    let normal = { x: -tangent.y, y: tangent.x };
    if (normal.y > 0) {
      normal = { x: -normal.x, y: -normal.y };
    }

    segments.push({
      a,
      b,
      length,
      tangent,
      normal,
      arcStart
    });
    arcStart += length;
  }

  world.tracks.push({
    id,
    points: points.map((point) => ({ ...point })),
    segments,
    length: arcStart
  });
}

export function removeRideTrack(world, id) {
  world.tracks = world.tracks.filter((track) => track.id !== id);
}

export function nearestTrackContact(world, point) {
  let nearest = null;

  for (const track of world.tracks) {
    for (const segment of track.segments) {
      const dx = segment.b.x - segment.a.x;
      const dy = segment.b.y - segment.a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : clamp(((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared, 0, 1);
      const projected = {
        x: segment.a.x + dx * t,
        y: segment.a.y + dy * t
      };
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);

      if (!nearest || distance < nearest.distance) {
        nearest = {
          trackId: track.id,
          point: projected,
          distance,
          tangent: segment.tangent,
          normal: segment.normal,
          arc: segment.arcStart + segment.length * t
        };
      }
    }
  }

  return nearest;
}

function runnerProbe(rider, config, direction, side) {
  return {
    x: rider.position.x + direction.x * side * (config.runnerSpacing / 2),
    y: rider.position.y + direction.y * side * (config.runnerSpacing / 2) + config.runnerDrop
  };
}

function averageContact(contacts) {
  const point = contacts.reduce((sum, contact) => ({
    x: sum.x + contact.point.x,
    y: sum.y + contact.point.y
  }), { x: 0, y: 0 });
  const tangent = normalize(
    contacts.reduce((sum, contact) => ({
      x: sum.x + contact.tangent.x,
      y: sum.y + contact.tangent.y
    }), { x: 0, y: 0 })
  );
  let normal = { x: -tangent.y, y: tangent.x };
  if (normal.y > 0) {
    normal = { x: -normal.x, y: -normal.y };
  }

  return {
    point: {
      x: point.x / contacts.length,
      y: point.y / contacts.length
    },
    tangent,
    normal,
    contacts
  };
}

function limitVelocity(rider, maxSpeed) {
  const speed = vectorLength(rider.velocity);
  if (speed <= maxSpeed) {
    return;
  }

  const scale = maxSpeed / speed;
  rider.velocity.x *= scale;
  rider.velocity.y *= scale;
}

export function stepRide(world, dt) {
  const { config, rider } = world;
  const safeDt = Math.min(dt, 1 / 30);
  const motionDirection = normalize(rider.velocity, {
    x: Math.cos(rider.angle),
    y: Math.sin(rider.angle)
  });
  const probes = [
    runnerProbe(rider, config, motionDirection, -1),
    runnerProbe(rider, config, motionDirection, 1)
  ];
  const contacts = probes
    .map((probe) => nearestTrackContact(world, probe))
    .filter((contact) => contact && contact.distance <= config.snapDistance);

  if (contacts.length > 0) {
    const contact = averageContact(contacts);
    let tangent = contact.tangent;
    if (dot(rider.velocity, tangent) < 0) {
      tangent = { x: -tangent.x, y: -tangent.y };
    }

    const normal = contact.normal;
    const along = dot(rider.velocity, tangent);
    const slopeAcceleration = config.gravity * tangent.y;
    let railSpeed = along + slopeAcceleration * safeDt;
    railSpeed *= Math.max(0, 1 - config.railDrag * safeDt);

    rider.velocity = {
      x: tangent.x * railSpeed,
      y: tangent.y * railSpeed
    };
    rider.position = {
      x: contact.point.x + normal.x * config.runnerDrop,
      y: contact.point.y + normal.y * config.runnerDrop
    };
    rider.angle = Math.atan2(tangent.y, tangent.x);
    rider.grounded = true;
    rider.contacts = contacts;

    if (Math.abs(railSpeed) < config.stallSpeed) {
      rider.stallMs += safeDt * 1000;
    } else {
      rider.stallMs = 0;
    }

    rider.status = rider.stallMs >= config.stallMs ? 'stalled' : 'riding';
  } else {
    rider.velocity.y += config.gravity * safeDt;
    rider.velocity.x *= Math.max(0, 1 - config.airDrag * safeDt);
    rider.velocity.y *= Math.max(0, 1 - config.airDrag * safeDt);
    rider.position.x += rider.velocity.x * safeDt;
    rider.position.y += rider.velocity.y * safeDt;
    rider.angle += rider.angularVelocity * safeDt;
    rider.grounded = false;
    rider.contacts = [];
    rider.stallMs = 0;
    rider.status = 'airborne';
  }

  limitVelocity(rider, config.maxSpeed);
  rider.distance = Math.max(rider.distance, rider.position.x - rider.startX);
  world.telemetry = getRideTelemetry(world);
  return world.telemetry;
}

export function getRideTelemetry(world) {
  const { rider } = world;
  return {
    status: rider.status,
    grounded: rider.grounded,
    speed: vectorLength(rider.velocity),
    distance: rider.distance,
    contacts: rider.contacts.map((contact) => ({
      trackId: contact.trackId,
      distance: contact.distance,
      arc: contact.arc
    }))
  };
}
