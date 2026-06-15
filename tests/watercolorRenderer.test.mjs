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

test('cached watercolor renderer avoids square grid-cell fills', () => {
  const renderer = extractFunction('createGlazeCanvas');

  assert.doesNotMatch(renderer, /fillRect\(px\s*-\s*1,\s*py\s*-\s*1,\s*glaze\.cellSize\s*\+\s*2/);
  assert.doesNotMatch(renderer, /fillRect\(px,\s*py,\s*glaze\.cellSize,\s*glaze\.cellSize/);
  assert.match(renderer, /fillSoftDot\(washCtx/);
  assert.match(renderer, /renderRunoffLayer\(runCtx,\s*glaze,\s*paletteColor\)/);
  assert.match(renderer, /drawImage\(wash,\s*0,\s*0\)/);
});

test('cached watercolor renderer breaks cell cadence with paper tooth and jitter', () => {
  const renderer = extractFunction('createGlazeCanvas');
  const runoff = extractFunction('renderRunoffLayer');
  const trackRenderer = extractFunction('renderTrack');

  assert.match(renderer, /latticeNoise\(x,\s*y,\s*101\)/);
  assert.match(renderer, /destination-out/);
  assert.match(renderer, /drawImage\(tooth,\s*0,\s*0\)/);
  assert.match(runoff, /const connected = above \|\| below \|\| side/);
  assert.match(runoff, /if \(!connected && strength < 0\.08\)/);
  assert.match(trackRenderer, /setLineDash/);
  assert.match(trackRenderer, /lineDashOffset/);
});
