import { Canvas } from "@react-three/fiber";
import { Environment, Grid, OrbitControls } from "@react-three/drei";
import {
  buildRenderDrafts,
  loadRuntimeTaskArtifact,
  summarizeArtifact,
  type PrimitiveNode,
  type RenderDraftSpec,
} from "@3dvibegame/scene-runtime-ts";
import { useMemo, useState } from "react";

import barrelTriangleArtifact from "./fixtures/barrel-triangle.artifact.json";
import clarificationArtifact from "./fixtures/clarification.artifact.json";
import pineTreeArtifact from "./fixtures/pine-tree.artifact.json";

const fixtureMap = {
  pine_tree: pineTreeArtifact,
  barrel_triangle: barrelTriangleArtifact,
  clarification: clarificationArtifact,
} as const;

type FixtureKey = keyof typeof fixtureMap;

export function App() {
  const [selected, setSelected] = useState<FixtureKey>("barrel_triangle");
  const artifact = useMemo(
    () => loadRuntimeTaskArtifact(fixtureMap[selected]),
    [selected],
  );
  const summary = useMemo(() => summarizeArtifact(artifact), [artifact]);
  const derivedDrafts = useMemo(
    () =>
      artifact.normalized_plan
        ? buildRenderDrafts(artifact.normalized_plan)
        : artifact.render_drafts,
    [artifact],
  );

  return (
    <div className="shell">
      <aside className="panel">
        <div className="eyebrow">Scene Runtime Demo</div>
        <h1>Artifact-driven draft preview</h1>
        <p className="lede">
          TypeScript consumer port of the Python runtime contract. This demo
          loads saved artifacts and mirrors normalization plus render-draft
          preview behavior in the browser.
        </p>

        <label className="field">
          <span>Fixture</span>
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value as FixtureKey)}
          >
            <option value="pine_tree">Single object create</option>
            <option value="barrel_triangle">Grouped layout create</option>
            <option value="clarification">Clarification request</option>
          </select>
        </label>

        <div className="stats">
          <Stat label="Response type" value={summary.responseType} />
          <Stat
            label="Normalized intents"
            value={String(summary.normalizedIntentCount)}
          />
          <Stat
            label="Grouped instances"
            value={String(summary.groupedInstanceCount)}
          />
          <Stat
            label="Render drafts"
            value={String(summary.renderDraftCount)}
          />
        </div>

        <section className="artifact-card">
          <h2>Diagnostics</h2>
          {summary.diagnostics.length ? (
            <ul>
              {summary.diagnostics.map((diagnostic) => (
                <li key={diagnostic}>{diagnostic}</li>
              ))}
            </ul>
          ) : (
            <p>No diagnostics for this artifact.</p>
          )}
        </section>

        <section className="artifact-card">
          <h2>Draft overview</h2>
          {derivedDrafts.length ? (
            derivedDrafts.map((draft) => (
              <div className="draft-row" key={draft.draft_id}>
                <strong>{draft.display_name}</strong>
                <span>{draft.primitive_nodes.length} preview nodes</span>
              </div>
            ))
          ) : (
            <p>This artifact does not produce a render draft.</p>
          )}
        </section>
      </aside>

      <main className="viewport">
        <Canvas
          camera={{ position: [6, 5, 8], fov: 45 }}
          shadows
        >
          <color attach="background" args={["#d9f0ff"]} />
          <fog attach="fog" args={["#d9f0ff", 10, 30]} />
          <ambientLight intensity={0.65} />
          <directionalLight
            castShadow
            intensity={1.1}
            position={[6, 9, 3]}
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <group position={[0, -1, 0]}>
            <Grid
              args={[30, 30]}
              cellColor="#97b9c8"
              sectionColor="#6a8fa1"
              fadeDistance={18}
              fadeStrength={1}
              position={[0, 0, 0]}
            />
          </group>
          <DraftScene drafts={derivedDrafts} />
          <Environment preset="park" />
          <OrbitControls enableDamping />
        </Canvas>
      </main>
    </div>
  );
}

function DraftScene({ drafts }: { drafts: RenderDraftSpec[] }) {
  if (!drafts.length) {
    return (
      <group>
        <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
          <sphereGeometry args={[0.4, 24, 24]} />
          <meshStandardMaterial color="#f2a9a9" />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      {drafts.flatMap((draft, draftIndex) =>
        draft.primitive_nodes.map((node, nodeIndex) => (
          <DraftNode
            key={`${draft.draft_id}-${nodeIndex}`}
            draftIndex={draftIndex}
            node={node}
          />
        )),
      )}
    </group>
  );
}

function DraftNode({
  draftIndex,
  node,
}: {
  draftIndex: number;
  node: PrimitiveNode;
}) {
  const instanceIndex =
    typeof node.transform.instance_index === "number"
      ? node.transform.instance_index
      : 0;
  const polarAngle =
    typeof node.transform.polar_angle_degrees === "number"
      ? node.transform.polar_angle_degrees
      : null;

  let x = draftIndex * 4 - 2;
  let z = 0;
  if (polarAngle !== null) {
    const radians = (polarAngle * Math.PI) / 180;
    x += Math.cos(radians) * 2.2;
    z += Math.sin(radians) * 2.2;
  } else {
    x += instanceIndex * 1.6 - 0.8;
  }

  const y = node.primitive === "column" ? 0.8 : 0.5;
  const geometry =
    node.primitive === "column" ? (
      <cylinderGeometry args={[0.35, 0.4, 1.6, 18]} />
    ) : (
      <boxGeometry args={[1.2, 1.2, 1.2]} />
    );

  return (
    <mesh position={[x, y, z]} castShadow receiveShadow>
      {geometry}
      <meshStandardMaterial color={materialColor(node.material)} />
    </mesh>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function materialColor(value: string | null | undefined) {
  switch (value) {
    case "red":
      return "#c63a36";
    case "wood":
      return "#8f6745";
    case "bark":
      return "#6d4a35";
    case "pine_green":
      return "#2f7a4a";
    default:
      return "#7aaec2";
  }
}
