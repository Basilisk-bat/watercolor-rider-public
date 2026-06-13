import { clamp, distanceToSegment } from './trackGeometry.js';

const DEFAULTS = {
  cellSize: 4,
  margin: 88,
  thickness: 10,
  water: 1,
  pigment: 1,
  steps: 34,
  flowRate: 0.34,
  diffusion: 0.08,
  gravity: 0.42,
  capillary: 0.2,
  adsorption: 0.075,
  desorption: 0.006,
  evaporation: 0.006,
  runThreshold: 0.7,
  runStrength: 0.72
};

export function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashNoise(x, y, seed) {
  let n = x * 374761393 + y * 668265263 + seed * 1442695041;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function computeBounds(points, margin) {
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
    width: Math.ceil(bounds.maxX - bounds.minX + margin * 2),
    height: Math.ceil(bounds.maxY - bounds.minY + margin * 2)
  };
}

function idx(x, y, width) {
  return y * width + x;
}

function sampleNearestDistance(worldPoint, points) {
  let nearest = Number.POSITIVE_INFINITY;

  for (let i = 1; i < points.length; i += 1) {
    nearest = Math.min(nearest, distanceToSegment(worldPoint, points[i - 1], points[i]));
  }

  return nearest;
}

function makeFields(width, height, seed) {
  const size = width * height;
  const paperHeight = new Float32Array(size);
  const capacity = new Float32Array(size);
  const fiberX = new Float32Array(size);
  const fiberY = new Float32Array(size);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = idx(x, y, width);
      const low = hashNoise(Math.floor(x / 3), Math.floor(y / 3), seed);
      const fine = hashNoise(x, y, seed + 91);
      const fiber = hashNoise(x, y, seed + 211) * Math.PI * 2;
      const heightValue = low * 0.68 + fine * 0.32;

      paperHeight[i] = heightValue;
      capacity[i] = 0.54 + heightValue * 0.32 + hashNoise(x, y, seed + 409) * 0.14;
      fiberX[i] = Math.cos(fiber) * 0.5;
      fiberY[i] = Math.sin(fiber) * 0.22 + 0.16;
    }
  }

  return { paperHeight, capacity, fiberX, fiberY };
}

function seedStroke(glaze, points, options) {
  const radius = Math.max(3, options.thickness * 0.9);
  let seedCellCount = 0;

  for (let y = 0; y < glaze.height; y += 1) {
    for (let x = 0; x < glaze.width; x += 1) {
      const i = idx(x, y, glaze.width);
      const worldPoint = {
        x: glaze.bounds.x + x * glaze.cellSize + glaze.cellSize * 0.5,
        y: glaze.bounds.y + y * glaze.cellSize + glaze.cellSize * 0.5
      };
      const nearest = sampleNearestDistance(worldPoint, points);
      if (nearest > radius * 2.2) {
        continue;
      }

      const falloff = Math.exp(-(nearest * nearest) / (radius * radius));
      const paperCapacity = glaze.capacity[i];
      const water = options.water * falloff * (0.95 + paperCapacity * 0.28);
      const pigment = options.pigment * falloff * (0.9 + (1 - glaze.paperHeight[i]) * 0.34);

      if (water > 0.02 || pigment > 0.02) {
        seedCellCount += 1;
        glaze.seedMask[i] = 1;
        glaze.wetMask[i] = 1;
        glaze.water[i] += water;
        glaze.pigment[i] += pigment;
        glaze.initialPigmentMass += pigment;
      }
    }
  }

  glaze.seedCellCount = seedCellCount;
}

function neighbourWeight(glaze, from, x, y, nx, ny, options) {
  if (nx < 0 || ny < 0 || nx >= glaze.width || ny >= glaze.height) {
    return 0;
  }

  const ni = idx(nx, ny, glaze.width);
  const paperSlope = glaze.paperHeight[from] - glaze.paperHeight[ni];
  const gravity = ny > y ? options.gravity : ny < y ? -options.gravity * 0.18 : 0;
  const fiber = (nx - x) * glaze.fiberX[from] + (ny - y) * glaze.fiberY[from];
  const capacityPull = glaze.capacity[ni] * options.capillary;

  return Math.max(0.01, 1 + paperSlope * 1.6 + gravity + fiber * 0.55 + capacityPull);
}

function simulateStep(glaze, options) {
  const nextWater = new Float32Array(glaze.water.length);
  const nextPigment = new Float32Array(glaze.pigment.length);

  for (let y = 0; y < glaze.height; y += 1) {
    for (let x = 0; x < glaze.width; x += 1) {
      const i = idx(x, y, glaze.width);
      const water = glaze.water[i];
      const pigment = glaze.pigment[i];

      if (water <= 0.0001 && pigment <= 0.0001) {
        continue;
      }

      const granularity = 0.62 + (1 - glaze.paperHeight[i]) * 0.42;
      const adsorb = Math.min(pigment, pigment * options.adsorption * granularity * (0.55 + water));
      const desorb = Math.min(glaze.deposited[i], glaze.deposited[i] * options.desorption * water);
      glaze.deposited[i] += adsorb - desorb;
      const mobilePigment = pigment - adsorb + desorb;
      const evaporatedWater = Math.max(0, water * (1 - options.evaporation));
      const runBoost = water > options.runThreshold ? options.runStrength * (water - options.runThreshold) : 0;
      const movableWater = Math.min(evaporatedWater, evaporatedWater * (options.flowRate + runBoost));
      const retainedWater = evaporatedWater - movableWater;
      const movablePigment = mobilePigment * (movableWater / Math.max(evaporatedWater, 0.0001));
      const retainedPigment = mobilePigment - movablePigment;
      const neighbours = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
        [x + 1, y + 1],
        [x - 1, y + 1]
      ];
      const weights = neighbours.map(([nx, ny]) => neighbourWeight(glaze, i, x, y, nx, ny, options));
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      const validNeighbourCount = neighbours.filter(
        ([nx, ny]) => nx >= 0 && ny >= 0 && nx < glaze.width && ny < glaze.height
      ).length;

      nextWater[i] += retainedWater;
      nextPigment[i] += retainedPigment;

      neighbours.forEach(([nx, ny], neighbourIndex) => {
        if (nx < 0 || ny < 0 || nx >= glaze.width || ny >= glaze.height) {
          return;
        }

        const advectiveWeight = weights[neighbourIndex] / weightSum;
        const diffusiveWeight = validNeighbourCount > 0 ? 1 / validNeighbourCount : 0;
        const weight = advectiveWeight * (1 - options.diffusion) + diffusiveWeight * options.diffusion;
        const ni = idx(nx, ny, glaze.width);
        nextWater[ni] += movableWater * weight;
        nextPigment[ni] += movablePigment * weight;

        if (runBoost > 0 && ny > y && movableWater * weight > 0.003) {
          glaze.runMask[ni] = 1;
        }
      });
    }
  }

  glaze.water = nextWater;
  glaze.pigment = nextPigment;

  for (let i = 0; i < glaze.water.length; i += 1) {
    if (glaze.water[i] > 0.015 || glaze.pigment[i] > 0.01) {
      glaze.wetMask[i] = 1;
    }
  }
}

function finalizeGlaze(glaze) {
  const edgeCandidates = [];
  const sourceCandidates = [];
  let sourceMass = 0;

  for (let y = 0; y < glaze.height; y += 1) {
    for (let x = 0; x < glaze.width; x += 1) {
      const i = idx(x, y, glaze.width);
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < glaze.width - 1 ? i + 1 : -1,
        y > 0 ? i - glaze.width : -1,
        y < glaze.height - 1 ? i + glaze.width : -1
      ];
      const dryNeighbour = neighbours.some((ni) => ni < 0 || glaze.wetMask[ni] === 0);

      if (dryNeighbour && glaze.wetMask[i] > 0 && glaze.deposited[i] > 0.015) {
        edgeCandidates.push(i);
      }
      if (glaze.seedMask[i] > 0 && glaze.deposited[i] > 0.015) {
        sourceCandidates.push(i);
        sourceMass += glaze.deposited[i];
      }
    }
  }

  if (edgeCandidates.length > 0 && sourceMass > 0) {
    const transferMass = sourceMass * 0.56;
    let edgeWeight = 0;

    for (const i of edgeCandidates) {
      edgeWeight += 0.4 + (1 - glaze.paperHeight[i]) + glaze.capacity[i] * 0.35;
    }
    for (const i of sourceCandidates) {
      glaze.deposited[i] -= transferMass * (glaze.deposited[i] / sourceMass);
    }
    for (const i of edgeCandidates) {
      const weight = 0.4 + (1 - glaze.paperHeight[i]) + glaze.capacity[i] * 0.35;
      glaze.deposited[i] += transferMass * (weight / edgeWeight);
    }
  }

  let wetCellCount = 0;
  let runoffCellCount = 0;
  let edgeMass = 0;
  let edgeCells = 0;
  let centerMass = 0;
  let centerCells = 0;
  let mobilePigmentMass = 0;
  let depositedPigmentMass = 0;
  const edge = new Float32Array(glaze.water.length);
  const granulation = new Float32Array(glaze.water.length);

  for (let y = 0; y < glaze.height; y += 1) {
    for (let x = 0; x < glaze.width; x += 1) {
      const i = idx(x, y, glaze.width);
      const wet = glaze.wetMask[i] > 0;
      if (!wet && glaze.deposited[i] <= 0.0001) {
        continue;
      }

      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < glaze.width - 1 ? i + 1 : -1,
        y > 0 ? i - glaze.width : -1,
        y < glaze.height - 1 ? i + glaze.width : -1
      ];
      const dryNeighbour = neighbours.some((ni) => ni < 0 || glaze.wetMask[ni] === 0);
      const roughness = 1 - glaze.paperHeight[i];
      const grain = Math.max(0, roughness - 0.34) * glaze.deposited[i];

      if (dryNeighbour) {
        edge[i] = glaze.deposited[i] * 0.38;
        edgeMass += glaze.deposited[i] + edge[i];
        edgeCells += 1;
      }

      granulation[i] = grain;
      if (glaze.seedMask[i] > 0) {
        centerMass += glaze.deposited[i];
        centerCells += 1;
      }
      if (wet) {
        wetCellCount += 1;
      }
      if (glaze.runMask[i] > 0 && glaze.seedMask[i] === 0 && y * glaze.cellSize + glaze.bounds.y > glaze.seedMaxY + glaze.cellSize * 2) {
        runoffCellCount += 1;
      }
    }
  }

  for (let i = 0; i < glaze.water.length; i += 1) {
    mobilePigmentMass += glaze.pigment[i];
    depositedPigmentMass += glaze.deposited[i];
  }

  glaze.edge = edge;
  glaze.granulation = granulation;
  glaze.metrics = {
    seedCellCount: glaze.seedCellCount,
    wetCellCount,
    spreadCells: Math.max(0, wetCellCount - glaze.seedCellCount),
    runoffCellCount,
    dripCount: runoffCellCount,
    mobilePigmentMass,
    depositedPigmentMass,
    totalPigmentMass: mobilePigmentMass + depositedPigmentMass,
    initialPigmentMass: glaze.initialPigmentMass,
    wetness: wetCellCount / glaze.water.length,
    edgeDepositedAverage: edgeCells > 0 ? edgeMass / edgeCells : 0,
    centerDepositedAverage: centerCells > 0 ? centerMass / centerCells : 0,
    granulationMass: granulation.reduce((sum, value) => sum + value, 0)
  };

  return glaze;
}

export function simulateWatercolorStroke(points, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const bounds = computeBounds(points, config.margin);
  const width = Math.max(1, Math.ceil(bounds.width / config.cellSize));
  const height = Math.max(1, Math.ceil(bounds.height / config.cellSize));
  const seed = config.seed ?? 1;
  const fields = makeFields(width, height, seed);
  const glaze = {
    bounds,
    width,
    height,
    cellSize: config.cellSize,
    water: new Float32Array(width * height),
    pigment: new Float32Array(width * height),
    deposited: new Float32Array(width * height),
    wetMask: new Uint8Array(width * height),
    seedMask: new Uint8Array(width * height),
    runMask: new Uint8Array(width * height),
    initialPigmentMass: 0,
    seedCellCount: 0,
    seedMaxY: points.reduce((max, point) => Math.max(max, point.y), Number.NEGATIVE_INFINITY),
    ...fields
  };

  seedStroke(glaze, points, config);

  for (let step = 0; step < config.steps; step += 1) {
    simulateStep(glaze, config);
  }

  return finalizeGlaze(glaze);
}

export function aggregateGlazeMetrics(glazes) {
  const totals = {
    wetness: 0,
    mobilePigmentMass: 0,
    depositedPigmentMass: 0,
    totalPigmentMass: 0,
    initialPigmentMass: 0,
    runoffCellCount: 0,
    dripCount: 0,
    granulationMass: 0,
    wetCellCount: 0,
    cellCount: 0
  };

  for (const glaze of glazes) {
    if (!glaze?.metrics) {
      continue;
    }
    totals.mobilePigmentMass += glaze.metrics.mobilePigmentMass;
    totals.depositedPigmentMass += glaze.metrics.depositedPigmentMass;
    totals.totalPigmentMass += glaze.metrics.totalPigmentMass;
    totals.initialPigmentMass += glaze.metrics.initialPigmentMass;
    totals.runoffCellCount += glaze.metrics.runoffCellCount;
    totals.dripCount += glaze.metrics.dripCount;
    totals.granulationMass += glaze.metrics.granulationMass;
    totals.wetCellCount += glaze.metrics.wetCellCount;
    totals.cellCount += glaze.water.length;
  }

  totals.wetness = totals.cellCount > 0 ? clamp(totals.wetCellCount / totals.cellCount, 0, 1) : 0;
  return totals;
}
