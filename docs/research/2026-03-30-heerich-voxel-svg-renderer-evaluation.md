# Heerich Evaluation for 3D Object Display

Date: 2026-03-30

## Bottom Line

`heerich.js` is a strong fit for stylized voxel previews, documentation visuals, object cards, and other low-object-count surfaces where SVG output is a feature.

It is not a strong fit for this repo's main in-world 3D renderer. The project currently uses a plain Three.js prototype for runtime inspection, and that remains the better direction for interactive world rendering, camera movement, scene-scale composition, and future gameplay systems.

## What Heerich Actually Is

`heerich.js` describes itself as "a tiny engine for 3D voxel scenes rendered to SVG." It builds voxel compositions in a 3D grid, applies operations such as boxes, spheres, lines, subtraction, intersection, and rotation, then projects the result into SVG markup.

Important distinction: this is not a real-time GPU 3D renderer in the same category as Three.js. It is closer to a procedural voxel modeling and projection tool that outputs 2D vector graphics.

From the interactive guide, the engine supports:

- voxel-grid composition
- boolean operations: `union`, `subtract`, `intersect`, `exclude`
- 90 degree rotations
- per-face styling and functional styles
- oblique and simple perspective camera modes
- serialization and voxel queries
- transparent voxels and custom SVG content inside voxels
- external animation by rebuilding and re-rendering SVG

## Why It Is Interesting for This Repo

This repo is explicitly aiming at a chunky, voxel-native visual language. That makes `heerich.js` relevant at the style level. Its boolean voxel construction also maps well to the current direction of deterministic rough-draft object building.

There is still a category mismatch:

- this repo's current runtime slice is `artifact JSON -> normalized scene plan -> render drafts -> Three renderer`
- `heerich.js` outputs SVG in the DOM, not an interactive WebGL scene

So the question is not "is Heerich cool?" It is "which product surface benefits from SVG voxel projection, and which surfaces need an actual 3D runtime?"

## Pros

### 1. The visual language matches the product

The repo is already leaning toward chunky, draft-oriented, voxel-native objects. `heerich.js` embraces exactly that. If the goal is to make generated objects feel intentionally blocky rather than low-budget, it aligns well.

### 2. SVG output is excellent for preview and publishing surfaces

SVG gives you:

- crisp rendering at any size
- easy embedding in docs, marketing pages, and UI panels
- CSS styling without a shader pipeline
- direct DOM integration for hover states, overlays, labels, and theming

That makes it appealing for:

- object thumbnails
- builder previews before placement
- "AI draft accepted" cards
- changelog or version comparison visuals
- documentation and design references

### 3. The modeling primitives are useful for deterministic draft generation

The engine's primitives map well to the kind of constrained builder output this repo is exploring:

- boxes
- spheres
- lines
- subtraction and intersection
- simple rotation

That is a good match for a rough-draft builder that needs recognizability and determinism more than sculptural fidelity.

### 4. It is easier to inspect than a shader-heavy renderer

Because the final result is SVG and the construction model is voxel-based, it is easier to reason about:

- what geometry was generated
- which faces are exposed
- how styles were assigned
- how a build changed across versions

That is useful during the current benchmark-heavy stage of the project.

### 5. It could make internal tools cheaper to build

For developer-facing tools, SVG can be simpler than WebGL:

- no render loop ownership required for static output
- easy export to assets
- easy overlay composition with HTML
- easy serialization and embedding in reports

That matters for artifact inspectors, debug dashboards, and object-approval workflows.

## Cons

### 1. It is not a true interactive 3D runtime

This is the main issue. `heerich.js` projects voxel scenes into SVG. That means the output is ultimately 2D markup representing a chosen camera view, not a live 3D scene graph with free camera movement, depth buffering, and GPU-backed rendering.

For this repo's main runtime goals, that creates hard limits:

- world navigation is weaker
- camera interaction is narrower
- scene-scale composition is harder
- later gameplay systems will fit poorly

If the product needs users to move around a world, inspect objects from arbitrary angles, or eventually support multiplayer spatial play, Three.js is the right class of renderer. `heerich.js` is not.

### 2. SVG and DOM cost will rise badly with scene size

SVG is elegant for small to medium outputs, but it does not scale like WebGL for large, dynamic scenes. A voxel-heavy scene can turn into a large amount of DOM markup and path data. Even if the library is efficient for incremental rebuilds, the browser still has to parse, layout, paint, and update the resulting SVG.

That makes it risky for:

- many simultaneous objects
- large public scenes
- frequent camera or animation updates
- multiplayer views with constant change

### 3. Camera and rendering flexibility are limited

The guide shows oblique projection and a simple perspective mode. That is enough for stylized presentation, but not enough to replace a general 3D renderer.

Likely pain points:

- limited camera expressiveness
- no natural path to orbit, fly, or avatar-follow cameras
- no lighting model comparable to a WebGL scene
- no material system in the usual game-rendering sense

For draft previews, that is acceptable. For the actual world renderer, it is a constraint.

### 4. Animation is rebuild-driven, not runtime-native

The guide's animation model is: mutate voxel state, call `toSVG()`, replace the output. That is fine for controlled demo animation. It is much less attractive for a game-like runtime with frequent updates.

This repo is already thinking about:

- authoritative state changes
- lifecycle transitions
- grace periods and cooldowns
- lock ownership changes
- eventually multiplayer replay and delta sync

Those systems want a renderer that updates live scene objects efficiently. Rebuilding SVG for every meaningful state change is the wrong performance shape for the core client.

### 5. It may encourage the wrong architectural seam

The current repo docs are correctly separating:

- normalized/runtime data
- deterministic object building
- renderer adapters
- client visualization

Replacing the main renderer with `heerich.js` too early could blur the difference between:

- an inspection or presentation renderer
- the actual game/runtime renderer

That would be a step backward. The project still needs a renderer that proves the runtime seam cleanly under actual interactive conditions.

### 6. The output is visually strong, but intentionally constrained

`heerich.js` is compelling partly because it is opinionated. That is good when the product surface wants exactly that look. It becomes a downside when requirements expand:

- richer materials
- terrain integration
- dynamic lighting
- animation systems
- effects
- denser scene composition

At that point, the SVG-first approach stops being liberating and starts being confining.

## Best Use Cases in This Repo

If adopted, `heerich.js` should be a secondary renderer, not the main world renderer.

Best candidates:

- object preview cards in the UI
- docs and benchmark reports
- marketing or landing-page illustrations
- fixture galleries for deterministic builder output
- moderation, review, or approval screenshots
- version diff views for object edits

These surfaces benefit from:

- stable camera framing
- crisp export quality
- stylized voxel presentation
- easy embedding in DOM-heavy UI

## Poor Use Cases in This Repo

Avoid using it for:

- the primary `scene-runtime-demo` renderer
- free-camera object inspection in the main client
- multiplayer world rendering
- any surface expected to scale to many dynamic objects
- future gameplay layers that need standard 3D rendering tools

## Recommendation

Do not replace the current Three.js runtime direction with `heerich.js`.

Instead, consider a narrow spike where `heerich.js` renders the same builder output as a secondary presentation path:

1. take one or two existing fixture-backed objects
2. adapt the builder output into `heerich.js` primitives
3. generate SVG previews for docs or a HUD side panel
4. measure output size, render latency, and DOM complexity
5. decide whether it is worth keeping for previews only

That gives the project a useful answer without betting the core renderer on the wrong abstraction.

## Decision

For this codebase, `heerich.js` looks valuable as a preview and communication tool.

It does not look like the right foundation for the main 3D object renderer.

## Architecture Decision Update

The repo should treat voxel-native authoring as the canonical creative source for editable objects.

That does not mean the live world must render raw voxel data directly. The better architecture is:

- canonical voxel-aware authoring spec for editable object versions
- compiled runtime artifacts for performance-sensitive consumers
- optional secondary preview targets such as SVG

In practice, that means the project can adopt a voxel-native builder DSL without committing the main world renderer to an SVG or naive voxel-rendering path.

## Sources

- Repository: <https://github.com/meodai/heerich>
- Heerich interactive guide: <https://meodai.github.io/heerich/>
- Local renderer direction: [docs/plans/2026-03-28-scene-runtime-three-renderer-design.md](/Users/gianpaj_it/github/gianpaj/3dvibegame/docs/plans/2026-03-28-scene-runtime-three-renderer-design.md)
- Local authority/lifecycle direction: [docs/plans/2026-03-30-authoritative-object-lifecycle-prototype-design.md](/Users/gianpaj_it/github/gianpaj/3dvibegame/docs/plans/2026-03-30-authoritative-object-lifecycle-prototype-design.md)
