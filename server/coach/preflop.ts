import type { Card, Language } from "../../shared/types";
import type { PreflopAnalysis, PreflopContext } from "../../shared/preflopCoach";
import { getStartingHandClass, STARTING_HANDS, type StartingTrait } from "./startingHands";

const traitText: Record<StartingTrait, [string, string]> = {
  pair: ["Карманная пара: готовая пара уже на старте.", "Pocket pair: a made pair from the start."],
  broadway: ["Две карты 10–A: потенциал сильной топ-пары и старших стритов.", "Two T–A cards: strong top-pair and broadway-straight potential."],
  suited: ["Одна масть: дополнительный флеш-потенциал, но готового дро пока нет.", "Suited: extra flush potential, not a made draw yet."],
  offsuit: ["Разные масти: меньше флеш-потенциала.", "Offsuit: less flush potential."],
  "suited-ace": ["Одномастный туз даёт перспективу сильного флеша.", "A suited ace offers strong flush potential."],
  "suited-king": ["Одномастный король может собрать сильный флеш, но флеш с тузом старше.", "A suited king can make a strong flush, but an ace-high flush beats it."],
  connector: ["Соседние ранги могут вместе участвовать в стритах.", "Connected ranks can contribute to the same straights."],
  "one-gap": ["Между рангами один пропуск: стриты возможны реже, чем у коннекторов.", "One rank gap: fewer straight possibilities than connectors."],
  "two-gap": ["Два пропуска между рангами: ограниченная связность.", "Two rank gaps: limited connectivity."],
  "wheel-ace": ["Туз и младшая карта могут участвовать в стрите A–5.", "An ace and a small card can contribute to an A–5 straight."],
  "high-card": ["Старшая карта помогает собирать высокие пары; значение кикера остаётся важным.", "A high card can make high pairs; the kicker still matters."],
  "dominated-kicker": ["Слабый кикер: при общей старшей паре более высокий кикер соперника может доминировать вашу руку.", "Weak kicker: an opponent sharing your top pair may dominate it with a better kicker."],
  "set-mining": ["Небольшая пара может охотиться за сетом, если цена мала и соперник способен оплатить сильную руку.", "A smaller pair can seek a set if the price is low and opponents can pay off a strong hand."],
  "nut-flush": ["Потенциал флеша с тузом — старшего обычного флеша; спаренная доска всё равно опасна.", "Ace-high flush potential; paired boards can still be dangerous."],
};

export function analyzePreflop(cards: [Card, Card], context: PreflopContext, language: Language): PreflopAnalysis {
  const ru = language === "ru", text = (a: string, b: string) => ru ? a : b;
  const profile = STARTING_HANDS[getStartingHandClass(...cards)];
  const actions = context.actions.filter((a) => a.street === "preflop");
  const raises = actions.filter((a) => a.aggressive === true);
  const lastRaise = actions.reduce((last, a, i) => a.aggressive === true ? i : last, -1);
  const callers = actions.slice(lastRaise + 1).filter((a) => (a.action === "call" || a.action === "all-in" && !a.aggressive) && (a.amount ?? 0) > 0).length;
  const actionContext: PreflopAnalysis["actionContext"] = raises.length >= 3 ? "4bet-plus" : raises.length === 2 ? "3bet" : raises.length === 1 ? callers ? "open-callers" : "open-raise" : callers ? "limped" : "unopened";
  const contextLabels = {
    unopened: text("Неоткрытый банк", "Unopened pot"), limped: text("Лимпованный банк", "Limped pot"),
    "open-raise": text("Банк с открывающим рейзом", "Open-raised pot"), "open-callers": text("Рейз и коллеры", "Open plus callers"),
    "3bet": text("3-бет банк", "3-bet pot"), "4bet-plus": text("4-бет или выше", "4-bet or higher"),
  };
  const late = context.position.includes("BTN"), early = context.position === "UTG";
  const headsUp = context.playerCount === 2;
  const short = context.effectiveStackBb < 30, deep = context.effectiveStackBb >= 100;
  const speculative = profile.traits.some((t) => ["connector", "wheel-ace", "set-mining"].includes(t));
  // Context adjusts willingness to invest, never the context-independent hand rating.
  const threshold = (raises.length >= 3 ? 83 : raises.length === 2 ? 72 : raises.length === 1 ? 58 : callers ? 43 : 38)
    + (early ? 9 : late ? -9 : context.position === "SB" ? 3 : 0)
    + (headsUp ? -6 : Math.max(0, context.playerCount - 3) * 3)
    + (raises.length && context.aggressorPosition === "UTG" ? 5 : 0)
    + (raises.length && context.currentBet / context.bigBlind > 5 ? 7 : 0)
    + (speculative && short ? 9 : speculative && deep && late ? -5 : 0)
    + (raises.length && callers ? 4 : 0);
  const margin = profile.rating - threshold;
  const premium = profile.rating >= 87;
  const frequency = premium ? 4 : margin > 20 ? 4 : margin >= 5 ? 3 : margin >= -8 ? 2 : margin >= -20 ? 1 : 0;
  const frequencies = ru ? ["Почти никогда", "Редко", "Иногда", "Часто", "Почти всегда"] : ["Almost never", "Rarely", "Sometimes", "Often", "Almost always"];
  const legal = new Set(context.legalActions.map((a) => a.type));
  const aggressive = legal.has("raise") ? "raise" : legal.has("bet") ? "bet" : undefined;
  const jam = context.legalActions.find((a) => a.type === "all-in");
  let recommendedAction: string | null = null;
  if (context.canAct) {
    if ((premium || margin >= (raises.length ? 18 : 0)) && aggressive) recommendedAction = aggressive;
    else if (premium && jam && (jam.amount ?? 0) > context.currentBet && short) recommendedAction = "all-in";
    else if (legal.has("check")) recommendedAction = "check";
    else if ((premium || margin >= -5 && (actionContext !== "unopened" || context.position.includes("SB"))) && legal.has("call")) recommendedAction = "call";
    else if (legal.has("fold")) recommendedAction = "fold";
    else if (legal.has("call")) recommendedAction = "call";
    else if (jam) recommendedAction = "all-in";
  }
  const priorities: StartingTrait[] = ["pair", "broadway", "suited", "offsuit", "wheel-ace", "connector", "dominated-kicker", "nut-flush", "set-mining", "one-gap", "two-gap", "high-card"];
  const reasonTraits = priorities.filter((id) => profile.traits.includes(id)).slice(0, 4);
  if (profile.traits.includes("dominated-kicker") && !reasonTraits.includes("dominated-kicker")) reasonTraits[3] = "dominated-kicker";
  const reasons = reasonTraits.map((id) => traitText[id][ru ? 0 : 1]);
  if (profile.rating < 25) reasons.push(text("Слабые пары часто уступают более высоким; низкая связность ограничивает сильные попадания.", "Weak pairs often lose to higher pairs; limited connectivity reduces strong outcomes."));
  const positionExplanation = headsUp ? text("Heads-up: BTN также ставит SB и ходит первым префлоп, но последним после флопа.", "Heads-up: BTN is also SB and acts first preflop, but last postflop.") : late ? text("BTN действует последним после флопа. Дополнительная информация позволяет шире разыгрывать руки.", "BTN acts last postflop. Extra information permits wider play.") : early ? text("UTG первым принимает решение префлоп. Позади ещё соперники, поэтому вход обычно осторожнее; здесь UTG за коротким столом.", "UTG acts first preflop with opponents behind, usually requiring more caution. This is short-handed UTG.") : text("На блайндах после флопа часто придётся действовать раньше соперников. Бесплатный чек не равен добровольному входу за деньги.", "Blinds often act early postflop. A free check is not voluntary investment.");
  const stackExplanation = speculative ? short ? text("Короткий стек ограничивает оплату будущего сета, стрита или флеша: дорогой колл ради попадания опасен.", "Short stacks limit future set/straight/flush payoffs; expensive speculative calls are risky.") : text("Спекулятивная рука лучше реализуется при запасе фишек и позиции. Глубина сама по себе не оправдывает любой колл.", "Speculative hands benefit from stack depth and position. Depth alone does not justify any call.") : text("Старшие карты и большие пары меньше зависят от редкого сильного попадания. Размер ставки и диапазон соперника всё равно важны.", "High cards and big pairs rely less on rare strong hits. Bet size and opponent ranges still matter.");
  const line = recommendedAction?.toUpperCase() ?? text("Ожидайте своего хода", "Wait for your turn");
  const foldReason = raises.length ? text("Цена продолжения и сила предыдущей линии требуют более сильной руки.", "The price and prior aggression favor a stronger continuing hand.") : text("Для стандартного входа из этой позиции руке не хватает силы или играбельности; ещё остаются соперники, которые могут ответить рейзом.", "The hand lacks strength or playability for a standard entry from this position; opponents can still raise.");
  const explanation = `${profile.handClass} · ${context.position} · ${contextLabels[actionContext]}. ${text("По учебной эвристике", "Under this teaching heuristic")}: ${line}. ` + (recommendedAction === "fold" ? foldReason : premium ? text("Одна из сильнейших стартовых рук: обычно стоит продолжать агрессивно, если правила разрешают рейз.", "One of the strongest starting hands: usually continue aggressively when raising is allowed.") : margin < 5 ? text("Пограничная рука: позиция, цена и риск доминации особенно важны.", "A borderline hand: position, price and domination risk matter especially.") : text("Рука подходит для продолжения в этом контексте, но это не гарантия выигрыша и не solver-стратегия.", "The hand is suitable for continuing in this context, not a winning guarantee or solver strategy."));
  const open = context.legalActions.find((a) => a.type === "raise");
  const low = Math.max(open?.min ?? Infinity, 2 * context.bigBlind), high = Math.min(open?.max ?? 0, 3 * context.bigBlind);
  const learningConcepts = [
    { id: "position", text: positionExplanation },
    ...profile.traits.filter((t) => ["suited", "connector", "dominated-kicker", "pair", "broadway", "set-mining"].includes(t)).map((id) => ({ id: `preflop-${id}`, text: traitText[id][ru ? 0 : 1] })),
    { id: raises.length ? "3bet" : "open-raise", text: text("Блайнд — первый уровень ставки; открывающий рейз — второй, ререйз — 3-бет. Короткий олл-ин-колл не повышает уровень.", "The blind is bet level one; the open is level two, a reraise is a 3-bet. A short all-in call does not raise the level.") },
    { id: "effective-stack", text: text("Эффективный стек — покрываемые фишки против последнего агрессора; до рейза здесь используется крупнейший живой соперник. В multiway у других игроков стек может отличаться.", "Effective stack is covered chips versus the latest aggressor; before a raise this uses the largest live opponent. Other multiway stacks may differ.") },
  ];
  return { handClass: profile.handClass, cards, rating: profile.rating, ratingMethod: "local-preflop-v1", ratingMeaning: text("Относительный рейтинг по внутренней эвристике LocalBot, а не вероятность победы. Разница в пару пунктов не научно точна.", "Relative rating from the LocalBot heuristic, not win probability. A few points are not scientifically precise."), category: (ru ? { premium: "Премиум", "very-strong": "Очень сильная", strong: "Сильная", playable: "Играбельная", marginal: "Пограничная", weak: "Слабая", trash: "Очень слабая" } : { premium: "Premium", "very-strong": "Very strong", strong: "Strong", playable: "Playable", marginal: "Marginal", weak: "Weak", trash: "Trash" })[profile.category], traits: profile.traits.map((id) => ({ id, text: traitText[id][ru ? 0 : 1] })), reasons, position: context.position, positionExplanation, playerCount: context.playerCount, playersInHand: context.playersInHand, actionContext, contextLabel: contextLabels[actionContext], betLevel: raises.length + 1, aggressorPosition: context.aggressorPosition, effectiveStackBb: context.effectiveStackBb, stackCategory: short ? "short" : deep ? "deep" : "medium", stackExplanation, recommendedAction, alternatives: context.canAct ? [...legal].filter((a) => a !== recommendedAction).map((a) => `${a.toUpperCase()} — ${text("возможная альтернатива; зависит от диапазона и сайзинга", "an alternative depending on range and sizing")}`) : [], playFrequency: context.canAct ? frequencies[frequency] : text("Оценка после предыдущих действий", "Reassess after preceding actions"), explanation, openSizing: context.canAct && actionContext === "unopened" && recommendedAction === "raise" && low <= high ? { min: low, max: high, bigBlind: context.bigBlind } : undefined, learningConcepts };
}
