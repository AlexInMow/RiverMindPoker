import type { Difficulty, Language, Strategy } from "../../shared/types";

const strategyPrompts: Record<Strategy, string> = {
  balanced: "Play a balanced, practical style. Mix value and bluffs without becoming recklessly aggressive or passive.",
  tag: "Play tight-aggressive: enter fewer pots, apply pressure with a strong range, and avoid loose marginal calls.",
  lag: "Play loose-aggressive: defend a wider range, pressure capped ranges, and include credible bluffs.",
  nit: "Play very tight and risk-aware. Prefer strong ranges and avoid large marginal spots.",
  "calling-station": "Call wider with bluff-catchers and draws, raise infrequently, and do not fold medium strength too readily.",
  maniac: "Play extremely aggressively with frequent raises, 3-bets, bluffs, and occasional overbets, while staying inside legal actions.",
  tricky: "Use traps, check-raises, delayed aggression, and mixed lines so your play is difficult to read.",
  adaptive: "Exploit the supplied aggregate player profile. Adjust to observed leaks while keeping the sample size in mind.",
};

const difficultyPrompts: Record<Difficulty, string> = {
  casual: "Use basic hand strength and position. Occasionally choose a plausible suboptimal line.",
  strong: "Consider ranges, pot odds, position, stack-to-pot ratio, board texture, and coherent bet sizing.",
  expert: "Think carefully about ranges, pot and implied odds, board texture, blockers, position, SPR, sizing, and value/bluff balance. You are not a GTO solver and must not claim to be one.",
};

export function decisionInstructions(strategy: Strategy, difficulty: Difficulty, tableTalk: boolean, language: Language): string {
  return [
    "You are the AI player in a heads-up no-limit Texas Hold'em game. The deterministic application is the dealer and arbiter.",
    "Choose exactly one of the supplied legal actions. Never invent game state, award a pot, deal cards, or alter rules.",
    "You only know the structured state provided. Never infer or claim knowledge of the human's hidden cards.",
    strategyPrompts[strategy],
    difficultyPrompts[difficulty],
    "Return a short reasoning_summary suitable for a coach; do not reveal private chain-of-thought.",
    tableTalk ? "table_talk may be one brief, natural sentence that reveals no cards or analysis." : "table_talk must be an empty string.",
    language === "ru" ? "Write reasoning_summary and table_talk in natural Russian." : "Write reasoning_summary and table_talk in English.",
  ].join("\n");
}
