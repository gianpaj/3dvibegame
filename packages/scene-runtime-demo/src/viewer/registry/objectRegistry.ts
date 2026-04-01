import * as THREE from "three";

interface ObjectRegistryEntry {
  objectId: string;
  group: THREE.Group;
  focusPoint: THREE.Vector3;
  renderClass: string;
}

export function createObjectRegistry() {
  const entries = new Map<string, ObjectRegistryEntry>();
  const byRenderClass = new Map<string, Set<string>>();

  return {
    listEntries() {
      return Array.from(entries.values());
    },
    listObjectIds() {
      return Array.from(entries.keys());
    },
    has(objectId: string) {
      return entries.has(objectId);
    },
    get(objectId: string) {
      return entries.get(objectId) ?? null;
    },
    register(input: ObjectRegistryEntry) {
      this.delete(input.objectId);
      entries.set(input.objectId, input);

      const ids = byRenderClass.get(input.renderClass) ?? new Set<string>();
      ids.add(input.objectId);
      byRenderClass.set(input.renderClass, ids);
    },
    delete(objectId: string) {
      const existing = entries.get(objectId);
      if (!existing) return;

      entries.delete(objectId);
      const ids = byRenderClass.get(existing.renderClass);
      ids?.delete(objectId);
      if (ids && ids.size === 0) {
        byRenderClass.delete(existing.renderClass);
      }
    },
    clear() {
      entries.clear();
      byRenderClass.clear();
    },
  };
}
