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
  ENGINE_FPS,
  createRideWorld,
  getRideTelemetry,
  resetRide,
  setRideTracks,
  stepRide
} from './ridePhysics.js';

createIcons({ icons });

const canvas = document.querySelector('#game');
const app = document.querySelector('#app');
const ctx = canvas.getContext('2d', { alpha: false });
const mainMenu = document.querySelector('#mainMenu');
const menuToggle = document.querySelector('#menuToggle');
const menuStart = document.querySelector('#menuStart');
const menuReset = document.querySelector('#menuReset');
const menuHelp = document.querySelector('#menuHelp');
const menuHelpPanel = document.querySelector('#menuHelpPanel');
const menuClose = document.querySelector('#menuClose');
const drawTool = document.querySelector('#drawTool');
const eraseTool = document.querySelector('#eraseTool');
const playTool = document.querySelector('#playTool');
const resetTool = document.querySelector('#resetTool');
const zoomOutTool = document.querySelector('#zoomOutTool');
const zoomInTool = document.querySelector('#zoomInTool');
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
const debugMass = document.querySelector('[data-diagnostic="mass"]');

const CHROME_IDLE_MS = 2200;
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
  pointer: null,
  currentStroke: [],
  tracks: [],
  history: [],
  rideWorld: createRideWorld(),
  rider: null,
  paperPattern: null,
  dpr: 1,
  width: 0,
  height: 0,
  seeded: false,
  camera: {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.45,
    maxZoom: 1.8
  },
  metrics: {
    startX: 0,
    bestDistance: 0,
    currentAir: 0,
    longestAir: 0,
    topSpeed: 0,
    inkLength: 0,
    strokeCount: 0,
    resets: 0
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

function updateDebugDiagnostics() {
  if (debugStatus) {
    debugStatus.textContent = statusStrip.textContent;
  }
  if (debugZoom) {
    debugZoom.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  }
  if (debugWetness) {
    const wetness = state.currentStroke.length > 1 ? 86 : Math.min(72, Math.round(state.tracks.length * 9));
    debugWetness.textContent = `${wetness}%`;
  }
  if (debugMass) {
    const mass = state.tracks.reduce((sum, track) => sum + Math.max(0, track.points.length - 1), 0);
    debugMass.textContent = String(mass);
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
  app.dataset.zoom = String(Math.round(state.camera.zoom * 100) / 100);
  updateDebugDiagnostics();
}

function modeStatus() {
  return state.mode === 'draw' ? 'brush' : 'erase';
}

function setStatus(status) {
  statusStrip.textContent = status;
  publishTelemetry();
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
  return {
    x: point.x / state.camera.zoom + state.camera.x,
    y: point.y / state.camera.zoom + state.camera.y
  };
}

function worldToScreen(point) {
  return {
    x: (point.x - state.camera.x) * state.camera.zoom,
    y: (point.y - state.camera.y) * state.camera.zoom
  };
}

function setZoom(nextZoom, anchorScreen = { x: state.width / 2, y: state.height / 2 }) {
  const before = screenToWorld(anchorScreen);
  state.camera.zoom = Math.min(state.camera.maxZoom, Math.max(state.camera.minZoom, nextZoom));
  const after = screenToWorld(anchorScreen);
  state.camera.x += before.x - after.x;
  state.camera.y += before.y - after.y;
  publishTelemetry();
}

function followRider() {
  if (!state.rider || !state.playing) {
    return;
  }

  const visibleWidth = state.width / state.camera.zoom;
  const visibleHeight = state.height / state.camera.zoom;
  const targetX = state.rider.position.x - visibleWidth * 0.38;
  const targetY = state.rider.position.y - visibleHeight * 0.44;
  state.camera.x += (targetX - state.camera.x) * 0.08;
  state.camera.y += (targetY - state.camera.y) * 0.08;
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

function buildWatercolorLayers(points, seed) {
  const layers = [];
  const random = mulberry32(seed);

  for (let layer = 0; layer < 18; layer += 1) {
    const spread = 2.2 + layer * 1.75;
    const edgeBias = layer / 17;
    layers.push({
      points: points.map((point) => ({
        x: point.x + (random() - 0.5) * spread,
        y: point.y + (random() - 0.5) * spread
      })),
      alpha: 0.18 - edgeBias * 0.12,
      widthBoost: 16 - layer * 0.52,
      blur: layer < 9 ? 0.35 + edgeBias * 1.8 : 0,
      composite: layer < 11 ? 'multiply' : 'source-over'
    });
  }

  return layers;
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
  const track = {
    id,
    points,
    thickness: starter ? 12 : 10,
    palette: palette[paletteIndex],
    layers: buildWatercolorLayers(points, paletteIndex * 997 + state.tracks.length * 251 + 17)
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
  state.mode = mode;
  state.currentStroke = [];
  drawTool.classList.toggle('active', mode === 'draw');
  eraseTool.classList.toggle('active', mode === 'erase');
  canvas.classList.toggle('erase-mode', mode === 'erase');
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
  const start = startTrack?.points[0] ?? { x: state.width * 0.12, y: state.height * 0.28 };
  state.rider = resetRide(state.rideWorld, { x: start.x + 1, y: start.y - 5 });
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

function drawPath(points) {
  if (points.length < 2) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[i - 1];
    const mid = {
      x: (previous.x + current.x) / 2,
      y: (previous.y + current.y) / 2
    };
    ctx.quadraticCurveTo(previous.x, previous.y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function renderTrack(track) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.shadowColor = track.palette.wash;
  ctx.shadowBlur = 18;
  track.layers.forEach((layer, index) => {
    ctx.globalCompositeOperation = layer.composite;
    ctx.strokeStyle = index < 13 ? track.palette.wash : track.palette.ink;
    ctx.globalAlpha = Math.max(0.035, layer.alpha);
    ctx.lineWidth = track.thickness + layer.widthBoost;
    ctx.filter = layer.blur > 0 ? `blur(${layer.blur}px)` : 'none';
    drawPath(layer.points);
    ctx.stroke();
  });

  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = 'rgba(255, 250, 235, 0.72)';
  ctx.lineWidth = Math.max(8, track.thickness * 0.86);
  drawPath(track.points);
  ctx.stroke();

  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = track.palette.ink;
  ctx.lineWidth = Math.max(1.8, track.thickness * 0.2);
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
  ctx.shadowColor = 'rgba(52, 43, 34, 0.24)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

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
  ctx.lineWidth = 24;
  ctx.globalAlpha = 0.5;
  ctx.filter = 'blur(1.2px)';
  drawPath(state.currentStroke);
  ctx.stroke();

  ctx.filter = 'none';
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = 'rgba(36, 72, 96, 0.72)';
  ctx.lineWidth = 3;
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
  const point = screenToWorld(screenPoint(event));
  state.pointerDown = true;
  state.pointer = point;

  if (state.mode === 'erase') {
    eraseAt(point);
    return;
  }

  state.currentStroke = [point];
}

function onPointerMove(event) {
  const point = screenToWorld(screenPoint(event));
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
menuStart.addEventListener('click', () => {
  setMenuOpen(false);
  setPlaying(true);
});
menuReset.addEventListener('click', () => {
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
resetTool.addEventListener('click', () => {
  setPlaying(false);
  resetRider();
  setStatus(modeStatus());
});
zoomOutTool.addEventListener('click', () => setZoom(state.camera.zoom / 1.18));
zoomInTool.addEventListener('click', () => setZoom(state.camera.zoom * 1.18));
undoTool.addEventListener('click', undoStroke);
clearTool.addEventListener('click', clearCanvas);
debugToggle.addEventListener('click', () => setDebugOpen(!state.ui.debugOpen));
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
    setZoom(state.camera.zoom * factor, point);
  },
  { passive: false }
);
app.addEventListener('pointermove', revealChrome);
app.addEventListener('pointerdown', revealChrome);
app.addEventListener('touchstart', revealChrome, { passive: true });
app.addEventListener('focusin', revealChrome);
window.addEventListener('keydown', revealChrome);
window.addEventListener('resize', resize);

window.RPK_RIDER = {
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  reset: resetRider,
  clear: clearCanvas,
  addTrack,
  eraseAt,
  getState: () => ({
    mode: state.mode,
    playing: state.playing,
    tracks: state.tracks.map((track) => ({
      id: track.id,
      points: track.points.length,
      length: totalLength(track.points)
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
    camera: { ...state.camera },
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
