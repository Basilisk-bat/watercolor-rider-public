import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('menu-open state keeps the floating menu toggle reachable', () => {
  assert.doesNotMatch(styles, /#app\.menu-open\s+\.chrome-shell,\s*#app\.menu-open\s+\.status-strip\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(styles, /#app\.menu-open\s+\.chrome-shell\s*\{[^}]*z-index:\s*5/s);
  assert.match(styles, /#app\.menu-open\s+\.chrome-shell\s*\{[^}]*pointer-events:\s*auto/s);
});

test('mobile chrome remains compact over the watercolor canvas', () => {
  assert.match(styles, /#app\.debug-open\s+\.debug-drawer\s*\{[^}]*opacity:\s*1/s);
  assert.match(styles, /\.debug-drawer\s*\{[^}]*max-height:\s*min\(62vh,\s*430px\)/s);
  assert.match(styles, /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.chrome-shell\s*\{[^}]*width:\s*auto/s);
  assert.match(styles, /@media \(max-width:\s*430px\)\s*\{[\s\S]*?\.meters\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.meters\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
});

test('favicon is served from the Vite base path to avoid GitHub Pages root 404s', () => {
  assert.match(indexHtml, /<link rel="icon" type="image\/svg\+xml" href="%BASE_URL%favicon\.svg" \/>/);
  assert.match(favicon, /<svg[^>]+viewBox="0 0 64 64"/);
});

test('mouse-first brush controls expose bounded input and recovery hooks', () => {
  assert.match(indexHtml, /id="watercolorTool"/);
  assert.match(indexHtml, /id="pencilTool"/);
  assert.match(indexHtml, /id="markerTool"/);
  assert.match(indexHtml, /id="eraseTool"/);
  assert.doesNotMatch(indexHtml, /id="drawTool"/);
  assert.doesNotMatch(indexHtml, /Space rides/);
  assert.match(mainSource, /WHEEL_DELTA_MAX/);
  assert.match(mainSource, /RIDE_LINE_TYPES\.SOLID/);
  assert.match(mainSource, /RIDE_LINE_TYPES\.SCENERY/);
  assert.match(mainSource, /RIDE_LINE_TYPES\.ACC/);
  assert.match(mainSource, /brushId/);
  assert.doesNotMatch(mainSource, /window\.addEventListener\('keydown'/);
  assert.doesNotMatch(mainSource, /event\.key\.toLowerCase\(\) === 'b'/);
  assert.doesNotMatch(mainSource, /event\.key\.toLowerCase\(\) === 'e'/);
  assert.doesNotMatch(mainSource, /event\.key\.toLowerCase\(\) === 'r'/);
  assert.doesNotMatch(mainSource, /event\.code === 'Space'/);
  assert.match(mainSource, /lostpointercapture/);
  assert.match(mainSource, /window\.addEventListener\('blur',\s*cancelPointerState\)/);
  assert.match(mainSource, /limits:\s*\{/);
  assert.match(mainSource, /performance:\s*\{/);
  assert.match(mainSource, /recovery:\s*\{/);
});
