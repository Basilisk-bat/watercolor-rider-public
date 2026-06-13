import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');

test('menu-open state keeps the floating menu toggle reachable', () => {
  assert.doesNotMatch(styles, /#app\.menu-open\s+\.chrome-shell,\s*#app\.menu-open\s+\.status-strip\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(styles, /#app\.menu-open\s+\.chrome-shell\s*\{[^}]*z-index:\s*5/s);
  assert.match(styles, /#app\.menu-open\s+\.chrome-shell\s*\{[^}]*pointer-events:\s*auto/s);
});

test('favicon is served from the Vite base path to avoid GitHub Pages root 404s', () => {
  assert.match(indexHtml, /<link rel="icon" type="image\/svg\+xml" href="%BASE_URL%favicon\.svg" \/>/);
  assert.match(favicon, /<svg[^>]+viewBox="0 0 64 64"/);
});
