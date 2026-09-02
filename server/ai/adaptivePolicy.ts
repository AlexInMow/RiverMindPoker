import type { AdaptiveMetricConfidence, AdaptivePolicy, PlayerProfile, RepeatedPlayerPattern } from "../../shared/types";

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const rounded = (value: number): number => Number(value.toFixed(3));
const sampleConfidence = (opportunities: number, stabilizingSample: number): number => rounded(1 - Math.exp(-Math.max(0, opportunities) / stabilizingSample));
const highRate = (rate: number, baseline: number): number => clamp((rate - baseline) / (100 - baseline));
const lowRate = (rate: number, baseline: number): number => clamp((baseline - rate) / baseline);

function patternConfidence(patterns: RepeatedPlayerPattern[], names: string[]): number {
  const occurrences = patterns
    .filter((pattern) => names.includes(pattern.pattern))
    .reduce((total, pattern) => total + pattern.occurrences, 0);
  return sampleConfidence(occurrences, 5);
}

export function deriveAdaptivePolicy(profile: PlayerProfile, patterns: RepeatedPlayerPattern[] = []): AdaptivePolicy {
  const metricConfidence: AdaptiveMetricConfidence = {
    preflop: sampleConfidence(profile.hands, 20),
    facingBet: sampleConfidence(profile.foldOpportunities, 12),
    facingThreeBet: sampleConfidence(profile.foldToThreeBetOpportunities, 8),
    facingCBet: sampleConfidence(profile.foldToCBetOpportunities, 10),
    flopCBet: sampleConfidence(profile.flopCBetOpportunities, 10),
    turnBarrel: sampleConfidence(profile.turnBarrelOpportunities, 8),
    river: sampleConfidence(profile.riverOpportunities, 8),
    checkRaise: sampleConfidence(profile.checkRaiseOpportunities, 8),
    wentToShowdown: sampleConfidence(profile.wentToShowdownOpportunities, 15),
    wonAtShowdown: sampleConfidence(profile.wonAtShowdownOpportunities, 12),
    repeatedPatterns: patternConfidence(patterns, patterns.map((pattern) => pattern.pattern)),
  };

  const aggressivePatternNames = [
    "preflop-aggression",
    "preflop-aggression+flop-pressure",
    "flop-cbet",
    "turn-barrel",
    "check-raise",
    "river-aggression",
  ];
  const repeatedAggression = patternConfidence(patterns, aggressivePatternNames);
  const repeatedFoldToThreeBet = patternConfidence(patterns, ["fold-to-3bet"]);
  const preflopPressure = Math.max(highRate(profile.pfr, 28), highRate(profile.threeBet, 10)) * metricConfidence.preflop;
  const postflopPressure = Math.max(
    highRate(profile.flopCBet, 65) * metricConfidence.flopCBet,
    highRate(profile.turnBarrel, 60) * metricConfidence.turnBarrel,
    highRate(profile.riverAggression, 55) * metricConfidence.river,
    highRate(profile.checkRaise, 12) * metricConfidence.checkRaise,
  );
  const pressure = clamp(Math.max(preflopPressure, postflopPressure, repeatedAggression));

  const foldLeak = clamp(Math.max(
    highRate(profile.foldFrequency, 55) * metricConfidence.facingBet,
    highRate(profile.foldToThreeBet, 60) * metricConfidence.facingThreeBet,
    highRate(profile.foldToCBet, 60) * metricConfidence.facingCBet,
    repeatedFoldToThreeBet,
  ));
  const sticky = clamp(Math.max(
    lowRate(profile.foldFrequency, 38) * metricConfidence.facingBet,
    highRate(profile.wentToShowdown, 42) * metricConfidence.wentToShowdown,
  ));
  const losesAtShowdown = lowRate(profile.wonAtShowdown, 45) * metricConfidence.wonAtShowdown;
  const loosePassive = clamp(Math.min(
    highRate(profile.vpip, 38) * metricConfidence.preflop,
    lowRate(profile.pfr, 20) * metricConfidence.preflop,
  ));
  const tight = lowRate(profile.vpip, 25) * metricConfidence.preflop;

  let opponentType: AdaptivePolicy["opponentType"] = "balanced";
  let confidence = Math.max(pressure, foldLeak, sticky, loosePassive, tight);
  if (profile.hands < 3 || confidence < 0.18) opponentType = "unknown";
  else if (loosePassive >= 0.25 && sticky >= 0.18) opponentType = "calling-station";
  else if (pressure >= Math.max(0.22, foldLeak, tight)) opponentType = "aggressive";
  else if (Math.max(foldLeak, tight) >= 0.22) opponentType = "nit";

  const stationEvidence = opponentType === "calling-station" ? Math.max(loosePassive, sticky, losesAtShowdown) : 0;
  const reasons: string[] = [];
  if (pressure >= 0.18) reasons.push("confirmed repeated aggression: defend wider and add value re-raises");
  if (foldLeak >= 0.18) reasons.push("confirmed folding leak: increase pressure and selective bluffs");
  if (stationEvidence >= 0.18) reasons.push("loose-passive showdown tendency: bluff less and value-bet thinner");
  if (!reasons.length) reasons.push("insufficient metric-specific sample: stay close to balanced");

  confidence = rounded(clamp(confidence));
  return {
    opponentType,
    confidence,
    metricConfidence,
    frequencyAdjustments: {
      defend: rounded(clamp(pressure * 0.22, 0, 0.22)),
      call: rounded(clamp(pressure * 0.14, 0, 0.14)),
      raise: rounded(clamp(pressure * 0.1 + foldLeak * 0.15 + stationEvidence * 0.08, 0, 0.24)),
      fold: rounded(-clamp(pressure * 0.24, 0, 0.24)),
      bluff: rounded(clamp(foldLeak * 0.15 - pressure * 0.05 - stationEvidence * 0.18, -0.18, 0.15)),
      value: rounded(clamp(pressure * 0.06 + stationEvidence * 0.28, 0, 0.24)),
    },
    reasons,
  };
}
