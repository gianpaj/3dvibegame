// Gemini 2.5 Flash pricing (as of 2026-06).
const INPUT_PRICE_PER_TOKEN = 0.3 / 1_000_000;
// Thinking tokens bill at the output rate.
const OUTPUT_PRICE_PER_TOKEN = 2.5 / 1_000_000;

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface BudgetState {
  utcDay: string;
  spentUsd: number;
}

export function createBudgetTracker(dailyBudgetUsd: number) {
  let state: BudgetState = { utcDay: utcDay(), spentUsd: 0 };

  function resetIfNewDay() {
    const today = utcDay();
    if (state.utcDay !== today) {
      state = { utcDay: today, spentUsd: 0 };
    }
  }

  return {
    checkBudget() {
      resetIfNewDay();
      if (state.spentUsd >= dailyBudgetUsd) {
        throw Object.assign(
          new Error("Daily AI budget reached — try again tomorrow."),
          { code: "budget_exhausted" },
        );
      }
    },

    recordSpend(usage: GeminiUsage): number {
      const inputTokens = usage.promptTokenCount ?? 0;
      const outputTokens =
        (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
      const cost =
        inputTokens * INPUT_PRICE_PER_TOKEN +
        outputTokens * OUTPUT_PRICE_PER_TOKEN;
      state.spentUsd += cost;
      return cost;
    },

    getSpentUsd(): number {
      resetIfNewDay();
      return state.spentUsd;
    },
  };
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}
