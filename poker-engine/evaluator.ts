import type { Card, ShowdownDetail, ShowdownReason } from "../shared/types";
import { rankValue } from "./cards";

export interface HandScore {
  category: number;
  rankValues: number[];
  kickers: number[];
  name: string;
  bestFive: Card[];
  cards: Card[];
}

const NAMES = ["High card", "One pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];

function combinations<T>(items: T[], choose: number): T[][] {
  if (choose === 0) return [[]];
  if (items.length < choose) return [];
  const [first, ...rest] = items;
  return [
    ...combinations(rest, choose - 1).map((tail) => [first, ...tail]),
    ...combinations(rest, choose),
  ];
}

function straightHigh(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  return null;
}

function assertValidCards(cards: Card[], expected?: number): void {
  if (expected !== undefined && cards.length !== expected) throw new Error(`Expected exactly ${expected} cards`);
  if (cards.some((card) => !/^[2-9TJQKA][shdc]$/.test(card))) throw new Error("Invalid card in poker hand");
  if (new Set(cards).size !== cards.length) throw new Error("Duplicate card in poker hand");
}

function orderedBestFive(cards: Card[], category: number, rankValues: number[]): Card[] {
  let orderedRanks: number[];
  if (category === 4 || category === 8) {
    const high = rankValues[0];
    orderedRanks = high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4];
  } else if (category === 7) {
    orderedRanks = [rankValues[0], rankValues[0], rankValues[0], rankValues[0], rankValues[1]];
  } else if (category === 6) {
    orderedRanks = [rankValues[0], rankValues[0], rankValues[0], rankValues[1], rankValues[1]];
  } else if (category === 3) {
    orderedRanks = [rankValues[0], rankValues[0], rankValues[0], rankValues[1], rankValues[2]];
  } else if (category === 2) {
    orderedRanks = [rankValues[0], rankValues[0], rankValues[1], rankValues[1], rankValues[2]];
  } else if (category === 1) {
    orderedRanks = [rankValues[0], rankValues[0], rankValues[1], rankValues[2], rankValues[3]];
  } else {
    orderedRanks = rankValues;
  }

  const remaining = [...cards];
  return orderedRanks.map((rank) => {
    const index = remaining.findIndex((card) => rankValue(card) === rank);
    if (index < 0) throw new Error("Could not construct best five cards");
    return remaining.splice(index, 1)[0];
  });
}

export function evaluateFive(cards: Card[]): HandScore {
  assertValidCards(cards, 5);
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((card) => card[1] === cards[0][1]);
  const straight = straightHigh(values);
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let category = 0;
  let kickers = values;
  if (flush && straight) [category, kickers] = [8, [straight]];
  else if (groups[0][1] === 4) [category, kickers] = [7, [groups[0][0], groups[1][0]]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) [category, kickers] = [6, [groups[0][0], groups[1][0]]];
  else if (flush) [category, kickers] = [5, values];
  else if (straight) [category, kickers] = [4, [straight]];
  else if (groups[0][1] === 3) [category, kickers] = [3, [groups[0][0], ...groups.slice(1).map(([v]) => v).sort((a, b) => b - a)]];
  else if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    [category, kickers] = [2, [...pairs, groups[2][0]]];
  } else if (groups[0][1] === 2) [category, kickers] = [1, [groups[0][0], ...groups.slice(1).map(([v]) => v).sort((a, b) => b - a)]];

  const bestFive = orderedBestFive(cards, category, kickers);
  return { category, rankValues: kickers, kickers, name: NAMES[category], bestFive, cards: bestFive };
}

export function compareScores(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return Math.sign(a.category - b.category);
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i += 1) {
    if ((a.kickers[i] ?? 0) !== (b.kickers[i] ?? 0)) return Math.sign((a.kickers[i] ?? 0) - (b.kickers[i] ?? 0));
  }
  return 0;
}

export function getShowdownDetail(winner: HandScore, loser: HandScore): ShowdownDetail | undefined {
  if (winner.category !== loser.category) return undefined;
  const decisiveIndex = winner.kickers.findIndex((rank, index) => rank !== loser.kickers[index]);
  if (decisiveIndex < 0) return undefined;

  let reason: ShowdownReason;
  switch (winner.category) {
    case 0: reason = "higher-card"; break;
    case 1: reason = decisiveIndex === 0 ? "higher-pair" : "kicker"; break;
    case 2: reason = decisiveIndex < 2 ? "higher-two-pair" : "kicker"; break;
    case 3: reason = decisiveIndex === 0 ? "higher-trips" : "kicker"; break;
    case 4: reason = "higher-straight"; break;
    case 5: reason = "higher-flush"; break;
    case 6: reason = "higher-full-house"; break;
    case 7: reason = decisiveIndex === 0 ? "higher-quads" : "kicker"; break;
    default: reason = "higher-straight-flush";
  }
  const winningRank = winner.kickers[decisiveIndex];
  const losingRank = loser.kickers[decisiveIndex];
  return { reason, category: winner.category, decisiveIndex, decisiveRank: winningRank, winningRank, losingRank };
}

export function evaluateHand(cards: Card[]): HandScore {
  if (cards.length < 5 || cards.length > 7) throw new Error("A poker hand must contain 5 to 7 cards");
  assertValidCards(cards);
  return combinations(cards, 5).map(evaluateFive).reduce((best, score) => compareScores(score, best) > 0 ? score : best);
}
