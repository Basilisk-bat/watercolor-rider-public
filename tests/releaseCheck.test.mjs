import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssetsUseExpectedBase,
  hashAssetBuffer,
  parseArgs,
  parseHtmlAssets
} from '../scripts/release-check.mjs';

const pagesHtml = `
  <link rel="icon" type="image/svg+xml" href="/watercolor-rider-public/favicon.svg" />
  <script type="module" crossorigin src="/watercolor-rider-public/assets/index-BWSD7DH6.js"></script>
  <link rel="stylesheet" crossorigin href="/watercolor-rider-public/assets/index-CmzlBpab.css">
`;

test('pages option configures live URL and GitHub Pages base', () => {
  assert.deepEqual(parseArgs(['--pages']), {
    liveUrl: 'https://basilisk-bat.github.io/watercolor-rider-public/',
    skipLocal: false,
    buildBase: '/watercolor-rider-public/',
    expectedBase: '/watercolor-rider-public/'
  });
});

test('build-base becomes the expected asset base unless overridden', () => {
  assert.deepEqual(parseArgs(['--build-base=/demo/', '--expected-base=/play/']), {
    liveUrl: null,
    skipLocal: false,
    buildBase: '/demo/',
    expectedBase: '/play/'
  });
  assert.equal(parseArgs(['--build-base=/demo/']).expectedBase, '/demo/');
});

test('release check parses Vite asset references from generated HTML', () => {
  assert.deepEqual(parseHtmlAssets(pagesHtml, 'fixture'), {
    scriptPath: '/watercolor-rider-public/assets/index-BWSD7DH6.js',
    stylePath: '/watercolor-rider-public/assets/index-CmzlBpab.css',
    faviconPath: '/watercolor-rider-public/favicon.svg'
  });
});

test('release check rejects wrong GitHub Pages asset base paths', () => {
  const assets = parseHtmlAssets(pagesHtml, 'fixture');

  assert.doesNotThrow(() => assertAssetsUseExpectedBase(assets, '/watercolor-rider-public/', 'fixture'));
  assert.throws(
    () => assertAssetsUseExpectedBase(assets, '/wrong-base/', 'fixture'),
    /does not use expected base/
  );
});

test('release check normalizes SVG line endings before hashing', () => {
  const lf = Buffer.from('<svg viewBox="0 0 1 1">\n  <path d="M0 0"/>\n</svg>\n');
  const crlf = Buffer.from('<svg viewBox="0 0 1 1">\r\n  <path d="M0 0"/>\r\n</svg>\r\n');

  assert.equal(hashAssetBuffer(crlf, '/watercolor-rider-public/favicon.svg'), hashAssetBuffer(lf, '/watercolor-rider-public/favicon.svg'));
  assert.notEqual(hashAssetBuffer(crlf, '/watercolor-rider-public/assets/index-demo.js'), hashAssetBuffer(lf, '/watercolor-rider-public/assets/index-demo.js'));
});
