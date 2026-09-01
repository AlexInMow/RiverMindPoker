import type { EngineState } from "../poker-engine/game";
import type { ActionType, PlayerProfile, SessionStats, Street } from "../shared/types";

interface HandFlags { voluntary: boolean; pfr: boolean; threeBet: boolean; preflopRaises: number; }

export class StatsTracker {
  private startingStack: number;
  private bigBlind: number;
  private won = 0;
  private showdowns = 0;
  private showdownWon = 0;
  private biggestPot = 0;
  private vpipHands = 0;
  private pfrHands = 0;
  private threeBetHands = 0;
  private folds = 0;
  private calls = 0;
  private aggressiveActions = 0;
  private betTotal = 0;
  private betCount = 0;
  private completed = 0;
  private flags: HandFlags = { voluntary: false, pfr: false, threeBet: false, preflopRaises: 0 };
  private chips: Array<{ hand: number; chips: number }>;

  constructor(startingStack: number, bigBlind: number) {
    this.startingStack = startingStack;
    this.bigBlind = bigBlind;
    this.chips = [{ hand: 0, chips: startingStack }];
  }

  observe(action: ActionType, street: Street, amount = 0): void {
    if (["call", "bet", "raise", "all-in"].includes(action)) this.flags.voluntary = true;
    if (street === "preflop" && ["raise", "all-in"].includes(action)) {
      this.flags.preflopRaises += 1;
      this.flags.pfr = true;
      if (this.flags.preflopRaises >= 2) this.flags.threeBet = true;
    }
    if (action === "fold") this.folds += 1;
    if (action === "call") this.calls += 1;
    if (["bet", "raise", "all-in"].includes(action)) {
      this.aggressiveActions += 1;
      this.betTotal += amount;
      this.betCount += 1;
    }
  }

  finish(state: EngineState): void {
    if (!state.result) return;
    this.completed += 1;
    if (state.result.winners.includes("human")) this.won += 1;
    if (state.result.humanHand) {
      this.showdowns += 1;
      if (state.result.winners.includes("human")) this.showdownWon += 1;
    }
    this.biggestPot = Math.max(this.biggestPot, state.result.pot);
    if (this.flags.voluntary) this.vpipHands += 1;
    if (this.flags.pfr) this.pfrHands += 1;
    if (this.flags.threeBet) this.threeBetHands += 1;
    this.chips.push({ hand: this.completed, chips: state.players.human.stack });
    this.flags = { voluntary: false, pfr: false, threeBet: false, preflopRaises: 0 };
  }

  profile(): PlayerProfile {
    const pct = (value: number) => this.completed ? Math.round(value / this.completed * 100) : 0;
    const vpip = pct(this.vpipHands);
    const pfr = pct(this.pfrHands);
    const foldFrequency = Math.round(this.folds / Math.max(1, this.folds + this.calls) * 100);
    const aggressionFactor = Number((this.aggressiveActions / Math.max(1, this.calls)).toFixed(2));
    const tendencies: string[] = [];
    if (this.completed < 10) tendencies.push("sample size is still small");
    if (vpip > 40) tendencies.push("enters many pots");
    if (pfr > 28) tendencies.push("raises frequently preflop");
    if (foldFrequency > 60) tendencies.push("folds often when facing pressure");
    if (aggressionFactor > 2.5) tendencies.push("uses aggressive actions frequently");
    if (!tendencies.length) tendencies.push("no pronounced tendency detected");
    return {
      hands: this.completed,
      vpip,
      pfr,
      threeBet: pct(this.threeBetHands),
      foldFrequency,
      aggressionFactor,
      averageBetSize: Math.round(this.betTotal / Math.max(1, this.betCount)),
      tendencies,
    };
  }

  stats(currentStack: number): SessionStats {
    const profile = this.profile();
    const netChips = currentStack - this.startingStack;
    return {
      ...profile,
      handsWon: this.won,
      showdowns: this.showdowns,
      showdownsWon: this.showdownWon,
      biggestPot: this.biggestPot,
      netChips,
      bbPer100: this.completed ? Number((netChips / this.bigBlind / this.completed * 100).toFixed(1)) : 0,
      chipHistory: this.chips,
    };
  }
}
