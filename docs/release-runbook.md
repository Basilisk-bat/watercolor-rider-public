# Release Runbook

This is the current operator checklist for Watercolor Rider after the public playable release exists.

## Repositories

- Private source: `Basilisk-bat/watercolor-rider`
- Public source: `Basilisk-bat/watercolor-rider-public`
- Public playable URL: `https://basilisk-bat.github.io/watercolor-rider-public/`
- Pages source: `watercolor-rider-public` branch `gh-pages`, path `/`

## Safe Scope

- Work in `C:\Users\lacyj\OneDrive\Documents\Rider` and known Rider public clone/worktree paths only.
- Do not run broad cleanup commands in OneDrive or temp roots.
- Do not recursively delete generated folders as part of release work.
- Do not force-push, retarget Pages, rename repos, or change visibility without explicit approval.
- For Pages deploys, copy only explicit built files and leave old hashed assets unless a separate cleanup is reviewed.

## Local Gates

Run these before any source push:

```powershell
npm run release:check
npm run release:pages
```

`release:check` runs tests, build, high-severity audit, and production audit.
`release:pages` additionally builds with `/watercolor-rider-public/`, verifies local asset paths use that base, and verifies live Pages asset hashes.

## Browser Smoke

Use the live Pages URL and verify:

- The page loads with no console errors, page errors, or failed asset responses.
- Brush and eraser buttons change mode.
- Spawn Rider arms once, the next canvas click places one rider, and spawn exits.
- Ride/Pause starts the Line Rider simulation and frame/speed telemetry advance.
- Wheel or trackpad zoom changes `camera.targetZoom` and `camera.zoom`.
- Diagnostics opens and reports speed, air, ink, zoom, wetness, pigment, deposited pigment, runoff, and status.
- Mobile width has no horizontal overflow.
- Watercolor reads as soft wash/bleed/runs, not square-cell marks.

## Public Source Sync

After a private source commit, mirror source changes to `Basilisk-bat/watercolor-rider-public` only when they are public-safe.

For source/test/docs-only changes:

1. Copy only the changed source/test/docs files into the public source clone.
2. Run `npm run release:pages` in the public source clone.
3. Commit and push `master`.
4. Verify public CI.
5. Do not touch `gh-pages` unless the playable build output changed.

## Pages Deploy

Only deploy when the playable build changes.

1. In the public source clone, run `npm run release:pages`.
2. Copy the explicit files from `dist` into the `gh-pages` worktree:
   - `index.html`
   - `favicon.svg`
   - `assets/index-*.js`
   - `assets/index-*.css`
   - `.nojekyll` if present
3. Run `git status --short --branch` in the `gh-pages` worktree and confirm only expected files changed or were added.
4. Commit and push `gh-pages`.
5. Wait for `pages-build-deployment` success.
6. Verify the live URL with `npm run release:pages` and a browser smoke.

## Final State Checks

Before reporting done for a release pass:

```powershell
git status --short --branch
gh run list --repo Basilisk-bat/watercolor-rider --branch master --limit 3 --json databaseId,headSha,status,conclusion,workflowName,createdAt,updatedAt
gh run list --repo Basilisk-bat/watercolor-rider-public --branch master --limit 3 --json databaseId,headBranch,headSha,status,conclusion,workflowName,createdAt,updatedAt
gh api repos/Basilisk-bat/watercolor-rider-public/pages
```

Also check the public source clone and Pages worktree status. If a local preview server was started, stop it and confirm the port is no longer listening.
