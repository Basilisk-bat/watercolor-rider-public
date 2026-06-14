import './styles.css';
import { createIcons, icons } from 'lucide';
import {
  chaikinSmooth,
  distance,
  erasePolyline,
  nearestDistanceToPolyline,
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
  RIDE_LINE_TYPES,
  createRideWorld,
  getRideTelemetry,
  nearestTrackContact,
  resetRide,
  setRideTracks,
  spawnRider,
  stepRide
} from './ridePhysics.js';
import { getRideRecovery } from './recoveryRules.js';
import { aggregateStrokeMetrics, createStrokeMaterial, rewetStrokeMaterialAtPoint } from './strokeMaterial.js';
import {
  WORKLOAD_LIMITS,
  chooseRenderBudget,
  createTimedCache,
  prepareTrackPoints,
  shouldSampleStrokePoint
} from './workloadLimits.js';

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
const watercolorTool = document.querySelector('#watercolorTool');
const pencilTool = document.querySelector('#pencilTool');
const markerTool = document.querySelector('#markerTool');
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
const debugTexture = document.querySelector('[data-diagnostic="texture"]');
const debugInk = document.querySelector('[data-diagnostic="ink"]');
const debugMarks = document.querySelector('[data-diagnostic="marks"]');
const debugTrails = document.querySelector('[data-diagnostic="trails"]');

const CHROME_IDLE_MS = 2200;
const RIDER_BLEED_INTERVAL_MS = 70;
const {
  maxTrackPoints: MAX_TRACK_POINTS,
  maxTracks: MAX_TRACKS,
  maxHistory: MAX_HISTORY,
  maxRenderSamples: MAX_RENDER_SAMPLES,
  maxMaterialCanvasPixels: MAX_MATERIAL_CANVAS_PIXELS,
  metricsCacheMs: METRICS_CACHE_MS,
  materialCanvasRefreshMs: MATERIAL_CANVAS_REFRESH_MS,
  eraserIntervalMs: ERASER_INTERVAL_MS,
  eraserMinScreenDistance: ERASER_MIN_SCREEN_DISTANCE,
  pinchDeadzoneRatio: PINCH_DEADZONE_RATIO,
  wheelDeltaMax: WHEEL_DELTA_MAX,
  maxRawStrokePoints: MAX_RAW_STROKE_POINTS
} = WORKLOAD_LIMITS;
let chromeTimer = null;

const watercolorPalettes = [
  { ink: 'rgba(36, 72, 96, 0.78)', wash: 'rgba(64, 132, 154, 0.16)' },
  { ink: 'rgba(54, 95, 72, 0.78)', wash: 'rgba(96, 153, 105, 0.16)' },
  { ink: 'rgba(142, 83, 95, 0.72)', wash: 'rgba(191, 107, 126, 0.15)' },
  { ink: 'rgba(113, 86, 56, 0.74)', wash: 'rgba(198, 145, 79, 0.14)' }
];

const BRUSHES = Object.freeze({
  watercolor: {
    id: 'watercolor',
    label: 'Watercolor',
    lineType: RIDE_LINE_TYPES.SOLID,
    rideable: true,
    collidable: true,
    thickness: 10,
    water: 1.05,
    pigment: 1.08,
    steps: 36
  },
  pencil: {
    id: 'pencil',
    label: 'Pencil',
    lineType: RIDE_LINE_TYPES.SCENERY,
    rideable: false,
    collidable: false,
    thickness: 5,
    water: 0.26,
    pigment: 0.48,
    steps: 18,
    palette: { ink: 'rgba(45, 47, 45, 0.72)', wash: 'rgba(88, 87, 80, 0.055)' }
  },
  marker: {
    id: 'marker',
    label: 'Marker',
    lineType: RIDE_LINE_TYPES.ACC,
    rideable: true,
    collidable: true,
    thickness: 12,
    water: 0.68,
    pigment: 1.34,
    steps: 24,
    palette: { ink: 'rgba(125, 56, 85, 0.9)', wash: 'rgba(191, 74, 116, 0.18)' }
  }
});

const brushTools = new Map([
  ['watercolor', watercolorTool],
  ['pencil', pencilTool],
  ['marker', markerTool]
]);

const state = {
  mode: 'draw',
  brushId: 'watercolor',
  playing: false,
  pointerDown: false,
  pointers: new Map(),
  pinch: null,
  pointer: null,
  lastStrokeScreen: null,
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
    renderRewets: 0
  },
  material: {
    lastRewetAt: 0,
    lastRewetTrackId: null,
    lastRewetAmount: 0
  },
  eraser: {
    lastAt: 0,
    lastPoint: null
  },
  performance: {
    lastStrokeBuildMs: 0,
    worstStrokeBuildMs: 0,
    lastFrameMs: 0,
    worstFrameMs: 0,
    materialRebuilds: 0,
    renderMetricRecomputes: 0,
    lastTrackLimited: false,
    lastTrackRejected: null
  },
  recovery: {
    reason: null,
    status: null,
    autoPaused: false,
    at: 0
  },
  ui: {
    chromeVisible: true,
    debugOpen: false,
    menuOpen: true
  },
  log: []
};

const renderMetricsCache = createTimedCache(
  () => {
    const metrics = aggregateStrokeMetrics(state.tracks.map((track) => track.material));
    state.performance.renderMetricRecomputes += 1;
    return metrics;
  },
  { ttlMs: METRICS_CACHE_MS }
);

function invalidateRenderMetrics() {
  renderMetricsCache.invalidate();
}

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

function getRenderMetrics() {
  return renderMetricsCache.get();
}

function getBrush(brushId = state.brushId) {
  return BRUSHES[brushId] ?? BRUSHES.watercolor;
}

function getBrushPalette(brush, trackIndex) {
  if (brush.id === 'watercolor') {
    return watercolorPalettes[trackIndex % watercolorPalettes.length];
  }

  return brush.palette;
}

function updateDebugDiagnostics() {
  if (debugStatus) {
    debugStatus.textContent = statusStrip.textContent;
  }
  if (debugZoom) {
    debugZoom.textContent = `${Math.round(state.camera.targetZoom * 100)}%`;
  }
  const render = getRenderMetrics();
  if (debugTexture) {
    debugTexture.textContent = `${Math.round(render.textureLoad * 100)}%`;
  }
  if (debugInk) {
    debugInk.textContent = render.totalPigmentMass.toFixed(1);
  }
  if (debugMarks) {
    debugMarks.textContent = String(render.renderUnitCount);
  }
  if (debugTrails) {
    debugTrails.textContent = String(render.trailCount);
  }
}

function publishTelemetry() {
  const speed = state.rider ? Math.hypot(state.rider.velocity.x, state.rider.velocity.y) : 0;
  app.dataset.playing = String(state.playing);
  app.dataset.mode = state.mode;
  app.dataset.brush = state.brushId;
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
  const render = getRenderMetrics();
  app.dataset.texture = String(Math.round(render.textureLoad * 1000) / 1000);
  app.dataset.inkMass = String(Math.round(render.totalPigmentMass * 10) / 10);
  app.dataset.marks = String(render.renderUnitCount);
  app.dataset.trails = String(render.trailCount);
  app.dataset.rewets = String(state.metrics.renderRewets);
  app.dataset.wetness = app.dataset.texture;
  app.dataset.pigmentMass = app.dataset.inkMass;
  app.dataset.depositedMass = String(Math.round(render.depositedPigmentMass * 10) / 10);
  app.dataset.runoff = app.dataset.trails;
  app.dataset.bleeds = app.dataset.rewets;
  updateDebugDiagnostics();
}

function modeStatus() {
  if (state.spawn.active) {
    return 'spawn';
  }
  return state.mode === 'draw' ? state.brushId : 'erase';
}

function setStatus(status, options = {}) {
  statusStrip.textContent = status;
  if (options.publish !== false) {
    publishTelemetry();
  }
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pushHistory(action) {
  state.history.push(action);
  while (state.history.length > MAX_HISTORY) {
    state.history.shift();
  }
}

function clearRecovery() {
  state.recovery = {
    reason: null,
    status: null,
    autoPaused: false,
    at: 0
  };
}

function setPlayIcon(playing) {
  playTool.classList.toggle('active', playing);
  playTool.setAttribute('aria-label', playing ? 'Pause' : 'Ride');
  playTool.setAttribute('title', playing ? 'Pause' : 'Ride');
  playTool.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
  createIcons({ icons });
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

function clearCurrentStroke() {
  state.currentStroke = [];
  state.lastStrokeScreen = null;
}

function appendStrokePoint(point, screen, options = {}) {
  const last = state.currentStroke[state.currentStroke.length - 1];
  const shouldAppend =
    options.force ||
    state.currentStroke.length === 0 ||
    (state.currentStroke.length < MAX_RAW_STROKE_POINTS &&
      shouldSampleStrokePoint(state.lastStrokeScreen, screen, state.camera.targetZoom));

  if (!shouldAppend) {
    return false;
  }

  if (last && distance(last, point) < 0.001) {
    state.lastStrokeScreen = { ...screen };
    return false;
  }

  state.currentStroke.push(point);
  state.lastStrokeScreen = { ...screen };
  return true;
}

function cancelPointerState() {
  state.pointerDown = false;
  state.pinch = null;
  state.pointers.clear();
  clearCurrentStroke();
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
  clearCurrentStroke();
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

  if (Math.abs(nextDistance - state.pinch.distance) / state.pinch.distance < PINCH_DEADZONE_RATIO) {
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

function latticeNoise(x, y, salt) {
  let n = Math.imul(x + 3749, 374761393) ^ Math.imul(y + 6689, 668265263) ^ Math.imul(salt + 17, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function applyMaterialTransform(targetCtx, material) {
  const scale = material.canvasScale ?? 1;
  targetCtx.setTransform(scale, 0, 0, scale, -material.bounds.x * scale, -material.bounds.y * scale);
}

function resetLayerTransform(targetCtx) {
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
}

function createMaterialCanvas(material, paletteColor, points = [], brushId = 'watercolor') {
  const paint = document.createElement('canvas');
  const paintCtx = paint.getContext('2d');
  const scale = material.canvasScale ?? 1;
  paint.width = Math.max(1, Math.ceil(material.bounds.width * scale));
  paint.height = Math.max(1, Math.ceil(material.bounds.height * scale));
  paintCtx.clearRect(0, 0, paint.width, paint.height);

  const wash = createLayerCanvas(paint.width, paint.height);
  const washCtx = wash.getContext('2d');
  const ink = createLayerCanvas(paint.width, paint.height);
  const inkCtx = ink.getContext('2d');
  const trails = createLayerCanvas(paint.width, paint.height);
  const trailCtx = trails.getContext('2d');
  const grain = createLayerCanvas(paint.width, paint.height);
  const grainCtx = grain.getContext('2d');
  const tooth = createLayerCanvas(paint.width, paint.height);
  const toothCtx = tooth.getContext('2d');

  for (const layerCtx of [washCtx, inkCtx, trailCtx, grainCtx, toothCtx]) {
    applyMaterialTransform(layerCtx, material);
    layerCtx.lineCap = 'round';
    layerCtx.lineJoin = 'round';
  }

  if (points.length > 1) {
    const washWidth = brushId === 'marker' ? material.thickness * 1.55 : material.thickness * 2.25;
    washCtx.filter = `blur(${Math.max(1.4, material.thickness * 0.18 * scale)}px)`;
    washCtx.strokeStyle = colorWithAlpha(paletteColor.wash, brushId === 'marker' ? 0.3 : 0.2);
    washCtx.lineWidth = washWidth;
    tracePath(washCtx, points);
    washCtx.stroke();
    washCtx.filter = 'none';

    inkCtx.globalCompositeOperation = 'multiply';
    inkCtx.strokeStyle = colorWithAlpha(paletteColor.ink, brushId === 'pencil' ? 0.48 : 0.18);
    inkCtx.lineWidth = Math.max(1.2, material.thickness * (brushId === 'pencil' ? 0.36 : 0.22));
    tracePath(inkCtx, points);
    inkCtx.stroke();
  }

  for (const sample of material.samples) {
    const radius = material.thickness * sample.radius * (brushId === 'pencil' ? 0.18 : 0.38);
    if (brushId !== 'pencil') {
      fillSoftEllipse(
        washCtx,
        sample.x,
        sample.y,
        Math.max(1.2, radius * 1.55),
        Math.max(0.8, radius * 0.9),
        paletteColor.wash,
        Math.min(0.055, sample.alpha * 0.11),
        sample.angle
      );
    }

    if (sample.roughness > 0.55 || brushId === 'pencil') {
      fillSoftEllipse(
        inkCtx,
        sample.x,
        sample.y,
        Math.max(0.4, radius * 0.52),
        Math.max(0.3, radius * 0.26),
        paletteColor.ink,
        brushId === 'pencil' ? 0.055 : 0.032,
        sample.angle
      );
    }
  }

  for (const trail of material.trails) {
    trailCtx.strokeStyle = colorWithAlpha(paletteColor.wash, trail.alpha);
    trailCtx.lineWidth = Math.max(1, trail.width);
    trailCtx.beginPath();
    trailCtx.moveTo(trail.x, trail.y);
    trailCtx.quadraticCurveTo(trail.x + trail.drift * 0.42, trail.y + trail.length * 0.5, trail.x + trail.drift, trail.y + trail.length);
    trailCtx.stroke();
    fillSoftEllipse(trailCtx, trail.x + trail.drift, trail.y + trail.length, trail.width * 1.9, trail.width * 1.25, paletteColor.wash, trail.alpha * 0.62);
  }

  for (const mark of material.rewetMarks) {
    fillSoftDot(washCtx, mark.x, mark.y, mark.radius, paletteColor.wash, mark.alpha);
    fillSoftEllipse(inkCtx, mark.x, mark.y, mark.radius * 0.42, mark.radius * 0.22, paletteColor.ink, mark.alpha * 0.32, mark.speed * 0.002);
  }

  for (const dot of material.grain) {
    grainCtx.fillStyle = colorWithAlpha(paletteColor.ink, dot.alpha);
    grainCtx.beginPath();
    grainCtx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
    grainCtx.fill();
  }

  for (const dot of material.grain.slice(0, 80)) {
    fillSoftEllipse(toothCtx, dot.x, dot.y, dot.radius * 2.4, dot.radius * 1.3, 'rgba(0, 0, 0, 1)', 0.045);
  }

  for (const layerCtx of [washCtx, inkCtx, trailCtx, grainCtx, toothCtx]) {
    resetLayerTransform(layerCtx);
  }

  paintCtx.globalCompositeOperation = 'multiply';
  paintCtx.filter = `blur(${Math.max(0.8, material.thickness * 0.08 * scale)}px)`;
  paintCtx.drawImage(wash, 0, 0);
  paintCtx.filter = 'none';
  paintCtx.globalCompositeOperation = 'destination-out';
  paintCtx.globalAlpha = 0.22;
  paintCtx.drawImage(tooth, 0, 0);
  paintCtx.globalCompositeOperation = 'multiply';
  paintCtx.globalAlpha = 0.76;
  paintCtx.drawImage(trails, 0, 0);
  paintCtx.globalAlpha = 1;
  paintCtx.drawImage(ink, 0, 0);
  paintCtx.globalAlpha = 0.42;
  paintCtx.drawImage(grain, 0, 0);
  paintCtx.globalAlpha = 1;
  paintCtx.globalCompositeOperation = 'source-over';

  return paint;
}

function syncRideWorld() {
  setRideTracks(state.rideWorld, state.tracks);
  state.rider = state.rideWorld.rider;
  publishTelemetry();
}

function createTrack(rawPoints, options = {}) {
  const { starter = false, preserve = false } = options;
  const brush = getBrush(starter ? 'watercolor' : options.brushId);
  const startedAt = performance.now();
  const prepared = prepareTrackPoints(rawPoints, {
    starter,
    preserve,
    maxPoints: MAX_TRACK_POINTS
  });
  const points = prepared.points;

  if (points.length < 2 || totalLength(points) < 16) {
    return null;
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : `track-${Date.now()}-${state.tracks.length}`;
  const paletteIndex = state.tracks.length % watercolorPalettes.length;
  const seed = paletteIndex * 997 + state.tracks.length * 251 + brush.id.length * 53 + 17;
  const thickness = starter ? 12 : brush.thickness;
  const renderBudget = chooseRenderBudget(points, {
    starter,
    maxSamples: MAX_RENDER_SAMPLES,
    maxCanvasPixels: MAX_MATERIAL_CANVAS_PIXELS,
    sampleSpacing: starter ? 14 : 18
  });
  const material = createStrokeMaterial(points, {
    seed,
    sampleCount: renderBudget.sampleCount,
    canvasScale: renderBudget.canvasScale,
    thickness,
    water: starter ? 1.25 : brush.water,
    pigment: starter ? 0.96 : brush.pigment
  });
  const buildMs = performance.now() - startedAt;
  const limited = prepared.limited || renderBudget.limited;
  const paletteColor = getBrushPalette(brush, state.tracks.length);
  const track = {
    id,
    brushId: brush.id,
    brushLabel: brush.label,
    lineType: brush.lineType,
    rideable: brush.rideable,
    collidable: brush.collidable,
    points,
    thickness,
    palette: paletteColor,
    material,
    materialCanvas: null,
    materialDirty: true,
    materialDirtyAt: performance.now(),
    materialLastRebuildAt: 0,
    limited,
    rawPointCount: prepared.rawPointCount,
    preLimitPointCount: prepared.preLimitPointCount,
    renderSampleCount: material.samples.length,
    renderUnitCount: material.renderUnits,
    materialCanvasScale: material.canvasScale,
    buildMs
  };

  state.performance.lastStrokeBuildMs = buildMs;
  state.performance.worstStrokeBuildMs = Math.max(state.performance.worstStrokeBuildMs, buildMs);
  state.performance.lastTrackLimited = limited;
  state.performance.lastTrackRejected = null;

  return track;
}

function addTrack(rawPoints, options = {}) {
  if (!options.starter && state.tracks.length >= MAX_TRACKS) {
    state.performance.lastTrackRejected = 'track-limit';
    setStatus('limit');
    record('track-limit', { tracks: state.tracks.length, maxTracks: MAX_TRACKS });
    return null;
  }

  const track = createTrack(rawPoints, options);

  if (!track) {
    state.performance.lastTrackRejected = 'too-short';
    return null;
  }

  state.tracks.push(track);
  invalidateRenderMetrics();
  syncRideWorld();
  updateInkMetric();
  if (options.recordHistory !== false && !options.starter) {
    pushHistory({ type: 'add', tracks: [track] });
  }
  record(options.starter ? 'starter-track' : 'stroke-added', {
    brushId: track.brushId,
    lineType: track.lineType,
    points: track.points.length,
    length: Math.round(totalLength(track.points)),
    limited: track.limited,
    rawPoints: track.rawPointCount,
    preLimitPoints: track.preLimitPointCount,
    renderSampleCount: track.renderSampleCount,
    renderUnitCount: track.renderUnitCount,
    buildMs: Math.round(track.buildMs * 10) / 10
  });
  return track;
}

function insertTrack(track, index = state.tracks.length) {
  const safeIndex = Math.max(0, Math.min(index, state.tracks.length));
  state.tracks.splice(safeIndex, 0, track);
  invalidateRenderMetrics();
}

function removeTrack(track) {
  const index = state.tracks.indexOf(track);
  if (index >= 0) {
    state.tracks.splice(index, 1);
  } else {
    state.tracks = state.tracks.filter((candidate) => candidate.id !== track.id);
  }
  invalidateRenderMetrics();
  record('stroke-removed', { id: track.id });
  return index;
}

function updateInkMetric() {
  state.metrics.inkLength = state.tracks.reduce((sum, track) => sum + totalLength(track.points), 0);
  state.metrics.strokeCount = state.tracks.length;
  inkMeter.textContent = `${Math.round(state.metrics.inkLength / 100)}m ink`;
  publishTelemetry();
}

function updateToolChrome() {
  for (const [brushId, button] of brushTools) {
    const active = state.mode === 'draw' && state.brushId === brushId;
    button?.classList.toggle('active', active);
    button?.setAttribute('aria-pressed', String(active));
  }

  eraseTool.classList.toggle('active', state.mode === 'erase');
  eraseTool.setAttribute('aria-pressed', String(state.mode === 'erase'));
  canvas.classList.remove('watercolor-mode', 'pencil-mode', 'marker-mode', 'erase-mode', 'spawn-mode');

  if (state.mode === 'erase') {
    canvas.classList.add('erase-mode');
  } else {
    canvas.classList.add(`${state.brushId}-mode`);
  }
}

function setMode(mode, options = {}) {
  state.spawn.active = false;
  if (mode === 'erase') {
    state.mode = 'erase';
  } else {
    state.mode = 'draw';
    state.brushId = getBrush(options.brushId ?? state.brushId).id;
  }
  clearCurrentStroke();
  updateToolChrome();
  setStatus(modeStatus());
  record('mode', { mode: state.mode, brushId: state.brushId });
}

function setBrush(brushId) {
  setMode('draw', { brushId });
}

function setPlaying(playing) {
  state.playing = playing;
  if (playing) {
    clearRecovery();
  }
  setPlayIcon(playing);
  setStatus(playing ? 'riding' : modeStatus());
  record(playing ? 'play' : 'pause');
}

function resetRider() {
  clearRecovery();
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
  clearCurrentStroke();
  if (active) {
    canvas.classList.remove('watercolor-mode', 'pencil-mode', 'marker-mode', 'erase-mode');
    canvas.classList.add('spawn-mode');
  } else {
    updateToolChrome();
  }
  setPlaying(false);
  setStatus(modeStatus());
  record(active ? 'spawn-armed' : 'spawn-cancelled');
}

function spawnAt(point) {
  clearRecovery();
  state.spawn.start = { ...point };
  state.spawn.active = false;
  updateToolChrome();
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

function shouldThrottleErase(point, options = {}) {
  if (!options.throttle) {
    return false;
  }

  const now = performance.now();
  const minMove = ERASER_MIN_SCREEN_DISTANCE / Math.max(0.001, state.camera.zoom);
  const movedEnough = !state.eraser.lastPoint || distance(state.eraser.lastPoint, point) >= minMove;
  const waitedEnough = now - state.eraser.lastAt >= ERASER_INTERVAL_MS;

  if (!movedEnough && !waitedEnough) {
    return true;
  }

  state.eraser.lastAt = now;
  state.eraser.lastPoint = { ...point };
  return false;
}

function eraseAt(point, options = {}) {
  if (shouldThrottleErase(point, options)) {
    return false;
  }

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
      const nextTrack = createTrack(fragment, { preserve: true, brushId: track.brushId ?? 'watercolor' });
      if (nextTrack) {
        additions.push({ track: nextTrack, index: index + fragmentIndex });
      }
    });
  }

  if (removals.length === 0) {
    return false;
  }

  const availableSlots = Math.max(0, MAX_TRACKS - state.tracks.length);
  const limitedAdditions = additions.slice(0, availableSlots);

  for (const addition of limitedAdditions) {
    insertTrack(addition.track, addition.index);
  }

  syncRideWorld();
  updateInkMetric();
  pushHistory({
    type: 'erase',
    removed: removals,
    added: limitedAdditions.map(({ track }) => track)
  });
  record('erase-cut', {
    removed: removals.length,
    added: limitedAdditions.length,
    discarded: additions.length - limitedAdditions.length
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

function pauseForRecovery(reason, status, detail = {}) {
  if (state.recovery.reason === reason && state.recovery.autoPaused && !state.playing) {
    return;
  }

  state.playing = false;
  setPlayIcon(false);
  state.recovery = {
    reason,
    status,
    autoPaused: true,
    at: Number(performance.now().toFixed(1)),
    ...detail
  };
  setStatus(status);
  record('recovery-pause', {
    reason,
    status,
    ...detail
  });
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

  rewetRiderContact(telemetry);

  speedMeter.textContent = `${speed.toFixed(1)} px/s`;
  airMeter.textContent = `${state.metrics.longestAir.toFixed(1)}s air`;

  const bounds = getTrackBounds();
  const recovery = getRideRecovery(telemetry, state.rider, bounds);
  if (recovery) {
    pauseForRecovery(recovery.reason, recovery.status, recovery.detail);
    return;
  }

  setStatus(telemetry.status, { publish: false });
  publishTelemetry();
}

function markMaterialDirty(track) {
  track.materialDirty = true;
  track.materialDirtyAt = performance.now();
  invalidateRenderMetrics();
}

function rewetRiderContact(telemetry) {
  if (!telemetry.grounded || !state.rider?.mounted) {
    return null;
  }

  const contactTrackId = telemetry.contacts[0]?.trackId;
  if (!contactTrackId) {
    return null;
  }

  const now = performance.now();
  if (now - state.material.lastRewetAt < RIDER_BLEED_INTERVAL_MS) {
    return null;
  }

  const contact = nearestTrackContact(state.rideWorld, state.rider.position);
  if (!contact || contact.distance > 34 || contact.trackId !== contactTrackId) {
    return null;
  }

  const track = state.tracks.find((candidate) => candidate.id === contact.trackId);
  if (!track?.material || !track.collidable) {
    return null;
  }

  const speed = Math.max(telemetry.speed, telemetry.engineSpeed ?? 0);
  const result = rewetStrokeMaterialAtPoint(track.material, contact.point, {
    radius: clampValue(13 + speed * 0.024, 14, 30),
    water: clampValue(0.055 + speed * 0.0005, 0.06, 0.24),
    speed
  });

  if (result.affectedCellCount === 0) {
    return null;
  }

  track.renderUnitCount = track.material.renderUnits;
  markMaterialDirty(track);
  state.material.lastRewetAt = now;
  state.material.lastRewetTrackId = track.id;
  state.material.lastRewetAmount = result.addedWater;
  state.metrics.renderRewets += 1;

  if (state.metrics.renderRewets % 12 === 1) {
    record('rider-rewet', {
      trackId: track.id,
      marks: result.affectedCellCount,
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

  const now = performance.now();
  const shouldRebuildMaterial =
    !track.materialCanvas || (track.materialDirty && now - track.materialLastRebuildAt >= MATERIAL_CANVAS_REFRESH_MS);

  if (shouldRebuildMaterial) {
    track.materialCanvas = createMaterialCanvas(track.material, track.palette, track.points, track.brushId);
    track.materialDirty = false;
    track.materialLastRebuildAt = now;
    state.performance.materialRebuilds += 1;
  }

  const brushId = track.brushId ?? 'watercolor';

  ctx.globalAlpha = brushId === 'pencil' ? 0.58 : brushId === 'marker' ? 0.82 : 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(
    track.materialCanvas,
    track.material.bounds.x,
    track.material.bounds.y,
    track.material.bounds.width,
    track.material.bounds.height
  );

  if (brushId === 'pencil') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.58;
    ctx.strokeStyle = track.palette.ink;
    ctx.lineWidth = Math.max(1.2, track.thickness * 0.28);
    drawPath(track.points);
    ctx.stroke();

    ctx.globalAlpha = 0.2;
    ctx.setLineDash([1.5, 4.5]);
    ctx.lineDashOffset = -((track.material.metrics?.renderSampleCount ?? track.points.length) % 11);
    ctx.lineWidth = Math.max(0.8, track.thickness * 0.18);
    drawPath(track.points);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  if (brushId === 'marker') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.68;
    ctx.strokeStyle = track.palette.ink;
    ctx.lineWidth = Math.max(3.5, track.thickness * 0.48);
    drawPath(track.points);
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = colorWithAlpha(track.palette.wash, 0.34);
    ctx.lineWidth = Math.max(8, track.thickness * 0.72);
    drawPath(track.points);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = track.palette.ink;
  ctx.lineWidth = Math.max(1.5, track.thickness * 0.18);
  drawPath(track.points);
  ctx.stroke();

  ctx.globalAlpha = 0.07;
  ctx.setLineDash([Math.max(4, track.thickness * 0.55), Math.max(6, track.thickness * 0.72)]);
  ctx.lineDashOffset = -((track.material.metrics?.renderSampleCount ?? track.points.length) % 23);
  ctx.lineWidth = Math.max(1.1, track.thickness * 0.14);
  drawPath(track.points);
  ctx.stroke();
  ctx.setLineDash([]);

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

  const brush = getBrush();
  const paletteColor = getBrushPalette(brush, state.tracks.length);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (brush.id === 'pencil') {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = paletteColor.ink;
    ctx.lineWidth = 1.7;
    ctx.setLineDash([1.5, 4]);
    drawPath(state.currentStroke);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.strokeStyle = paletteColor.wash;
  ctx.lineWidth = brush.id === 'marker' ? 17 : 22;
  ctx.globalAlpha = brush.id === 'marker' ? 0.42 : 0.38;
  drawPath(state.currentStroke);
  ctx.stroke();

  ctx.globalAlpha = brush.id === 'marker' ? 0.58 : 0.24;
  ctx.strokeStyle = paletteColor.ink;
  ctx.lineWidth = brush.id === 'marker' ? 4.8 : 2.2;
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
    eraseAt(point, { throttle: false });
    return;
  }

  clearCurrentStroke();
  appendStrokePoint(point, screen, { force: true });
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
    eraseAt(point, { throttle: true });
    return;
  }

  appendStrokePoint(point, screen);
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
    clearCurrentStroke();
    return;
  }

  const screen = screenPoint(event);
  const point = screenToWorld(screen);
  if (state.mode === 'draw' && state.currentStroke.length > 0) {
    appendStrokePoint(point, screen, { force: true });
  }

  state.pointerDown = false;

  if (state.mode === 'draw' && state.currentStroke.length > 1) {
    addTrack(state.currentStroke, { brushId: state.brushId });
  }

  clearCurrentStroke();
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
    invalidateRenderMetrics();
  }

  syncRideWorld();
  updateInkMetric();
  record('undo', { type: action.type });
}

function clearCanvas() {
  const cleared = [...state.tracks];
  state.tracks = [];
  invalidateRenderMetrics();
  pushHistory({ type: 'clear', tracks: cleared });
  syncRideWorld();
  updateInkMetric();
  setPlaying(false);
  resetRider();
  setStatus(modeStatus());
  record('clear', { tracks: cleared.length });
}

let previous = performance.now();
function loop(now) {
  const frameStartedAt = performance.now();
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
  const frameMs = performance.now() - frameStartedAt;
  state.performance.lastFrameMs = frameMs;
  state.performance.worstFrameMs = Math.max(state.performance.worstFrameMs, frameMs);
  requestAnimationFrame(loop);
}

watercolorTool.addEventListener('click', () => setBrush('watercolor'));
pencilTool.addEventListener('click', () => setBrush('pencil'));
markerTool.addEventListener('click', () => setBrush('marker'));
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
    const deltaY = clampValue(event.deltaY, -WHEEL_DELTA_MAX, WHEEL_DELTA_MAX);
    const factor = Math.exp(-deltaY * 0.0012);
    setZoom(state.camera.targetZoom * factor, point);
  },
  { passive: false }
);
app.addEventListener('pointermove', revealChrome);
app.addEventListener('pointerdown', revealChrome);
app.addEventListener('touchstart', revealChrome, { passive: true });
app.addEventListener('focusin', revealChrome);
canvas.addEventListener('lostpointercapture', () => {
  if (state.pointerDown || state.pinch) {
    cancelPointerState();
  }
});
window.addEventListener('blur', cancelPointerState);
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
    brushId: state.brushId,
    playing: state.playing,
    spawn: { ...state.spawn },
    tracks: state.tracks.map((track) => ({
      id: track.id,
      brushId: track.brushId,
      lineType: track.lineType,
      rideable: track.rideable,
      collidable: track.collidable,
      points: track.points.length,
      length: totalLength(track.points),
      limited: track.limited,
      rawPointCount: track.rawPointCount,
      preLimitPointCount: track.preLimitPointCount,
      renderSampleCount: track.renderSampleCount,
      renderUnitCount: track.renderUnitCount,
      materialCanvasScale: track.materialCanvasScale,
      buildMs: track.buildMs,
      render: { ...track.material.metrics },
      watercolor: { ...track.material.metrics }
    })),
    brushes: Object.values(BRUSHES).map((brush) => ({
      id: brush.id,
      label: brush.label,
      lineType: brush.lineType,
      rideable: brush.rideable,
      collidable: brush.collidable
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
    renderDynamics: { ...state.material },
    watercolorDynamics: { ...state.material },
    limits: {
      maxTrackPoints: MAX_TRACK_POINTS,
      maxTracks: MAX_TRACKS,
      maxHistory: MAX_HISTORY,
      maxRenderSamples: MAX_RENDER_SAMPLES,
      maxMaterialCanvasPixels: MAX_MATERIAL_CANVAS_PIXELS,
      metricsCacheMs: METRICS_CACHE_MS,
      materialCanvasRefreshMs: MATERIAL_CANVAS_REFRESH_MS
    },
    performance: {
      ...state.performance,
      renderMetricRecomputes: renderMetricsCache.stats().recomputes
    },
    recovery: { ...state.recovery },
    camera: { ...state.camera },
    render: getRenderMetrics(),
    watercolor: getRenderMetrics(),
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
