import type { EngineState } from "../../poker-engine/game";
import type { Card, Language, LocalBotDecisionTrace, PlayerAction, PlayerId, PublicGameState, Street } from "../../shared/types";
import type { CoachDecision, CoachReport } from "../../shared/coach";
import { analyzeSituation } from "./analyzer";
import { compareScores, evaluateHand } from "../../poker-engine/evaluator";
import { getLegalActions } from "../../poker-engine/game";
import type { PreflopContext } from "../../shared/preflopCoach";

/** Action-time public facts only. Never retain deck, burns or opponents' hole cards. */
export interface CoachSnapshot {
  index: number;
  player: PlayerId;
  street: Street;
  board: Card[];
  pot: number;
  streetBet: number;
  call: number;
  contestablePotAfter: number;
  priorActions: PlayerAction[];
  lastToAct: boolean;
  preflop?: PreflopContext;
  decision?: Pick<LocalBotDecisionTrace, "coachIntent" | "postflopStrength" | "raiseThreshold">;
}
export function captureCoachSnapshot(state: EngineState, id: PlayerId): CoachSnapshot {
  const own = state.players[id]!;
  const call = Math.min(own.stack, Math.max(0, state.currentBet - own.streetBet));
  const cap = own.totalContribution + call;
  const contestablePotAfter = Object.values(state.players).reduce((sum, p) => sum + Math.min(p!.totalContribution, cap), 0) + call;
  const index = state.seats.findIndex((s) => s.playerId === state.button);
  const order = [...state.seats.slice(index + 1), ...state.seats.slice(0, index + 1)].filter((s) => { const p = state.players[s.playerId]!; return !p.folded && !p.eliminated && !p.allIn; });
  const aggressor = [...state.actions].reverse().find((a) => a.street === "preflop" && a.aggressive)?.player;
  const opponents = Object.values(state.players).filter((p) => p!.id !== id && !p!.eliminated && !p!.folded);
  const opponentTotal = aggressor && aggressor !== id ? state.players[aggressor]!.stack + state.players[aggressor]!.totalContribution : Math.max(0, ...opponents.map((p) => p!.stack + p!.totalContribution));
  const preflop: PreflopContext | undefined = state.street === "preflop" ? { position: state.positions[id] ?? "", playerCount: state.seats.filter((s) => !state.players[s.playerId]!.eliminated).length, playersInHand: opponents.length + 1, bigBlind: state.config.bigBlind, effectiveStackBb: Math.min(own.stack + own.totalContribution, opponentTotal) / state.config.bigBlind, aggressor: aggressor !== id ? aggressor : undefined, aggressorPosition: aggressor && aggressor !== id ? state.positions[aggressor] : undefined, actions: state.actions.map((a) => ({ ...a })), amountToCall: call, currentBet: state.currentBet, legalActions: getLegalActions(state, id), canAct: state.actor === id } : undefined;
  return { index: state.actions.length, player: id, street: state.street, board: [...state.board], pot: state.pot, streetBet: own.streetBet, call, contestablePotAfter, priorActions: state.actions.map((a) => ({ ...a })), lastToAct: order.at(-1)?.playerId === id, preflop };
}
const names = (id: PlayerId, ru: boolean) => id === "human" ? (ru ? "Вы" : "You") : `AI ${id === "ai" ? "1" : id.replace("ai-", "")}`;

function reviewDecision(snapshot: CoachSnapshot, action: PlayerAction, game: PublicGameState, language: Language): CoachDecision {
  const ru = language === "ru";
  const player = game.players[snapshot.player]!;
  // Explicit privacy boundary. Even available internal metadata is ignored until this player reveals.
  const visible = snapshot.player === "human" || player.showCards;
  const cards = visible ? player.cards : null;
  const analysis = cards ? analyzeSituation(cards, snapshot.board, language, { call: snapshot.call, pot: snapshot.pot, contestablePotAfter: snapshot.contestablePotAfter }, snapshot.preflop) : undefined;
  const labels: Record<string, string> = ru ? { fold: "пас", check: "чек", call: "колл", bet: "ставка", raise: "рейз до", "all-in": "олл-ин до" } : { fold: "fold", check: "check", call: "call", bet: "bet", raise: "raise to", "all-in": "all-in to" };
  const aggressive = action.aggressive === true;
  const paid = action.action === "call" ? action.amount ?? 0 : Math.max(0, (action.effectiveAmount ?? action.amount ?? 0) - snapshot.streetBet);
  const title = `${names(snapshot.player, ru)}: ${labels[action.action] ?? action.action}${action.amount !== undefined ? ` ${action.amount}` : ""}`;
  let actionCategory = aggressive ? (ru ? "Агрессивная линия" : "Aggressive line") : labels[action.action] ?? action.action;
  let certainty: CoachDecision["certainty"] = "unknown";
  let explanation = aggressive ? (ru ? "Ставка создаёт давление и увеличивает банк. Без открытых карт и диапазонов нельзя уверенно отличить вэлью от блефа." : "The bet creates pressure and grows the pot. Without revealed cards and ranges, value and bluff cannot be distinguished reliably.") : action.action === "fold" ? (ru ? "Фолд прекращает дальнейшие вложения и отдаёт право на банк. По одному действию нельзя установить силу сброшенной руки." : "Folding avoids further investment and gives up the pot. The action alone does not establish hand strength.") : action.action === "check" ? (ru ? "Чек сохраняет банк. Он совместим как со слабостью, так и с контролем банка или ловушкой; намерение неизвестно." : "Checking keeps the pot unchanged. It can mean weakness, pot control or a trap; intent is unknown.") : (ru ? "Колл сохраняет участие в банке. Для оценки нужны диапазон соперника и equity; техническая сила руки их не заменяет." : "Calling keeps the player in the pot. Assessing it requires ranges and equity, not a raw strength score.");
  const meta = visible ? snapshot.decision : undefined;
  if (aggressive && meta?.coachIntent === "value") {
    actionCategory = ru ? "Вэлью по модели бота" : "Bot-model value";
    explanation = ru ? "Бот выбрал ветку вэлью: его внутренняя оценка превысила порог агрессии. Это реальная причина выбора, но эта оценка не является equity и не доказывает, что более слабые руки оплатят ставку." : "The bot selected its value branch: its internal score exceeded the aggression threshold. This is the actual branch, but the score is not equity and does not prove weaker hands will pay.";
    certainty = "observed";
  } else if (aggressive && meta?.coachIntent === "pressure") {
    const draw = analysis?.draws.some((d) => ["flush", "oesd", "gutshot", "double-gutshot"].includes(d.kind));
    actionCategory = ru ? (draw ? "Возможный полублеф" : "Блефовая ветка бота") : (draw ? "Possible semi-bluff" : "Bot bluff branch");
    explanation = ru ? "Бот выбрал вероятностную ветку давления, а не ветку сильной руки. Цель такой ветки — получать фолды; наличие дро даёт дополнительный путь к улучшению. Это описание алгоритма, не доказательство прибыльности ставки." : "The bot selected its probabilistic pressure branch rather than the strong-hand branch. This branch seeks folds; a draw adds an improvement path. This describes the algorithm, not proof of profitability.";
    certainty = "observed";
  }
  if (action.action === "check" && snapshot.lastToAct && snapshot.street !== "preflop") actionCategory = ru ? "Чек-бэк" : "Check-back";
  if (aggressive && cards && snapshot.board.length === 5 && meta?.coachIntent === "pressure") {
    const score = evaluateHand([...cards, ...snapshot.board]);
    const strongerRevealed = game.seats.some((s) => s.playerId !== snapshot.player && game.players[s.playerId]!.showCards && game.players[s.playerId]!.cards && compareScores(evaluateHand([...game.players[s.playerId]!.cards!, ...snapshot.board]), score) > 0);
    if (strongerRevealed) explanation += ru ? " После вскрытия видно: эта рука проигрывала более сильной раскрытой руке на ривере. Чтобы выиграть у неё, требовался фолд; результат не доказывает, что блеф был хорошим или плохим." : " Showdown confirms this river hand lost to a stronger revealed hand. Beating that hand required a fold; the result does not establish whether the bluff was good or bad.";
  }
  if (aggressive && snapshot.street === "flop" && !snapshot.priorActions.some((a) => a.street === "flop" && a.aggressive) && [...snapshot.priorActions].reverse().find((a) => a.street === "preflop" && a.aggressive)?.player === snapshot.player) actionCategory += ru ? " · продолженная ставка" : " · continuation bet";
  if (analysis) explanation = `${analysis.madeHand}. ${explanation}`;
  if (analysis?.potOdds && !aggressive && action.action !== "fold") {
    explanation += ru ? ` Цена колла — ${analysis.potOdds.call} в доступный банк ${analysis.potOdds.contestablePotAfter} после колла: нужно ${(analysis.potOdds.requiredEquity * 100).toFixed(1)}% equity. Дро и кикеры помогают оценить перспективы, но без диапазона нельзя заключить, что колл выгоден.` : ` Calling ${analysis.potOdds.call} for a contestable final pot of ${analysis.potOdds.contestablePotAfter} requires ${(analysis.potOdds.requiredEquity * 100).toFixed(1)}% equity. Draws and kickers matter, but profitability requires a range estimate.`;
  }
  if (analysis && snapshot.player === "human" && snapshot.board.length >= 3) {
    explanation += ` ${analysis.boardTexture.reasons[0] ?? ""}`;
    if (aggressive) explanation += ru ? " Рейз может получить коллы сильных рук или встретить ререйз; одна опасная доска не доказывает, что соперник сбросит." : "A raise can be called by strong hands or reraised; a threatening board alone does not imply folds.";
  }
  if (action.action === "all-in") actionCategory += aggressive ? (ru ? " · олл-ин" : " · all-in") : (ru ? " · колл на весь стек" : " · all-in call");
  if (analysis?.preflop && snapshot.player === "human") { explanation = `${title} · ${analysis.preflop.handClass}. ${analysis.preflop.explanation} ${analysis.preflop.reasons.join(" ")}`; certainty = "heuristic"; }
  return { index: snapshot.index, player: snapshot.player, street: snapshot.street, title, explanation, actionCategory, certainty, board: snapshot.board, analysis, betSizePercent: aggressive && snapshot.pot ? paid / snapshot.pot * 100 : undefined, technicalData: meta ? { strength: meta.postflopStrength, valueThreshold: meta.raiseThreshold, source: ru ? "Внутренняя эвристика LocalBot, не equity" : "LocalBot heuristic, not equity" } : undefined };
}

export function buildCoachReport(game: PublicGameState, snapshots: CoachSnapshot[], current: CoachSnapshot, language: Language): CoachReport {
  const ru = language === "ru";
  const decisions = snapshots.flatMap((s) => {
    const a = game.actions[s.index];
    return a && a.player === s.player && a.street === s.street ? [reviewDecision(s, a, game, language)] : [];
  });
  const price = game.actor === "human" ? { call: current.call, pot: current.pot, contestablePotAfter: current.contestablePotAfter } : undefined;
  const focus = snapshots.filter((s) => s.player === "human" && game.actions[s.index]).sort((a, b) => b.call - a.call)[0];
  const keyMoment = focus && focus.call > 0 ? (ru ? `Точка для разбора: ${focus.street}, цена продолжения ${focus.call} при банке ${focus.pot}. ` : `Review point: ${focus.street}, continuation cost ${focus.call} into ${focus.pot}. `) : "";
  return {
    handId: game.handId, actionCount: game.actions.length,
    current: analyzeSituation(game.players.human.cards ?? [], game.board, language, price, current.preflop), decisions,
    showdown: game.result?.endReason === "showdown" ? game.seats.flatMap((s) => {
      const p = game.players[s.playerId]!;
      if (!p.showCards || !p.cards) return [];
      const hand = analyzeSituation(p.cards, game.board, language);
      return [{ player: s.playerId, cards: p.cards, madeHand: hand.madeHand, bestFiveCards: hand.bestFiveCards }];
    }) : [],
    resultSummary: game.result?.summary,
    takeaway: keyMoment + (ru ? "Сравнивайте цену решения с диапазоном соперника. Победа или поражение в одной раздаче сами по себе не определяют качество хода." : "Compare the price with the opponent's range. A single hand's result does not determine decision quality."),
  };
}
