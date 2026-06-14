import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = mainSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);

  const nextFunction = mainSource.indexOf('\nfunction ', start + 1);
  return mainSource.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('cached stroke material renderer is sampled instead of grid-simulated', () => {
  const renderer = extractFunction('createMaterialCanvas');

  assert.match(renderer, /material\.samples/);
  assert.match(renderer, /material\.trails/);
  assert.match(renderer, /material\.rewetMarks/);
  assert.doesNotMatch(renderer, /for \(let y = 0; y < .*height; y \+= 1\)/);
  assert.doesNotMatch(renderer, /for \(let x = 0; x < .*width; x \+= 1\)/);
  assert.doesNotMatch(renderer, /fillRect\(px,\s*py,\s*.*cellSize/);
});

test('runtime imports procedural material instead of watercolor simulation', () => {
  assert.match(mainSource, /createStrokeMaterial/);
  assert.match(mainSource, /rewetStrokeMaterialAtPoint/);
  assert.doesNotMatch(mainSource, /simulateWatercolorStroke/);
  assert.doesNotMatch(mainSource, /watercolorSim/);
});

test('track rendering draws scaled material canvas in world space', () => {
  const trackRenderer = extractFunction('renderTrack');

  assert.match(trackRenderer, /createMaterialCanvas\(track\.material/);
  assert.match(trackRenderer, /track\.material\.bounds\.x/);
  assert.match(trackRenderer, /track\.material\.bounds\.width/);
  assert.match(trackRenderer, /materialRebuilds/);
  assert.doesNotMatch(trackRenderer, /glaze/);
});
