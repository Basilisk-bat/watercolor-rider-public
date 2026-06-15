# GitHub Public Sync Packet

## Current Repositories

- Owner: `Basilisk-bat`
- Private source: `Basilisk-bat/watercolor-rider`
- Public source: `Basilisk-bat/watercolor-rider-public`
- Public playable URL: `https://basilisk-bat.github.io/watercolor-rider-public/`
- Source path: `C:\Users\lacyj\OneDrive\Documents\Rider`
- Private branch: `master`
- Public source branch: `master`
- Pages branch: `gh-pages`

## Public Sync Policy

The private source repo is the working source of truth. The public source repo is
updated only after tracked files are checked for public safety and local release
gates pass.

Use a public worktree rooted at the public repository history for source syncs.
Do not force-push private history into the public repo.

## Intended Source Scope

The public source repo may contain the tracked game source, tests, release
scripts, GitHub workflow, README, and release runbook.

Do not publish generated local artifacts:

- `node_modules/`
- `dist/`
- `.rpk-audits/`
- Vite local log files

## Current Verification Gates

Run before source sync:

```powershell
npm run release:check
```

Run before or after Pages deployment as appropriate:

```powershell
npm run release:pages
npm run smoke:live
```

`release:pages` compares the live Pages assets with local `dist`. If local code
has changed and Pages has not been redeployed yet, a live asset mismatch means
the Pages branch is behind the current build.

## Stop Conditions

Stop before mutation if any of these become true:

- `gh auth status` is not authenticated as `Basilisk-bat`.
- The public repo is missing or no longer public.
- The local source tree has unrelated uncommitted changes.
- The public worktree has unrelated uncommitted changes.
- Git would require a force-push.
- Any request would delete, transfer, rename, retarget Pages, or change
  visibility without explicit approval.
- Secret-pattern scanning finds credentials, tokens, or private keys.
