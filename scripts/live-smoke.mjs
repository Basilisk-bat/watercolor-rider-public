import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_URL = 'https://basilisk-bat.github.io/watercolor-rider-public/';

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    headed: false,
    screenshots: null,
    stress: false
  };

  for (const arg of argv) {
    if (arg === '--headed') {
      options.headed = true;
    } else if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length) || DEFAULT_URL;
    } else if (arg.startsWith('--screenshots=')) {
      options.screenshots = arg.slice('--screenshots='.length) || null;
    } else if (arg === '--stress') {
      options.stress = true;
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
      brushId: state.brushId,
      brushes: state.brushes,
      tracks: state.tracks,
      spawn: state.spawn,
      camera: state.camera,
      limits: state.limits,
      performance: state.performance,
      recovery: state.recovery,
      dataset: app ? { ...app.dataset } : {},
      render: state.render,
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

function stressStroke(count, width = 1280, height = 720) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    return {
      x: 70 + t * (width - 140),
      y: height * 0.5 + Math.sin(index * 0.42) * 90 + Math.sin(index * 0.071) * 34
    };
  });
}

async function drawBrushStroke(page, canvasBox, rowOffset = 0) {
  const startX = canvasBox.x + canvasBox.width * 0.18;
  const startY = canvasBox.y + canvasBox.height * (0.27 + rowOffset);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 5; i += 1) {
    await page.mouse.move(startX + i * 44, startY + Math.sin(i * 0.9) * 18, { steps: 4 });
  }
  await page.mouse.up();
  await page.waitForTimeout(140);
}

async function runStressChecks(page) {
  await page.evaluate(() => window.RPK_RIDER.pause());
  await page.waitForTimeout(80);
  const brushSamples = await page.evaluate(async (samples) => {
    const results = [];
    for (const sample of samples) {
      const track = window.RPK_RIDER.addTrack(sample.points, { brushId: sample.brushId });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const state = window.RPK_RIDER.getState();
      results.push({
        requested: sample.brushId,
        accepted: Boolean(track),
        returned: track
          ? {
              brushId: track.brushId,
              lineType: track.lineType,
              rideable: track.rideable,
              collidable: track.collidable
            }
          : null,
        lastTrack: state.tracks.at(-1)
      });
    }
    return results;
  }, [
    { brushId: 'watercolor', points: stressStroke(90, 880, 420) },
    {
      brushId: 'pencil',
      points: stressStroke(90, 880, 420).map((point) => ({ x: point.x, y: point.y + 74 }))
    },
    {
      brushId: 'marker',
      points: stressStroke(90, 880, 420).map((point) => ({ x: point.x, y: point.y + 148 }))
    }
  ]);
  const expectedLineTypes = { watercolor: 0, marker: 1, pencil: 2 };
  const expectedCollidable = { watercolor: true, marker: true, pencil: false };
  for (const result of brushSamples) {
    assert(result.accepted, `${result.requested} sample stroke should be accepted`);
    assert(result.returned?.brushId === result.requested, `${result.requested} returned brush metadata should match`);
    assert(result.returned?.lineType === expectedLineTypes[result.requested], `${result.requested} should use native line type`);
    assert(result.returned?.collidable === expectedCollidable[result.requested], `${result.requested} collidable flag should match`);
    assert(result.lastTrack?.brushId === result.requested, `${result.requested} state metadata should match`);
  }

  const stress = await page.evaluate(async (strokes) => {
    const results = [];
    for (const points of strokes) {
      const startedAt = performance.now();
      const track = window.RPK_RIDER.addTrack(points);
      const afterAdd = performance.now();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const afterRender = performance.now();
      const state = window.RPK_RIDER.getState();
      results.push({
        rawPoints: points.length,
        accepted: Boolean(track),
        addMs: afterAdd - startedAt,
        twoFrameMs: afterRender - afterAdd,
        trackCount: state.tracks.length,
        engineLines: state.engine.lines,
        lastTrack: state.tracks.at(-1),
        performance: state.performance,
        limits: state.limits
      });
    }
    return results;
  }, [stressStroke(120), stressStroke(600), stressStroke(1400), stressStroke(2600)]);

  for (const result of stress) {
    assert(result.accepted, `Stress stroke ${result.rawPoints} should be accepted`);
    assert(result.lastTrack.brushId === 'watercolor', 'Stress stroke should default to watercolor brush');
    assert(result.lastTrack.lineType === 0, 'Stress stroke should default to solid line type');
    assert(result.lastTrack.points <= result.limits.maxTrackPoints, 'Stress stroke should be capped to max track points');
    assert(
      result.lastTrack.render.renderSampleCount <= result.limits.maxRenderSamples,
      'Stress stroke material samples should stay under render sample cap'
    );
    assert(result.engineLines <= result.limits.maxTrackPoints * result.limits.maxTracks, 'Engine line count should remain bounded');
  }

  const frameBudget = await page.evaluate(async () => {
    window.RPK_RIDER.play();
    const samples = [];
    const until = performance.now() + 1800;
    while (performance.now() < until) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(window.RPK_RIDER.getState().performance.lastFrameMs);
    }
    window.RPK_RIDER.pause();
    samples.sort((a, b) => a - b);
    const state = window.RPK_RIDER.getState();
    return {
      targetFrameMs: 1000 / 60,
      frames: samples.length,
      p95FrameMs: samples[Math.floor(samples.length * 0.95)] ?? 0,
      maxSampledFrameMs: samples.at(-1) ?? 0,
      p95FrameWorkFps: samples.length > 0 ? 1000 / Math.max(0.001, samples[Math.floor(samples.length * 0.95)] ?? 0) : 0,
      appWorstFrameMs: state.performance.worstFrameMs,
      lastFrameMs: state.performance.lastFrameMs
    };
  });
  assert(frameBudget.frames >= 20, `Stress frame sampler should collect enough frame-work samples: ${JSON.stringify(frameBudget)}`);
  assert(
    frameBudget.p95FrameMs <= frameBudget.targetFrameMs,
    `Stress frame work should stay within 60fps budget: ${JSON.stringify(frameBudget)}`
  );
  assert(
    frameBudget.p95FrameWorkFps >= 60,
    `Stress frame work should estimate above 60fps: ${JSON.stringify(frameBudget)}`
  );

  const eraser = await page.evaluate(() => {
    const before = window.RPK_RIDER.getState();
    for (let i = 0; i < 24; i += 1) {
      window.RPK_RIDER.eraseAt({ x: 160 + i * 38, y: 360 + Math.sin(i * 0.5) * 70 });
    }
    const after = window.RPK_RIDER.getState();
    return {
      beforeTracks: before.tracks.length,
      afterTracks: after.tracks.length,
      limits: after.limits,
      engineLines: after.engine.lines
    };
  });
  assert(eraser.afterTracks <= eraser.limits.maxTracks, 'Eraser sweep should not fragment past max tracks');
  assert(eraser.engineLines <= eraser.limits.maxTrackPoints * eraser.limits.maxTracks, 'Eraser sweep should keep engine lines bounded');

  await page.click('#menuToggle');
  await page.click('#resetTool');
  await page.waitForTimeout(100);
  const postStressReset = await readState(page, 'stress-post-reset');
  assert(postStressReset.playing === false, 'Reset should respond after stress strokes');

  await page.click('#menuToggle');
  await page.click('#clearTool');
  await page.waitForTimeout(120);
  const postStressClear = await readState(page, 'stress-post-clear');
  assert(postStressClear.playing === false, 'Clear should leave playback stopped after stress strokes');
  assert(postStressClear.trackCount === 0, 'Clear should remove stress tracks before play/pause control check');

  await page.click('#playTool');
  await page.waitForTimeout(160);
  const responsivePlay = await readState(page, 'stress-responsive-play');
  assert(
    responsivePlay.playing === true,
    `Ride button should remain responsive after stress strokes: ${JSON.stringify({
      playing: responsivePlay.playing,
      status: responsivePlay.dataset.status,
      recovery: responsivePlay.recovery,
      frame: responsivePlay.frame,
      trackCount: responsivePlay.trackCount,
      engineLines: responsivePlay.tracks?.length
    })}`
  );
  await page.click('#playTool');
  await page.waitForTimeout(80);
  const responsivePause = await readState(page, 'stress-responsive-pause');
  assert(responsivePause.playing === false, 'Pause button should remain responsive after stress strokes');

  const recovery = await page.evaluate(async () => {
    window.RPK_RIDER.spawnAt({ x: -5000, y: 5000 });
    window.RPK_RIDER.play();
    await new Promise((resolve) => setTimeout(resolve, 220));
    return window.RPK_RIDER.getState();
  });
  assert(recovery.playing === false, 'Out-of-bounds rider should auto-pause playback');
  assert(recovery.recovery?.autoPaused === true, 'Out-of-bounds rider should expose recovery auto-pause state');
  assert(recovery.recovery?.reason === 'out-of-bounds', 'Out-of-bounds recovery reason should be recorded');
  assert(recovery.recovery?.status === 'rinse', 'Out-of-bounds recovery should set rinse status');

  await page.click('#menuToggle');
  await page.click('#resetTool');
  await page.waitForTimeout(100);
  const reset = await readState(page, 'stress-reset');
  assert(reset.playing === false, 'Reset should remain responsive after recovery pause');

  return {
    brushSamples,
    strokes: stress,
    eraser,
    frameBudget,
    recovery: {
      reason: recovery.recovery?.reason,
      status: recovery.recovery?.status,
      autoPaused: recovery.recovery?.autoPaused
    },
    postStressReset,
    postStressClear,
    reset
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const consoleEvents = [];
  const pageErrors = [];
  const badResponses = [];
  const states = {};
  const screenshots = {};
  let stress = null;
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
    assert(states.initial.brushId === 'watercolor', 'Initial brush should be watercolor');
    assert(states.initial.trackCount >= 1, 'Starter track should be present');
    assert(states.initial.render?.renderSampleCount > 0, 'Rendered material metrics should be live');

    await page.click('#menuToggle');
    const canvasBox = await page.locator('#game').boundingBox();
    assert(canvasBox, 'Canvas should have a visible bounding box');

    const brushExpectations = {
      watercolor: { lineType: 0, collidable: true },
      pencil: { lineType: 2, collidable: false },
      marker: { lineType: 1, collidable: true }
    };
    for (const [index, brushId] of ['watercolor', 'pencil', 'marker'].entries()) {
      await page.click(`#${brushId}Tool`);
      states[`tool-${brushId}`] = await readState(page, `tool-${brushId}`);
      assert(states[`tool-${brushId}`].mode === 'draw', `${brushId} should keep draw mode active`);
      assert(states[`tool-${brushId}`].brushId === brushId, `${brushId} button should select its brush`);
      assert(states[`tool-${brushId}`].dataset.brush === brushId, `${brushId} dataset should reflect selected brush`);

      await drawBrushStroke(page, canvasBox, index * 0.09);
      states[`stroke-${brushId}`] = await readState(page, `stroke-${brushId}`);
      const lastTrack = states[`stroke-${brushId}`].tracks.at(-1);
      assert(lastTrack?.brushId === brushId, `${brushId} stroke should record brush metadata`);
      assert(lastTrack?.lineType === brushExpectations[brushId].lineType, `${brushId} stroke should use native line type`);
      assert(
        lastTrack?.collidable === brushExpectations[brushId].collidable,
        `${brushId} stroke should expose collidable metadata`
      );
    }

    await page.click('#eraseTool');
    states.erase = await readState(page, 'erase');
    assert(states.erase.mode === 'erase', 'Eraser button should switch to erase mode');

    await page.click('#watercolorTool');
    states.watercolor = await readState(page, 'watercolor');
    assert(states.watercolor.mode === 'draw', 'Watercolor button should switch back to draw mode');
    assert(states.watercolor.brushId === 'watercolor', 'Watercolor button should restore watercolor brush');

    await page.click('#menuToggle');
    await page.click('#menuSpawn');
    states.spawnArmed = await readState(page, 'spawn-armed');
    assert(states.spawnArmed.spawn?.active === true, 'Spawn Rider should arm one-shot spawn mode');

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
    assert(states.debug.dataset.trails === String(states.debug.render.trailCount), 'Diagnostics trails should match state metrics');
    screenshots.desktop = await maybeScreenshot(page, options.screenshots, 'desktop');

    await page.setViewportSize({ width: 390, height: 720 });
    await page.waitForTimeout(260);
    states.mobile = await readState(page, 'mobile');
    assert(states.mobile.viewport.overflowX === 0, 'Mobile viewport should not overflow horizontally');
    assert(Number(states.mobile.dataset.rewets) > 0, 'Rider contact should add render rewet marks');
    screenshots.mobile = await maybeScreenshot(page, options.screenshots, 'mobile');

    if (options.stress) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.waitForTimeout(120);
      stress = await runStressChecks(page);
      states.stressFinal = await readState(page, 'stress-final');
      assert(states.stressFinal.viewport.overflowX === 0, 'Stress final viewport should not overflow horizontally');
    }

    assertNoBrowserFailures({ consoleEvents, pageErrors, badResponses });

    console.log(
      JSON.stringify(
        {
          url: options.url,
          states,
          stress,
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
