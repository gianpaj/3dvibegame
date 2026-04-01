/**
 * Conversation thread — multi-turn context for a player's object creation session.
 *
 * Each time a player submits a prompt (new or follow-up), a ConversationTurn is
 * appended. The thread tracks which object the conversation is about and is included
 * in GenerationIntent so the AI worker can resolve references like "it", "the car",
 * "a longer one", etc.
 *
 * Intent classification (refine / replace / create) uses lightweight heuristics on
 * the raw prompt text. The AI worker should re-classify using full context, but the
 * session controller needs a local classification to decide whether to discard the
 * current draft before queuing a new create request.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationRole = "player" | "assistant";

/**
 * What the session controller should do in response to a follow-up prompt.
 *
 * - "create"  — no active object or no reference; treat as a brand-new request.
 * - "refine"  — the player wants to modify the current draft (small/medium changes);
 *               use operation: "refine" and keep the same object_id.
 * - "replace" — the player rejected the draft entirely; discard it (if still in grace)
 *               and start a fresh create with the new prompt. The AI gets conversation
 *               context so it understands relative references like "longer" or "a bus".
 */
export type ConversationIntentClass = "create" | "refine" | "replace";

export interface ConversationTurn {
  turn_id: string;
  role: ConversationRole;
  text: string;
  /** Which object this turn was referring to, resolved at recording time. */
  referenced_object_id: string | null;
  /** Local classification at the time the turn was recorded. */
  intent_class: ConversationIntentClass;
  timestamp: string;
}

export interface ConversationThread {
  thread_id: string;
  /** The object currently being discussed. Updated as drafts are created/discarded. */
  active_object_id: string | null;
  turns: ConversationTurn[];
}

/**
 * Compact summary of a prior object spec, included in ConversationContext so the
 * AI understands what "longer" or "different" is relative to.
 */
export interface PriorSpecSummary {
  object_category: string;
  size_tier: string;
  style_tags: string[];
  behaviors: string[];
}

/**
 * Sent to the AI worker as part of GenerationIntent. Lets the AI resolve
 * conversational references and understand incremental modifications.
 */
export interface ConversationContext {
  thread_id: string;
  referenced_object_id: string | null;
  /** Last N player turns (no assistant turns — those are just status messages). */
  prior_player_turns: string[];
  /**
   * Summary of the most recently discarded or referenced spec.
   * Present on "replace" so the AI knows what was rejected.
   * Present on "refine" so the AI knows what to modify.
   */
  prior_spec: PriorSpecSummary | null;
  intent_class: ConversationIntentClass;
}

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

/**
 * Signals that the player is rejecting the current draft and wants something
 * structurally different. Matched at start or anywhere in the prompt.
 */
const REPLACE_SIGNALS = [
  "no,",
  "no.",
  "no ",
  "actually",
  "instead",
  "different kind",
  "different type",
  "different shape",
  "completely different",
  "scratch that",
  "forget it",
  "never mind",
  "start over",
  "start again",
];

/**
 * Signals that the player is modifying the active draft (not replacing it).
 * Checked only when a replace signal is absent.
 */
const REFINE_SIGNALS = [
  "make it",
  "make the",
  "change it",
  "change the",
  "add a",
  "add some",
  "taller",
  "wider",
  "shorter",
  "longer",
  "bigger",
  "smaller",
  "more ",
  "less ",
  "darker",
  "lighter",
  "brighter",
];

/**
 * Pronouns and deictic references that indicate the player is talking about an
 * existing object rather than requesting a new one.
 */
const REFERENCE_SIGNALS = [
  " it ",
  " it,",
  " it.",
  "that one",
  "this one",
  "the car",
  "the tree",
  "the barrel",
  "the house",
  "the bus",
  "the object",
  "that thing",
];

export interface ClassifiedIntent {
  intent_class: ConversationIntentClass;
  references_active_object: boolean;
  /** Human-readable reason for the classification (for diagnostics/logging). */
  reason: string;
}

/**
 * Classify a follow-up prompt using lightweight heuristics.
 *
 * This is intentionally conservative: ambiguous prompts default to "create"
 * so the session controller doesn't accidentally discard drafts. The AI worker
 * performs a deeper classification using full conversation context.
 *
 * @param prompt       Raw player prompt text.
 * @param hasActiveDraft  Whether there is an object currently in grace period.
 */
export function classifyFollowUpIntent(
  prompt: string,
  hasActiveDraft: boolean,
): ClassifiedIntent {
  const lower = ` ${prompt.toLowerCase().trim()} `;

  // No active draft — always a fresh create regardless of prompt content
  if (!hasActiveDraft) {
    return {
      intent_class: "create",
      references_active_object: false,
      reason: "no active draft",
    };
  }

  // Replace signals: player is explicitly rejecting the current draft
  const replaceSignal = REPLACE_SIGNALS.find((s) => lower.includes(s));
  if (replaceSignal) {
    return {
      intent_class: "replace",
      references_active_object: true,
      reason: `replace signal "${replaceSignal.trim()}"`,
    };
  }

  // Reference signals without replace: player is referring to the draft (refine)
  const refSignal = REFERENCE_SIGNALS.find((s) => lower.includes(s));
  if (refSignal) {
    return {
      intent_class: "refine",
      references_active_object: true,
      reason: `reference signal "${refSignal.trim()}"`,
    };
  }

  // Refinement signals: structural/aesthetic modification of active draft
  const refineSignal = REFINE_SIGNALS.find((s) => lower.includes(s));
  if (refineSignal) {
    return {
      intent_class: "refine",
      references_active_object: true,
      reason: `refine signal "${refineSignal.trim()}"`,
    };
  }

  // Default: treat as a new create (no evidence of reference to active object)
  return {
    intent_class: "create",
    references_active_object: false,
    reason: "no reference or replacement signal detected",
  };
}

// ---------------------------------------------------------------------------
// Thread factory
// ---------------------------------------------------------------------------

let threadSequence = 0;

export function createConversationThread(initialObjectId?: string): ConversationThread {
  threadSequence += 1;
  return {
    thread_id: `thread_${threadSequence}`,
    active_object_id: initialObjectId ?? null,
    turns: [],
  };
}

// ---------------------------------------------------------------------------
// Thread mutation helpers (return new thread — immutable update pattern)
// ---------------------------------------------------------------------------

let turnSequence = 0;

export function appendPlayerTurn(
  thread: ConversationThread,
  text: string,
  intentClass: ConversationIntentClass,
): ConversationThread {
  turnSequence += 1;
  const turn: ConversationTurn = {
    turn_id: `turn_${turnSequence}`,
    role: "player",
    text,
    referenced_object_id: thread.active_object_id,
    intent_class: intentClass,
    timestamp: new Date().toISOString(),
  };
  return { ...thread, turns: [...thread.turns, turn].slice(-20) };
}

export function updateThreadActiveObject(
  thread: ConversationThread,
  objectId: string | null,
): ConversationThread {
  return { ...thread, active_object_id: objectId };
}

// ---------------------------------------------------------------------------
// Context builder — what the AI worker receives
// ---------------------------------------------------------------------------

const MAX_PRIOR_TURNS = 5;

export function buildConversationContext(
  thread: ConversationThread,
  intentClass: ConversationIntentClass,
  priorSpec: PriorSpecSummary | null,
): ConversationContext {
  const playerTurns = thread.turns
    .filter((t) => t.role === "player")
    .slice(-MAX_PRIOR_TURNS)
    .map((t) => t.text);

  return {
    thread_id: thread.thread_id,
    referenced_object_id: thread.active_object_id,
    prior_player_turns: playerTurns,
    prior_spec: priorSpec,
    intent_class: intentClass,
  };
}
