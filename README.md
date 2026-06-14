# Watercolor Rider

A cozy minimalist browser toy inspired by line rider: paint soft ink rails, then send a tiny rider through the watercolor wash.

## Play in browser

[Launch Watercolor Rider](https://basilisk-bat.github.io/watercolor-rider-public/)

## Play

- Draw with Watercolor, Pencil, or Marker directly on the canvas; cut rails with Eraser.
- Use the floating dock for Menu, brush tools, Eraser, and Ride/Pause.
- Use the menu for Spawn Rider, Reset Rider, Undo, Clear, Diagnostics, and Help.
- Zoom with mouse wheel, trackpad, or pinch gestures.
- Open diagnostics for speed, air time, ink, zoom, wetness, pigment mass, runoff, and ride status.

## Methodology Essay

Watercolor Rider treats motion as a conversation between line, pigment, and evidence. The rail begins as an ideal path: a clean proposal about balance, timing, and contact. Once the rider touches it, the wash answers back. Pigment blooms around grounded motion, faster contact lays down more moisture, and the visible stain becomes a record of pressure, recovery, hesitation, and speed. The effect is expressive, but it is not allowed to take over the rules. Line Rider physics remains the fixed ground; watercolor is layered as an interpretable surface that reveals the ride rather than replacing it.

That makes the project half toy and half method. A good run should look argued for: a route attempted, a surface resisted, a trace left behind, and enough telemetry to decide whether the feeling matches the mechanism. Beauty is welcome, but it has to survive inspection. If a wash looks lovely while breaking contact, timing, eraser cuts, zoom, or glide, it fails. If a physically correct ride feels dry and inert, the rendering has not done its job. The aim is a disciplined surface where playful accident, repeatable checks, and visible consequence keep teaching each other how to move.

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
npm run smoke:live
```

The Line Rider adapter lives in `src/ridePhysics.js`, with focused coverage in `tests/ridePhysics.test.mjs`. Camera smoothing, track erasing, and watercolor behavior are covered in their matching test files under `tests/`.

Release and Pages operations are documented in `docs/release-runbook.md`.
