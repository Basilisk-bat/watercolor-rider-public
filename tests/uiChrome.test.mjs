import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('menu-open state keeps the floating menu toggle reachable', () => {
  assert.doesNotMatch(styles, /#app\.menu-open\s+\.chrome-shell,\s*#app\.menu-open\s+\.status-strip\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(styles, /#app\.menu-open\s+\.chrome-shell\s*\{[^}]*z-index:\s*5/s);
  assert.match(styles, /#app\.menu-open\s+\.chrome-shell\s*\{[^}]*pointer-events:\s*auto/s);
});
