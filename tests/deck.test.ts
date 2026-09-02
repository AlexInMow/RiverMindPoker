import { describe, expect, it } from "vitest";
import { createDeck, shuffleDeck } from "../poker-engine/cards";
import { applyAction, assertCardIntegrity, createGame, startNextHand } from "../poker-engine/game";
import type { Card, GameConfig } from "../shared/types";

const config: GameConfig = {
  language: "ru", startingStack: 1000, smallBlind: 50, bigBlind: 100, strategy: "balanced", difficulty: "strong", tableTalk: false, coachMode: false, debugMode: true,
};

function allCardZones(game: ReturnType<typeof createGame>): Card[] {
  return [...game.deck, ...game.players.human.cards, ...game.players.ai.cards, ...game.board, ...game.burnCards];
}

describe("cryptographically shuffled deck lifecycle", () => {
  it("creates exactly one standard deck of 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("uses a bounded integer RNG for every Fisher-Yates step", () => {
    const upperBounds: number[] = [];
    const shuffled = shuffleDeck(createDeck(), (upperExclusive) => {
      upperBounds.push(upperExclusive);
      return upperExclusive - 1;
    });
    expect(upperBounds).toEqual(Array.from({ length: 51 }, (_, index) => 52 - index));
    expect(shuffled).toEqual(createDeck());
  });

  it("maintains a complete unique 52-card partition through flop, turn and river burns", () => {
    const game = createGame(config);
    const initialHoles = structuredClone({ human: game.players.human.cards, ai: game.players.ai.cards });
    expect(game.cardsDrawn).toBe(4);
    expect(game.deck).toHaveLength(48);
    expect(game.burnCards).toHaveLength(0);

    applyAction(game, "human", { type: "call" });
    applyAction(game, "ai", { type: "check" });
    expect(game.street).toBe("flop");
    expect(game.board).toHaveLength(3);
    expect(game.burnCards).toHaveLength(1);
    expect(game.cardsDrawn).toBe(8);
    expect(game.deck).toHaveLength(44);
    assertCardIntegrity(game, "flop test");

    applyAction(game, "ai", { type: "check" });
    applyAction(game, "human", { type: "check" });
    expect(game.street).toBe("turn");
    expect(game.board).toHaveLength(4);
    expect(game.burnCards).toHaveLength(2);
    expect(game.cardsDrawn).toBe(10);
    expect(game.deck).toHaveLength(42);
    assertCardIntegrity(game, "turn test");

    applyAction(game, "ai", { type: "check" });
    applyAction(game, "human", { type: "check" });
    expect(game.street).toBe("river");
    expect(game.board).toHaveLength(5);
    expect(game.burnCards).toHaveLength(3);
    expect(game.cardsDrawn).toBe(12);
    expect(game.deck).toHaveLength(40);
    expect(game.players.human.cards).toEqual(initialHoles.human);
    expect(game.players.ai.cards).toEqual(initialHoles.ai);
    expect(allCardZones(game)).toHaveLength(52);
    expect(new Set(allCardZones(game)).size).toBe(52);
    assertCardIntegrity(game, "river test");
  });

  it("rejects duplicate cards, changed hole cards, a second shuffle and a backward deck pointer", () => {
    const duplicate = createGame(config);
    duplicate.players.ai.cards[0] = duplicate.players.human.cards[0];
    expect(() => assertCardIntegrity(duplicate, "duplicate injection")).toThrow(/52 unique cards/);

    const changedHole = createGame(config);
    const replacement = changedHole.deck[0];
    const original = changedHole.players.human.cards[0];
    changedHole.players.human.cards[0] = replacement;
    changedHole.deck[0] = original;
    expect(() => assertCardIntegrity(changedHole, "hole mutation")).toThrow(/hole cards changed/);

    const reshuffled = createGame(config);
    reshuffled.shuffleCount += 1;
    expect(() => assertCardIntegrity(reshuffled, "repeat shuffle")).toThrow(/shuffled exactly once/);

    const rewound = createGame(config);
    applyAction(rewound, "human", { type: "call" });
    applyAction(rewound, "ai", { type: "check" });
    const returnedCard = rewound.board.pop()!;
    rewound.deck.push(returnedCard);
    rewound.cardsDrawn -= 1;
    expect(() => assertCardIntegrity(rewound, "pointer rewind")).toThrow(/pointer moved backward/);
  });

  it("gives each new hand a new handId and a separately shuffled deck", () => {
    const firstIndex = (upperExclusive: number) => upperExclusive - 1;
    const middleIndex = (upperExclusive: number) => Math.floor(upperExclusive / 2);
    const game = createGame(config, firstIndex);
    const firstHandId = game.handId;
    const firstCards = [...game.players.human.cards, ...game.players.ai.cards, ...game.deck];
    applyAction(game, "human", { type: "fold" });
    startNextHand(game, middleIndex);
    const secondCards = [...game.players.human.cards, ...game.players.ai.cards, ...game.deck];
    expect(game.handId).not.toBe(firstHandId);
    expect(game.shuffleCount).toBe(1);
    expect(game.shuffledHandId).toBe(game.handId);
    expect(secondCards).not.toEqual(firstCards);
    assertCardIntegrity(game, "new hand test");
  });

  it("passes 10,000 crypto-RNG deals with no duplicates and no obvious first-card bias", () => {
    const cardCounts = new Map<Card, number>(createDeck().map((card) => [card, 0]));
    const suitCounts = new Map<string, number>([["s", 0], ["h", 0], ["d", 0], ["c", 0]]);
    const rankCounts = new Map<string, number>("23456789TJQKA".split("").map((rank) => [rank, 0]));

    for (let hand = 0; hand < 10_000; hand += 1) {
      const game = createGame(config);
      const zones = allCardZones(game);
      expect(zones).toHaveLength(52);
      expect(new Set(zones).size).toBe(52);
      expect(game.players.human.cards).toHaveLength(2);
      expect(game.players.ai.cards).toHaveLength(2);
      expect(game.players.human.cards.some((card) => game.players.ai.cards.includes(card))).toBe(false);
      expect(game.board.some((card) => game.players.human.cards.includes(card) || game.players.ai.cards.includes(card))).toBe(false);
      expect(game.shuffleCount).toBe(1);
      expect(game.cardsDrawn).toBe(4);
      assertCardIntegrity(game, `crypto deal ${hand + 1}`);

      const firstCard = game.players.human.cards[0];
      cardCounts.set(firstCard, cardCounts.get(firstCard)! + 1);
      suitCounts.set(firstCard[1], suitCounts.get(firstCard[1])! + 1);
      rankCounts.set(firstCard[0], rankCounts.get(firstCard[0])! + 1);
    }

    const expectedCardFrequency = 10_000 / 52;
    for (const count of cardCounts.values()) {
      expect(count).toBeGreaterThan(expectedCardFrequency * 0.5);
      expect(count).toBeLessThan(expectedCardFrequency * 1.5);
    }
    for (const count of suitCounts.values()) {
      expect(count).toBeGreaterThan(2200);
      expect(count).toBeLessThan(2800);
    }
    for (const count of rankCounts.values()) {
      expect(count).toBeGreaterThan(620);
      expect(count).toBeLessThan(920);
    }
  }, 30_000);
});
