# Watercolor Rider

A cozy minimalist browser toy inspired by line rider: paint soft ink rails, then send a tiny rider through the watercolor wash.

## Play in browser

[Launch Watercolor Rider](https://basilisk-bat.github.io/watercolor-rider-public/)

## Play

- Brush and erase rails directly on the canvas.
- Use the floating dock for Menu, Brush, Eraser, and Ride/Pause.
- Use the menu for Spawn Rider, Reset Rider, Undo, Clear, Diagnostics, and Help.
- Zoom with mouse wheel, trackpad, or pinch gestures.
- Open diagnostics for speed, air time, ink, zoom, wetness, pigment mass, runoff, and ride status.

## Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm run test
npm run build
npm audit --audit-level=high
npm run release:check
npm run release:check -- --live
npm run release:pages
```

The Line Rider adapter lives in `src/ridePhysics.js`, with focused coverage in `tests/ridePhysics.test.mjs`. Camera smoothing, track erasing, and watercolor behavior are covered in their matching test files under `tests/`.

Release and Pages operations are documented in `docs/release-runbook.md`.
