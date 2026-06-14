import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_URL = 'https://basilisk-bat.github.io/watercolor-rider-public/';

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    headed: false,
    screenshots: null
  };

  for (const arg of argv) {
    if (arg === '--headed') {
      options.headed = true;
    } else if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length) || DEFAULT_URL;
    } else if (arg.startsWith('--screenshots=')) {
      options.screenshots = arg.slice('--screenshots='.length) || null;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoBrowserFailures({ consoleEvents, pageErrors, badResponses }) {
  assert(consoleEvents.length === 0, `Browser console warnings/errors: ${JSON.stringify(consoleEvents)}`);
  assert(pageErrors.length === 0, `Page errors: ${JSON.stringify(pageErrors)}`);
  assert(badResponses.length === 0, `Failed network responses: ${JSON.stringify(badResponses)}`);
}

function cacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('smoke', String(Date.now()));
  return parsed.href;
}

async function readState(page, label) {
  return page.evaluate((stateLabel) => {
    const state = window.RPK_RIDER.getState();
    const app = document.querySelector('#app');
    return {
      label: stateLabel,
      mode: state.mode,
      playing: state.playing,
      frame: state.rider?.frame ?? state.engine?.frame ?? null,
      speed: state.metrics?.speed ?? state.rider?.speed ?? null,
      trackCount: state.tracks?.length ?? null,
      spawn: state.spawn,
      camera: state.camera,
      dataset: app ? { ...app.dataset } : {},
      watercolor: state.watercolor,
      viewport: {
        innerWidth,
        innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      }
    };
  }, label);
}

async function maybeScreenshot(page, screenshots, name) {
  if (!screenshots) {
    return null;
  }

  await mkdir(screenshots, { recursive: true });
  const screenshotPath = path.join(screenshots, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const consoleEvents = [];
  const pageErrors = [];
  const badResponses = [];
  const states = {};
  const screenshots = {};
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !options.headed
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    page.on('console', (message) => {
      if (['error', 'warning', 'warn'].includes(message.type())) {
        consoleEvents.push({ type: message.type(), text: message.text() });
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(String(error.message || error));
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        badResponses.push({ status: response.status(), url: response.url() });
      }
    });

    await page.goto(cacheBust(options.url), { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('#game', { timeout: 20000 });
    await page.waitForFunction(() => Boolean(window.RPK_RIDER?.getState), null, { timeout: 20000 });

    states.initial = await readState(page, 'initial');
    assert(states.initial.mode === 'draw', 'Initial mode should be draw');
    assert(states.initial.trackCount >= 1, 'Starter track should be present');
    assert(states.initial.watercolor?.runoffCellCount > 0, 'Watercolor runoff metrics should be live');

    await page.click('#menuToggle');
    await page.click('#eraseTool');
    states.erase = await readState(page, 'erase');
    assert(states.erase.mode === 'erase', 'Eraser button should switch to erase mode');

    await page.click('#drawTool');
    states.draw = await readState(page, 'draw');
    assert(states.draw.mode === 'draw', 'Brush button should switch to draw mode');

    await page.click('#menuToggle');
    await page.click('#menuSpawn');
    states.spawnArmed = await readState(page, 'spawn-armed');
    assert(states.spawnArmed.spawn?.active === true, 'Spawn Rider should arm one-shot spawn mode');

    const canvasBox = await page.locator('#game').boundingBox();
    assert(canvasBox, 'Canvas should have a visible bounding box');
    await page.mouse.click(canvasBox.x + canvasBox.width * 0.28, canvasBox.y + canvasBox.height * 0.44);
    await page.waitForTimeout(180);
    states.spawnPlaced = await readState(page, 'spawn-placed');
    assert(states.spawnPlaced.spawn?.active === false, 'Spawn mode should exit after canvas placement');
    assert(states.spawnPlaced.spawn?.start, 'Spawn placement should set a rider start point');

    await page.click('#playTool');
    await page.waitForTimeout(700);
    states.ride = await readState(page, 'ride');
    assert(states.ride.playing === true, 'Ride/Pause should start playback');
    assert(states.ride.frame > states.spawnPlaced.frame, 'Ride frame should advance after playback starts');
    assert(Number(states.ride.dataset.speed) > 0, 'Ride telemetry speed should be positive');

    await page.mouse.move(canvasBox.x + canvasBox.width * 0.56, canvasBox.y + canvasBox.height * 0.54);
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(300);
    states.zoom = await readState(page, 'zoom');
    assert(states.zoom.camera.targetZoom > states.ride.camera.targetZoom, 'Wheel zoom should increase camera target zoom');
    assert(states.zoom.camera.zoom > states.ride.camera.zoom, 'Camera zoom should move toward the target');

    await page.click('#menuToggle');
    await page.click('#debugToggle');
    await page.waitForTimeout(120);
    states.debug = await readState(page, 'debug');
    assert(states.debug.dataset.debugOpen === 'true', 'Diagnostics should open from the menu');
    assert(states.debug.dataset.runoff === String(states.debug.watercolor.runoffCellCount), 'Diagnostics runoff should match state metrics');
    screenshots.desktop = await maybeScreenshot(page, options.screenshots, 'desktop');

    await page.setViewportSize({ width: 390, height: 720 });
    await page.waitForTimeout(260);
    states.mobile = await readState(page, 'mobile');
    assert(states.mobile.viewport.overflowX === 0, 'Mobile viewport should not overflow horizontally');
    assert(Number(states.mobile.dataset.bleeds) > 0, 'Rider contact should rewet watercolor and increment bleed telemetry');
    screenshots.mobile = await maybeScreenshot(page, options.screenshots, 'mobile');

    assertNoBrowserFailures({ consoleEvents, pageErrors, badResponses });

    console.log(
      JSON.stringify(
        {
          url: options.url,
          states,
          screenshots,
          consoleEvents,
          pageErrors,
          badResponses
        },
        null,
        2
      )
    );
    console.log('\nLive browser smoke passed.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`\nLive browser smoke failed: ${error.message}`);
  process.exitCode = 1;
});
