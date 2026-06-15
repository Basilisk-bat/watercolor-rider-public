import { chaikinSmooth, distance, simplifyPoints } from './trackGeometry.js';

export const WORKLOAD_LIMITS = {
  maxTrackPoints: 1800,
  maxTracks: 24,
  maxHistory: 30,
  maxGlazeCells: 45000,
  metricsCacheMs: 250,
  rewetCanvasRefreshMs: 120,
  eraserIntervalMs: 45,
  eraserMinScreenDistance: 6,
  pinchDeadzoneRatio: 0.015,
  wheelDeltaMax: 240,
  minStrokeScreenDistance: 3,
  maxStrokeScreenDistance: 8,
  maxRawStrokePoints: 3600
};

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function capPointCount(points, maxPoints = WORKLOAD_LIMITS.maxTrackPoints) {
  if (points.length <= maxPoints) {
    return { points: points.map(clonePoint), limited: false };
  }

  const capped = [clonePoint(points[0])];
  const step = (points.length - 1) / (maxPoints - 1);
  let previousIndex = 0;

  for (let i = 1; i < maxPoints - 1; i += 1) {
    const index = Math.max(previousIndex + 1, Math.min(points.length - 2, Math.round(i * step)));
    capped.push(clonePoint(points[index]));
    previousIndex = index;
  }

  capped.push(clonePoint(points[points.length - 1]));
  return { points: capped, limited: true };
}

export function prepareTrackPoints(rawPoints, options = {}) {
  const preserve = options.preserve === true || options.starter === true;
  const basePoints = preserve
    ? rawPoints.map(clonePoint)
    : chaikinSmooth(simplifyPoints(rawPoints, options.minDistance ?? 7), 2);
  const capped = capPointCount(basePoints, options.maxPoints ?? WORKLOAD_LIMITS.maxTrackPoints);

  return {
    points: capped.points,
    limited: capped.limited,
    rawPointCount: rawPoints.length,
    preLimitPointCount: basePoints.length
  };
}

export function estimateStrokeBounds(points, margin = 88) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  return {
    width: Math.max(1, Math.ceil(bounds.maxX - bounds.minX + margin * 2)),
    height: Math.max(1, Math.ceil(bounds.maxY - bounds.minY + margin * 2))
  };
}

export function estimateGlazeCellCount(points, cellSize = 4, margin = 88) {
  const bounds = estimateStrokeBounds(points, margin);
  return Math.ceil(bounds.width / cellSize) * Math.ceil(bounds.height / cellSize);
}

export function chooseWatercolorBudget(points, options = {}) {
  const baseCellSize = options.cellSize ?? 4;
  const baseSteps = options.steps ?? 36;
  const margin = options.margin ?? 88;
  const maxCells = options.maxCells ?? WORKLOAD_LIMITS.maxGlazeCells;
  const bounds = estimateStrokeBounds(points, margin);
  const idealCellSize = Math.sqrt((bounds.width * bounds.height) / maxCells);
  let cellSize = Math.max(baseCellSize, Math.ceil(idealCellSize));
  let cellCount = Math.ceil(bounds.width / cellSize) * Math.ceil(bounds.height / cellSize);
  while (cellCount > maxCells) {
    cellSize += 1;
    cellCount = Math.ceil(bounds.width / cellSize) * Math.ceil(bounds.height / cellSize);
  }
  const stepScale = cellSize > baseCellSize ? Math.sqrt(baseCellSize / cellSize) : 1;
  const minSteps = options.minSteps ?? (options.starter ? 30 : 24);
  const steps = clamp(Math.round(baseSteps * stepScale), minSteps, baseSteps);

  return {
    cellSize,
    steps,
    cellCount,
    limited: cellSize > baseCellSize || steps < baseSteps
  };
}

export function strokeScreenDistance(zoom = 1) {
  return clamp(6 - Math.max(0, zoom - 1) * 1.4, WORKLOAD_LIMITS.minStrokeScreenDistance, WORKLOAD_LIMITS.maxStrokeScreenDistance);
}

export function shouldSampleStrokePoint(previousScreen, nextScreen, zoom = 1) {
  if (!previousScreen) {
    return true;
  }

  return distance(previousScreen, nextScreen) >= strokeScreenDistance(zoom);
}

export function createTimedCache(compute, options = {}) {
  const ttlMs = options.ttlMs ?? WORKLOAD_LIMITS.metricsCacheMs;
  const now = options.now ?? (() => performance.now());
  let value = null;
  let dirty = true;
  let lastComputedAt = Number.NEGATIVE_INFINITY;
  let recomputes = 0;

  return {
    get(force = false) {
      const currentTime = now();
      if (force || dirty || value === null || currentTime - lastComputedAt >= ttlMs) {
        value = compute();
        dirty = false;
        lastComputedAt = currentTime;
        recomputes += 1;
      }
      return value;
    },
    invalidate() {
      dirty = true;
    },
    stats() {
      return {
        dirty,
        lastComputedAt,
        recomputes
      };
    }
  };
}
