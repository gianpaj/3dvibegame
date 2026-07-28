import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useChatTranscript } from "@/hooks/useChatTranscript";
import type { GenerationStageEvent } from "@3dvibegame/scene-authority-ts";

function event(id: string, message: string): GenerationStageEvent {
  return { id, stage: "planning", message, status: "complete", timestamp: "2026-06-02T00:00:00Z" };
}

describe("useChatTranscript", () => {
  it("appends submitted prompts as player messages", () => {
    const { result } = renderHook(() => useChatTranscript({ stageEvents: [] }));

    act(() => result.current.appendPlayerMessage("a red car"));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: "player", label: "You", text: "a red car" });
  });

  it("ignores empty/whitespace prompts", () => {
    const { result } = renderHook(() => useChatTranscript({ stageEvents: [] }));
    act(() => result.current.appendPlayerMessage("   "));
    expect(result.current.messages).toHaveLength(0);
  });

  it("folds in stage events and dedupes by id across re-renders", () => {
    const first = [event("e1", "Planning…")];
    const { result, rerender } = renderHook((props) => useChatTranscript(props), {
      initialProps: { stageEvents: first },
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: "event", label: "Planning", text: "Planning…" });

    // Same event id again → no duplicate; a new id → appended.
    rerender({ stageEvents: [event("e1", "Planning…"), event("e2", "Compiled.")] });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ text: "Compiled." });
  });

  it("caps the transcript at 32 messages, dropping the oldest", () => {
    const { result } = renderHook(() => useChatTranscript({ stageEvents: [] }));

    act(() => {
      for (let i = 0; i < 40; i += 1) result.current.appendPlayerMessage(`msg ${i}`);
    });

    expect(result.current.messages).toHaveLength(32);
    expect(result.current.messages[0].text).toBe("msg 8");
    expect(result.current.messages.at(-1)?.text).toBe("msg 39");
  });
});
