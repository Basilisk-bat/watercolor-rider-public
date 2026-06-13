import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const DEFAULT_LIVE_URL = 'https://basilisk-bat.github.io/watercolor-rider-public/';
const DEFAULT_PAGES_BASE = '/watercolor-rider-public/';

export function parseArgs(argv) {
  const options = {
    liveUrl: null,
    skipLocal: false,
    buildBase: null,
    expectedBase: null
  };

  for (const arg of argv) {
    if (arg === '--live') {
      options.liveUrl = DEFAULT_LIVE_URL;
    } else if (arg.startsWith('--live=')) {
      options.liveUrl = arg.slice('--live='.length) || DEFAULT_LIVE_URL;
    } else if (arg === '--pages') {
      options.liveUrl = DEFAULT_LIVE_URL;
      options.buildBase = DEFAULT_PAGES_BASE;
      options.expectedBase = DEFAULT_PAGES_BASE;
    } else if (arg.startsWith('--build-base=')) {
      options.buildBase = arg.slice('--build-base='.length);
      options.expectedBase ??= options.buildBase;
    } else if (arg.startsWith('--expected-base=')) {
      options.expectedBase = arg.slice('--expected-base='.length);
    } else if (arg === '--skip-local') {
      options.skipLocal = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function run(command, args, label = [command, ...args].join(' ')) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} exited with ${result.status ?? 'no status'}`);
  }
}

function quoteCmdArg(arg) {
  if (/^[A-Za-z0-9_:/=.-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runNpm(args) {
  const label = ['npm', ...args].join(' ');

  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, ...args], label);
    return;
  }

  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', ['npm', ...args].map(quoteCmdArg).join(' ')], label);
    return;
  }

  run('npm', args, label);
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'cache-control': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function withCacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('releaseCheck', String(Date.now()));
  return parsed;
}

export function findAsset(html, pattern, label) {
  const match = html.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not find ${label} in live HTML`);
  }
  return match[1];
}

export function parseHtmlAssets(html, sourceLabel) {
  return {
    scriptPath: findAsset(html, /<script[^>]+src="([^"]*assets\/index-[^"]+\.js)"/, `${sourceLabel} JavaScript asset`),
    stylePath: findAsset(html, /<link[^>]+href="([^"]*assets\/index-[^"]+\.css)"/, `${sourceLabel} CSS asset`),
    faviconPath: findAsset(html, /<link[^>]+href="([^"]*favicon\.svg)"/, `${sourceLabel} favicon`)
  };
}

export function assertExpectedBase(assetPath, expectedBase, sourceLabel) {
  if (!expectedBase || assetPath.startsWith('http')) {
    return;
  }

  if (!assetPath.startsWith(expectedBase)) {
    throw new Error(`${sourceLabel} asset ${assetPath} does not use expected base ${expectedBase}`);
  }
}

export function assertAssetsUseExpectedBase(assets, expectedBase, sourceLabel) {
  for (const assetPath of Object.values(assets)) {
    assertExpectedBase(assetPath, expectedBase, sourceLabel);
  }
}

async function compareLiveAsset(liveBase, assetPath, localPath) {
  const remoteUrl = new URL(assetPath, liveBase);
  const remoteHash = hashBuffer(await fetchBytes(remoteUrl));
  const localHash = hashBuffer(await readFile(localPath));

  if (remoteHash !== localHash) {
    throw new Error(`${assetPath} hash mismatch: live ${remoteHash}, local ${localHash}`);
  }

  return { assetPath, remoteUrl: remoteUrl.href, hash: remoteHash };
}

async function checkLocalHtml(expectedBase) {
  if (!expectedBase) {
    return null;
  }

  const html = await readFile(path.join('dist', 'index.html'), 'utf8');
  const assets = parseHtmlAssets(html, 'local dist');
  assertAssetsUseExpectedBase(assets, expectedBase, 'local dist');

  console.log(`\nLocal dist index uses expected base ${expectedBase}`);
  return assets;
}

async function checkLive(url, expectedBase) {
  const liveBase = new URL(url);
  const html = (await fetchBytes(withCacheBust(liveBase))).toString('utf8');
  const { scriptPath, stylePath, faviconPath } = parseHtmlAssets(html, 'live');
  assertAssetsUseExpectedBase({ scriptPath, stylePath, faviconPath }, expectedBase, 'live');
  const checks = [
    await compareLiveAsset(liveBase, scriptPath, path.join('dist', 'assets', path.basename(scriptPath))),
    await compareLiveAsset(liveBase, stylePath, path.join('dist', 'assets', path.basename(stylePath))),
    await compareLiveAsset(liveBase, faviconPath, path.join('dist', 'favicon.svg'))
  ];

  console.log('\nLive asset hashes match local dist:');
  for (const check of checks) {
    console.log(`- ${check.assetPath} ${check.hash.slice(0, 12)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.skipLocal) {
    runNpm(['run', 'test']);
    runNpm(options.buildBase ? ['run', 'build', '--', '--base', options.buildBase] : ['run', 'build']);
    runNpm(['audit', '--audit-level=high']);
    runNpm(['audit', '--omit=dev']);
    await checkLocalHtml(options.expectedBase);
  }

  if (options.liveUrl) {
    await checkLive(options.liveUrl, options.expectedBase);
  }

  console.log('\nRelease check passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nRelease check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
