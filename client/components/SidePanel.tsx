import { useMemo, useState } from "react";
import type { Language, PublicGameState } from "../../shared/types";
import { resultText, t, translateLog, translateTendency } from "../i18n";

export function SidePanel({ game, language }: { game: PublicGameState; language: Language }) {
  const [tab, setTab] = useState<"history" | "stats" | "debug">("history");
  const latestLines = game.handLog;
  return (
    <aside className="side-panel">
      <nav className="panel-tabs">
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>{t(language, "handLog")}</button>
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>{t(language, "stats")}</button>
        {game.config.debugMode && <button className={tab === "debug" ? "active" : ""} onClick={() => setTab("debug")}>{t(language, "debug")}</button>}
      </nav>
      {tab === "history" && <div className="history-pane">
        <div className="history-head"><div><span>{t(language, "hand")}</span><strong>#{game.handNumber}</strong></div><span>{game.config.smallBlind} / {game.config.bigBlind}</span></div>
        <div className="log-lines">{latestLines.map((line, index) => <LogLine key={`${index}-${line}`} line={line} language={language} resultTextOverride={game.result && line === game.result.summary ? resultText(game.result, language) : undefined} />)}</div>
        {game.completedHands.length > 1 && <details className="past-hands"><summary>{t(language, "previousHands")} ({game.completedHands.length - 1})</summary>{game.completedHands.slice(1).map((hand) => <div key={hand.handNumber} className="past-hand"><strong>#{hand.handNumber}</strong><span>{resultText(hand.result, language)}</span></div>)}</details>}
      </div>}
      {tab === "stats" && <Stats game={game} language={language} />}
      {tab === "debug" && <pre className="debug-pane">{JSON.stringify(game.debug, null, 2)}</pre>}
    </aside>
  );
}

function LogLine({ line, language, resultTextOverride }: { line: string; language: Language; resultTextOverride?: string }) {
  const isStreet = /^(Flop|Turn|River|Showdown)/.test(line);
  const isWin = /wins|Split/.test(line);
  return <div className={`log-line ${isStreet ? "street" : ""} ${isWin ? "win" : ""}`}>{resultTextOverride ?? translateLog(line, language)}</div>;
}

function Stats({ game, language }: { game: PublicGameState; language: Language }) {
  const stats = game.stats;
  const sampledRate = (rate: number, opportunities: number) => `${rate}% · ${opportunities}`;
  const points = useMemo(() => {
    const values = stats.chipHistory.map((point) => point.chips);
    const min = Math.min(...values, game.config.startingStack) - game.config.bigBlind;
    const max = Math.max(...values, game.config.startingStack) + game.config.bigBlind;
    return stats.chipHistory.map((point, index) => `${(index / Math.max(1, values.length - 1)) * 280},${80 - ((point.chips - min) / Math.max(1, max - min)) * 70}`).join(" ");
  }, [stats.chipHistory, game.config]);
  const entries = [
    [t(language, "handsPlayed"), stats.hands], [t(language, "handsWon"), stats.handsWon], [t(language, "showdownsWon"), `${stats.showdownsWon}/${stats.showdowns}`], [t(language, "biggestPot"), stats.biggestPot.toLocaleString()],
    ["VPIP", `${stats.vpip}%`], ["PFR", `${stats.pfr}%`], [language === "ru" ? "3-бет" : "3-Bet", `${stats.threeBet}%`], [t(language, "aggression"), stats.aggressionFactor],
    [language === "ru" ? "Фолд" : "Fold frequency", sampledRate(stats.foldFrequency, stats.foldOpportunities)],
    [language === "ru" ? "Фолд на 3-бет" : "Fold to 3-bet", sampledRate(stats.foldToThreeBet, stats.foldToThreeBetOpportunities)],
    [language === "ru" ? "Фолд на контбет" : "Fold to c-bet", sampledRate(stats.foldToCBet, stats.foldToCBetOpportunities)],
    [language === "ru" ? "Контбет флопа" : "Flop c-bet", sampledRate(stats.flopCBet, stats.flopCBetOpportunities)],
    [language === "ru" ? "Баррель тёрна" : "Turn barrel", sampledRate(stats.turnBarrel, stats.turnBarrelOpportunities)],
    [language === "ru" ? "Агрессия ривера" : "River aggression", sampledRate(stats.riverAggression, stats.riverOpportunities)],
    [language === "ru" ? "Чек-рейз" : "Check-raise", sampledRate(stats.checkRaise, stats.checkRaiseOpportunities)],
    ["WTSD", `${stats.wentToShowdown}%`], ["W$SD", `${stats.wonAtShowdown}%`],
    [t(language, "netChips"), `${stats.netChips >= 0 ? "+" : ""}${stats.netChips}`], [language === "ru" ? "ББ / 100" : "BB / 100", stats.bbPer100],
  ];
  return <div className="stats-pane">
    <div className="chart-head"><span>{t(language, "chipGraph")}</span><strong className={stats.netChips >= 0 ? "positive" : "negative"}>{stats.netChips >= 0 ? "+" : ""}{stats.netChips}</strong></div>
    <svg className="chip-chart" viewBox="0 0 280 90" preserveAspectRatio="none"><line x1="0" y1="80" x2="280" y2="80" /><polyline points={points} /></svg>
    <div className="stat-grid">{entries.map(([label, value]) => <div key={label as string}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="tendencies"><span>{t(language, "tendencies")}</span>{stats.tendencies.map((item) => <p key={item}>• {translateTendency(item, language)}</p>)}</div>
  </div>;
}
