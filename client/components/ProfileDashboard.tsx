import { useEffect, useState } from "react";
import type { Language, Strategy } from "../../shared/types";
import type { HistoryFilters, LifetimeStats, LocalPlayerProfile, StoredHandDetail, StoredHandSummary } from "../../shared/history";
import { api } from "../api";
import { PlayingCard } from "./Card";

const emptyFilters: HistoryFilters = { scope: "all", showdown: "all", result: "all", limit: 50 };

export function ProfileDashboard({ profile, language, currentSessionId, onBack }: { profile: LocalPlayerProfile; language: Language; currentSessionId?: string; onBack: () => void }) {
  const [filters, setFilters] = useState<HistoryFilters>(emptyFilters);
  const [stats, setStats] = useState<LifetimeStats>();
  const [hands, setHands] = useState<StoredHandSummary[]>([]);
  const [detail, setDetail] = useState<StoredHandDetail>();
  const [message, setMessage] = useState("");
  const [dataPath, setDataPath] = useState("");
  const load = () => Promise.all([api.profileStats(profile.id, filters), api.profileHands(profile.id, filters)]).then(([nextStats, nextHands]) => { setStats(nextStats); setHands(nextHands); });
  useEffect(() => { void load(); }, [profile.id, JSON.stringify(filters)]);
  useEffect(() => { void api.info().then((info) => setDataPath(info.databasePath)); }, []);
  const update = (key: keyof HistoryFilters, value: string | number | undefined) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  const download = (contents: string, type: string, extension: string) => { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([contents], { type })); link.download = `rivermind-${profile.displayName}-${new Date().toISOString().slice(0, 10)}.${extension}`; link.click(); URL.revokeObjectURL(link.href); };
  const exportJson = async () => download(JSON.stringify(await api.exportProfile(profile.id, filters), null, 2), "application/json", "json");
  const exportCsv = async () => download(await api.exportCsv(profile.id, filters), "text/csv", "csv");
  return <main className="dashboard-shell">
    <header className="dashboard-header"><button onClick={onBack}>← {language === "ru" ? "К столу" : "Back"}</button><div><span>{language === "ru" ? "ПРОФИЛЬ ИГРОКА" : "PLAYER PROFILE"}</span><h1>{profile.displayName}</h1></div><div><button onClick={() => void exportJson()}>JSON</button><button onClick={() => void exportCsv()}>CSV</button><button onClick={() => void api.backup().then((value) => setMessage(`${language === "ru" ? "Копия создана" : "Backup created"}: ${value.path}`))}>⧉</button></div></header>
    <section className="history-filters">
      <select value={filters.scope} onChange={(e) => setFilters((current) => ({ ...current, scope: e.target.value as HistoryFilters["scope"], sessionId: e.target.value === "session" ? currentSessionId : undefined }))}><option value="all">{language === "ru" ? "Всё время" : "All time"}</option>{currentSessionId && <option value="session">{language === "ru" ? "Текущая сессия" : "Current session"}</option>}<option value="last100">{language === "ru" ? "Последние 100" : "Last 100"}</option><option value="last500">{language === "ru" ? "Последние 500" : "Last 500"}</option></select>
      <select value={filters.tableSize ?? ""} onChange={(e) => update("tableSize", e.target.value ? Number(e.target.value) : undefined)}><option value="">{language === "ru" ? "Любой стол" : "Any table"}</option><option value="2">Heads-up</option><option value="3">3-player</option><option value="4">4-player</option></select>
      <select value={filters.strategy ?? ""} onChange={(e) => update("strategy", e.target.value as Strategy)}><option value="">{language === "ru" ? "Любая стратегия" : "Any strategy"}</option>{["balanced","tag","lag","nit","calling-station","maniac","tricky","adaptive"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select value={filters.showdown} onChange={(e) => update("showdown", e.target.value)}><option value="all">{language === "ru" ? "Все финалы" : "Any ending"}</option><option value="showdown">Showdown</option><option value="no-showdown">No showdown</option></select>
      <select value={filters.result} onChange={(e) => update("result", e.target.value)}><option value="all">{language === "ru" ? "Любой результат" : "Any result"}</option><option value="profitable">{language === "ru" ? "Прибыльные" : "Profitable"}</option><option value="losing">{language === "ru" ? "Убыточные" : "Losing"}</option><option value="neutral">{language === "ru" ? "Нулевые" : "Neutral"}</option></select>
    </section>
    {stats && <><h2 className="lifetime-title">{language === "ru" ? "СТАТИСТИКА ЗА ВСЁ ВРЕМЯ" : "LIFETIME STATISTICS"}</h2><section className="lifetime-grid">{[
      [language === "ru" ? "Сессии" : "Sessions", stats.sessions], [language === "ru" ? "Раздачи" : "Hands", stats.hands], ["Net", `${stats.netChips >= 0 ? "+" : ""}${stats.netChips}`], ["BB/100", stats.bbPer100], [language === "ru" ? "Прибыльные" : "Profitable", stats.profitableHands], [language === "ru" ? "С выплатой" : "With payout", stats.handsWithPayout], [language === "ru" ? "Банков выиграно" : "Pots won", stats.potsWon], [language === "ru" ? "Вскрытия" : "Showdowns", stats.showdowns], [language === "ru" ? "Вскрытия с выплатой" : "Showdowns with payout", stats.showdownsWithPayout], ["VPIP", `${stats.vpip}%`], ["PFR", `${stats.pfr}%`], ["3-bet", `${stats.threeBet}%`], [language === "ru" ? "Фолд" : "Fold frequency", `${stats.foldFrequency}% · ${stats.foldOpportunities}`], [language === "ru" ? "Фолд на 3-бет" : "Fold to 3-bet", `${stats.foldToThreeBet}% · ${stats.foldToThreeBetOpportunities}`], [language === "ru" ? "Фолд на контбет" : "Fold to c-bet", `${stats.foldToCBet}% · ${stats.foldToCBetOpportunities}`], [language === "ru" ? "Контбет флопа" : "Flop c-bet", `${stats.flopCBet}% · ${stats.flopCBetOpportunities}`], [language === "ru" ? "Баррель тёрна" : "Turn barrel", `${stats.turnBarrel}% · ${stats.turnBarrelOpportunities}`], [language === "ru" ? "Агрессия ривера" : "River aggression", `${stats.riverAggression}% · ${stats.riverOpportunities}`], [language === "ru" ? "Чек-рейз" : "Check-raise", `${stats.checkRaise}% · ${stats.checkRaiseOpportunities}`], ["WTSD", `${stats.wentToShowdown}%`], ["W$SD", `${stats.wonAtShowdown}%`], [language === "ru" ? "Самый большой банк" : "Biggest pot", stats.biggestPot], [language === "ru" ? "Средний банк" : "Average pot", stats.averagePot], [language === "ru" ? "Лучшая раздача" : "Biggest win", stats.biggestWinningHand ? `#${stats.biggestWinningHand.handNumber} +${stats.biggestWinningHand.humanNet}` : "—"], [language === "ru" ? "Худшая раздача" : "Biggest loss", stats.biggestLosingHand ? `#${stats.biggestLosingHand.handNumber} ${stats.biggestLosingHand.humanNet}` : "—"],
    ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section><ProfitGraph points={stats.profitHistory} /></>}
    <section className="saved-hands"><h2>{language === "ru" ? "История раздач" : "Hand history"}</h2>{hands.length === 0 && <p>{language === "ru" ? "Сохранённых раздач пока нет." : "No saved hands yet."}</p>}{hands.map((hand) => <button key={hand.id} onClick={() => void api.hand(hand.id).then(setDetail)}><b>#{hand.handNumber}</b><strong className={hand.humanNet >= 0 ? "positive" : "negative"}>{hand.humanNet >= 0 ? "+" : ""}{hand.humanNet}</strong><span>{hand.opponentCount + 1} players · {hand.strategy}</span><small>{hand.reachedShowdown ? "showdown" : hand.foldedStreet ? `folded ${hand.foldedStreet}` : "no showdown"}{hand.isMarkedForReview ? " · ★" : ""}</small></button>)}</section>
    {dataPath && <p className="data-path">{language === "ru" ? "Данные хранятся локально" : "Data stored locally"}: <code>{dataPath}</code></p>}
    {message && <div className="data-message">{message}<button onClick={() => setMessage("")}>×</button></div>}
    {detail && <HandDetail hand={detail} language={language} onClose={() => setDetail(undefined)} onSaved={(hand) => { setDetail(hand); void load(); }} />}
  </main>;
}

function ProfitGraph({ points }: { points: LifetimeStats["profitHistory"] }) {
  const values = points.map((point) => point.cumulativeNet); const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const line = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 900},${150 - ((value - min) / Math.max(1, max - min)) * 130}`).join(" ");
  return <svg className="lifetime-chart" viewBox="0 0 900 170" preserveAspectRatio="none"><line x1="0" y1="150" x2="900" y2="150" /><polyline points={line} /></svg>;
}

function HandDetail({ hand, language, onClose, onSaved }: { hand: StoredHandDetail; language: Language; onClose: () => void; onSaved: (hand: StoredHandDetail) => void }) {
  const [marked, setMarked] = useState(hand.isMarkedForReview); const [note, setNote] = useState(hand.reviewNote);
  return <div className="hand-detail-backdrop"><article className="hand-detail"><button className="detail-close" onClick={onClose}>×</button><span>#{hand.handNumber} · {hand.completedAt.slice(0, 16).replace("T", " ")}</span><h2>{hand.humanNet >= 0 ? "+" : ""}{hand.humanNet} chips</h2>
    <div className="detail-board">{hand.board.map((card) => <PlayingCard key={card} card={card} small />)}</div>
    <div className="detail-players">{hand.players.map((player) => <div key={player.playerId}><b>{player.playerId === "human" ? (language === "ru" ? "Вы" : "You") : player.playerId.toUpperCase()}</b><span>{player.position} · {player.startingStack} → {player.endingStack}</span><div>{player.holeCards ? player.holeCards.map((card) => <PlayingCard key={card} card={card} small />) : <em>{language === "ru" ? "Карты скрыты" : "Cards hidden"}</em>}</div></div>)}</div>
    <div className="detail-actions">{hand.actions.map((action, index) => <p key={index}><span>{action.street}</span> {action.player}: {action.action} {action.amount ?? ""}</p>)}</div>
    <div className="detail-pots">{hand.pots.map((pot) => <p key={pot.index}>{pot.index === 0 ? "Main pot" : `Side pot ${pot.index}`}: {pot.amount} → {pot.winners.join(" / ")}</p>)}</div>
    <div className="review-form"><label><input type="checkbox" checked={marked} onChange={(e) => setMarked(e.target.checked)} /> ★ {language === "ru" ? "Сохранить для разбора" : "Mark for review"}</label><textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={language === "ru" ? "Заметка о раздаче" : "Review note"} /><button onClick={() => void api.reviewHand(hand.id, marked, note).then(onSaved)}>{language === "ru" ? "СОХРАНИТЬ" : "SAVE"}</button></div>
  </article></div>;
}
