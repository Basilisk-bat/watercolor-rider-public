export function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function simplifyPoints(points, minDistance = 7) {
  if (points.length <= 2) {
    return [...points];
  }

  const simplified = [points[0]];
  let last = points[0];

  for (let i = 1; i < points.length - 1; i += 1) {
    if (distance(last, points[i]) >= minDistance) {
      simplified.push(points[i]);
      last = points[i];
    }
  }

  const end = points[points.length - 1];
  if (distance(simplified[simplified.length - 1], end) > 1) {
    simplified.push(end);
  }

  return simplified;
}

export function chaikinSmooth(points, iterations = 2) {
  if (points.length <= 2) {
    return [...points];
  }

  let result = [...points];

  for (let pass = 0; pass < iterations; pass += 1) {
    const next = [result[0]];

    for (let i = 0; i < result.length - 1; i += 1) {
      const a = result[i];
      const b = result[i + 1];
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75
      });
    }

    next.push(result[result.length - 1]);
    result = next;
  }

  return result;
}

export function totalLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += distance(points[i - 1], points[i]);
  }
  return length;
}

export function segmentFromPoints(a, b, thickness = 10) {
  const length = distance(a, b);
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    length,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    thickness
  };
}

export function pointsToSegments(points, thickness = 10, minLength = 4) {
  const segments = [];

  for (let i = 1; i < points.length; i += 1) {
    const segment = segmentFromPoints(points[i - 1], points[i], thickness);
    if (segment.length >= minLength) {
      segments.push(segment);
    }
  }

  return segments;
}

export function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return distance(point, a);
  }

  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  const projected = {
    x: a.x + t * dx,
    y: a.y + t * dy
  };

  return distance(point, projected);
}

export function nearestDistanceToPolyline(point, points) {
  if (points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (points.length === 1) {
    return distance(point, points[0]);
  }

  let nearest = Number.POSITIVE_INFINITY;

  for (let i = 1; i < points.length; i += 1) {
    nearest = Math.min(nearest, distanceToSegment(point, points[i - 1], points[i]));
  }

  return nearest;
}
