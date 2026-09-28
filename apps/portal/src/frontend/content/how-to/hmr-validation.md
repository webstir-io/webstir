# HMR Validation Checklist

Follow these steps after touching the frontend hot-update pipeline.

## Automated Smoke
- Run `bun run --filter @webstir-io/webstir-frontend build`.
- Run `bun run --filter @webstir-io/webstir-frontend test`.
- Start `webstir watch` in a clean frontend-capable workspace and confirm the dev loop boots without errors.

## Page Refresh
1. Launch `webstir watch --workspace "$PWD/examples/demos/spa"`. The SPA demo has client-nav on.
2. Scroll the home page, focus a control, then change `examples/demos/spa/src/frontend/pages/home/index.ts`.
3. Verify:
   - The console logs `Refreshed the page for src/frontend/pages/home/index.ts.`
   - The page shows the new code without a reload: scroll and focus stay, and the previous `setup`'s cleanup ran before the new one.

## CSS Refresh
1. Edit `examples/demos/spa/src/frontend/pages/home/index.css`.
2. Confirm the DOM injects a fresh stylesheet and the page does not reload.

## Fallback Scenario
1. In a copy of `examples/demos/ssg/base` (no client-nav), run `webstir enable scripts home` and start `webstir watch` on it.
2. Edit `src/frontend/pages/home/index.ts`.
3. Confirm the console warns about the fallback and the page reloads with the new code.

## HTML/Manifest Change
1. Modify `examples/demos/spa/src/frontend/app/app.html`.
2. Observe the watch loop logging a reload requirement and the browser performing a full refresh.

## Performance Spot Check
- Capture the emitted watch diagnostics and ensure hot updates complete quickly on the demo workspace you used for validation.

Document any deviations (especially fallback rates above 10%) before shipping.
