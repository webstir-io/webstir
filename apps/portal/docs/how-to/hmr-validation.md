# Legacy HMR Validation Checklist

Follow these steps after touching the legacy frontend hot-update pipeline.
SPA now defaults to Bun-first HMR. Use this checklist for the legacy path only when running `webstir watch --frontend-runtime legacy`.

## Automated Smoke
- Run `bun run --filter @webstir-io/webstir-frontend build`.
- Run `bun run --filter @webstir-io/webstir-frontend test`.
- Start `webstir watch` in a clean frontend-capable workspace and confirm the daemon boots without errors.

## JavaScript/Edit Loop
1. Launch `webstir watch --workspace "$PWD/examples/demos/spa" --hmr-verbose`.
2. Modify `examples/demos/spa/src/frontend/pages/home/index.ts` (for example, change a string).
3. Verify the browser console logs:
   - `Applied hot update…` message with module/style counts.
   - `Totals — applied: <n>, fallbacks: <m>` increments without forcing a reload.
4. Repeat with additional JS edits to observe counters climbing without page refreshes.

## CSS Refresh
1. Edit `examples/demos/spa/src/frontend/pages/home/index.css`.
2. Confirm the DOM injects a fresh stylesheet and console totals increment.

## Fallback Scenario
1. From the browser console run `window.__webstirAccept = () => false;`.
2. Edit the page script again.
3. Confirm:
   - Console warning announces fallback with reasons and totals.
   - SSE status switches to `hmr-fallback`, followed by a full reload.
   - Daemon logs show `Hot update totals — …` and `frontend.watch.pipeline.hmrfallback`.

## HTML/Manifest Change
1. Modify `examples/demos/spa/src/frontend/app/app.html`.
2. Observe the daemon logging a reload requirement and the browser performing a full refresh.

## Performance Spot Check
- Capture `frontend.watch.javascript.build.stats` and `frontend.watch.hmr.summary` timings; ensure hot updates complete quickly on the demo workspace you used for validation.

Document any deviations (especially fallback rates above 10%) before shipping.
