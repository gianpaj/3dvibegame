import { useMemo } from "react";
import { createReferenceWorld } from "../viewer/objects/createReferenceWorld";

export function ReferenceWorld() {
  const group = useMemo(() => createReferenceWorld().group, []);
  return <primitive object={group} />;
}
