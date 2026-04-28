# Generated App Agent Trial

Backlink: [EXECMAP.md](./EXECMAP.md)

## Goal

Prove that an agent can use Webstir commands to understand and safely modify a generated app without editing Webstir internals.

## Setup

- Created a fresh SPA app with `webstir init spa`.
- Enabled `client-nav` and the package-managed backend.
- Installed this checkout's local packages with `file:` dependencies so the trial exercised current repo code before publish.

## Flow

1. Ran `webstir agent inspect --json`.
   - Result: healthy.
   - Backend truth exposed 3 routes, 1 job, auth/db capabilities, session/form metadata, and migration runner facts.
2. Ran `webstir agent scaffold-job session-cleanup --schedule "rate(5 minutes)"`.
   - Result: healthy.
   - Follow-up inspect exposed both the compiled `nightly` job and package-manifest `session-cleanup` job.
3. Ran `webstir agent scaffold-route profile-save ...`.
   - Result: healthy.
   - Follow-up doctor reported 4 routes and 2 jobs.
4. Deleted `Errors.404.html`, then ran `webstir agent repair --json`.
   - Result: repair restored the missing scaffold-managed file and doctor returned healthy.
5. Ran `webstir agent validate --json`.
   - Result: passed with frontend and backend targets built and 1 generated test passing.

## Fixes Found By The Trial

- `enable backend` copied backend code without adding the backend package dependency, `pino`, or Bun types to generated apps.
- Repair treated a SPA converted with `enable backend` as if it used the built-in full backend template instead of the package-managed backend scaffold.
- The backend scaffold template had strict TypeScript issues in generated scheduler, DB, and module code.
- Backend manifest loading merged package routes with compiled routes, but not package jobs with compiled jobs.
- The SPA generated home-page test expected relative asset links while the current build emitted root-relative links.

## Outcome

The final trial passed after those fixes. The main remaining caveat is release timing: external generated apps will only see the fixed package surfaces after the next package release.
