import type { HandResult, Language, PlayerAction, Strategy, Street } from "../shared/types";

const en = {
  headsUp: "HEADS-UP NO-LIMIT HOLD'EM", hero1: "Read the table.", hero2: "Not the cards.",
  intro: "Play a complete heads-up session against an AI opponent. The deterministic engine deals every card and enforces every chip.",
  isolated: "Information-isolated AI", noCards: "Your hole cards never enter the decision request.", newTable: "NEW TABLE", chooseOpponent: "Choose your opponent", local: "LOCAL",
  difficulty: "Difficulty", startingStack: "Starting stack", blinds: "Blinds", smallBlind: "Small blind", bigBlind: "Big blind",
  tableTalk: "AI table talk", coachMode: "Coach mode", debugMode: "Developer debug", opening: "OPENING TABLE…", takeSeat: "TAKE A SEAT", disclaimer: "Virtual chips only. No real-money gambling.",
  hand: "HAND", chips: "CHIPS", yourTurn: "YOUR TURN", you: "YOU", pot: "POT", handComplete: "HAND COMPLETE", aiThinking: "AI is thinking", smallBlindShort: "SB", bigBlindShort: "BB",
  fold: "FOLD", check: "CHECK", call: "CALL", bet: "BET", raiseTo: "RAISE TO", allIn: "ALL-IN", to: "TO", max: "MAX", nextAuto: "The cards will stay on the table until you are ready.", nextHand: "NEXT HAND",
  handLog: "HAND LOG", stats: "STATS", debug: "DEBUG", previousHands: "Previous hands", handsPlayed: "Hands played", handsWon: "Hands won", showdownsWon: "Showdowns won", biggestPot: "Biggest pot",
  aggression: "Aggression", netChips: "Net chips", chipGraph: "CHIP GRAPH", tendencies: "OBSERVED TENDENCIES",
  apiConnected: "AI API CONNECTED", apiOffline: "AI API OFFLINE · LOCAL BOT", leave: "LEAVE TABLE", why: "WHY DID AI PLAY IT THAT WAY?", newSession: "NEW SESSION",
  youWonMatch: "You won the match", aiWonMatch: "River AI won the match", matchFinished: "MATCH COMPLETE", reviewFinalHand: "The final cards and result will stay on the table until you are ready.", coachReview: "COACH REVIEW", decisionSummary: "AI decision summary",
  openError: "Could not open the table", refreshError: "Could not refresh the game", nextError: "Could not deal the next hand", actionError: "Action failed", explainError: "Explanation failed",
  handGuide: "HAND RANKINGS", handGuideSubtitle: "Strongest to weakest", closeGuide: "Close hand rankings",
} as const;

type TranslationKey = keyof typeof en;
const ru: Record<TranslationKey, string> = {
  headsUp: "ХЕДЗ-АП БЕЗЛИМИТНЫЙ ХОЛДЕМ", hero1: "Читайте стол.", hero2: "Не чужие карты.",
  intro: "Сыграйте полноценную хедз-ап сессию против AI-соперника. Детерминированный движок раздаёт карты, контролирует ставки и каждую фишку.",
  isolated: "Честная информационная изоляция", noCards: "Ваши закрытые карты никогда не передаются AI.", newTable: "НОВЫЙ СТОЛ", chooseOpponent: "Выберите соперника", local: "ЛОКАЛЬНО",
  difficulty: "Уровень", startingStack: "Начальный стек", blinds: "Блайнды", smallBlind: "Малый блайнд", bigBlind: "Большой блайнд",
  tableTalk: "Реплики AI", coachMode: "Режим тренера", debugMode: "Режим разработчика", opening: "ОТКРЫВАЕМ СТОЛ…", takeSeat: "СЕСТЬ ЗА СТОЛ", disclaimer: "Только виртуальные фишки. Игра не использует реальные деньги.",
  hand: "РАЗДАЧА", chips: "ФИШЕК", yourTurn: "ВАШ ХОД", you: "ВЫ", pot: "БАНК", handComplete: "РАЗДАЧА ЗАВЕРШЕНА", aiThinking: "AI думает", smallBlindShort: "МБ", bigBlindShort: "ББ",
  fold: "ПАС", check: "ЧЕК", call: "КОЛЛ", bet: "СТАВКА", raiseTo: "РЕЙЗ ДО", allIn: "ОЛЛ-ИН", to: "ДО", max: "МАКС", nextAuto: "Карты останутся на столе, пока вы не будете готовы.", nextHand: "СЛЕДУЮЩАЯ РАЗДАЧА",
  handLog: "ИСТОРИЯ", stats: "СТАТИСТИКА", debug: "ОТЛАДКА", previousHands: "Предыдущие раздачи", handsPlayed: "Сыграно раздач", handsWon: "Выиграно раздач", showdownsWon: "Выиграно вскрытий", biggestPot: "Самый большой банк",
  aggression: "Агрессия", netChips: "Результат", chipGraph: "ГРАФИК ФИШЕК", tendencies: "ЗАМЕЧЕННЫЕ ТЕНДЕНЦИИ",
  apiConnected: "OPENAI ПОДКЛЮЧЁН", apiOffline: "OPENAI ОТКЛЮЧЁН · ЛОКАЛЬНЫЙ БОТ", leave: "ПОКИНУТЬ СТОЛ", why: "ПОЧЕМУ AI СЫГРАЛ ИМЕННО ТАК?", newSession: "НОВАЯ СЕССИЯ",
  youWonMatch: "Вы выиграли матч", aiWonMatch: "River AI выиграл матч", matchFinished: "МАТЧ ЗАВЕРШЁН", reviewFinalHand: "Финальные карты и результат останутся на столе, пока вы их рассматриваете.", coachReview: "РАЗБОР ТРЕНЕРА", decisionSummary: "Краткий разбор решения AI",
  openError: "Не удалось открыть стол", refreshError: "Не удалось обновить игру", nextError: "Не удалось начать следующую раздачу", actionError: "Не удалось выполнить действие", explainError: "Не удалось получить объяснение",
  handGuide: "КОМБИНАЦИИ", handGuideSubtitle: "От сильнейшей к младшей", closeGuide: "Закрыть подсказку",
};

export function t(language: Language, key: TranslationKey): string { return language === "ru" ? ru[key] : en[key]; }

export const strategyInfo: Record<Language, Record<Strategy, { name: string; description: string }>> = {
  en: {
    balanced: { name: "Balanced", description: "Measured, versatile and hard to exploit." }, tag: { name: "TAG", description: "Tight range, sharp aggression." },
    lag: { name: "LAG", description: "Wide range and constant pressure." }, nit: { name: "Nit", description: "Very selective and risk-aware." },
    "calling-station": { name: "Calling Station", description: "Sticky calls, few raises." }, maniac: { name: "Maniac", description: "Relentless raises and bluffs." },
    tricky: { name: "Tricky", description: "Traps, delays and mixed lines." }, adaptive: { name: "Adaptive", description: "Adjusts to your aggregate profile." },
  },
  ru: {
    balanced: { name: "Сбалансированный", description: "Гибкий стиль без явных перекосов." }, tag: { name: "TAG", description: "Узкий диапазон и сильная агрессия." },
    lag: { name: "LAG", description: "Широкий диапазон и постоянное давление." }, nit: { name: "Нит", description: "Крайне осторожная игра сильных рук." },
    "calling-station": { name: "Автоответчик", description: "Много коллов и мало рейзов." }, maniac: { name: "Маньяк", description: "Безостановочные рейзы и блефы." },
    tricky: { name: "Хитрый", description: "Ловушки, задержанная агрессия и микс линий." }, adaptive: { name: "Адаптивный", description: "Подстраивается под вашу статистику." },
  },
};

export const difficultyNames = { en: { casual: "Casual", strong: "Strong", expert: "Expert" }, ru: { casual: "Любитель", strong: "Сильный", expert: "Эксперт" } } as const;
const streetNames: Record<Language, Record<Street, string>> = {
  en: { preflop: "PREFLOP", flop: "FLOP", turn: "TURN", river: "RIVER", showdown: "SHOWDOWN", complete: "HAND COMPLETE" },
  ru: { preflop: "ПРЕФЛОП", flop: "ФЛОП", turn: "ТЁРН", river: "РИВЕР", showdown: "ВСКРЫТИЕ", complete: "РАЗДАЧА ЗАВЕРШЕНА" },
};
export function streetLabel(street: Street, language: Language): string { return streetNames[language][street]; }

const hands: Record<string, string> = { "High card": "старшая карта", "One pair": "пара", "Two pair": "две пары", "Three of a kind": "сет/трипс", Straight: "стрит", Flush: "флеш", "Full house": "фулл-хаус", "Four of a kind": "каре", "Straight flush": "стрит-флеш" };
export function handName(name: string | undefined, language: Language): string { return language === "ru" && name ? hands[name] ?? name : name ?? ""; }

function rankLabel(rank: number): string {
  return ({ 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10" } as Record<number, string>)[rank] ?? String(rank);
}

function showdownSuffix(result: HandResult, language: Language): string {
  if (!result.showdownDetail) return "";
  const rank = rankLabel(result.showdownDetail.decisiveRank);
  if (result.showdownDetail.reason === "kicker") return language === "ru" ? `, старший кикер ${rank}` : `, ${rank} kicker`;
  const labels = language === "ru" ? {
    "higher-card": "по старшей карте", "higher-pair": "по старшей паре", "higher-two-pair": "по старшим двум парам", "higher-trips": "по старшей тройке", "higher-straight": "по старшему стриту", "higher-flush": "по старшему флешу", "higher-full-house": "по старшему фулл-хаусу", "higher-quads": "по старшему каре", "higher-straight-flush": "по старшему стрит-флешу",
  } : {
    "higher-card": "higher card", "higher-pair": "higher pair", "higher-two-pair": "higher two pair", "higher-trips": "higher three of a kind", "higher-straight": "higher straight", "higher-flush": "higher flush", "higher-full-house": "higher full house", "higher-quads": "higher four of a kind", "higher-straight-flush": "higher straight flush",
  };
  const label = labels[result.showdownDetail.reason];
  return language === "ru" ? `, ${label} (${rank})` : `, ${label} (${rank})`;
}

export function resultText(result: HandResult, language: Language): string {
  const pot = result.pot.toLocaleString(language === "ru" ? "ru-RU" : "en-US").replace(/\u00a0/g, " ");
  if (result.winners.length === 2) return language === "ru" ? `Банк ${pot} разделён — ${handName(result.humanHand, language)}` : `Split pot ${pot} — ${result.humanHand}`;
  const humanWins = result.winners[0] === "human";
  const winner = humanWins ? (language === "ru" ? "Вы" : "You") : "AI";
  if (!result.humanHand) return language === "ru" ? `${winner} ${humanWins ? "забираете" : "забирает"} банк ${pot} — соперник сбросил карты` : `${winner} wins pot ${pot} — opponent folded`;
  const hand = handName(humanWins ? result.humanHand : result.aiHand, language);
  return language === "ru"
    ? `${winner} ${humanWins ? "выигрываете" : "выигрывает"} ${pot}: ${hand}${showdownSuffix(result, language)}`
    : `${winner} wins ${pot}: ${hand}${showdownSuffix(result, language)}`;
}

const playerRu = (name: string) => name === "You" ? "Вы" : "AI";
export function translateLog(line: string, language: Language): string {
  if (language === "en") return line;
  let match: RegExpMatchArray | null;
  if ((match = line.match(/^Hand #(\d+)$/))) return `Раздача №${match[1]}`;
  if ((match = line.match(/^(You|AI) (?:are|is) Button \/ SB$/))) return `${playerRu(match[1])} — баттон / МБ`;
  if ((match = line.match(/^(You|AI) posts (small blind|big blind) (\d+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "ставите" : "ставит"} ${match[2] === "small blind" ? "малый" : "большой"} блайнд ${match[3]}`;
  if ((match = line.match(/^(You|AI) folds$/))) return `${playerRu(match[1])} — пас`;
  if ((match = line.match(/^(You|AI) checks$/))) return `${playerRu(match[1])} — чек`;
  if ((match = line.match(/^(You|AI) calls (\d+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "коллируете" : "коллирует"} ${match[2]}`;
  if ((match = line.match(/^(You|AI) bets (\d+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "ставите" : "ставит"} ${match[2]}`;
  if ((match = line.match(/^(You|AI) raises to (\d+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "повышаете" : "повышает"} до ${match[2]}`;
  if ((match = line.match(/^(You|AI) is all-in to (\d+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "идёте" : "идёт"} олл-ин до ${match[2]}`;
  if ((match = line.match(/^(You|AI) calls all-in for (\d+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "коллируете" : "коллирует"} олл-ин на ${match[2]}`;
  if ((match = line.match(/^Uncalled (\d+) returned to (You|AI)$/))) return `Непринятые ${match[1]} возвращены: ${playerRu(match[2])}`;
  if ((match = line.match(/^(Flop|Turn|River): (.+)$/))) return `${({ Flop: "Флоп", Turn: "Тёрн", River: "Ривер" } as Record<string, string>)[match[1]]}: ${match[2]}`;
  if ((match = line.match(/^Showdown: You (.+) · AI (.+)$/))) return `Вскрытие: Вы ${match[1]} · AI ${match[2]}`;
  if ((match = line.match(/^(You|AI) wins (\d+) \(opponent folded\)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "забираете" : "забирает"} ${match[2]} — соперник сбросил карты`;
  if ((match = line.match(/^(You|AI) wins (\d+) with (.+)$/))) return `${playerRu(match[1])} ${match[1] === "You" ? "выигрываете" : "выигрывает"} ${match[2]}: ${handName(match[3], language)}`;
  if ((match = line.match(/^Split pot — both players have (.+)$/))) return `Банк разделён — у обоих ${handName(match[1], language)}`;
  return line;
}

const tendencyRu: Record<string, string> = { "sample size is still small": "пока недостаточно раздач для точного профиля", "enters many pots": "входит во многие банки", "raises frequently preflop": "часто повышает на префлопе", "folds often when facing pressure": "часто сдаётся под давлением", "uses aggressive actions frequently": "часто выбирает агрессивные действия", "no pronounced tendency detected": "явных тенденций пока не обнаружено" };
export function translateTendency(value: string, language: Language): string { return language === "ru" ? tendencyRu[value] ?? value : value; }

export function actionAnnouncement(action: PlayerAction, language: Language): string {
  const amount = action.amount ? ` ${action.amount}` : "";
  const labels: Record<Language, Partial<Record<PlayerAction["action"], string>>> = {
    ru: { fold: "ПАС", check: "ЧЕК", call: "КОЛЛ", bet: "СТАВКА", raise: "РЕЙЗ ДО", "all-in": "ОЛЛ-ИН ДО" },
    en: { fold: "FOLD", check: "CHECK", call: "CALL", bet: "BET", raise: "RAISE TO", "all-in": "ALL-IN TO" },
  };
  return `${labels[language][action.action] ?? action.action.toUpperCase()}${amount}`;
}
