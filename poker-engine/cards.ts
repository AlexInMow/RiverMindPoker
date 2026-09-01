import type { Card, Rank, Suit } from "../shared/types";

export const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const SUITS: Suit[] = ["s", "h", "d", "c"];

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}` as Card));
}

export function shuffleDeck(deck: Card[], random: () => number = Math.random): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as Rank) + 2;
}

export function cardLabel(card: Card): string {
  const ranks: Record<string, string> = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };
  const suits: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
  return `${ranks[card[0]] ?? card[0]}${suits[card[1] as Suit]}`;
}
