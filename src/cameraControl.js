export function createCameraState(overrides = {}) {
  const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
    minZoom: 0.35,
    maxZoom: 2.25,
    ...overrides
  };

  camera.targetX ??= camera.x;
  camera.targetY ??= camera.y;
  camera.targetZoom ??= camera.zoom;
  return camera;
}

export function clampZoom(camera, zoom) {
  return Math.min(camera.maxZoom, Math.max(camera.minZoom, zoom));
}

export function screenToWorld(camera, point, useTarget = false) {
  const zoom = useTarget ? camera.targetZoom : camera.zoom;
  const x = useTarget ? camera.targetX : camera.x;
  const y = useTarget ? camera.targetY : camera.y;

  return {
    x: point.x / zoom + x,
    y: point.y / zoom + y
  };
}

export function worldToScreen(camera, point) {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom
  };
}

export function setCameraTargetZoom(camera, nextZoom, anchorScreen) {
  const before = screenToWorld(camera, anchorScreen, true);
  camera.targetZoom = clampZoom(camera, nextZoom);
  const after = screenToWorld(camera, anchorScreen, true);
  camera.targetX += before.x - after.x;
  camera.targetY += before.y - after.y;
  return camera;
}

export function focusCameraTarget(camera, worldPoint, viewport, xFactor = 0.38, yFactor = 0.44) {
  camera.targetX = worldPoint.x - (viewport.width / camera.targetZoom) * xFactor;
  camera.targetY = worldPoint.y - (viewport.height / camera.targetZoom) * yFactor;
  return camera;
}

export function stepCamera(camera, alpha = 0.16) {
  camera.x += (camera.targetX - camera.x) * alpha;
  camera.y += (camera.targetY - camera.y) * alpha;
  camera.zoom += (camera.targetZoom - camera.zoom) * alpha;

  if (Math.abs(camera.targetX - camera.x) < 0.001) {
    camera.x = camera.targetX;
  }
  if (Math.abs(camera.targetY - camera.y) < 0.001) {
    camera.y = camera.targetY;
  }
  if (Math.abs(camera.targetZoom - camera.zoom) < 0.0001) {
    camera.zoom = camera.targetZoom;
  }

  return camera;
}
