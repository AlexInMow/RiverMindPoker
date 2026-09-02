import { createDeck, rankValue } from "../poker-engine/cards";
import { applyAction, assertCardIntegrity, createGame, getLegalActions, startNextHand, type EngineState } from "../poker-engine/game";
import type { Card, GameConfig, Strategy } from "../shared/types";
import { dummyDecision } from "../server/ai/dummyBot";
import { SessionStore } from "../server/session";

const trials = 5_000;
const config: GameConfig = {
  language: "en", startingStack: 1_000, smallBlind: 5, bigBlind: 10,
  strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: false,
};
const hands: Record<string, Card[]> = {
  AA: ["As", "Ah"], KK: ["Ks", "Kh"], QQ: ["Qs", "Qh"], AKs: ["As", "Ks"], AKo: ["As", "Kh"],
  JJ: ["Js", "Jh"], TT: ["Ts", "Th"], AQs: ["As", "Qs"], AQo: ["As", "Qh"], AJs: ["As", "Js"],
  KQs: ["Ks", "Qs"], JTs: ["Js", "Ts"], "99": ["9s", "9h"], "76s": ["7s", "6s"], A5s: ["As", "5s"],
  K6o: ["Ks", "6h"], K2o: ["Ks", "2h"], "72o": ["7s", "2h"],
};

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => (value = (value * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000;
}

function rig(game: EngineState, aiCards: Card[]): void {
  const human = createDeck().filter((card) => !aiCards.includes(card)).slice(0, 2);
  const used = new Set([...human, ...aiCards]);
  game.players.human.cards = human;
  game.players.ai.cards = [...aiCards];
  game.initialHoleCards = { human: [...human], ai: [...aiCards] };
  game.deck = createDeck().filter((card) => !used.has(card));
  game.cardsDrawn = 4;
  game.validatedCardsDrawn = 4;
  assertCardIntegrity(game, "preflop simulation fixture");
}

function reachableSpot(hand: Card[], level: 2 | 3 | 4 | 5) {
  const store = new SessionStore();
  const session = store.create(config, () => 0);
  const game = session.state;
  if (level % 2 === 1) {
    applyAction(game, "human", { type: "fold" });
    startNextHand(game, () => 0);
  }
  rig(game, hand);
  if (level === 2) applyAction(game, "human", { type: "raise", amount: 25 });
  if (level === 3) {
    applyAction(game, "ai", { type: "raise", amount: 25 });
    applyAction(game, "human", { type: "raise", amount: 80 });
  }
  if (level === 4) {
    applyAction(game, "human", { type: "raise", amount: 25 });
    applyAction(game, "ai", { type: "raise", amount: 80 });
    applyAction(game, "human", { type: "raise", amount: 200 });
  }
  if (level === 5) {
    applyAction(game, "ai", { type: "raise", amount: 25 });
    applyAction(game, "human", { type: "raise", amount: 80 });
    applyAction(game, "ai", { type: "raise", amount: 200 });
    applyAction(game, "human", { type: "raise", amount: 450 });
  }
  return store.aiVisibleState(session);
}

function decisionFrequencies(hand: Card[], level: 2 | 3 | 4 | 5) {
  const state = reachableSpot(hand, level);
  const random = seeded(0xc001d00d + level);
  const counts: Record<string, number> = { fold: 0, call: 0, raise: 0, "all-in": 0 };
  for (let trial = 0; trial < trials; trial += 1) {
    const action = dummyDecision(state, "balanced", false, "en", random).action;
    counts[action] = (counts[action] ?? 0) + 1;
  }
  const pct = (name: string) => Number((100 * counts[name] / trials).toFixed(1));
  return `${pct("fold")}/${pct("call")}/${pct("raise")}/${pct("all-in")}`;
}

function raiseWar(hand: Card[], strategy: Strategy, random: () => number): boolean {
  const store = new SessionStore();
  const session = store.create({ ...config, strategy }, () => 0);
  const game = session.state;
  rig(game, hand);
  applyAction(game, "human", { type: "raise", amount: 20 });
  for (let actionCount = 0; game.street === "preflop" && actionCount < 40; actionCount += 1) {
    if (game.actor === "ai") {
      const decision = dummyDecision(store.aiVisibleState(session), strategy, false, "en", random);
      applyAction(game, "ai", { type: decision.action, amount: decision.amount });
      if (decision.action === "all-in" || game.players.ai.totalContribution >= 800) return true;
      if (decision.action !== "raise") return false;
    } else {
      const raise = getLegalActions(game, "human").find((action) => action.type === "raise");
      if (raise) applyAction(game, "human", { type: "raise", amount: raise.min });
      else {
        const shove = getLegalActions(game, "human").find((action) => action.type === "all-in" && (action.amount ?? 0) > game.currentBet);
        if (!shove) return game.players.ai.totalContribution >= 800;
        applyAction(game, "human", { type: "all-in" });
      }
    }
  }
  return game.players.ai.totalContribution >= 800;
}

function stackOffFrequency(hand: Card[], strategy: Strategy): string {
  const random = seeded(0x5157ac + strategy.length);
  let count = 0;
  for (let trial = 0; trial < trials; trial += 1) count += Number(raiseWar(hand, strategy, random));
  return `${(100 * count / trials).toFixed(1)}%`;
}

function legacyStackOffFrequency(hand: Card[], strategy: Strategy): string {
  const [a, b] = hand.map(rankValue);
  const pair = a === b ? 0.42 + a / 35 : 0;
  const suited = hand[0][1] === hand[1][1] ? 0.07 : 0;
  const connected = Math.abs(a - b) <= 2 ? 0.05 : 0;
  const legacyStrength = Math.min(1, Math.max(a, b) / 18 + pair + suited + connected);
  // The prior implementation deterministically raised at every level whenever
  // this coarse score exceeded one global 0.68 value threshold.
  if (legacyStrength > 0.68) return "100.0%";
  const coefficient = strategy === "maniac" ? 0.86 : strategy === "adaptive" ? 0.48 : 0.45;
  const perRaise = coefficient * (0.28 + legacyStrength * 0.5);
  return `${(100 * perRaise ** 8).toFixed(1)}%`;
}

console.log(`LocalBot preflop simulation — ${trials.toLocaleString()} seeded decisions per hand/spot; values are fold/call/raise/jam %`);
console.table(Object.fromEntries(Object.entries(hands).map(([name, hand]) => [name, {
  "facing open": decisionFrequencies(hand, 2),
  "facing 3-bet": decisionFrequencies(hand, 3),
  "facing 4-bet": decisionFrequencies(hand, 4),
  "facing 5-bet": decisionFrequencies(hand, 5),
}])));

console.log(`Deep 100 BB repeated-min-reraise stack-off — ${trials.toLocaleString()} independent first hands per cell`);
const reportHands = ["AA", "KK", "QQ", "AKs", "AKo", "JJ", "JTs", "K6o", "K2o", "72o"];
console.table(Object.fromEntries(reportHands.map((name) => [name, {
  "Legacy Balanced": legacyStackOffFrequency(hands[name], "balanced"),
  Balanced: stackOffFrequency(hands[name], "balanced"),
  "Legacy Adaptive": legacyStackOffFrequency(hands[name], "adaptive"),
  "Adaptive hand #1": stackOffFrequency(hands[name], "adaptive"),
  "Legacy Maniac": legacyStackOffFrequency(hands[name], "maniac"),
  Maniac: stackOffFrequency(hands[name], "maniac"),
}])));
