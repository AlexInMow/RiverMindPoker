import type { EngineState } from "../poker-engine/game";
import type { ActionType, PlayerId, PlayerProfile, SessionStats, Street } from "../shared/types";

export interface ObservedAction {
  player: PlayerId;
  action: ActionType;
  street: Street;
  amount?: number;
  isAggressive: boolean;
  facingBet: boolean;
}

interface HandFlags {
  voluntary: boolean;
  pfr: boolean;
  threeBet: boolean;
  /** Big blind is the forced first bet; the first voluntary raise is therefore a 2-bet. */
  preflopBetLevel: number;
  preflopAggressor?: PlayerId;
  streetAggressor: Partial<Record<Street, PlayerId>>;
  humanChecked: Partial<Record<Street, boolean>>;
  aiFlopCBet: boolean;
  humanFacedFlopCBet: boolean;
  humanFlopCBet: boolean;
  flopCBetOpportunity: boolean;
  turnBarrelOpportunity: boolean;
  turnBarrel: boolean;
  riverOpportunity: boolean;
  riverAggression: boolean;
  checkRaiseOpportunities: number;
  checkRaises: number;
  checkRaiseRecorded: Partial<Record<Street, boolean>>;
  foldOpportunities: number;
  foldsFacingBet: number;
  foldToThreeBetOpportunities: number;
  foldsToThreeBet: number;
  foldToCBetOpportunities: number;
  foldsToCBet: number;
}

const initialHandFlags = (): HandFlags => ({
  voluntary: false,
  pfr: false,
  threeBet: false,
  preflopBetLevel: 1,
  streetAggressor: {},
  humanChecked: {},
  aiFlopCBet: false,
  humanFacedFlopCBet: false,
  humanFlopCBet: false,
  flopCBetOpportunity: false,
  turnBarrelOpportunity: false,
  turnBarrel: false,
  riverOpportunity: false,
  riverAggression: false,
  checkRaiseOpportunities: 0,
  checkRaises: 0,
  checkRaiseRecorded: {},
  foldOpportunities: 0,
  foldsFacingBet: 0,
  foldToThreeBetOpportunities: 0,
  foldsToThreeBet: 0,
  foldToCBetOpportunities: 0,
  foldsToCBet: 0,
});

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
  private sawFlopHands = 0;
  private calls = 0;
  private aggressiveActions = 0;
  private betTotal = 0;
  private betCount = 0;
  private completed = 0;
  private foldOpportunities = 0;
  private foldsFacingBet = 0;
  private foldToThreeBetOpportunities = 0;
  private foldsToThreeBet = 0;
  private foldToCBetOpportunities = 0;
  private foldsToCBet = 0;
  private flopCBetOpportunities = 0;
  private flopCBets = 0;
  private turnBarrelOpportunities = 0;
  private turnBarrels = 0;
  private riverOpportunities = 0;
  private riverAggressiveHands = 0;
  private checkRaiseOpportunities = 0;
  private checkRaises = 0;
  private flags: HandFlags = initialHandFlags();
  private chips: Array<{ hand: number; chips: number }>;

  constructor(startingStack: number, bigBlind: number) {
    this.startingStack = startingStack;
    this.bigBlind = bigBlind;
    this.chips = [{ hand: 0, chips: startingStack }];
  }

  observe({ player, action, street, amount = 0, isAggressive, facingBet }: ObservedAction): void {
    const priorBetLevel = this.flags.preflopBetLevel;

    if (player === "human" && facingBet) {
      this.flags.foldOpportunities += 1;
      if (action === "fold") this.flags.foldsFacingBet += 1;

      if (street === "preflop" && priorBetLevel === 3) {
        this.flags.foldToThreeBetOpportunities += 1;
        if (action === "fold") this.flags.foldsToThreeBet += 1;
      }
      if (street === "flop" && this.flags.aiFlopCBet && !this.flags.humanFacedFlopCBet) {
        this.flags.humanFacedFlopCBet = true;
        this.flags.foldToCBetOpportunities += 1;
        if (action === "fold") this.flags.foldsToCBet += 1;
      }
      if (street !== "preflop" && this.flags.humanChecked[street] && this.flags.streetAggressor[street] === "ai" && !this.flags.checkRaiseRecorded[street]) {
        this.flags.checkRaiseRecorded[street] = true;
        this.flags.checkRaiseOpportunities += 1;
        if (isAggressive) this.flags.checkRaises += 1;
      }
    }

    if (street === "preflop") {
      if (isAggressive) {
        this.flags.preflopBetLevel += 1;
        this.flags.preflopAggressor = player;
      }

      if (player === "human") {
        const voluntarilyInvested = action === "call" || action === "raise" || action === "bet" || action === "all-in";
        if (voluntarilyInvested) this.flags.voluntary = true;
        if (isAggressive) {
          this.flags.pfr = true;
          if (this.flags.preflopBetLevel === 3) this.flags.threeBet = true;
        }
      }
    } else {
      if (player === "human" && street === "flop" && this.flags.preflopAggressor === "human"
        && !this.flags.streetAggressor.flop && !facingBet && !this.flags.flopCBetOpportunity) {
        this.flags.flopCBetOpportunity = true;
        if (isAggressive) this.flags.humanFlopCBet = true;
      }
      if (player === "human" && street === "turn" && this.flags.humanFlopCBet
        && !this.flags.streetAggressor.turn && !facingBet && !this.flags.turnBarrelOpportunity) {
        this.flags.turnBarrelOpportunity = true;
        if (isAggressive) this.flags.turnBarrel = true;
      }
      if (player === "human" && street === "river") {
        this.flags.riverOpportunity = true;
        if (isAggressive) this.flags.riverAggression = true;
      }
      if (action === "check" && player === "human") this.flags.humanChecked[street] = true;
      if (isAggressive) {
        if (street === "flop" && player === "ai" && this.flags.preflopAggressor === "ai" && !this.flags.streetAggressor.flop) {
          this.flags.aiFlopCBet = true;
        }
        this.flags.streetAggressor[street] = player;
      }
    }

    if (player !== "human") return;
    if (action === "call" || (action === "all-in" && !isAggressive)) this.calls += 1;
    if (isAggressive) {
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
    if (state.board.length >= 3) this.sawFlopHands += 1;
    this.biggestPot = Math.max(this.biggestPot, state.result.pot);
    if (this.flags.voluntary) this.vpipHands += 1;
    if (this.flags.pfr) this.pfrHands += 1;
    if (this.flags.threeBet) this.threeBetHands += 1;
    this.foldOpportunities += this.flags.foldOpportunities;
    this.foldsFacingBet += this.flags.foldsFacingBet;
    this.foldToThreeBetOpportunities += this.flags.foldToThreeBetOpportunities;
    this.foldsToThreeBet += this.flags.foldsToThreeBet;
    this.foldToCBetOpportunities += this.flags.foldToCBetOpportunities;
    this.foldsToCBet += this.flags.foldsToCBet;
    if (this.flags.flopCBetOpportunity) this.flopCBetOpportunities += 1;
    if (this.flags.humanFlopCBet) this.flopCBets += 1;
    if (this.flags.turnBarrelOpportunity) this.turnBarrelOpportunities += 1;
    if (this.flags.turnBarrel) this.turnBarrels += 1;
    if (this.flags.riverOpportunity) this.riverOpportunities += 1;
    if (this.flags.riverAggression) this.riverAggressiveHands += 1;
    this.checkRaiseOpportunities += this.flags.checkRaiseOpportunities;
    this.checkRaises += this.flags.checkRaises;
    this.chips.push({ hand: this.completed, chips: state.players.human.stack });
    this.flags = initialHandFlags();
  }

  profile(): PlayerProfile {
    const pct = (value: number) => this.completed ? Math.round(value / this.completed * 100) : 0;
    const opportunityPct = (value: number, opportunities: number) => opportunities ? Math.round(value / opportunities * 100) : 0;
    const vpip = pct(this.vpipHands);
    const pfr = pct(this.pfrHands);
    const foldFrequency = opportunityPct(this.foldsFacingBet, this.foldOpportunities);
    const aggressionFactor = Number((this.aggressiveActions / Math.max(1, this.calls)).toFixed(2));
    const tendencies: string[] = [];
    if (this.completed < 10) tendencies.push("sample size is still small");
    if (vpip > 40) tendencies.push("enters many pots");
    if (pfr > 28) tendencies.push("raises frequently preflop");
    if (foldFrequency > 60) tendencies.push("folds often when facing pressure");
    if (this.foldToThreeBetOpportunities >= 3 && opportunityPct(this.foldsToThreeBet, this.foldToThreeBetOpportunities) > 65) tendencies.push("often folds to 3-bets");
    if (this.foldToCBetOpportunities >= 3 && opportunityPct(this.foldsToCBet, this.foldToCBetOpportunities) > 60) tendencies.push("often folds to flop continuation bets");
    if (this.flopCBetOpportunities >= 3 && opportunityPct(this.flopCBets, this.flopCBetOpportunities) > 70) tendencies.push("continuation-bets the flop frequently");
    if (this.turnBarrelOpportunities >= 3 && opportunityPct(this.turnBarrels, this.turnBarrelOpportunities) > 65) tendencies.push("frequently barrels the turn");
    if (aggressionFactor > 2.5) tendencies.push("uses aggressive actions frequently");
    if (!tendencies.length) tendencies.push("no pronounced tendency detected");
    return {
      hands: this.completed,
      vpip,
      pfr,
      threeBet: pct(this.threeBetHands),
      foldFrequency,
      foldOpportunities: this.foldOpportunities,
      foldToThreeBet: opportunityPct(this.foldsToThreeBet, this.foldToThreeBetOpportunities),
      foldToThreeBetOpportunities: this.foldToThreeBetOpportunities,
      foldToCBet: opportunityPct(this.foldsToCBet, this.foldToCBetOpportunities),
      foldToCBetOpportunities: this.foldToCBetOpportunities,
      flopCBet: opportunityPct(this.flopCBets, this.flopCBetOpportunities),
      flopCBetOpportunities: this.flopCBetOpportunities,
      turnBarrel: opportunityPct(this.turnBarrels, this.turnBarrelOpportunities),
      turnBarrelOpportunities: this.turnBarrelOpportunities,
      riverAggression: opportunityPct(this.riverAggressiveHands, this.riverOpportunities),
      riverOpportunities: this.riverOpportunities,
      checkRaise: opportunityPct(this.checkRaises, this.checkRaiseOpportunities),
      checkRaiseOpportunities: this.checkRaiseOpportunities,
      wentToShowdown: opportunityPct(this.showdowns, this.sawFlopHands),
      wentToShowdownOpportunities: this.sawFlopHands,
      wonAtShowdown: opportunityPct(this.showdownWon, this.showdowns),
      wonAtShowdownOpportunities: this.showdowns,
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
