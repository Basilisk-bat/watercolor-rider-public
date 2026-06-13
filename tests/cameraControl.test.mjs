import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCameraState,
  screenToWorld,
  setCameraTargetZoom,
  stepCamera
} from '../src/cameraControl.js';

test('target zoom preserves the pointer anchor in world space', () => {
  const camera = createCameraState({ x: 100, y: 40, zoom: 1, targetX: 100, targetY: 40, targetZoom: 1 });
  const anchor = { x: 320, y: 180 };
  const before = screenToWorld(camera, anchor, true);

  setCameraTargetZoom(camera, 1.8, anchor);
  const after = screenToWorld(camera, anchor, true);

  assert.ok(Math.abs(before.x - after.x) < 0.0001);
  assert.ok(Math.abs(before.y - after.y) < 0.0001);
  assert.equal(camera.targetZoom, 1.8);
});

test('camera steps smoothly toward target without snapping immediately', () => {
  const camera = createCameraState({ x: 0, y: 0, zoom: 1, targetX: 100, targetY: 50, targetZoom: 2 });

  stepCamera(camera, 0.2);

  assert.equal(camera.x, 20);
  assert.equal(camera.y, 10);
  assert.equal(Math.round(camera.zoom * 100) / 100, 1.2);
  assert.notEqual(camera.x, camera.targetX);
  assert.notEqual(camera.zoom, camera.targetZoom);
});
