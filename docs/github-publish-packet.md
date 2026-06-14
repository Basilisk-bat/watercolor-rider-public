# GitHub Publish Packet

## Target

- Owner: `Basilisk-bat`
- Repository: `watercolor-rider`
- Visibility: private
- Source path: `C:\Users\lacyj\OneDrive\Documents\Rider`
- Current branch: `master`
- Current remote: none
- Current repository status: no commits yet

## Intended Source Scope

Publish these project files:

- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `docs/github-publish-packet.md`
- `index.html`
- `package.json`
- `package-lock.json`
- `src/main.js`
- `src/ridePhysics.js`
- `src/styles.css`
- `src/trackGeometry.js`
- `tests/ridePhysics.test.mjs`
- `tests/trackGeometry.test.mjs`

Do not publish generated local artifacts:

- `node_modules/`
- `dist/`
- `.rpk-audits/`

## Exact Live Commands

Run only after explicit approval:

```powershell
python -X utf8 C:\Users\lacyj\.codex\plugins\cache\rpkplug\rpk-codex\0.1.0+codex.20260613080348\skills\rpk-github-project-starter\scripts\github_project_starter.py create --repo watercolor-rider --source C:\Users\lacyj\OneDrive\Documents\Rider --push --commit-message "Initial project publish" --execute
```

Expected effect:

- Create private GitHub repo `Basilisk-bat/watercolor-rider`.
- Create the first local commit with message `Initial project publish`.
- Set `origin` for this checkout.
- Push `master` to GitHub.

## Verification Commands

After publish:

```powershell
gh repo view Basilisk-bat/watercolor-rider --json name,url,visibility,isPrivate
git remote -v
git status -sb
npm run test
npm run build
npm audit --audit-level=high
```

## Current Local Check Evidence

Last verified locally before publish approval:

- `npm run test`: 9 tests passed.
- `npm run build`: production build passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `gh auth status`: authenticated to `github.com` as `Basilisk-bat`.
- `gh repo view Basilisk-bat/watercolor-rider`: repository not found, so the target name appears available from this authenticated account.

## Stop Conditions

Stop before mutation if any of these become true:

- `Basilisk-bat/watercolor-rider` already exists.
- `gh auth status` is not authenticated as `Basilisk-bat`.
- The requested visibility changes from private without explicit approval.
- The publish script dry-run command changes unexpectedly.
- Git reports unrelated tracked changes outside the intended source scope.
- The push fails after repository creation.
- Any request appears to delete, transfer, make public, force-push, or enable GitHub Pages without explicit approval.
