---
repo: GL-Demo-Garden
domain: graphics-shaders
languages: [typescript, glsl]
primary_oracle: "timeout 120s npm run build && timeout 180s npm run test:cells && timeout 180s npm run test:stone && timeout 180s npm run test:bubbles && timeout 180s npm run test:ripple && timeout 180s npm run test:searchlights && timeout 180s npm run test:keyboard && timeout 180s npm run test:browser"
---

# Standing Autonomous Protocols — `GL-Demo-Garden`

Durable reference for unsupervised, monotonic-value workflows in
`GL-Demo-Garden` (WebGL2 interactive 80s-anime shader gallery: Wobbly Cells,
Turing Patterns, Bubble Physics, Ripple Drop, Sea Melt, Stone Break,
Searchlights, and Paper Marbling).

## Protocol: WebGL2 Pass & Shader Frame-Time Ratchet
- **id**: `GL-Demo-Garden/perf`
- **category**: `perf`
- **scope**: `own-code`
- **metric**: `frame-ms | draw-calls | texture-fetches`
- **default_stop**: `speedup>=5% | cycles=4 | indefinite`
- **tier**: `draft-pr`
- **oracle**: `timeout 120s npm run build && timeout 300s npm run test:browser`
- **summary**: Profile and reduce redundant FBO passes, texture lookups, CPU-GPU uniform churn, and shader ALU cost across src/engine/ and src/plugins/ while keeping all check-*.mjs gates green.

### Focus Areas & Invariants
- Engine & plugin passes (`ARCHITECTURE.md`, `src/engine/`, `src/plugins/`,
  `src/shaders/`).
- Verify all visual/functional Playwright suites (`test:cells`, `test:stone`,
  `test:bubbles`, `test:ripple`, `test:searchlights`, `test:keyboard`,
  `test:browser`) pass with zero WebGL errors or console warnings.

## Protocol: Real-Time Shader & Physics Algorithm Bake-Offs
- **id**: `GL-Demo-Garden/bakeoff`
- **category**: `bakeoff`
- **scope**: `own-code`
- **metric**: `frame-ms | visual-fidelity | stability`
- **default_stop**: `candidates=3 | indefinite`
- **tier**: `scratch-ledger`
- **oracle**: `timeout 120s npm run build && timeout 300s targeted npm run test:*`
- **summary**: Prototype and benchmark alternative GPU shader/simulation algorithms (Gray-Scott integrators, Voronoi seams, fracture geometry, Ebru advection, ink-contour AA) in isolated worktrees.

### Candidate Topics
- Analytic/screen-space-derivative (`fwidth`) ink-edge antialiasing across
  Wobbly Cells, Sea Melt, and Ripple Drop.
- Semi-Lagrangian vs MacCormack / symplectic advection accuracy for Paper
  Marbling (`suminagashi` / Ebru paint pushes & combing).
- Shared fracture-network triangulation & piece-reassembly dynamics (`Stone Break`).
- Volumetric searchlight occlusion / 2D raymarching vs shadow-map pass count
  (`Searchlights`).

## Protocol: Adversarial Blind Mutation Testing
- **id**: `GL-Demo-Garden/mutation-blind`
- **category**: `mutation`
- **scope**: `own-code`
- **metric**: `killed-mutants`
- **default_stop**: `cycles=5 | killed-mutants>=3 | indefinite`
- **tier**: `pr-ready`
- **oracle**: `timeout 120s npm run build && timeout 300s targeted scripts/check-*.mjs`
- **summary**: Dual-worktree adversarial blind mutation testing across src/engine/, src/ui/, and demo plugin state/physics controllers to harden scripts/check-*.mjs.

### Focus Modules
- `src/engine/` (resource lifecycle, FBO ping-pong resize, DPR scaling),
  `src/ui/` (drawer collapse on mobile, keyboard shortcuts, hide/show state),
  and per-demo parameter/interaction state in `src/plugins/`.
- Follow `references/adversarial-mutation.md` §2.

## Protocol: Stricter TypeScript & Shader Static Compliance Ratchet
- **id**: `GL-Demo-Garden/warnings`
- **category**: `warnings`
- **scope**: `own-code`
- **metric**: `tsconfig-flags-enabled`
- **default_stop**: `flags>=1 | warnings=0 | indefinite`
- **tier**: `pr-ready`
- **oracle**: `timeout 120s npm run build && timeout 300s npm run test:browser`
- **summary**: Tighten tsconfig.json beyond strict:true (noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters, exactOptionalPropertyTypes) and validate GLSL shaders statically.

### Escalation Ladder (`tsconfig.json`)
1. `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`
2. `noUncheckedIndexedAccess: true`
3. `exactOptionalPropertyTypes: true`
4. Optional `glslangValidator` / ESLint static pass over `src/shaders/` and `src/`.

## Protocol: Stylized WebGL2, 80s Anime Shading & Gallery UX Research
- **id**: `GL-Demo-Garden/research`
- **category**: `research`
- **scope**: `theory`
- **metric**: `verified-writeups`
- **default_stop**: `notes=1 | indefinite`
- **tier**: `research-doc`
- **oracle**: `web-verified citations + local ARCHITECTURE.md and src/shaders/ grounding`
- **summary**: Pull verified real-time graphics and UX theory on cel/hand-inked WebGL2 shading, Ebru marbling fluid advection, fracture networks, and mobile-first shader-control drawers.

### Research Queue
- Hand-inked / 80s anime aesthetic in WebGL2: variable-width contour lines,
  cel palette quantization, film grain/halation, and temporal stability.
- Mathematical models of Ebru / suminagashi marbling (incompressible drop
  diffeomorphisms, tine combing, vortex curls) and Voronoi stone fracture.
- Mobile-first interactive shader gallery UX (touch gesture vs drawer conflict,
  preset discovery, keyboard/accessibility ergonomics).
