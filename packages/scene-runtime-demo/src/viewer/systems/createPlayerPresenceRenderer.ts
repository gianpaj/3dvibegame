import * as THREE from "three";

export interface PlayerPresenceRenderSnapshot {
  enabled: boolean;
  players: PlayerPresenceRenderPlayer[];
}

export interface PlayerPresenceRenderPlayer {
  id: string;
  nickname: string;
  presenceState: string;
  isLocal: boolean;
  transform: {
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationYaw: number;
    rotationPitch: number;
  };
}

interface PlayerPresenceEntry {
  group: THREE.Group;
  signature: string;
}

export function createPlayerPresenceRenderer(root: THREE.Group) {
  const entries = new Map<string, PlayerPresenceEntry>();

  return {
    sync(snapshot: PlayerPresenceRenderSnapshot) {
      const players = snapshot.enabled
        ? snapshot.players.filter(
            (player) => !player.isLocal && player.presenceState === "active",
          )
        : [];
      const currentIds = new Set(players.map((player) => player.id));

      for (const [playerId, entry] of entries) {
        if (currentIds.has(playerId)) continue;
        root.remove(entry.group);
        disposeGroup(entry.group);
        entries.delete(playerId);
      }

      for (const player of players) {
        const signature = `${player.nickname}:${player.presenceState}`;
        const existing = entries.get(player.id);

        if (!existing || existing.signature !== signature) {
          if (existing) {
            root.remove(existing.group);
            disposeGroup(existing.group);
          }

          const group = createPresenceMarker(player);
          root.add(group);
          entries.set(player.id, { group, signature });
        }

        const entry = entries.get(player.id);
        if (entry) {
          syncMarkerTransform(entry.group, player);
        }
      }
    },
    dispose() {
      for (const entry of entries.values()) {
        root.remove(entry.group);
        disposeGroup(entry.group);
      }
      entries.clear();
    },
  };
}

function createPresenceMarker(player: PlayerPresenceRenderPlayer) {
  const group = new THREE.Group();
  group.name = `remote-player-${player.id}`;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.026, 10, 32),
    new THREE.MeshStandardMaterial({
      color: "#2f8fa1",
      emissive: "#2f8fa1",
      emissiveIntensity: 0.12,
      roughness: 0.72,
      metalness: 0.02,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, 0.82, 16),
    new THREE.MeshStandardMaterial({
      color: "#2f8fa1",
      roughness: 0.78,
      metalness: 0.02,
    }),
  );
  body.position.y = 0.48;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 18, 12),
    new THREE.MeshStandardMaterial({
      color: "#f8fbf6",
      roughness: 0.74,
      metalness: 0.02,
    }),
  );
  head.position.y = 1.02;
  head.castShadow = true;
  group.add(head);

  const facing = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.26, 3),
    new THREE.MeshStandardMaterial({
      color: "#20251f",
      roughness: 0.62,
      metalness: 0.02,
    }),
  );
  facing.position.set(0, 0.68, 0.31);
  facing.rotation.x = Math.PI / 2;
  group.add(facing);

  const label = createNameLabel(player.nickname);
  label.position.y = 1.42;
  group.add(label);

  syncMarkerTransform(group, player);
  return group;
}

function syncMarkerTransform(
  group: THREE.Group,
  player: PlayerPresenceRenderPlayer,
) {
  group.position.set(
    player.transform.positionX,
    Math.max(player.transform.positionY, 0),
    player.transform.positionZ,
  );
  group.rotation.y = player.transform.rotationYaw;
}

function createNameLabel(nickname: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(248, 251, 246, 0.92)";
    roundRect(context, 18, 18, 220, 48, 10);
    context.fill();
    context.strokeStyle = "rgba(24, 32, 24, 0.2)";
    context.stroke();
    context.fillStyle = "#182018";
    context.font = "700 24px Avenir Next, Trebuchet MS, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(nickname.slice(0, 18), 128, 43);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.75, 0.66, 1);
  return sprite;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function disposeGroup(group: THREE.Group) {
  group.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
      return;
    }

    if (child instanceof THREE.Sprite) {
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }

  if (material instanceof THREE.SpriteMaterial) {
    material.map?.dispose();
  }
  material.dispose();
}
