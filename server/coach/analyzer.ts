import { createDeck, rankValue, cardLabel } from "../../poker-engine/cards";
import { evaluateHand, type HandScore } from "../../poker-engine/evaluator";
import type { Card, Language } from "../../shared/types";
import type { CoachAnalysis, CoachDraw } from "../../shared/coach";
import { deriveBoardMetrics } from "../ai/context";
import { analyzePreflop } from "./preflop";
import type { PreflopContext } from "../../shared/preflopCoach";

const rank = (n: number) => n === 14 ? "A" : n === 13 ? "K" : n === 12 ? "Q" : n === 11 ? "J" : String(n);
const rankPlural = (n: number) => ["двоек", "троек", "четвёрок", "пятёрок", "шестёрок", "семёрок", "восьмёрок", "девяток", "десяток", "валетов", "дам", "королей", "тузов"][n - 2];
export function describeHand(score: HandScore, language: Language): string {
  const r = score.rankValues.map(rank);
  if (language === "en") return `${score.name} · ${r.join(" / ")}`;
  return [
    `Старшая карта ${r[0]}`, `Пара ${rankPlural(score.rankValues[0])}`, `Две пары: ${r[0]} и ${r[1]}`,
    `Тройка ${rankPlural(score.rankValues[0])}`, `Стрит ${score.rankValues[0] === 5 ? "A" : rank(score.rankValues[0] - 4)}–${r[0]}`,
    `Флеш, ${r[0]} старший`, `Фулл-хаус: ${r[0]} и ${r[1]}`, `Каре ${r[0]}`, `Стрит-флеш, ${r[0]} старший`,
  ][score.category];
}

/** Uses only the viewer's cards and board; outs are potential improvements, never claimed clean. */
export function analyzeSituation(hole: Card[], board: Card[], language: Language, price?: { call: number; pot: number; contestablePotAfter: number }, preflopContext?: PreflopContext): CoachAnalysis {
  const preflop = board.length === 0 && hole.length === 2 && preflopContext ? analyzePreflop(hole as [Card, Card], preflopContext, language) : undefined;
  const ru = language === "ru";
  const cards = [...hole, ...board];
  const score = cards.length >= 5 && hole.length === 2 ? evaluateHand(cards) : undefined;
  const metrics = deriveBoardMetrics({ board });
  const reasons: string[] = [];
  if (metrics.maxSuitCount >= 3) reasons.push(ru ? "Три или больше карт одной масти: возможен готовый флеш." : "At least three cards of one suit: a made flush is possible.");
  else if (metrics.maxSuitCount === 2) reasons.push(ru ? "Две карты одной масти создают возможности флеш-дро." : "Two suited board cards create flush-draw possibilities.");
  if (metrics.connectedness >= 3) reasons.push(ru ? "Близкие ранги допускают стриты и стрит-дро." : "Nearby ranks allow straights and straight draws.");
  if (metrics.trips) reasons.push(ru ? "Тройка на столе входит в общую комбинацию; кикеры, фулл-хаус и каре особенно важны." : "Board trips are shared; kickers, full houses and quads matter.");
  else if (metrics.paired) reasons.push(ru ? "Спаренная доска: возможны фулл-хаус и каре." : "A paired board allows full houses and quads.");
  if (!reasons.length) reasons.push(ru ? "Мало очевидных дро; готовые руки обычно устойчивее." : "Few obvious draws; made hands tend to be more stable.");
  const draws: CoachDraw[] = [];
  const unseen = createDeck().filter((c) => !cards.includes(c));
  const add = (kind: string, label: string, participating: Card[], outs: Card[], description: string) => {
    if (outs.length) draws.push({ kind, label, cards: participating, potentialOuts: outs, description });
  };
  if (score && (board.length === 3 || board.length === 4)) {
    if (score.category < 5) for (const suit of ["s", "h", "d", "c"]) {
      const suited = cards.filter((c) => c[1] === suit);
      if (suited.length === 4) add("flush", ru ? "Флеш-дро" : "Flush draw", suited, unseen.filter((c) => c[1] === suit), ru ? "Четыре карты одной масти. Это потенциальные ауты: возможны старший флеш или фулл-хаус соперника." : "Four suited cards. Potential outs can lose to a higher flush or full house.");
    }
    if (score.category < 4) {
      const values = new Set(cards.map(rankValue));
      if (values.has(14)) values.add(1);
      const windows: { sequence: number[]; missing: number }[] = [];
      for (let low = 1; low <= 10; low++) {
        const sequence = Array.from({ length: 5 }, (_, i) => low + i);
        const missing = sequence.filter((v) => !values.has(v));
        if (missing.length === 1) windows.push({ sequence, missing: missing[0] === 1 ? 14 : missing[0] });
      }
      const missingRanks = new Set(windows.map((w) => w.missing));
      const oesd = Array.from({ length: 10 }, (_, i) => i + 2).some((low) => low <= 10 && [low, low + 1, low + 2, low + 3].every((v) => values.has(v)) && missingRanks.has(low - 1) && missingRanks.has(low + 4));
      const kind = oesd ? "oesd" : missingRanks.size >= 2 ? "double-gutshot" : "gutshot";
      const labels = { oesd: ru ? "Двустороннее стрит-дро" : "Open-ended straight draw", "double-gutshot": ru ? "Двойной гатшот" : "Double gutshot", gutshot: ru ? "Гатшот" : "Gutshot" };
      const participating = cards.filter((c) => windows.some((w) => w.sequence.includes(rankValue(c)) || rankValue(c) === 14 && w.sequence.includes(1)));
      add(kind, labels[kind], participating, unseen.filter((c) => missingRanks.has(rankValue(c))), ru ? "Карты, закрывающие стрит на следующей улице. Часть может также усилить соперника; дро на столе бывает общим." : "Cards completing a straight next street. Some may help opponents; board draws can be shared.");
    }
    const improvementTargets: Record<number, number[]> = { 0: [1], 1: [2, 3], 2: [6], 3: [6, 7] };
    const targets = improvementTargets[score.category];
    if (targets) {
      const over = hole.filter((c) => rankValue(c) > Math.max(...board.map(rankValue)));
      const improvement = unseen.filter((c) => targets.includes(evaluateHand([...cards, c]).category) && (score.category !== 0 || over.some((h) => rankValue(h) === rankValue(c))));
      const labels = [ru ? "Оверкарты → пара" : "Overcards → pair", ru ? "Пара → две пары / тройка" : "Pair → two pair / trips", ru ? "Две пары → фулл-хаус" : "Two pair → full house", ru ? "Тройка → фулл-хаус / каре" : "Trips → full house / quads"];
      add("improvement", labels[score.category], score.category === 0 ? over : cards.filter((c) => improvement.some((out) => rankValue(out) === rankValue(c))), improvement, ru ? "Улучшение категории по evaluator. Общие карты могут улучшать всех; это не гарантирует победу." : "Evaluator category improvement. Shared cards may improve everyone; winning is not guaranteed.");
    }
    const primary = draws.filter((d) => d.kind !== "improvement");
    if (primary.some((d) => d.kind === "flush") && primary.length > 1) add("combo", ru ? "Комбо-дро" : "Combo draw", [...new Set(primary.flatMap((d) => d.cards))], [...new Set(primary.flatMap((d) => d.potentialOuts))], ru ? "Объединение флеш- и стрит-аутов без двойного подсчёта." : "Union of flush and straight outs, without double counting.");
  }
  const warnings = [ru ? "Эвристический разбор, не GTO. Сила комбинации и количество аутов не равны equity против диапазона." : "Heuristic review, not GTO. Hand strength and outs are not equity against a range."];
  if (draws.length) warnings.push(ru ? "Указаны потенциальные ауты на следующую карту, не чистые ауты и не вероятность выиграть банк." : "Outs are potential next-card improvements, not clean outs or winning probability.");
  if (score && board.length === 5 && evaluateHand(board).category === score.category) warnings.push(ru ? "Доска существенно участвует в комбинации: сравнивайте лучшие пять карт и кикеры, а не только название." : "The board contributes heavily: compare the best five and kickers, not just the category.");
  const potOdds = price && price.call > 0 ? { call: price.call, potBefore: price.pot, potAfter: price.pot + price.call, contestablePotAfter: price.contestablePotAfter, requiredEquity: price.call / price.contestablePotAfter } : undefined;
  if (potOdds) warnings.push(ru ? "Цена колла уже учитывает доступную вам часть банка. Будущие ставки, диапазоны и реализация equity не рассчитаны." : "Call price uses the pot you can contest. Future bets, ranges and equity realization are not calculated.");
  return {
    preflop,
    madeHand: score ? describeHand(score, language) : hole.length === 2 ? (rankValue(hole[0]) === rankValue(hole[1]) ? `${ru ? "Карманная пара" : "Pocket pair"} ${rank(rankValue(hole[0]))}` : `${ru ? "Стартовая рука" : "Starting hand"}: ${hole.map(cardLabel).join(" ")}`) : (ru ? "Карты неизвестны" : "Cards unknown"),
    bestFiveCards: score?.bestFive ?? [], draws, outs: [...new Set(draws.flatMap((d) => d.potentialOuts))],
    boardTexture: { label: board.length < 3 ? (ru ? "Префлоп — доски ещё нет" : "Preflop — no board yet") : metrics.wetness >= .55 ? (ru ? "Динамичная" : "Dynamic") : metrics.wetness >= .3 ? (ru ? "Умеренно динамичная" : "Moderately dynamic") : (ru ? "Относительно сухая" : "Relatively dry"), reasons: board.length ? reasons : [], metrics },
    potOdds, warnings,
    learningConcepts: [...(draws.length ? [{ id: "outs", text: ru ? "Аут — неизвестная карта, которая может улучшить вашу руку. Улучшение не всегда означает победу." : "An out is an unseen card that may improve your hand. Improvement does not always mean winning." }] : []), ...(potOdds ? [{ id: "pot-odds", text: ru ? "Шансы банка: цена колла / доступный банк после колла. Сравнивать нужно с equity против диапазона, а не с технической силой руки." : "Pot odds: call cost / contestable pot after calling. Compare with equity against a range, not raw hand strength." }] : [])],
  };
}
