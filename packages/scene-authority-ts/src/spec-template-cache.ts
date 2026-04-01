import type { PaintRegionOp, VoxelBuilderSpec, VoxelMaterial } from "./voxel-contracts";

/**
 * Known color vocabulary used to detect color modifiers in style tags, prompts,
 * and material_ids. The AI worker convention is to use the color name directly as
 * the material_id (e.g. material_id: "red"), which this cache relies on for detection
 * and derivation.
 */
const KNOWN_COLORS: Record<string, string> = {
  red: "#cc2222",
  blue: "#2255cc",
  green: "#22aa44",
  yellow: "#eecc22",
  black: "#222222",
  white: "#eeeeee",
  purple: "#882299",
  orange: "#dd7722",
  pink: "#ee6699",
  brown: "#885533",
  cyan: "#22aacc",
  gray: "#888888",
  grey: "#888888",
};

function isKnownColor(name: string): boolean {
  return name.toLowerCase() in KNOWN_COLORS;
}

function colorHint(name: string): string {
  return KNOWN_COLORS[name.toLowerCase()] ?? "#888888";
}

/**
 * Find material_ids in a spec whose name or tags indicate a color.
 * Matches: material_id that IS a known color, or tags that include a known color.
 */
function findColorMaterialIds(spec: VoxelBuilderSpec): string[] {
  return spec.materials
    .filter(
      (m) => isKnownColor(m.material_id) || m.tags?.some((t) => isKnownColor(t)),
    )
    .map((m) => m.material_id);
}

function extractColorFromTags(styleTags: string[]): string | null {
  return styleTags.find((tag) => isKnownColor(tag)) ?? null;
}

function extractColorFromPrompt(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  return Object.keys(KNOWN_COLORS).find((color) => lower.includes(color)) ?? null;
}

/**
 * Derive a new VoxelBuilderSpec from a base spec by overriding its colorable
 * materials with a new color. Appends PaintRegionOps (by_material_ids) at the end
 * of the operations list so they take precedence over any earlier ops.
 *
 * Example: base spec has material_id "red" (from "red barrels").
 * Calling deriveSpecWithColor(base, "blue", ...) returns a spec that adds a "blue"
 * material and appends PaintRegionOp({by_material_ids: ["red"]}, "blue").
 * The geometry is identical; only the color changes.
 */
export function deriveSpecWithColor(
  baseSpec: VoxelBuilderSpec,
  newColor: string,
  newRequestId: string,
  newIntentId: string,
): VoxelBuilderSpec {
  const colorLower = newColor.toLowerCase();
  const colorableIds = findColorMaterialIds(baseSpec);

  if (!colorableIds.length) {
    return { ...baseSpec, request_id: newRequestId, intent_id: newIntentId };
  }

  // Carry over tags from the first colorable material (e.g. ["painted"])
  const sourceMaterial = baseSpec.materials.find((m) =>
    colorableIds.includes(m.material_id),
  );
  const inheritedTags = sourceMaterial?.tags ?? [];

  const newMaterial: VoxelMaterial = {
    material_id: colorLower,
    color_hint: colorHint(colorLower),
    tags: inheritedTags,
  };

  // Replace existing materials, deduplicated by material_id
  const mergedMaterials: VoxelMaterial[] = [
    ...baseSpec.materials.filter((m) => m.material_id !== colorLower),
    newMaterial,
  ];

  // Append a PaintRegionOp for each old color material that differs from the new color
  const paintOps: PaintRegionOp[] = colorableIds
    .filter((id) => id.toLowerCase() !== colorLower)
    .map((oldId, index) => ({
      op_id: `derived_paint_${colorLower}_${index}`,
      kind: "paint_region" as const,
      target: { by_material_ids: [oldId] },
      material_id: colorLower,
    }));

  return {
    ...baseSpec,
    request_id: newRequestId,
    intent_id: newIntentId,
    materials: mergedMaterials,
    operations: [...baseSpec.operations, ...paintOps],
  };
}

export interface SpecTemplateCacheEntry {
  object_category: string;
  size_tier: string;
  base_spec: VoxelBuilderSpec;
  stored_at: number;
}

/**
 * In-memory cache of VoxelBuilderSpecs keyed by object_category:size_tier.
 *
 * Stores the first generated spec for a given shape (e.g. "barrel:small").
 * Subsequent requests for the same shape but different color skip the AI worker
 * and instead derive a new spec by appending a PaintRegionOp to the base.
 *
 * Integration point: between GenerationIntent resolution (planning stage) and the
 * AI worker call (voxel_source_ready stage). Check deriveIfApplicable() first; only
 * call the AI worker on a cache miss, then call store() with the result.
 */
export function createSpecTemplateCache() {
  const entries = new Map<string, SpecTemplateCacheEntry>();

  function cacheKey(category: string, sizeTier: string): string {
    return `${category.toLowerCase()}:${sizeTier.toLowerCase()}`;
  }

  return {
    has(category: string, sizeTier: string): boolean {
      return entries.has(cacheKey(category, sizeTier));
    },

    lookup(category: string, sizeTier: string): VoxelBuilderSpec | null {
      return entries.get(cacheKey(category, sizeTier))?.base_spec ?? null;
    },

    /**
     * Store a spec as the canonical base template for its category+size_tier.
     * Called after a successful AI worker response (cache miss path).
     * Does not overwrite an existing entry — first generation wins.
     */
    store(spec: VoxelBuilderSpec): void {
      const key = cacheKey(spec.object_category, spec.size_tier);
      if (entries.has(key)) return;
      entries.set(key, {
        object_category: spec.object_category,
        size_tier: spec.size_tier,
        base_spec: spec,
        stored_at: Date.now(),
      });
    },

    /**
     * Try to derive a spec from a cached base without calling the AI worker.
     *
     * Returns a derived VoxelBuilderSpec if:
     *   1. A base spec exists for the given category + size_tier, AND
     *   2. A color modifier is present in style_tags or source_prompt.
     *
     * Returns null when:
     *   - No cached base exists for this shape (cache miss — call AI worker).
     *   - No color override is needed (caller can use the cached base directly).
     *
     * Example:
     *   // First request — cache miss
     *   const derived = cache.deriveIfApplicable("barrel", "small", [], "red barrels", ...);
     *   // → null (no base cached yet); call AI worker, then cache.store(result)
     *
     *   // Second request — same shape, different color
     *   const derived = cache.deriveIfApplicable("barrel", "small", ["blue"], "blue barrels", ...);
     *   // → VoxelBuilderSpec with blue PaintRegionOp appended (no AI call needed)
     */
    deriveIfApplicable(
      category: string,
      sizeTier: string,
      styleTags: string[],
      sourcePrompt: string,
      newRequestId: string,
      newIntentId: string,
    ): VoxelBuilderSpec | null {
      const baseSpec = this.lookup(category, sizeTier);
      if (!baseSpec) return null;

      const newColor =
        extractColorFromTags(styleTags) ?? extractColorFromPrompt(sourcePrompt);

      if (!newColor) {
        // No color override — return base as-is with new ids
        return { ...baseSpec, request_id: newRequestId, intent_id: newIntentId };
      }

      // If the base already has this exact color, no paint ops needed
      const colorableIds = findColorMaterialIds(baseSpec);
      const alreadyCorrect = colorableIds.some(
        (id) => id.toLowerCase() === newColor.toLowerCase(),
      );
      if (alreadyCorrect) {
        return { ...baseSpec, request_id: newRequestId, intent_id: newIntentId };
      }

      return deriveSpecWithColor(baseSpec, newColor, newRequestId, newIntentId);
    },

    size(): number {
      return entries.size;
    },

    clear(): void {
      entries.clear();
    },
  };
}

export type SpecTemplateCache = ReturnType<typeof createSpecTemplateCache>;
