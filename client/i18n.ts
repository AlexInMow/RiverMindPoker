import type { EvaluatedHandSummary, HandResult, Language, PlayerAction, Strategy, Street } from "../shared/types";

const en = {
  headsUp: "2–4 PLAYER NO-LIMIT HOLD'EM", hero1: "Read the table.", hero2: "Not the cards.",
  intro: "Play a complete session against one, two, or three AI opponents. The deterministic engine deals every card and enforces every chip.",
  isolated: "Information-isolated AI", noCards: "Each AI sees only its own cards and public table information.", newTable: "NEW TABLE", chooseOpponent: "Choose your table", opponents: "AI opponents", local: "LOCAL",
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
  headsUp: "ХОЛДЕМ НА 2–4 ИГРОКОВ", hero1: "Читайте стол.", hero2: "Не чужие карты.",
  intro: "Сыграйте полноценную сессию против одного, двух или трёх AI-соперников. Детерминированный движок раздаёт карты, контролирует ставки и каждую фишку.",
  isolated: "Честная информационная изоляция", noCards: "Каждый AI видит только свои карты и открытую информацию стола.", newTable: "НОВЫЙ СТОЛ", chooseOpponent: "Настройте стол", opponents: "Соперники", local: "ЛОКАЛЬНО",
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

const ruRankPlural: Record<number, string> = {
  14: "тузов", 13: "королей", 12: "дам", 11: "валетов", 10: "десяток", 9: "девяток", 8: "восьмёрок", 7: "семёрок", 6: "шестёрок", 5: "пятёрок", 4: "четвёрок", 3: "троек", 2: "двоек",
};
const ruRankNominativePlural: Record<number, string> = {
  14: "тузы", 13: "короли", 12: "дамы", 11: "валеты", 10: "десятки", 9: "девятки", 8: "восьмёрки", 7: "семёрки", 6: "шестёрки", 5: "пятёрки", 4: "четвёрки", 3: "тройки", 2: "двойки",
};
const ruRankAfterTo: Record<number, string> = {
  14: "туза", 13: "короля", 12: "дамы", 11: "валета", 10: "десятки", 9: "девятки", 8: "восьмёрки", 7: "семёрки", 6: "шестёрки", 5: "пятёрки", 4: "четвёрки", 3: "тройки", 2: "двойки",
};
const enRankPlural: Record<number, string> = {
  14: "aces", 13: "kings", 12: "queens", 11: "jacks", 10: "tens", 9: "nines", 8: "eights", 7: "sevens", 6: "sixes", 5: "fives", 4: "fours", 3: "threes", 2: "twos",
};
const enRankName: Record<number, string> = {
  14: "ace", 13: "king", 12: "queen", 11: "jack", 10: "ten", 9: "nine", 8: "eight", 7: "seven", 6: "six", 5: "five", 4: "four", 3: "three", 2: "two",
};

export function handDescription(score: EvaluatedHandSummary | undefined, fallbackName: string | undefined, language: Language): string {
  if (!score) return handName(fallbackName, language);
  const [first, second] = score.rankValues;
  if (language === "ru") {
    switch (score.category) {
      case 0: return `Старшая карта: ${rankLabel(first)}`;
      case 1: return `Пара ${ruRankPlural[first]}`;
      case 2: return `Две пары: ${ruRankNominativePlural[first]} и ${ruRankNominativePlural[second]}`;
      case 3: return `Тройка ${ruRankPlural[first]}`;
      case 4: return `Стрит до ${ruRankAfterTo[first]}`;
      case 5: return `Флеш до ${ruRankAfterTo[first]}`;
      case 6: return `Фулл-хаус: ${ruRankNominativePlural[first]} фулл ${ruRankPlural[second]}`;
      case 7: return `Каре ${ruRankPlural[first]}`;
      default: return first === 14 ? "Роял-флеш" : `Стрит-флеш до ${ruRankAfterTo[first]}`;
    }
  }
  switch (score.category) {
    case 0: return `High card: ${enRankName[first]}`;
    case 1: return `Pair of ${enRankPlural[first]}`;
    case 2: return `Two pair: ${enRankPlural[first]} and ${enRankPlural[second]}`;
    case 3: return `Three ${enRankPlural[first]}`;
    case 4: return `Straight to ${enRankName[first]}`;
    case 5: return `Flush to ${enRankName[first]}`;
    case 6: return `Full house: ${enRankPlural[first]} full of ${enRankPlural[second]}`;
    case 7: return `Four ${enRankPlural[first]}`;
    default: return first === 14 ? "Royal flush" : `Straight flush to ${enRankName[first]}`;
  }
}

function showdownSuffix(result: HandResult, language: Language): string {
  if (!result.showdownDetail) return "";
  const detail = result.showdownDetail;
  const winning = rankLabel(detail.winningRank ?? detail.decisiveRank);
  const losing = detail.losingRank === undefined ? "" : rankLabel(detail.losingRank);
  const comparison = losing ? `${winning} > ${losing}` : winning;
  const category = detail.category;
  const index = detail.decisiveIndex;

  if (language === "ru") {
    let label: string;
    if (category === 1 && index > 0) label = index === 1 ? "старший кикер" : `${index}-й кикер`;
    else if (category === 2 && index === 2) label = "кикер";
    else if (category === 3 && index > 0) label = index === 1 ? "старший кикер" : "2-й кикер";
    else if (category === 7 && index === 1) label = "кикер";
    else if ((category === 0 || category === 5) && index > 0) label = `${index + 1}-я карта`;
    else label = ({
      "higher-card": "старшая карта", "higher-pair": "ранг пары", "higher-two-pair": index === 0 ? "старшая пара" : "младшая пара", "higher-trips": "ранг тройки", "higher-straight": "старшая карта стрита", "higher-flush": "старшая карта флеша", "higher-full-house": index === 0 ? "тройка фулл-хауса" : "пара фулл-хауса", "higher-quads": "ранг каре", "higher-straight-flush": "старшая карта стрит-флеша", kicker: "кикер",
    } as const)[detail.reason];
    return ` — ${label}: ${comparison}`;
  }

  let label: string;
  if (category === 1 && index > 0) label = index === 1 ? "top kicker" : `${index}${index === 2 ? "nd" : "rd"} kicker`;
  else if (category === 2 && index === 2) label = "kicker";
  else if (category === 3 && index > 0) label = index === 1 ? "top kicker" : "second kicker";
  else if (category === 7 && index === 1) label = "kicker";
  else if ((category === 0 || category === 5) && index > 0) label = `${["first", "second", "third", "fourth", "fifth"][index]} card`;
  else label = ({
    "higher-card": "high card", "higher-pair": "pair rank", "higher-two-pair": index === 0 ? "higher pair" : "lower pair", "higher-trips": "trip rank", "higher-straight": "straight high card", "higher-flush": "flush high card", "higher-full-house": index === 0 ? "full-house trips" : "full-house pair", "higher-quads": "quad rank", "higher-straight-flush": "straight-flush high card", kicker: "kicker",
  } as const)[detail.reason];
  return ` — ${label}: ${comparison}`;
}

export function resultText(result: HandResult, language: Language): string {
  const pot = result.pot.toLocaleString(language === "ru" ? "ru-RU" : "en-US").replace(/\u00a0/g, " ");
  if (result.pots && result.pots.length > 1) {
    return result.pots.map((settled, index) => {
      const label = language === "ru" ? (index === 0 ? "Основной банк" : `Побочный банк ${index}`) : (index === 0 ? "Main pot" : `Side pot ${index}`);
      const names = settled.winners.map((id) => playerDisplayName(id, language)).join(" / ");
      const amount = settled.amount.toLocaleString(language === "ru" ? "ru-RU" : "en-US").replace(/\u00a0/g, " ");
      const humanOnly = settled.winners.length === 1 && settled.winners[0] === "human";
      return language === "ru" ? `${label}: ${names} — ${settled.winners.length > 1 ? "делят" : humanOnly ? "выигрываете" : "выигрывает"} ${amount}` : `${label}: ${names} ${settled.winners.length > 1 ? "split" : humanOnly ? "win" : "wins"} ${amount}`;
    }).join(" · ");
  }
  if (result.winners.length > 1) {
    const description = handDescription(result.evaluatedHands?.[result.winners[0]!] ?? result.humanScore, result.humanHand, language);
    const names = result.winners.map((id) => playerDisplayName(id, language)).join(" / ");
    if (result.winners.length > 2) return language === "ru" ? `Банк ${pot} разделён: ${names} — ${description}` : `Split pot ${pot}: ${names} — ${description}`;
    return language === "ru" ? `Банк ${pot} разделён: одинаковая лучшая пятёрка — ${description}` : `Split pot ${pot}: identical best five — ${description}`;
  }
  const winnerId = result.winners[0]!;
  const humanWins = winnerId === "human";
  const winner = playerDisplayName(winnerId, language);
  const score = result.evaluatedHands?.[winnerId] ?? (humanWins ? result.humanScore : result.aiScore);
  const legacyHand = humanWins ? result.humanHand : result.aiHand;
  if (!score && !legacyHand) return language === "ru" ? `${winner} ${humanWins ? "забираете" : "забирает"} банк ${pot} — остальные сбросили карты` : `${winner} wins pot ${pot} — all opponents folded`;
  const hand = handDescription(score, legacyHand, language);
  return language === "ru"
    ? `${winner} ${humanWins ? "выигрываете" : "выигрывает"} ${pot}: ${hand}${showdownSuffix(result, language)}`
    : `${winner} ${humanWins ? "win" : "wins"} ${pot}: ${hand}${showdownSuffix(result, language)}`;
}

export function playerDisplayName(id: string, language: Language): string {
  if (id === "human" || id === "You") return language === "ru" ? "Вы" : "You";
  if (id === "ai" || id === "AI") return language === "ru" ? "AI 1" : "AI 1";
  const match = id.match(/(?:ai-|AI )(\d+)/i);
  return match ? `AI ${match[1]}` : id;
}
const playerRu = (name: string) => name === "You" ? "Вы" : name === "AI" ? "AI" : name;
export function translateLog(line: string, language: Language): string {
  if (language === "en") return line;
  let match: RegExpMatchArray | null;
  if ((match = line.match(/^Hand #(\d+)$/))) return `Раздача №${match[1]}`;
  if ((match = line.match(/^(You|AI(?: [123])?) (?:are|is) Button$/))) return `${playerRu(match[1])} — баттон`;
  const who = "(You|AI(?: [123])?)";
  if ((match = line.match(new RegExp(`^${who} (?:are|is) Button \\/ SB$`)))) return `${playerRu(match[1])} — баттон / МБ`;
  if ((match = line.match(new RegExp(`^${who} posts (small blind|big blind) (\\d+)$`)))) return `${playerRu(match[1])} ${match[1] === "You" ? "ставите" : "ставит"} ${match[2] === "small blind" ? "малый" : "большой"} блайнд ${match[3]}`;
  if ((match = line.match(new RegExp(`^${who} folds$`)))) return `${playerRu(match[1])} — пас`;
  if ((match = line.match(new RegExp(`^${who} checks$`)))) return `${playerRu(match[1])} — чек`;
  if ((match = line.match(new RegExp(`^${who} calls (\\d+)$`)))) return `${playerRu(match[1])} ${match[1] === "You" ? "коллируете" : "коллирует"} ${match[2]}`;
  if ((match = line.match(new RegExp(`^${who} bets (\\d+)$`)))) return `${playerRu(match[1])} ${match[1] === "You" ? "ставите" : "ставит"} ${match[2]}`;
  if ((match = line.match(new RegExp(`^${who} raises to (\\d+)$`)))) return `${playerRu(match[1])} ${match[1] === "You" ? "повышаете" : "повышает"} до ${match[2]}`;
  if ((match = line.match(new RegExp(`^${who} is all-in to (\\d+)$`)))) return `${playerRu(match[1])} ${match[1] === "You" ? "идёте" : "идёт"} олл-ин до ${match[2]}`;
  if ((match = line.match(new RegExp(`^${who} calls all-in for (\\d+)$`)))) return `${playerRu(match[1])} ${match[1] === "You" ? "коллируете" : "коллирует"} олл-ин на ${match[2]}`;
  if ((match = line.match(new RegExp(`^Uncalled (\\d+) returned to ${who}$`)))) return `Непокрытая ставка ${match[1]} возвращена: ${playerRu(match[2])}`;
  if ((match = line.match(/^(Flop|Turn|River): (.+)$/))) return `${({ Flop: "Флоп", Turn: "Тёрн", River: "Ривер" } as Record<string, string>)[match[1]]}: ${match[2]}`;
  if ((match = line.match(/^Showdown: You (.+) · AI (.+)$/))) return `Вскрытие: Вы ${match[1]} · AI ${match[2]}`;
  if ((match = line.match(/^(You (?:win|wins)|AI wins) (\d+) \(opponent folded\)$/))) return `${playerRu(match[1].startsWith("You") ? "You" : "AI")} ${match[1].startsWith("You") ? "забираете" : "забирает"} ${match[2]} — соперник сбросил карты`;
  if ((match = line.match(/^(You (?:win|wins)|AI wins) (\d+) with (.+)$/))) return `${playerRu(match[1].startsWith("You") ? "You" : "AI")} ${match[1].startsWith("You") ? "выигрываете" : "выигрывает"} ${match[2]}: ${handName(match[3], language)}`;
  if ((match = line.match(/^Split pot — both players have (.+)$/))) return `Банк разделён — у обоих ${handName(match[1], language)}`;
  return line;
}

const tendencyRu: Record<string, string> = {
  "sample size is still small": "пока недостаточно раздач для точного профиля",
  "enters many pots": "входит во многие банки",
  "raises frequently preflop": "часто повышает на префлопе",
  "folds often when facing pressure": "часто сдаётся под давлением",
  "often folds to 3-bets": "часто сдаётся на 3-бет",
  "often folds to flop continuation bets": "часто сдаётся на продолженную ставку флопа",
  "continuation-bets the flop frequently": "часто ставит контбет на флопе",
  "frequently barrels the turn": "часто продолжает ставить на тёрне",
  "uses aggressive actions frequently": "часто выбирает агрессивные действия",
  "no pronounced tendency detected": "явных тенденций пока не обнаружено",
};
export function translateTendency(value: string, language: Language): string { return language === "ru" ? tendencyRu[value] ?? value : value; }

export function actionAnnouncement(action: PlayerAction, language: Language): string {
  const amount = action.amount ? ` ${action.amount}` : "";
  const labels: Record<Language, Partial<Record<PlayerAction["action"], string>>> = {
    ru: { fold: "ПАС", check: "ЧЕК", call: "КОЛЛ", bet: "СТАВКА", raise: "РЕЙЗ ДО", "all-in": "ОЛЛ-ИН ДО" },
    en: { fold: "FOLD", check: "CHECK", call: "CALL", bet: "BET", raise: "RAISE TO", "all-in": "ALL-IN TO" },
  };
  return `${labels[language][action.action] ?? action.action.toUpperCase()}${amount}`;
}
