import './styles.css';
import { createIcons, icons } from 'lucide';
import {
  chaikinSmooth,
  distance,
  erasePolyline,
  nearestDistanceToPolyline,
  simplifyPoints,
  totalLength
} from './trackGeometry.js';
import {
  createCameraState,
  focusCameraTarget,
  screenToWorld as cameraScreenToWorld,
  setCameraTargetZoom,
  stepCamera
} from './cameraControl.js';
import {
  ENGINE_FPS,
  createRideWorld,
  getRideTelemetry,
  nearestTrackContact,
  resetRide,
  setRideTracks,
  spawnRider,
  stepRide
} from './ridePhysics.js';
import { aggregateGlazeMetrics, rewetGlazeAtPoint, simulateWatercolorStroke } from './watercolorSim.js';

createIcons({ icons });

const canvas = document.querySelector('#game');
const app = document.querySelector('#app');
const ctx = canvas.getContext('2d', { alpha: false });
const mainMenu = document.querySelector('#mainMenu');
const menuToggle = document.querySelector('#menuToggle');
const menuSpawn = document.querySelector('#menuSpawn');
const menuHelp = document.querySelector('#menuHelp');
const menuHelpPanel = document.querySelector('#menuHelpPanel');
const menuClose = document.querySelector('#menuClose');
const drawTool = document.querySelector('#drawTool');
const eraseTool = document.querySelector('#eraseTool');
const playTool = document.querySelector('#playTool');
const resetTool = document.querySelector('#resetTool');
const undoTool = document.querySelector('#undoTool');
const clearTool = document.querySelector('#clearTool');
const speedMeter = document.querySelector('#speedMeter');
const airMeter = document.querySelector('#airMeter');
const inkMeter = document.querySelector('#inkMeter');
const statusStrip = document.querySelector('#statusStrip');
const debugToggle = document.querySelector('#debugToggle');
const debugDrawer = document.querySelector('#debugDrawer');
const debugStatus = document.querySelector('[data-diagnostic="status"]');
const debugZoom = document.querySelector('[data-diagnostic="zoom"]');
const debugWetness = document.querySelector('[data-diagnostic="wetness"]');
const debugPigment = document.querySelector('[data-diagnostic="pigment"]');
const debugDeposited = document.querySelector('[data-diagnostic="deposited"]');
const debugRunoff = document.querySelector('[data-diagnostic="runoff"]');

const CHROME_IDLE_MS = 2200;
const RIDER_BLEED_INTERVAL_MS = 70;
let chromeTimer = null;

const palette = [
  { ink: 'rgba(36, 72, 96, 0.78)', wash: 'rgba(64, 132, 154, 0.16)' },
  { ink: 'rgba(54, 95, 72, 0.78)', wash: 'rgba(96, 153, 105, 0.16)' },
  { ink: 'rgba(142, 83, 95, 0.72)', wash: 'rgba(191, 107, 126, 0.15)' },
  { ink: 'rgba(113, 86, 56, 0.74)', wash: 'rgba(198, 145, 79, 0.14)' }
];

const state = {
  mode: 'draw',
  playing: false,
  pointerDown: false,
  pointers: new Map(),
  pinch: null,
  pointer: null,
  currentStroke: [],
  tracks: [],
  history: [],
  spawn: {
    active: false,
    start: null
  },
  rideWorld: createRideWorld(),
  rider: null,
  paperPattern: null,
  dpr: 1,
  width: 0,
  height: 0,
  seeded: false,
  camera: createCameraState({
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.35,
    maxZoom: 2.25
  }),
  metrics: {
    startX: 0,
    bestDistance: 0,
    currentAir: 0,
    longestAir: 0,
    topSpeed: 0,
    inkLength: 0,
    strokeCount: 0,
    resets: 0,
    watercolorBleeds: 0
  },
  watercolor: {
    lastBleedAt: 0,
    lastBleedTrackId: null,
    lastBleedWater: 0
  },
  ui: {
    chromeVisible: true,
    debugOpen: false,
    menuOpen: true
  },
  log: []
};

function record(type, detail = {}) {
  state.log.push({
    type,
    detail,
    at: Number(performance.now().toFixed(1))
  });

  if (state.log.length > 240) {
    state.log.shift();
  }
}

function getWatercolorMetrics() {
  return aggregateGlazeMetrics(state.tracks.map((track) => track.glaze));
}

function updateDebugDiagnostics() {
  if (debugStatus) {
    debugStatus.textContent = statusStrip.textContent;
  }
  if (debugZoom) {
    debugZoom.textContent = `${Math.round(state.camera.targetZoom * 100)}%`;
  }
  const watercolor = getWatercolorMetrics();
  if (debugWetness) {
    debugWetness.textContent = `${Math.round(watercolor.wetness * 100)}%`;
  }
  if (debugPigment) {
    debugPigment.textContent = watercolor.totalPigmentMass.toFixed(1);
  }
  if (debugDeposited) {
    debugDeposited.textContent = watercolor.depositedPigmentMass.toFixed(1);
  }
  if (debugRunoff) {
    debugRunoff.textContent = String(watercolor.runoffCellCount);
  }
}

function publishTelemetry() {
  const speed = state.rider ? Math.hypot(state.rider.velocity.x, state.rider.velocity.y) : 0;
  app.dataset.playing = String(state.playing);
  app.dataset.mode = state.mode;
  app.dataset.tracks = String(state.tracks.length);
  app.dataset.speed = String(Math.round(speed * 10) / 10);
  app.dataset.distance = String(Math.round(state.metrics.bestDistance));
  app.dataset.longestAir = String(Math.round(state.metrics.longestAir * 10) / 10);
  app.dataset.inkLength = String(Math.round(state.metrics.inkLength));
  app.dataset.status = statusStrip.textContent;
  app.dataset.debugOpen = String(state.ui.debugOpen);
  app.dataset.menuOpen = String(state.ui.menuOpen);
  app.dataset.spawn = String(state.spawn.active);
  app.dataset.zoom = String(Math.round(state.camera.targetZoom * 100) / 100);
  const watercolor = getWatercolorMetrics();
  app.dataset.wetness = String(Math.round(watercolor.wetness * 1000) / 1000);
  app.dataset.pigmentMass = String(Math.round(watercolor.totalPigmentMass * 10) / 10);
  app.dataset.depositedMass = String(Math.round(watercolor.depositedPigmentMass * 10) / 10);
  app.dataset.runoff = String(watercolor.runoffCellCount);
  app.dataset.bleeds = String(state.metrics.watercolorBleeds);
  updateDebugDiagnostics();
}

function modeStatus() {
  if (state.spawn.active) {
    return 'spawn';
  }
  return state.mode === 'draw' ? 'brush' : 'erase';
}

function setStatus(status) {
  statusStrip.textContent = status;
  publishTelemetry();
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hideChrome() {
  const activeElement = document.activeElement;
  const focusInsideChrome = activeElement?.closest?.('.chrome-shell, .debug-drawer, .corner-brand, .main-menu');

  if (state.ui.debugOpen || state.ui.menuOpen || focusInsideChrome) {
    return;
  }

  state.ui.chromeVisible = false;
  app.classList.remove('chrome-visible');
}

function revealChrome() {
  state.ui.chromeVisible = true;
  app.classList.add('chrome-visible');
  window.clearTimeout(chromeTimer);

  if (!state.ui.debugOpen && !state.ui.menuOpen) {
    chromeTimer = window.setTimeout(hideChrome, CHROME_IDLE_MS);
  }
}

function setDebugOpen(open) {
  state.ui.debugOpen = open;
  debugDrawer.setAttribute('aria-hidden', String(!open));
  debugToggle.setAttribute('aria-expanded', String(open));
  app.classList.toggle('debug-open', open);
  revealChrome();
  publishTelemetry();
}

function setMenuOpen(open) {
  state.ui.menuOpen = open;
  mainMenu.setAttribute('aria-hidden', String(!open));
  menuToggle.setAttribute('aria-expanded', String(open));
  app.classList.toggle('menu-open', open);
  revealChrome();
  publishTelemetry();
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePaperPattern() {
  const size = 260;
  const texture = document.createElement('canvas');
  const textureCtx = texture.getContext('2d', { alpha: false });
  texture.width = size;
  texture.height = size;

  const image = textureCtx.createImageData(size, size);
  const random = mulberry32(7129);

  for (let i = 0; i < image.data.length; i += 4) {
    const grain = Math.floor((random() - 0.5) * 22);
    image.data[i] = 241 + grain;
    image.data[i + 1] = 237 + grain;
    image.data[i + 2] = 224 + grain;
    image.data[i + 3] = 255;
  }

  textureCtx.putImageData(image, 0, 0);
  textureCtx.globalAlpha = 0.2;

  for (let y = 0; y < size; y += 9) {
    textureCtx.fillStyle = y % 18 === 0 ? '#f8f1dc' : '#e7dfc7';
    textureCtx.fillRect(0, y, size, 1);
  }

  return ctx.createPattern(texture, 'repeat');
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.max(320, rect.width);
  state.height = Math.max(320, rect.height);
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  state.paperPattern = makePaperPattern();

  if (!state.seeded) {
    seedStarterTrack();
    state.seeded = true;
  }
}

function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function screenToWorld(point) {
  return cameraScreenToWorld(state.camera, point);
}

function setZoom(nextZoom, anchorScreen = { x: state.width / 2, y: state.height / 2 }) {
  setCameraTargetZoom(state.camera, nextZoom, anchorScreen);
  publishTelemetry();
}

function pinchPoints() {
  return Array.from(state.pointers.values()).slice(0, 2);
}

function beginPinchZoom() {
  const points = pinchPoints();
  if (points.length < 2) {
    return;
  }

  state.pointerDown = false;
  state.currentStroke = [];
  state.pinch = {
    distance: distance(points[0], points[1]),
    zoom: state.camera.targetZoom,
    anchor: {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    }
  };
}

function updatePinchZoom() {
  if (!state.pinch) {
    return;
  }

  const points = pinchPoints();
  if (points.length < 2) {
    state.pinch = null;
    return;
  }

  const nextDistance = distance(points[0], points[1]);
  if (state.pinch.distance <= 0) {
    return;
  }

  setZoom(state.pinch.zoom * (nextDistance / state.pinch.distance), state.pinch.anchor);
}

function followRider() {
  if (!state.rider || !state.playing) {
    return;
  }

  focusCameraTarget(state.camera, state.rider.position, {
    width: state.width,
    height: state.height
  });
}

function seedStarterTrack() {
  const w = state.width;
  const h = state.height;
  const baseY = Math.max(175, Math.min(h * 0.5, 360));
  const points = [
    { x: Math.max(40, w * 0.07), y: baseY - 70 },
    { x: w * 0.18, y: baseY - 58 },
    { x: w * 0.31, y: baseY - 18 },
    { x: w * 0.46, y: baseY + 48 },
    { x: w * 0.62, y: baseY + 60 },
    { x: w * 0.76, y: baseY + 24 },
    { x: Math.min(w - 42, w * 0.92), y: baseY + 42 }
  ];

  addTrack(chaikinSmooth(points, 2), { starter: true, preserve: true, recordHistory: false });
  resetRider();
}

function colorWithAlpha(color, alpha) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return color;
  }

  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

function tracePath(targetCtx, points, offsetX = 0, offsetY = 0) {
  if (points.length < 2) {
    return;
  }

  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x + offsetX, points[0].y + offsetY);
  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[i - 1];
    const mid = {
      x: (previous.x + current.x) / 2,
      y: (previous.y + current.y) / 2
    };
    targetCtx.quadraticCurveTo(previous.x + offsetX, previous.y + offsetY, mid.x + offsetX, mid.y + offsetY);
  }
  const last = points[points.length - 1];
  targetCtx.lineTo(last.x + offsetX, last.y + offsetY);
}

function createLayerCanvas(width, height) {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  return layer;
}

function fillSoftDot(targetCtx, x, y, radius, color, alpha) {
  targetCtx.fillStyle = colorWithAlpha(color, alpha);
  targetCtx.beginPath();
  targetCtx.arc(x, y, radius, 0, Math.PI * 2);
  targetCtx.fill();
}

function fillSoftEllipse(targetCtx, x, y, radiusX, radiusY, color, alpha, rotation = 0) {
  targetCtx.fillStyle = colorWithAlpha(color, alpha);
  targetCtx.beginPath();
  targetCtx.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
  targetCtx.fill();
}

function isRunoffCell(glaze, x, y) {
  if (x < 0 || y < 0 || x >= glaze.width || y >= glaze.height) {
    return false;
  }
  const i = y * glaze.width + x;
  const worldY = y * glaze.cellSize + glaze.bounds.y;

  return glaze.runMask[i] > 0 && glaze.seedMask[i] === 0 && worldY > glaze.seedMaxY + glaze.cellSize * 2;
}

function renderRunoffLayer(runCtx, glaze, paletteColor) {
  runCtx.lineCap = 'round';
  runCtx.lineJoin = 'round';
  runCtx.globalCompositeOperation = 'source-over';

  for (let y = 0; y < glaze.height; y += 1) {
    for (let x = 0; x < glaze.width; x += 1) {
      if (!isRunoffCell(glaze, x, y)) {
        continue;
      }

      const i = y * glaze.width + x;
      const deposited = glaze.deposited[i];
      const water = glaze.water[i];

      if (deposited <= 0.001 && water <= 0.001) {
        continue;
      }

      const centerX = x * glaze.cellSize + glaze.cellSize * 0.5;
      const centerY = y * glaze.cellSize + glaze.cellSize * 0.5;
      const below = isRunoffCell(glaze, x, y + 1);
      const above = isRunoffCell(glaze, x, y - 1) || isRunoffCell(glaze, x - 1, y - 1) || isRunoffCell(glaze, x + 1, y - 1);
      const flowAlpha = Math.min(0.09, 0.018 + deposited * 0.024 + water * 0.012);

      if (above || below) {
        const targetY = centerY + (below ? glaze.cellSize * 0.86 : -glaze.cellSize * 0.46);
        runCtx.strokeStyle = colorWithAlpha(paletteColor.wash, flowAlpha);
        runCtx.lineWidth = Math.max(2.2, glaze.cellSize * 0.92 + deposited * 0.12);
        runCtx.beginPath();
        runCtx.moveTo(centerX, centerY - glaze.cellSize * 0.42);
        runCtx.lineTo(centerX + ((i % 3) - 1) * 0.34, targetY);
        runCtx.stroke();
      }

      fillSoftEllipse(
        runCtx,
        centerX + ((i % 5) - 2) * 0.28,
        centerY,
        glaze.cellSize * 0.58,
        glaze.cellSize * (above || below ? 1.05 : 0.78),
        paletteColor.wash,
        flowAlpha * 0.78,
        0
      );
    }
  }
}

function createGlazeCanvas(glaze, paletteColor, points = []) {
  const paint = document.createElement('canvas');
  const paintCtx = paint.getContext('2d');
  paint.width = Math.max(1, Math.ceil(glaze.bounds.width));
  paint.height = Math.max(1, Math.ceil(glaze.bounds.height));
  paintCtx.clearRect(0, 0, paint.width, paint.height);

  const wash = createLayerCanvas(paint.width, paint.height);
  const washCtx = wash.getContext('2d');
  const pigment = createLayerCanvas(paint.width, paint.height);
  const pigmentCtx = pigment.getContext('2d');
  const runs = createLayerCanvas(paint.width, paint.height);
  const runCtx = runs.getContext('2d');
  const grain = createLayerCanvas(paint.width, paint.height);
  const grainCtx = grain.getContext('2d');

  washCtx.lineCap = 'round';
  washCtx.lineJoin = 'round';

  if (points.length > 1) {
    const offsetX = -glaze.bounds.x;
    const offsetY = -glaze.bounds.y;

    // Cached blur keeps the watercolor wash continuous without per-frame filter cost.
    washCtx.filter = `blur(${Math.max(2.4, glaze.cellSize * 0.72)}px)`;
    washCtx.strokeStyle = colorWithAlpha(paletteColor.wash, 0.18);
    washCtx.lineWidth = Math.max(16, glaze.cellSize * 5.2);
    tracePath(washCtx, points, offsetX, offsetY);
    washCtx.stroke();
    washCtx.filter = 'none';

    washCtx.strokeStyle = colorWithAlpha(paletteColor.wash, 0.12);
    washCtx.lineWidth = Math.max(9, glaze.cellSize * 2.8);
    tracePath(washCtx, points, offsetX, offsetY);
    washCtx.stroke();
  }

  for (let y = 0; y < glaze.height; y += 1) {
    for (let x = 0; x < glaze.width; x += 1) {
      const i = y * glaze.width + x;
      const deposited = glaze.deposited[i];
      const wet = glaze.wetMask[i] > 0;

      if (deposited <= 0.002 && !wet) {
        continue;
      }

      const px = x * glaze.cellSize;
      const py = y * glaze.cellSize;
      const roughness = 1 - glaze.paperHeight[i];
      const edge = glaze.edge[i] ?? 0;
      const granulation = glaze.granulation[i] ?? 0;
      const centerX = px + glaze.cellSize * 0.5;
      const centerY = py + glaze.cellSize * 0.5;
      const runoff = isRunoffCell(glaze, x, y);
      const washAlpha = Math.min(0.038, deposited * 0.012 + (wet ? 0.003 : 0));
      const washRadius = glaze.cellSize * (wet ? 1.34 : 1) + Math.min(1.6, deposited * 0.34);

      if (!runoff) {
        fillSoftDot(washCtx, centerX, centerY, washRadius, paletteColor.wash, washAlpha);
      }

      if (edge > 0.002 && !runoff) {
        const edgeAlpha = Math.min(0.018, edge * 0.016);
        const edgeRadius = glaze.cellSize * 0.92 + Math.min(1.8, edge * 0.18);
        fillSoftEllipse(
          pigmentCtx,
          centerX,
          centerY,
          edgeRadius * 1.52,
          edgeRadius * 0.82,
          paletteColor.ink,
          edgeAlpha,
          ((i % 7) - 3) * 0.05
        );
      }

      if (granulation > 0.012 && roughness > 0.48) {
        const dotX = centerX + ((i % 5) - 2) * 0.42;
        const dotY = centerY + (((i >> 3) % 5) - 2) * 0.42;
        const dotRadius = Math.max(0.25, Math.min(0.58, glaze.cellSize * 0.08 + roughness * 0.18));
        grainCtx.fillStyle = colorWithAlpha(paletteColor.ink, Math.min(0.045, granulation * 0.032));
        grainCtx.beginPath();
        grainCtx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
        grainCtx.fill();
      }
    }
  }

  renderRunoffLayer(runCtx, glaze, paletteColor);

  paintCtx.globalCompositeOperation = 'multiply';
  paintCtx.filter = `blur(${Math.max(1.4, glaze.cellSize * 0.38)}px)`;
  paintCtx.drawImage(wash, 0, 0);
  paintCtx.filter = 'none';
  paintCtx.globalAlpha = 0.86;
  paintCtx.filter = `blur(${Math.max(0.7, glaze.cellSize * 0.2)}px)`;
  paintCtx.drawImage(runs, 0, 0);
  paintCtx.filter = 'none';
  paintCtx.globalAlpha = 1;
  paintCtx.filter = `blur(${Math.max(1.9, glaze.cellSize * 0.5)}px)`;
  paintCtx.drawImage(pigment, 0, 0);
  paintCtx.filter = 'none';
  paintCtx.globalAlpha = 0.35;
  paintCtx.filter = `blur(${Math.max(0.45, glaze.cellSize * 0.12)}px)`;
  paintCtx.drawImage(grain, 0, 0);
  paintCtx.filter = 'none';
  paintCtx.globalAlpha = 1;

  return paint;
}

function syncRideWorld() {
  setRideTracks(state.rideWorld, state.tracks);
  state.rider = state.rideWorld.rider;
  publishTelemetry();
}

function createTrack(rawPoints, options = {}) {
  const { starter = false, preserve = false } = options;
  const points = preserve || starter ? rawPoints.map((point) => ({ ...point })) : chaikinSmooth(simplifyPoints(rawPoints), 2);

  if (points.length < 2 || totalLength(points) < 16) {
    return null;
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : `track-${Date.now()}-${state.tracks.length}`;
  const paletteIndex = state.tracks.length % palette.length;
  const seed = paletteIndex * 997 + state.tracks.length * 251 + 17;
  const glaze = simulateWatercolorStroke(points, {
    seed,
    thickness: starter ? 12 : 10,
    water: starter ? 1.25 : 1.05,
    pigment: starter ? 0.96 : 1.08,
    steps: starter ? 42 : 36
  });
  const track = {
    id,
    points,
    thickness: starter ? 12 : 10,
    palette: palette[paletteIndex],
    glaze,
    glazeCanvas: null
  };

  return track;
}

function addTrack(rawPoints, options = {}) {
  const track = createTrack(rawPoints, options);

  if (!track) {
    return null;
  }

  state.tracks.push(track);
  syncRideWorld();
  updateInkMetric();
  if (options.recordHistory !== false && !options.starter) {
    state.history.push({ type: 'add', tracks: [track] });
  }
  record(options.starter ? 'starter-track' : 'stroke-added', {
    points: track.points.length,
    length: Math.round(totalLength(track.points))
  });
  return track;
}

function insertTrack(track, index = state.tracks.length) {
  const safeIndex = Math.max(0, Math.min(index, state.tracks.length));
  state.tracks.splice(safeIndex, 0, track);
}

function removeTrack(track) {
  const index = state.tracks.indexOf(track);
  if (index >= 0) {
    state.tracks.splice(index, 1);
  } else {
    state.tracks = state.tracks.filter((candidate) => candidate.id !== track.id);
  }
  record('stroke-removed', { id: track.id });
  return index;
}

function updateInkMetric() {
  state.metrics.inkLength = state.tracks.reduce((sum, track) => sum + totalLength(track.points), 0);
  state.metrics.strokeCount = state.tracks.length;
  inkMeter.textContent = `${Math.round(state.metrics.inkLength / 100)}m ink`;
  publishTelemetry();
}

function setMode(mode) {
  state.spawn.active = false;
  state.mode = mode;
  state.currentStroke = [];
  drawTool.classList.toggle('active', mode === 'draw');
  eraseTool.classList.toggle('active', mode === 'erase');
  canvas.classList.toggle('erase-mode', mode === 'erase');
  canvas.classList.remove('spawn-mode');
  setStatus(modeStatus());
  record('mode', { mode });
}

function setPlaying(playing) {
  state.playing = playing;
  playTool.classList.toggle('active', playing);
  playTool.setAttribute('aria-label', playing ? 'Pause' : 'Ride');
  playTool.setAttribute('title', playing ? 'Pause' : 'Ride');
  playTool.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
  createIcons({ icons });
  setStatus(playing ? 'riding' : modeStatus());
  record(playing ? 'play' : 'pause');
}

function resetRider() {
  const startTrack = state.tracks[0];
  const start = state.spawn.start ?? startTrack?.points[0] ?? { x: state.width * 0.12, y: state.height * 0.28 };
  const spawnOffset = state.spawn.start ? { x: 0, y: 0 } : { x: 1, y: -5 };
  state.rider = resetRide(state.rideWorld, { x: start.x + spawnOffset.x, y: start.y + spawnOffset.y });
  state.metrics.startX = state.rider.position.x;
  state.metrics.bestDistance = 0;
  state.metrics.currentAir = 0;
  state.metrics.longestAir = 0;
  state.metrics.topSpeed = 0;
  state.metrics.resets += 1;
  speedMeter.textContent = '0.0 px/s';
  airMeter.textContent = '0.0s air';
  record('reset', { x: Math.round(state.rider.position.x), y: Math.round(state.rider.position.y) });
  publishTelemetry();
}

function setSpawnMode(active) {
  state.spawn.active = active;
  state.currentStroke = [];
  canvas.classList.toggle('spawn-mode', active);
  canvas.classList.toggle('erase-mode', !active && state.mode === 'erase');
  setPlaying(false);
  setStatus(modeStatus());
  record(active ? 'spawn-armed' : 'spawn-cancelled');
}

function spawnAt(point) {
  state.spawn.start = { ...point };
  state.spawn.active = false;
  canvas.classList.remove('spawn-mode');
  state.rider = spawnRider(state.rideWorld, point);
  state.metrics.startX = state.rider.position.x;
  state.metrics.bestDistance = 0;
  state.metrics.currentAir = 0;
  state.metrics.longestAir = 0;
  state.metrics.topSpeed = 0;
  speedMeter.textContent = '0.0 px/s';
  airMeter.textContent = '0.0s air';
  setStatus(modeStatus());
  record('spawn', { x: Math.round(point.x), y: Math.round(point.y) });
  publishTelemetry();
  return state.rider;
}

function eraseAt(point) {
  const radius = 24 / state.camera.zoom;
  const removals = [];
  const additions = [];

  for (const track of [...state.tracks]) {
    if (nearestDistanceToPolyline(point, track.points) > radius) {
      continue;
    }

    const fragments = erasePolyline(track.points, point, radius, 18);
    const index = removeTrack(track);
    removals.push({ track, index });

    fragments.forEach((fragment, fragmentIndex) => {
      const nextTrack = createTrack(fragment, { preserve: true });
      if (nextTrack) {
        additions.push({ track: nextTrack, index: index + fragmentIndex });
      }
    });
  }

  if (removals.length === 0) {
    return false;
  }

  for (const addition of additions) {
    insertTrack(addition.track, addition.index);
  }

  syncRideWorld();
  updateInkMetric();
  state.history.push({
    type: 'erase',
    removed: removals,
    added: additions.map(({ track }) => track)
  });
  record('erase-cut', {
    removed: removals.length,
    added: additions.length
  });
  return true;
}

function getTrackBounds() {
  if (state.tracks.length === 0) {
    return {
      minX: -320,
      maxX: state.width / state.camera.zoom + 320,
      minY: -320,
      maxY: state.height / state.camera.zoom + 320
    };
  }

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (const track of state.tracks) {
    for (const point of track.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }

  return bounds;
}

function updateMetrics(deltaMs) {
  if (!state.rider) {
    return;
  }

  const telemetry = getRideTelemetry(state.rideWorld);
  const speed = telemetry.speed;
  state.metrics.topSpeed = Math.max(state.metrics.topSpeed, speed);
  state.metrics.bestDistance = Math.max(state.metrics.bestDistance, telemetry.distance);

  if (!telemetry.grounded) {
    state.metrics.currentAir += deltaMs / 1000;
    state.metrics.longestAir = Math.max(state.metrics.longestAir, state.metrics.currentAir);
  } else {
    state.metrics.currentAir = 0;
  }

  bleedRiderContact(telemetry);

  speedMeter.textContent = `${speed.toFixed(1)} px/s`;
  airMeter.textContent = `${state.metrics.longestAir.toFixed(1)}s air`;
  setStatus(telemetry.status);
  publishTelemetry();

  const bounds = getTrackBounds();
  if (state.rider.position.y > bounds.maxY + 520 || state.rider.position.x < bounds.minX - 520 || state.rider.position.x > bounds.maxX + 700) {
    setPlaying(false);
    setStatus('rinse');
    record('out-of-bounds', {
      x: Math.round(state.rider.position.x),
      y: Math.round(state.rider.position.y)
    });
  }
}

function bleedRiderContact(telemetry) {
  if (!telemetry.grounded || !state.rider?.mounted) {
    return null;
  }

  const now = performance.now();
  if (now - state.watercolor.lastBleedAt < RIDER_BLEED_INTERVAL_MS) {
    return null;
  }

  const contact = nearestTrackContact(state.rideWorld, state.rider.position);
  if (!contact || contact.distance > 34) {
    return null;
  }

  const track = state.tracks.find((candidate) => candidate.id === contact.trackId);
  if (!track?.glaze) {
    return null;
  }

  const speed = Math.max(telemetry.speed, telemetry.engineSpeed ?? 0);
  const result = rewetGlazeAtPoint(track.glaze, contact.point, {
    radius: clampValue(13 + speed * 0.024, 14, 30),
    water: clampValue(0.055 + speed * 0.0005, 0.06, 0.24),
    speed,
    steps: speed > 180 ? 3 : 2
  });

  if (result.affectedCellCount === 0) {
    return null;
  }

  track.glazeCanvas = null;
  state.watercolor.lastBleedAt = now;
  state.watercolor.lastBleedTrackId = track.id;
  state.watercolor.lastBleedWater = result.addedWater;
  state.metrics.watercolorBleeds += 1;

  if (state.metrics.watercolorBleeds % 12 === 1) {
    record('rider-bleed', {
      trackId: track.id,
      cells: result.affectedCellCount,
      water: Math.round(result.addedWater * 1000) / 1000,
      speed: Math.round(speed * 10) / 10
    });
  }

  return result;
}

function drawPath(points) {
  tracePath(ctx, points);
}

function renderTrack(track) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (!track.glazeCanvas) {
    track.glazeCanvas = createGlazeCanvas(track.glaze, track.palette, track.points);
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(track.glazeCanvas, track.glaze.bounds.x, track.glaze.bounds.y);

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = track.palette.ink;
  ctx.lineWidth = Math.max(1.5, track.thickness * 0.18);
  drawPath(track.points);
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = 'rgba(255, 250, 235, 0.75)';
  ctx.lineWidth = Math.max(5, track.thickness * 0.52);
  drawPath(track.points);
  ctx.stroke();
  ctx.restore();
}

function renderRider() {
  if (!state.rider) {
    return;
  }

  const points = state.rider.points ?? {};

  if (!points.NOSE || !points.TAIL || !points.PEG) {
    const { x, y } = state.rider.position;
    const angle = state.rider.angle;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(78, 51, 45, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    ctx.restore();
    return;
  }

  function strokeBetween(a, b, color, width = 1.5) {
    if (!a || !b) {
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(52, 43, 34, 0.14)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;

  strokeBetween(points.TAIL, points.NOSE, 'rgba(79, 55, 47, 0.8)', 2.2);
  strokeBetween(points.PEG, points.STRING, 'rgba(79, 55, 47, 0.72)', 1.7);
  strokeBetween(points.PEG, points.TAIL, 'rgba(79, 55, 47, 0.58)', 1.4);
  strokeBetween(points.STRING, points.NOSE, 'rgba(79, 55, 47, 0.58)', 1.4);

  ctx.shadowBlur = 0;
  strokeBetween(points.BUTT, points.SHOULDER, 'rgba(43, 53, 52, 0.84)', 1.8);
  strokeBetween(points.SHOULDER, points.LHAND, 'rgba(43, 53, 52, 0.66)', 1.35);
  strokeBetween(points.SHOULDER, points.RHAND, 'rgba(43, 53, 52, 0.66)', 1.35);
  strokeBetween(points.BUTT, points.LFOOT, 'rgba(43, 53, 52, 0.68)', 1.35);
  strokeBetween(points.BUTT, points.RFOOT, 'rgba(43, 53, 52, 0.68)', 1.35);

  const scarf = [
    points.SHOULDER,
    points.SCARF_0,
    points.SCARF_1,
    points.SCARF_2,
    points.SCARF_3,
    points.SCARF_4,
    points.SCARF_5,
    points.SCARF_6
  ].filter(Boolean);
  if (scarf.length > 1) {
    ctx.strokeStyle = 'rgba(170, 72, 83, 0.76)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(scarf[0].x, scarf[0].y);
    for (let i = 1; i < scarf.length; i += 1) {
      ctx.lineTo(scarf[i].x, scarf[i].y);
    }
    ctx.stroke();
  }

  if (points.SHOULDER) {
    ctx.fillStyle = 'rgba(43, 70, 79, 0.88)';
    ctx.beginPath();
    ctx.arc(points.SHOULDER.x + 0.4, points.SHOULDER.y - 3.8, 2.9, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const point of [points.PEG, points.TAIL, points.NOSE]) {
    ctx.fillStyle = 'rgba(255, 248, 232, 0.84)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function renderCurrentStroke() {
  if (state.currentStroke.length < 2) {
    return;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(64, 132, 154, 0.18)';
  ctx.lineWidth = 22;
  ctx.globalAlpha = 0.38;
  drawPath(state.currentStroke);
  ctx.stroke();

  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = 'rgba(36, 72, 96, 0.72)';
  ctx.lineWidth = 2.2;
  drawPath(state.currentStroke);
  ctx.stroke();
  ctx.restore();
}

function renderEraser() {
  if (state.mode !== 'erase' || !state.pointer) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(121, 72, 58, 0.45)';
  ctx.fillStyle = 'rgba(255, 248, 232, 0.38)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, 24 / state.camera.zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderBackground() {
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = state.paperPattern ?? '#f2eddf';
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.34;
  const wash = ctx.createLinearGradient(0, state.height * 0.08, state.width, state.height * 0.92);
  wash.addColorStop(0, 'rgba(126, 153, 125, 0.06)');
  wash.addColorStop(0.34, 'rgba(114, 159, 151, 0.14)');
  wash.addColorStop(0.66, 'rgba(194, 118, 106, 0.12)');
  wash.addColorStop(1, 'rgba(154, 103, 70, 0.1)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.restore();

  ctx.save();
  const vignette = ctx.createRadialGradient(
    state.width * 0.5,
    state.height * 0.48,
    state.height * 0.18,
    state.width * 0.5,
    state.height * 0.5,
    Math.max(state.width, state.height) * 0.7
  );
  vignette.addColorStop(0, 'rgba(255, 250, 235, 0)');
  vignette.addColorStop(1, 'rgba(83, 62, 42, 0.13)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.restore();
}

function render() {
  followRider();
  stepCamera(state.camera);
  renderBackground();
  ctx.setTransform(
    state.dpr * state.camera.zoom,
    0,
    0,
    state.dpr * state.camera.zoom,
    -state.camera.x * state.dpr * state.camera.zoom,
    -state.camera.y * state.dpr * state.camera.zoom
  );
  for (const track of state.tracks) {
    renderTrack(track);
  }
  renderCurrentStroke();
  renderRider();
  renderEraser();
}

function onPointerDown(event) {
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  const screen = screenPoint(event);
  state.pointers.set(event.pointerId, screen);

  if (event.pointerType === 'touch' && state.pointers.size >= 2) {
    beginPinchZoom();
    return;
  }

  const point = screenToWorld(screen);
  state.pointerDown = true;
  state.pointer = point;

  if (state.spawn.active) {
    state.pointerDown = false;
    spawnAt(point);
    return;
  }

  if (state.mode === 'erase') {
    eraseAt(point);
    return;
  }

  state.currentStroke = [point];
}

function onPointerMove(event) {
  const screen = screenPoint(event);
  if (state.pointers.has(event.pointerId)) {
    state.pointers.set(event.pointerId, screen);
  }

  if (state.pinch) {
    updatePinchZoom();
    return;
  }

  const point = screenToWorld(screen);
  state.pointer = point;

  if (!state.pointerDown) {
    return;
  }

  if (state.mode === 'erase') {
    eraseAt(point);
    return;
  }

  const last = state.currentStroke[state.currentStroke.length - 1];
  if (!last || distance(last, point) >= 3) {
    state.currentStroke.push(point);
  }
}

function onPointerUp(event) {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  state.pointers.delete(event.pointerId);

  if (state.pinch) {
    if (state.pointers.size < 2) {
      state.pinch = null;
    }
    state.pointerDown = false;
    state.currentStroke = [];
    return;
  }

  state.pointerDown = false;

  if (state.mode === 'draw' && state.currentStroke.length > 1) {
    addTrack(state.currentStroke);
  }

  state.currentStroke = [];
}

function undoStroke() {
  const action = state.history.pop();

  if (!action) {
    return;
  }

  if (action.type === 'add') {
    for (const track of action.tracks) {
      removeTrack(track);
    }
  } else if (action.type === 'erase') {
    for (const track of action.added) {
      removeTrack(track);
    }
    for (const { track, index } of action.removed.sort((a, b) => a.index - b.index)) {
      insertTrack(track, index);
    }
  } else if (action.type === 'clear') {
    state.tracks = [...action.tracks];
  }

  syncRideWorld();
  updateInkMetric();
  record('undo', { type: action.type });
}

function clearCanvas() {
  const cleared = [...state.tracks];
  state.tracks = [];
  state.history.push({ type: 'clear', tracks: cleared });
  syncRideWorld();
  updateInkMetric();
  setPlaying(false);
  resetRider();
  setStatus(modeStatus());
  record('clear', { tracks: cleared.length });
}

let previous = performance.now();
function loop(now) {
  const delta = Math.min(now - previous, 33);
  previous = now;

  if (state.playing) {
    let remaining = delta;
    while (remaining > 0) {
      const step = Math.min(remaining, 1000 / ENGINE_FPS);
      stepRide(state.rideWorld, step / 1000);
      remaining -= step;
    }
    state.rider = state.rideWorld.rider;
    updateMetrics(delta);
  }

  render();
  requestAnimationFrame(loop);
}

drawTool.addEventListener('click', () => setMode('draw'));
eraseTool.addEventListener('click', () => setMode('erase'));
playTool.addEventListener('click', () => setPlaying(!state.playing));
menuToggle.addEventListener('click', () => setMenuOpen(!state.ui.menuOpen));
menuSpawn.addEventListener('click', () => {
  setMenuOpen(false);
  setSpawnMode(true);
});
resetTool.addEventListener('click', () => {
  setPlaying(false);
  resetRider();
  setStatus(modeStatus());
  setMenuOpen(false);
});
menuHelp.addEventListener('click', () => {
  const open = menuHelp.getAttribute('aria-expanded') !== 'true';
  menuHelp.setAttribute('aria-expanded', String(open));
  menuHelpPanel.hidden = !open;
  revealChrome();
});
menuClose.addEventListener('click', () => setMenuOpen(false));
undoTool.addEventListener('click', () => {
  undoStroke();
  setMenuOpen(false);
});
clearTool.addEventListener('click', () => {
  clearCanvas();
  setMenuOpen(false);
});
debugToggle.addEventListener('click', () => {
  setMenuOpen(false);
  setDebugOpen(!state.ui.debugOpen);
});
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const point = screenPoint(event);
    const factor = Math.exp(-event.deltaY * 0.0012);
    setZoom(state.camera.targetZoom * factor, point);
  },
  { passive: false }
);
app.addEventListener('pointermove', revealChrome);
app.addEventListener('pointerdown', revealChrome);
app.addEventListener('touchstart', revealChrome, { passive: true });
app.addEventListener('focusin', revealChrome);
window.addEventListener('keydown', (event) => {
  revealChrome();

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoStroke();
    return;
  }

  if (event.code === 'Space' && !event.target?.closest?.('button')) {
    event.preventDefault();
    setPlaying(!state.playing);
    return;
  }

  if (event.key === 'Escape') {
    if (state.spawn.active) {
      setSpawnMode(false);
      return;
    }
    if (state.ui.debugOpen) {
      setDebugOpen(false);
      return;
    }
    if (state.ui.menuOpen) {
      setMenuOpen(false);
    }
  }
});
window.addEventListener('resize', resize);

window.RPK_RIDER = {
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  reset: resetRider,
  clear: clearCanvas,
  addTrack,
  eraseAt,
  spawnAt,
  getState: () => ({
    mode: state.mode,
    playing: state.playing,
    spawn: { ...state.spawn },
    tracks: state.tracks.map((track) => ({
      id: track.id,
      points: track.points.length,
      length: totalLength(track.points),
      watercolor: { ...track.glaze.metrics }
    })),
    rider: state.rider
      ? {
          x: state.rider.position.x,
          y: state.rider.position.y,
          speed: Math.hypot(state.rider.velocity.x, state.rider.velocity.y),
          status: state.rider.status,
          grounded: state.rider.grounded,
          frame: state.rider.frame,
          mounted: state.rider.mounted,
          points: Object.keys(state.rider.points ?? {})
        }
      : null,
    metrics: { ...state.metrics },
    watercolorDynamics: { ...state.watercolor },
    camera: { ...state.camera },
    watercolor: getWatercolorMetrics(),
    engine: {
      fps: ENGINE_FPS,
      lines: state.rideWorld.lines.length
    },
    telemetry: getRideTelemetry(state.rideWorld),
    ui: { ...state.ui },
    log: [...state.log]
  })
};

resize();
setMode('draw');
setMenuOpen(true);
revealChrome();
requestAnimationFrame(loop);
