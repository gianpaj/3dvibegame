import { useMemo, type RefObject } from "react";
import type { OrbitControlsLike } from "./orbitControls";
import type { BuilderSpec } from "@3dvibegame/scene-authority-ts";

import type {
  BackendAvatarPresence,
  BackendPlayerPresence,
} from "../../backend/createBackendPresenceBridge";
import { CharacterController } from "./CharacterController";
import { RemoteAvatars, type RemoteAvatarData } from "./RemoteAvatars";
import { collisionRegistry } from "./collision";
import {
  defaultAvatarBuilderSpec,
  hueFromIdentity,
  parseStoredAvatarSpec,
} from "./avatarSpec";
import type { MoveSample } from "./throttle";

export interface AvatarLayerProps {
  controlsRef: RefObject<OrbitControlsLike | null>;
  objectSelectedRef: RefObject<boolean>;
  players: BackendPlayerPresence[];
  avatars: BackendAvatarPresence[];
  onMove?: (sample: MoveSample) => void;
}

interface ResolvedBody {
  spec: BuilderSpec;
  tintHue?: number;
  version: number;
}

// Resolve a player's body: a stored, parseable spec renders as-is; otherwise the
// default body tinted by identity hue. Never bodiless (spec section 7).
function resolveBody(
  id: string,
  avatar: BackendAvatarPresence | undefined,
): ResolvedBody {
  if (avatar) {
    const parsed = parseStoredAvatarSpec(avatar.builderSpecJson);
    if (parsed) {
      return { spec: parsed, version: avatar.version };
    }
  }
  return {
    spec: defaultAvatarBuilderSpec(),
    tintHue: hueFromIdentity(id),
    version: 0,
  };
}

/**
 * Composes the local third-person avatar plus every remote player's avatar from the
 * backend presence snapshot. Stored bodies render in place; players without one get
 * the hue-tinted default body.
 */
export function AvatarLayer({
  controlsRef,
  objectSelectedRef,
  players,
  avatars,
  onMove,
}: AvatarLayerProps) {
  const local = players.find((player) => player.isLocal);
  const avatarById = useMemo(() => {
    const map = new Map<string, BackendAvatarPresence>();
    for (const avatar of avatars) map.set(avatar.id, avatar);
    return map;
  }, [avatars]);

  const localBody = local ? resolveBody(local.id, avatarById.get(local.id)) : null;

  const remotes: RemoteAvatarData[] = useMemo(() => {
    return players
      .filter((player) => !player.isLocal && player.presenceState === "active")
      .map((player) => {
        const body = resolveBody(player.id, avatarById.get(player.id));
        return {
          id: player.id,
          nickname: player.nickname,
          spec: body.spec,
          tintHue: body.tintHue,
          specVersion: body.version,
          target: {
            x: player.transform.positionX,
            y: player.transform.positionY,
            z: player.transform.positionZ,
            yaw: player.transform.rotationYaw,
          },
        };
      });
  }, [players, avatarById]);

  return (
    <>
      {local && localBody && (
        <CharacterController
          controlsRef={controlsRef}
          objectSelectedRef={objectSelectedRef}
          registry={collisionRegistry}
          spec={localBody.spec}
          tintHue={localBody.tintHue}
          nickname={local.nickname}
          spawnPop={localBody.version > 0}
          onMove={onMove}
        />
      )}
      <RemoteAvatars avatars={remotes} />
    </>
  );
}
