import { listRenderableSceneObjects } from "../core";
import type { SceneDocument } from "../core";
import { AuthorityObject } from "./AuthorityObject";

interface Props {
  document: SceneDocument;
  selectedObjectId: string | null;
  onSelectObject?: (objectId: string) => void;
}

export function SceneObjects({ document, selectedObjectId, onSelectObject }: Props) {
  const records = listRenderableSceneObjects(document);

  return (
    <>
      {records.map((record) => {
        const t = record.authority.transform;
        const transformKey = [...t.position, ...t.rotation, ...t.scale].join(",");
        return (
          <AuthorityObject
            key={`${record.object_id}@${record.authority.state}-v${record.authority.version}-${transformKey}-${selectedObjectId === record.object_id}`}
            object={record.authority}
            selected={record.object_id === selectedObjectId}
            onSelect={onSelectObject}
          />
        );
      })}
    </>
  );
}
