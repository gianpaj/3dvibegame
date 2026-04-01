import type { GenerationStage } from "@3dvibegame/scene-authority-ts";

type DemoEventMap = {
  "generation:prompt-submitted": {
    player_id: string;
    prompt: string;
  };
  "generation:stage-changed": {
    player_id: string;
    stage: GenerationStage;
    object_id?: string | null;
  };
  "object:selected": {
    player_id: string;
    object_id: string | null;
  };
  "viewer:focus-object": {
    player_id: string;
    object_id: string | null;
  };
  "tool:action-requested": {
    player_id: string;
    action_id: string;
  };
  "history:batch-started": {
    player_id: string;
    batch_id: string;
    label: string;
  };
  "history:batch-committed": {
    player_id: string;
    batch_id: string;
    label: string;
  };
};

type EventKey = keyof DemoEventMap;
type EventHandler<TKey extends EventKey> = (payload: DemoEventMap[TKey]) => void;

export function createEventBus() {
  const handlers = new Map<EventKey, Set<(payload: unknown) => void>>();

  return {
    on<TKey extends EventKey>(eventKey: TKey, handler: EventHandler<TKey>) {
      const current = handlers.get(eventKey) ?? new Set<(payload: unknown) => void>();
      current.add(handler as (payload: unknown) => void);
      handlers.set(eventKey, current);
      return () => this.off(eventKey, handler);
    },
    off<TKey extends EventKey>(eventKey: TKey, handler: EventHandler<TKey>) {
      handlers.get(eventKey)?.delete(handler as (payload: unknown) => void);
    },
    emit<TKey extends EventKey>(eventKey: TKey, payload: DemoEventMap[TKey]) {
      handlers.get(eventKey)?.forEach((handler) => {
        handler(payload);
      });
    },
  };
}

export const demoEventBus = createEventBus();

export type { DemoEventMap, EventKey };
