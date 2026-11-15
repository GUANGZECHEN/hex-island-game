# 3D art refinement 1

Approved by Product Owner: raise bare dunes, use rectangular brick stacks, exactly three sheep per pasture, upright wheat, retain resource-tile gradients, improve ocean. Keep the accepted two-deck boat ports unchanged.

## Implementation
- Display-only `refinement.ts` is applied after terrain construction. The rules, topology, tile IDs, RNG, bank, turns, network transport and boat models do not change.
- Sand relief is multiplied by 1.65 above the existing .123 seam height. No desert prop is added.
- Brick tiles contain nine rectangular cuboids in three stacks. Pastures contain three modeled sheep. Fields contain fifteen vertical stalks with raised ears; stems and grain use GPU instances.
- Every terrain has linear-RGB vertex-color gradients. No arithmetic is performed on CSS color strings.
- Ocean depth colors use distance to the actual outer coast, with short foam strokes and nonanimated ripples. Static scenes continue to render on demand.
- Shared geometry/materials retain their existing owner. Instance buffers are disposed before replacement and shutdown.

## Acceptance
Geometry tests must check actual mesh types, counts, dimensions, axes, gradients, dune seams, instance disposal and unchanged ports. Real Chromium must render standard and expanded boards, preserve fit and input, switch back to SVG, and report no shader errors. Screenshots are retained for visual review. Software-rendered CI is not a hardware performance guarantee.

## Standing delivery instruction, 2026-11-15
For approved game changes, publish the tested revision automatically through the existing `game/mvp` website workflow, then verify the live deployment. Do not ask again whether to deploy and do not treat a downloadable ZIP as publication. This instruction does not authorize unrelated changes, paid infrastructure, or an automatic merge into `main`. Report publication failures plainly.
