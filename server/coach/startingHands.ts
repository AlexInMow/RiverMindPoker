import type { Card } from "../../shared/types";
import { RANKS, rankValue } from "../../poker-engine/cards";
import { classifyPreflopHand } from "../ai/preflop";

/** Canonical notation shares the existing preflop classifier; reject impossible physical cards first. */
export function getStartingHandClass(first: Card, second: Card): string {
  if (![first, second].every((c) => /^[2-9TJQKA][shdc]$/.test(c)) || first === second) throw new Error("Two distinct valid cards required");
  return classifyPreflopHand([first, second]).label;
}
export type StartingCategory = "premium" | "very-strong" | "strong" | "playable" | "marginal" | "weak" | "trash";
export type StartingTrait = "pair" | "broadway" | "suited" | "offsuit" | "suited-ace" | "suited-king" | "connector" | "one-gap" | "two-gap" | "wheel-ace" | "high-card" | "dominated-kicker" | "set-mining" | "nut-flush";
export interface StartingProfile { handClass: string; rating: number; category: StartingCategory; traits: StartingTrait[] }
function profile(cards: [Card, Card]): StartingProfile {
  const handClass = getStartingHandClass(...cards);
  const [high, low] = cards.map(rankValue).sort((a, b) => b - a);
  const pair = high === low, suited = cards[0][1] === cards[1][1];
  const rating = Math.round(classifyPreflopHand(cards).strength * 100);
  const category: StartingCategory = rating >= 90 ? "premium" : rating >= 78 ? "very-strong" : rating >= 65 ? "strong" : rating >= 40 ? "playable" : rating >= 25 ? "marginal" : rating >= 12 ? "weak" : "trash";
  const traits: StartingTrait[] = [];
  if (pair) { traits.push("pair"); if (high <= 9) traits.push("set-mining"); }
  else {
    traits.push(suited ? "suited" : "offsuit");
    if (low >= 10) traits.push("broadway");
    if (high >= 12) traits.push("high-card");
    if (high === 14 && low <= 12 || high === 13 && low <= 11 || high === 12 && low <= 10) traits.push("dominated-kicker");
    if (suited && high === 14) traits.push("suited-ace", "nut-flush");
    if (suited && high === 13) traits.push("suited-king");
    if (high === 14 && low <= 5) traits.push("wheel-ace");
    if (high - low === 1 || high === 14 && low === 2) traits.push("connector");
    else if (high - low === 2 || high === 14 && low === 3) traits.push("one-gap");
    else if (high - low === 3 || high === 14 && low === 4) traits.push("two-gap");
  }
  return { handClass, rating, category, traits };
}
/** Materialized once: 13 pairs + 78 suited + 78 offsuit. Rating method: local-preflop-v1. */
export const STARTING_HANDS: Readonly<Record<string, StartingProfile>> = Object.freeze(Object.fromEntries(RANKS.flatMap((r, i) => RANKS.slice(0, i + 1).flatMap((low) => {
  const combos: [Card, Card][] = r === low ? [[`${r}s`, `${low}h`]] : [[`${r}s`, `${low}s`], [`${r}s`, `${low}h`]];
  return combos.map((cards) => { const p = profile(cards); return [p.handClass, Object.freeze({ ...p, traits: Object.freeze(p.traits) })]; });
})))) as Readonly<Record<string, StartingProfile>>;
