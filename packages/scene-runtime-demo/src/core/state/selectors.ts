import type { SceneDocument, SceneObjectRecord } from "./contracts";

export function getPlayerSession(document: SceneDocument, playerId: string) {
  return document.player_sessions_by_id[playerId] ?? null;
}

export function getPrimarySceneObject(document: SceneDocument): SceneObjectRecord | null {
  const objectId = document.root_object_ids[0];
  return objectId ? document.objects_by_id[objectId] ?? null : null;
}

export function listRenderableSceneObjects(document: SceneDocument) {
  return document.root_object_ids
    .map((objectId) => document.objects_by_id[objectId])
    .filter((record): record is SceneObjectRecord =>
      Boolean(record && record.authority.state !== "deleted" && record.authority.state !== "archived"),
    );
}
