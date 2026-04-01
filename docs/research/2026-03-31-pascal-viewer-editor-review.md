# Pascal Viewer + Editor Review: Learnings for 3d vibe game

Date: 2026-03-31
Reviewed npm package: `@pascal-app/viewer@0.3.2`
Package published: 2026-03-30
Reviewed repo: `pascalorg/editor`
Reviewed repo commit: `e84e87024857acc183406bd969ff3fc5357d05e6`

## Bottom Line

Pascal is most interesting as a scene architecture and editor architecture reference.

The viewer package is not just a canvas component. It is a reusable rendering layer with:

- its own state store
- camera defaults
- systems
- selection handling
- post-processing
- extension seams

The editor then adds tools, overlays, persistence, and editing workflows on top of that viewer.

For `3d vibe game`, the strongest ideas to borrow are:

- splitting core scene logic from rendering and editor tooling
- storing scene data in a normalized graph instead of in the Three.js scene graph
- using dirty-node systems to recompute geometry incrementally
- treating interaction as typed events, not direct component coupling
- making one drag or placement gesture equal one undo step

The main caution is that Pascal is optimized for a CAD-like architectural editor. Some of its hierarchy and tooling would be too heavy if copied literally into our object-first multiplayer game.

## Important Scope Note

The npm package and the GitHub repo are the same codebase.

`@pascal-app/viewer@0.3.2` is published from `packages/viewer` inside the `pascalorg/editor` monorepo. So the useful review target is the monorepo architecture as a whole, not the package tarball in isolation.

## What Stands Out

### 1. The package layering is excellent

Pascal separates the product into three layers:

- `@pascal-app/core`
- `@pascal-app/viewer`
- `@pascal-app/editor`

That split is the clearest lesson in the whole codebase.

`core` owns schemas, scene state, geometry systems, spatial queries, and event definitions.
`viewer` owns rendering, camera, viewer state, interaction plumbing, and post effects.
`editor` owns tools, panels, workflows, shortcuts, autosave, and editor-specific systems.

This is a very strong pattern for `3d vibe game`.

We should aim for the same conceptual split:

- object and authority contracts in a core package
- runtime or inspector rendering in a viewer package
- creation and refinement tools in an editor package

That will matter more over time than any one rendering trick.

Relevant files:

- `README.md`
- `packages/viewer/package.json`
- `packages/core/package.json`
- `packages/editor/package.json`

### 2. Scene data is normalized instead of being embedded in the scene graph

Pascal stores scene data as:

- a flat dictionary of nodes
- root node ids
- relational metadata
- dirty node ids

The Three.js scene is a projection of that data, not the source of truth.

That is the right direction for us too.

For `3d vibe game`, authoritative world state should never depend on traversal of live render objects. The source of truth should stay in explicit object records and compiled artifacts.

This is especially compatible with our current direction:

- canonical voxel-aware source
- compiled runtime artifact
- authority-managed object lifecycle

Relevant files:

- `packages/core/src/store/use-scene.ts`
- `README.md`

### 3. Dirty-node systems are the most reusable technical idea

Pascal does not rely on React rerender alone to rebuild geometry. Instead:

- node changes mark ids dirty
- systems inspect dirty ids each frame
- systems fetch the related `Object3D` from a registry
- systems update geometry and transforms imperatively
- dirty flags are cleared after recompute

That is a strong model for any editor where geometry generation is derived and potentially expensive.

This maps directly to `3d vibe game`.

We should likely do something similar for:

- voxel source edits
- builder compilation
- mesh regeneration
- preview artifact refresh

In our case, a dirty object may trigger:

- source-to-compiled rebuild
- bounds refresh
- collider refresh
- preview thumbnail invalidation

Relevant files:

- `packages/core/src/store/use-scene.ts`
- `packages/core/src/hooks/scene-registry/scene-registry.ts`
- `packages/core/src/systems/wall/wall-system.tsx`

### 4. The scene registry is a smart bridge between data and rendering

Pascal keeps a registry that maps:

- node id -> `Object3D`
- node type -> set of ids

This avoids expensive scene traversal and gives systems a fast path to the rendered object they need to update.

That is a useful pattern for us.

A similar registry in `3d vibe game` could support:

- focus camera on object
- highlight or inspect by object id
- update a compiled object mesh in place
- find all visible objects of a certain class

This is particularly helpful if we keep our world state external to React.

Relevant files:

- `packages/core/src/hooks/scene-registry/scene-registry.ts`
- `packages/viewer/src/components/renderers/wall/wall-renderer.tsx`

### 5. Separate stores for scene, viewer, and editor are the right state split

Pascal uses different Zustand stores for:

- scene state
- viewer state
- editor UI state

That is clean and disciplined.

It prevents rendering concerns from polluting domain state and prevents tool state from leaking into persistent scene data.

For our game, the equivalent split would likely be:

- world or authority state
- viewer or camera state
- tool or creation UI state

This separation will matter once we have:

- in-world play mode
- object creation mode
- moderation or inspection mode

Relevant files:

- `packages/core/src/store/use-scene.ts`
- `packages/viewer/src/store/use-viewer.ts`
- `packages/editor/src/store/use-editor.tsx`

### 6. The viewer package exposes a small public API and keeps the rest internal

The published `@pascal-app/viewer` surface is intentionally narrow:

- `Viewer`
- `useViewer`
- asset URL helpers
- some material helpers
- `InteractiveSystem`

That is a good packaging choice.

It means consumers extend the viewer through supported seams instead of depending on internals.

This is a useful lesson for us: if we build a reusable world viewer or object inspector, its public API should stay much smaller than its internal implementation.

Relevant files:

- `packages/viewer/src/index.ts`
- published package `dist/index.js`

### 7. Typed event bus plus event adapters is a strong interaction pattern

Pascal uses a typed `mitt` bus for:

- node events
- grid events
- camera commands
- tool cancellation
- preset and thumbnail actions

Then `useNodeEvents` converts R3F pointer events into typed domain events.

That gives them a stable interaction language that tools and systems can subscribe to without tight component coupling.

This is worth borrowing carefully.

For `3d vibe game`, a typed event layer could help with:

- object hover and selection
- tool previews
- camera focus requests
- placement validation events
- edit lifecycle UI

I would use this for tooling and inspection layers first. I would not make it the core gameplay networking protocol.

Relevant files:

- `packages/core/src/events/bus.ts`
- `packages/viewer/src/hooks/use-node-events.ts`

### 8. Their undo model is better than naive per-frame history

One of Pascal’s best editor techniques is pausing temporal history during transient interaction, then resuming only when the gesture commits.

That means:

- moving an item does not create 100 undo states while you drag
- the final placement becomes one undoable action
- draft nodes can be transient until commit

This is exactly the kind of editing behavior we should want.

It maps cleanly to our own draft lifecycle:

- create draft
- manipulate during grace
- commit edit

The important lesson is: transient manipulation state should not be recorded the same way final authored state is.

Relevant files:

- `packages/editor/src/components/tools/item/use-draft-node.ts`
- `packages/core/src/store/use-scene.ts`

### 9. The geometry systems are domain-specific, but the pattern is reusable

Pascal’s wall system is architecture-specific, but the approach is broadly useful:

- build geometry from structured node data
- use domain math such as mitering
- apply boolean cutouts where needed
- sync collision representations alongside render geometry

For our game, the equivalent would be:

- compile voxel or builder source into runtime mesh data
- apply cutouts or attachments deterministically
- keep colliders derived from the same source

Their use of `three-bvh-csg` is especially interesting because it shows a real editing workflow where booleans are not a gimmick but part of the authoring model.

Relevant files:

- `packages/core/src/systems/wall/wall-system.tsx`

### 10. Spatial validation is treated as a first-class system

Pascal has explicit spatial helpers and sync around:

- point in polygon
- item footprint overlap
- wall overlap with slab polygons
- slab elevation lookup
- placement validity

That is a valuable mindset for us.

If we want objects to feel grounded in the world rather than loosely tossed into it, we will need explicit spatial validation systems too, even if our world is more playful than architectural.

Examples for us:

- can an object be placed here
- is the placement grounded
- does it overlap protected space
- does it violate authority constraints

Relevant files:

- `packages/core/src/hooks/spatial-grid/spatial-grid-manager.ts`
- `packages/core/src/hooks/spatial-grid/spatial-grid-sync.ts`

### 11. Level modes and cutaway modes are good examples of derived view state

Pascal’s viewer supports:

- stacked levels
- exploded levels
- solo level mode
- wall cutaway / up / down modes

The specific features are building-editor features, but the principle is useful:

view state should be able to radically change presentation without mutating source scene data.

For us, similar view modes could be:

- draft view vs authoritative view
- builder anatomy view
- public world vs edit focus
- object-only inspect mode
- occlusion or transparency modes for dense scenes

Relevant files:

- `packages/viewer/src/store/use-viewer.ts`
- `packages/viewer/src/systems/level/level-system.tsx`
- `packages/viewer/src/systems/wall/wall-cutout.tsx`

### 12. The viewer is opinionated about rendering quality and resilience

Pascal’s viewer is not just "render some meshes." It includes:

- WebGPU renderer defaults
- BVH acceleration wrapping the scene
- post-processing pipeline
- outline effects
- SSGI
- retry logic when post-processing fails
- GPU device loss watcher

That is ambitious, and not all of it is something we should adopt now.

But there is a strong lesson here:

if the viewer is a product surface, it should own rendering resilience and defaults instead of forcing every consumer to rediscover them.

Relevant files:

- `packages/viewer/src/components/viewer/index.tsx`
- `packages/viewer/src/components/viewer/post-processing.tsx`

### 13. Asset resolution is abstracted well

Pascal resolves assets from:

- CDN URLs
- external URLs
- `asset://` local storage backed by IndexedDB

That is a practical abstraction.

For our game, a similar asset reference layer would help if we ever mix:

- generated assets
- uploaded references
- local cached object previews
- remote canonical files

Relevant files:

- `packages/viewer/src/lib/asset-url.ts`

### 14. The editor composes behavior rather than hardwiring one giant component

The top-level editor wires together:

- runtime initialization
- viewer
- custom controls
- tool manager
- overlays
- helper managers
- systems
- autosave
- floorplan and preview modes

This is useful mainly as a composition example.

The lesson is that tool behavior should stay modular enough to add or remove systems without rewriting the viewer.

Relevant files:

- `packages/editor/src/components/editor/index.tsx`
- `packages/editor/src/components/tools/tool-manager.tsx`

## Techniques To Adapt Carefully

### 1. Do not copy the architectural node hierarchy literally

Pascal’s hierarchy is:

- site
- building
- level
- wall
- slab
- ceiling
- roof
- zone
- item

That is appropriate for BIM-lite editing. It is not the right native ontology for `3d vibe game`.

We should borrow the normalized graph pattern, not the specific node taxonomy.

### 2. Be careful with the dual React + imperative systems model

Pascal gets a lot of power from:

- React components as renderer shells
- imperative geometry systems updating those objects later

That works, but it is also cognitively expensive.

If we adopt this style, we need to be disciplined about what is declarative and what is compiled or imperative.

For our repo, the cleanest line is probably:

- React for UI and renderer shells
- imperative systems for compiled object updates
- authority state outside render components

### 3. WebGPU and heavy post effects are not free

Pascal uses WebGPU, TSL, post-processing, and renderer-specific recovery code.

That is impressive, but it increases surface area and fragility.

For `3d vibe game`, this is not where I would spend complexity first. We need correctness of object contracts, editing flow, and scalable world state before we need SSGI.

### 4. Their package boundaries are stronger than their package independence

The separation is good, but the packages are still tightly coordinated inside one monorepo and shared mental model.

That is fine. It just means we should not mistake "published npm package" for "fully independent runtime platform."

## Best Ideas To Apply In 3d vibe game

### Near-term

- Split repo responsibilities more explicitly into core contracts, viewer runtime, and editor tooling.
- Keep world and object data normalized and external to render objects.
- Introduce a registry from object id to `Object3D`.
- Add dirty-object recompilation instead of relying only on rerender.
- Treat draft manipulation as transient and commit it as one undoable step.

### Mid-term

- Add a typed interaction bus for tool and inspector layers.
- Support alternate viewer modes that do not mutate source data.
- Build a minimal public API for any viewer package we expose.
- Add asset reference abstraction for local, generated, and remote resources.

### Long-term

- Make compiled object systems first-class: source spec -> compiled runtime -> collider / preview derivatives.
- Consider stronger viewer defaults and packaged inspection UX once the world model is stable.

## What This Means For Our Current Direction

Pascal supports the direction we are already moving toward:

- source data separate from rendering
- compiled geometry separate from authored intent
- editor tooling separate from viewer runtime

The repo does not make a case that we should turn `3d vibe game` into a CAD editor.

It does make a strong case that we should stop thinking of the renderer as the application. The application is:

- the data model
- the edit model
- the compile model
- the interaction model

The viewer is one layer on top of that.

That is the most useful lesson in Pascal.

## Reviewed Sources

- npm package: <https://www.npmjs.com/package/@pascal-app/viewer>
- Repository: <https://github.com/pascalorg/editor>
- Repository README: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/README.md>
- Viewer package source: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/viewer/src/index.ts>
- Viewer store: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/viewer/src/store/use-viewer.ts>
- Viewer component: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/viewer/src/components/viewer/index.tsx>
- Post-processing: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/viewer/src/components/viewer/post-processing.tsx>
- Selection manager: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/viewer/src/components/viewer/selection-manager.tsx>
- Interactive system: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/viewer/src/systems/interactive/interactive-system.tsx>
- Core scene store: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/core/src/store/use-scene.ts>
- Scene registry: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/core/src/hooks/scene-registry/scene-registry.ts>
- Wall system: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/core/src/systems/wall/wall-system.tsx>
- Event bus: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/core/src/events/bus.ts>
- Spatial grid sync: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/core/src/hooks/spatial-grid/spatial-grid-sync.ts>
- Editor store: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/editor/src/store/use-editor.tsx>
- Draft node lifecycle: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/editor/src/components/tools/item/use-draft-node.ts>
- Editor entry: <https://github.com/pascalorg/editor/blob/e84e87024857acc183406bd969ff3fc5357d05e6/packages/editor/src/components/editor/index.tsx>
