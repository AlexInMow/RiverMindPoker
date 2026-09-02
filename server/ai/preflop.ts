import { rankValue } from "../../poker-engine/cards";
import type { Card, PreflopHandClass } from "../../shared/types";

export interface PreflopHandProfile {
  handClass: PreflopHandClass;
  label: string;
  strength: number;
}

const pairStrength: Record<number, number> = {
  14: 1, 13: 0.97, 12: 0.93, 11: 0.83, 10: 0.78,
  9: 0.68, 8: 0.64, 7: 0.6, 6: 0.56, 5: 0.5, 4: 0.46, 3: 0.42, 2: 0.39,
};

const explicitStrength: Record<string, number> = {
  AKs: 0.9, AKo: 0.87, AQs: 0.81, AQo: 0.76, AJs: 0.73, AJo: 0.65,
  ATs: 0.67, KQs: 0.72, KQo: 0.63, KJs: 0.65, QJs: 0.62, JTs: 0.59,
  T9s: 0.55, "98s": 0.52, "87s": 0.49, "76s": 0.46, "65s": 0.43, "54s": 0.4,
};

function rankSymbol(value: number): string {
  return value === 14 ? "A" : value === 13 ? "K" : value === 12 ? "Q" : value === 11 ? "J" : value === 10 ? "T" : String(value);
}

export function classifyPreflopHand(cards: Card[]): PreflopHandProfile {
  if (cards.length !== 2) throw new Error("Preflop classification requires exactly two hole cards");
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const [high, low] = values;
  const pair = high === low;
  const suited = cards[0][1] === cards[1][1];
  const label = pair ? `${rankSymbol(high)}${rankSymbol(low)}` : `${rankSymbol(high)}${rankSymbol(low)}${suited ? "s" : "o"}`;
  let strength = pair
    ? pairStrength[high]
    : explicitStrength[label] ?? Math.max(0.05, Math.min(0.62,
      (high - 7) * 0.045 + (low - 2) * 0.025 + (suited ? 0.07 : 0) - Math.max(0, high - low - 3) * 0.025,
    ));
  strength = Number(strength.toFixed(3));

  let handClass: PreflopHandClass;
  if (pair && high >= 12 || label === "AKs" || label === "AKo") handClass = "premium";
  else if (pair && high >= 10 || ["AQs", "AQo", "AJs", "KQs"].includes(label)) handClass = "strong";
  else if (pair && high >= 6 || ["ATs", "KJs", "QJs", "JTs", "AJo", "KQo"].includes(label)) handClass = "medium";
  else if (pair || suited && (high === 14 || high - low <= 2)) handClass = "speculative";
  else handClass = "weak";
  return { handClass, label, strength };
}
