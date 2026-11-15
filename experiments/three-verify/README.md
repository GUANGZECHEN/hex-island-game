# Three.js runtime feasibility gate

This is a verification-only implementation authorized by the Product Owner. It is classified as a bounded engineering validation, not approval to replace the playable renderer. It adds no model-agent calls, paid services, remote computer control, account keys or live game commands.

## Isolation

The branch `verify/three-runtime` is based on `game/mvp` at `275e1f1442a838ff7a5a8dc32dc540eea67caf54`. All root application files and dependencies remain unchanged. The experiment has its own npm package, Vite build and read-only GitHub Actions job. It does not run the five-hour tunnel workflow or deploy to the shared GitHub Pages site.

## What is exercised

- Exact direct dependency versions: Three.js 0.180.0, @types/three 0.180.0, TypeScript 5.8.3, Vite 6.3.5, Playwright 1.58.0. CI resolves a lock and then uses `npm ci`; the resolved lock is preserved in the artifact.
- Real WebGL2 rendering with measured geometry/draw calls and screenshot pixel validation. Default Chromium support is probed separately. Automated rendering uses explicit ANGLE SwiftShader and must not be mistaken for hardware-GPU or phone performance evidence.
- Original project map generator and topology, standard 19 / expanded 24 hexes. Decorative models are provisional, with no game randomness consumed by decoration.
- Middle-button orbit, Shift+middle pan, wheel zoom, reset, left-click ray picking; middle drag cannot increment the picking counter.
- Height fit and compact hand/Actions adjacency at desktop and mobile viewport sizes, with selected form input retained during resize.
- On-demand rendering, source-map immutability, no WebSocket traffic.
- Existing `renderIslandBoard` SVG fallback on requested compatibility mode, unavailable WebGL2, and real `WEBGL_lose_context` context loss. Original IDs and tile count survive.

## Run

From this directory: `npm install`, `npm run typecheck`, `npm run build`, `npx playwright install chromium`, `npm run verify`. For inspection: `npm run dev`. The isolated production build is in `dist/` and is a static site to be served over HTTP; it is not the live multiplayer game.

## Acceptance and remaining work

The gate passes only when the CI report and screenshots confirm actual rendering and input behavior. It does not certify final art quality, full game UI integration, complete rules input, live multiplayer camera isolation, Safari/WebKit or physical-mobile frame rate. Those remain stages A–D of the proposed migration. Inspect `evidence/report.json` and the rendered screenshots rather than relying solely on a successful build.

Technical references: https://threejs.org/manual/en/installation.html ; https://threejs.org/docs/pages/OrbitControls.html ; https://threejs.org/docs/pages/WebGLRenderer.html .
