# Watercolor Rider

A cozy minimalist browser toy inspired by line rider: paint soft ink rails, then send a tiny rider through the watercolor wash.

## Play in browser

[Launch Watercolor Rider](https://basilisk-bat.github.io/watercolor-rider-public/)

## Play

- Brush and erase rails directly on the canvas.
- Ride, pause, reset, undo, or clear from the floating dock.
- Zoom with the zoom buttons or mouse wheel.
- Open diagnostics for speed, air time, ink, zoom, wetness, mass, and ride status.

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
```

The ride model lives in `src/ridePhysics.js` with focused coverage in `tests/ridePhysics.test.mjs`.
