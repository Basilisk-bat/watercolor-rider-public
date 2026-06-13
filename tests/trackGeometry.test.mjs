import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chaikinSmooth,
  distanceToSegment,
  nearestDistanceToPolyline,
  pointsToSegments,
  simplifyPoints,
  totalLength
} from '../src/trackGeometry.js';

test('simplifyPoints preserves endpoints while dropping tiny moves', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 12, y: 1 }
  ];

  const simplified = simplifyPoints(points, 5);

  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified.at(-1), points.at(-1));
  assert.equal(simplified.length, 2);
});

test('chaikinSmooth keeps endpoints and increases detail', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 20, y: 0 }
  ];

  const smoothed = chaikinSmooth(points, 2);

  assert.deepEqual(smoothed[0], points[0]);
  assert.deepEqual(smoothed.at(-1), points.at(-1));
  assert.ok(smoothed.length > points.length);
});

test('pointsToSegments creates physics-ready segments', () => {
  const segments = pointsToSegments(
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 }
    ],
    12
  );

  assert.equal(segments.length, 2);
  assert.equal(segments[0].x, 10);
  assert.equal(segments[0].y, 0);
  assert.equal(segments[0].length, 20);
  assert.equal(segments[0].thickness, 12);
  assert.equal(Math.round(segments[1].angle * 100) / 100, Math.round((Math.PI / 2) * 100) / 100);
});

test('polyline distance supports eraser targeting', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ];

  assert.equal(distanceToSegment({ x: 50, y: 7 }, points[0], points[1]), 7);
  assert.equal(nearestDistanceToPolyline({ x: 95, y: 65 }, points), 5);
});

test('totalLength sums adjacent segment distances', () => {
  const length = totalLength([
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: 6, y: 8 }
  ]);

  assert.equal(length, 10);
});
