import { clamp, distance, distanceToSegment, totalLength } from './trackGeometry.js';

const DEFAULTS = {
  margin: 72,
  thickness: 10,
  water: 1,
  pigment: 1,
  seed: 1,
  sampleCount: 120,
  canvasScale: 1,
  maxRewetMarks: 64
};

export function hashNoise(x, y, seed = 1) {
  let n = Math.imul(Math.floor(x) + 3749, 374761393);
  n ^= Math.imul(Math.floor(y) + 6689, 668265263);
  n ^= Math.imul(seed + 17, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function computeStrokeBounds(points, margin = DEFAULTS.margin) {
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
    x: Math.floor(bounds.minX - margin),
    y: Math.floor(bounds.minY - margin),
    width: Math.max(1, Math.ceil(bounds.maxX - bounds.minX + margin * 2)),
    height: Math.max(1, Math.ceil(bounds.maxY - bounds.minY + margin * 2))
  };
}

function pointAtDistance(points, targetDistance) {
  if (points.length === 0) {
    return { x: 0, y: 0, angle: 0 };
  }

  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);

    if (walked + segmentLength >= targetDistance) {
      const t = segmentLength > 0 ? (targetDistance - walked) / segmentLength : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: Math.atan2(b.y - a.y, b.x - a.x)
      };
    }

    walked += segmentLength;
  }

  const previous = points[Math.max(0, points.length - 2)];
  const last = points[points.length - 1];
  return {
    x: last.x,
    y: last.y,
    angle: Math.atan2(last.y - previous.y, last.x - previous.x)
  };
}

export function sampleStrokeMaterial(points, sampleCount, seed = 1) {
  const length = totalLength(points);
  if (points.length < 2 || length <= 0) {
    return [];
  }

  const safeCount = Math.max(2, sampleCount);
  const samples = [];
  for (let i = 0; i < safeCount; i += 1) {
    const t = i / Math.max(1, safeCount - 1);
    const base = pointAtDistance(points, length * t);
    const wobble = (hashNoise(i, seed, 31) - 0.5) * Math.min(10, Math.max(2, length / safeCount) * 0.36);
    const normal = base.angle + Math.PI / 2;
    const roughness = hashNoise(i, seed, 53);
    samples.push({
      x: base.x + Math.cos(normal) * wobble,
      y: base.y + Math.sin(normal) * wobble,
      angle: base.angle,
      roughness,
      radius: 0.72 + roughness * 0.8,
      alpha: 0.18 + hashNoise(i, seed, 79) * 0.28
    });
  }

  return samples;
}

function createTrailMarks(samples, options) {
  if (options.water < 0.58 || samples.length < 6) {
    return [];
  }

  const desired = Math.min(42, Math.max(1, Math.round(samples.length * options.water * 0.055)));
  const stride = Math.max(1, Math.floor(samples.length / desired));
  const trails = [];

  for (let i = stride; i < samples.length - stride && trails.length < desired; i += stride) {
    const sample = samples[i];
    const chance = hashNoise(i, options.seed, 131);
    if (chance < 0.4) {
      continue;
    }

    trails.push({
      x: sample.x,
      y: sample.y,
      length: options.thickness * (1.6 + chance * 2.4) * options.water,
      width: options.thickness * (0.14 + hashNoise(i, options.seed, 149) * 0.16),
      alpha: 0.04 + chance * 0.045,
      drift: (hashNoise(i, options.seed, 167) - 0.5) * options.thickness
    });
  }

  return trails;
}

function createGrainMarks(samples, options) {
  const desired = Math.min(160, Math.max(8, Math.round(samples.length * options.pigment * 0.32)));
  const grain = [];

  for (let i = 0; i < desired; i += 1) {
    const sample = samples[Math.floor(hashNoise(i, options.seed, 191) * samples.length)] ?? samples[0];
    if (!sample) {
      continue;
    }

    const spread = options.thickness * (0.4 + hashNoise(i, options.seed, 211) * 1.8);
    const angle = sample.angle + Math.PI / 2;
    const offset = (hashNoise(i, options.seed, 223) - 0.5) * spread;
    grain.push({
      x: sample.x + Math.cos(angle) * offset,
      y: sample.y + Math.sin(angle) * offset,
      radius: 0.45 + hashNoise(i, options.seed, 227) * 1.1,
      alpha: 0.025 + hashNoise(i, options.seed, 229) * 0.045
    });
  }

  return grain;
}

function nearestMaterialDistance(point, points) {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    nearest = Math.min(nearest, distanceToSegment(point, points[i - 1], points[i]));
  }
  return nearest;
}

function buildMetrics(material) {
  const renderUnits = material.renderUnits;
  const textureLoad = clamp(renderUnits / Math.max(1, material.sampleBudget + 180), 0, 1);
  const pigmentMass = material.length * material.thickness * material.pigment * 0.075;
  const trailCount = material.trails.length + material.rewetMarks.length;
  const grainMass = material.grain.length * material.pigment * 0.12;

  return {
    renderSampleCount: material.samples.length,
    renderUnitCount: material.renderUnits,
    textureLoad,
    wetness: textureLoad,
    mobilePigmentMass: 0,
    depositedPigmentMass: pigmentMass,
    totalPigmentMass: pigmentMass,
    initialPigmentMass: pigmentMass,
    runoffCellCount: trailCount,
    dripCount: trailCount,
    trailCount,
    rewetMarkCount: material.rewetMarks.length,
    granulationMass: grainMass,
    wetCellCount: material.samples.length,
    cellCount: material.renderUnits
  };
}

export function createStrokeMaterial(points, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const thickness = Math.max(1, config.thickness);
  const length = totalLength(points);
  const margin = Math.max(config.margin, thickness * 5);
  const bounds = computeStrokeBounds(points, margin);
  const sampleBudget = Math.max(2, Math.round(config.sampleCount));
  const samples = sampleStrokeMaterial(points, sampleBudget, config.seed);
  const material = {
    type: 'procedural-stroke-material',
    bounds,
    seed: config.seed,
    thickness,
    water: Math.max(0, config.water),
    pigment: Math.max(0, config.pigment),
    length,
    canvasScale: clamp(config.canvasScale, 0.2, 1),
    sampleBudget,
    samples,
    trails: [],
    grain: [],
    rewetMarks: [],
    renderUnits: samples.length,
    maxRewetMarks: config.maxRewetMarks,
    points
  };

  material.trails = createTrailMarks(samples, material);
  material.grain = createGrainMarks(samples, material);
  material.renderUnits = samples.length + material.trails.length + material.grain.length;
  material.metrics = buildMetrics(material);
  return material;
}

export function rewetStrokeMaterialAtPoint(material, point, options = {}) {
  const radius = Math.max(material.thickness * 1.1, options.radius ?? 16);
  const nearest = nearestMaterialDistance(point, material.points ?? []);
  if (nearest > radius * 1.6) {
    return { affectedCellCount: 0, addedWater: 0 };
  }

  const speed = Math.max(0, options.speed ?? 0);
  const water = Math.max(0, options.water ?? 0.12) * (0.7 + Math.min(2.4, speed / 140));
  const mark = {
    x: point.x,
    y: point.y,
    radius: radius * (0.72 + Math.min(1.2, water * 2.2)),
    alpha: clamp(0.08 + water * 0.28, 0.08, 0.22),
    speed,
    seed: material.seed + material.rewetMarks.length * 97
  };

  material.rewetMarks.push(mark);
  while (material.rewetMarks.length > material.maxRewetMarks) {
    material.rewetMarks.shift();
  }

  material.renderUnits = material.samples.length + material.trails.length + material.grain.length + material.rewetMarks.length;
  material.metrics = buildMetrics(material);

  return {
    affectedCellCount: Math.max(1, Math.round(radius)),
    addedWater: water
  };
}

export function aggregateStrokeMetrics(materials) {
  let textureWeight = 0;
  const totals = {
    wetness: 0,
    textureLoad: 0,
    mobilePigmentMass: 0,
    depositedPigmentMass: 0,
    totalPigmentMass: 0,
    initialPigmentMass: 0,
    runoffCellCount: 0,
    dripCount: 0,
    trailCount: 0,
    rewetMarkCount: 0,
    granulationMass: 0,
    wetCellCount: 0,
    cellCount: 0,
    renderSampleCount: 0,
    renderUnitCount: 0
  };

  for (const material of materials) {
    if (!material?.metrics) {
      continue;
    }
    totals.mobilePigmentMass += material.metrics.mobilePigmentMass;
    totals.depositedPigmentMass += material.metrics.depositedPigmentMass;
    totals.totalPigmentMass += material.metrics.totalPigmentMass;
    totals.initialPigmentMass += material.metrics.initialPigmentMass;
    totals.runoffCellCount += material.metrics.runoffCellCount;
    totals.dripCount += material.metrics.dripCount;
    totals.trailCount += material.metrics.trailCount;
    totals.rewetMarkCount += material.metrics.rewetMarkCount;
    totals.granulationMass += material.metrics.granulationMass;
    totals.wetCellCount += material.metrics.wetCellCount;
    totals.cellCount += material.metrics.cellCount;
    totals.renderSampleCount += material.metrics.renderSampleCount;
    totals.renderUnitCount += material.metrics.renderUnitCount;
    const weight = Math.max(1, material.metrics.renderSampleCount);
    totals.textureLoad += material.metrics.textureLoad * weight;
    textureWeight += weight;
  }

  totals.textureLoad = textureWeight > 0 ? clamp(totals.textureLoad / textureWeight, 0, 1) : 0;
  totals.wetness = totals.textureLoad;
  return totals;
}
