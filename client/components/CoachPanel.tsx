import { useEffect, useState } from "react";
import type { CoachAnalysis, CoachReport } from "../../shared/coach";
import type { Card, Language } from "../../shared/types";
import { PlayingCard } from "./Card";
import { playerDisplayName, streetLabel } from "../i18n";
import { PreflopCoach } from "./PreflopCoach";

function Cards({ cards }: { cards: Card[] }) {
  return <div className="coach-cards">{cards.map((card) => <PlayingCard key={card} card={card} />)}</div>;
}
function Analysis({ analysis: a, language }: { analysis: CoachAnalysis; language: Language }) {
  const ru = language === "ru";
  return <>
    {a.preflop ? <PreflopCoach analysis={a.preflop} language={language} /> : <h3>{a.madeHand}</h3>}
    {a.bestFiveCards.length > 0 && <><small>{ru ? "Лучшие 5 карт · зелёная подсветка на столе" : "Best five · green on table"}</small><Cards cards={a.bestFiveCards} /></>}
    {a.draws.length > 0 && <section><h4>{ru ? "Потенциал · жёлтая подсветка" : "Potential · yellow highlights"}</h4>{a.draws.map((d) => <details key={d.kind}><summary>{d.label} — {d.potentialOuts.length} {ru ? "потенциальных аутов" : "potential outs"}</summary><p>{d.description}</p><Cards cards={d.potentialOuts} /></details>)}<p>{ru ? "Всего уникальных потенциальных улучшений" : "Unique potential improvements"}: {a.outs.length}</p></section>}
    {a.potOdds && <section><h4>{ru ? "Цена колла" : "Call price"}</h4><p>{ru ? "Банк сейчас" : "Current pot"}: {a.potOdds.potBefore} · {ru ? "доплатить" : "call"}: {a.potOdds.call}</p><p>{ru ? "После колла" : "After calling"}: {a.potOdds.potAfter} · {ru ? "доступно вам" : "contestable"}: {a.potOdds.contestablePotAfter}</p><strong>{ru ? "Необходимое equity" : "Required equity"}: {(a.potOdds.requiredEquity * 100).toFixed(1)}%</strong><p>{ru ? "Equity вашей руки против диапазонов не рассчитано. Одной комбинации или числа аутов недостаточно, чтобы рекомендовать колл." : "Your equity against ranges is not calculated. A category or out count alone cannot justify a call."}</p></section>}
    <section><h4>{ru ? "Доска" : "Board"}: {a.boardTexture.label}</h4>{a.boardTexture.reasons.map((reason) => <p key={reason}>{reason}</p>)}</section>
    <details><summary>{ru ? "Подробнее: ограничения и технические данные" : "Details: limitations and metrics"}</summary>{a.warnings.map((w) => <p key={w}>{w}</p>)}<p>{ru ? "Эвристическая динамичность доски" : "Heuristic board wetness"}: {Math.round(a.boardTexture.metrics.wetness * 100)}%</p></details>
  </>;
}

export function CoachPanel({ report, language, onClose }: { report: CoachReport; language: Language; onClose: () => void }) {
  const ru = language === "ru";
  const [mode, setMode] = useState<"current" | "human" | "ai" | "hand">("current");
  const [tip, setTip] = useState<{ id: string; text: string }>();
  const concepts = [...(report.current.preflop?.learningConcepts ?? []), ...report.current.learningConcepts];
  useEffect(() => {
    try {
      const seen: string[] = JSON.parse(localStorage.getItem("rivermind:coach-concepts") ?? "[]");
      setTip(concepts.find((c) => !seen.includes(c.id)));
    } catch { setTip(undefined); }
  }, [report.handId, concepts.map((c) => `${c.id}:${c.text}`).join(",")]);
  const dismissTip = () => {
    if (tip) try { const seen = JSON.parse(localStorage.getItem("rivermind:coach-concepts") ?? "[]"); localStorage.setItem("rivermind:coach-concepts", JSON.stringify([...new Set([...seen, tip.id])])); } catch { /* storage may be disabled */ }
    setTip(undefined);
  };
  const selected = mode === "hand" ? report.decisions : mode === "human" ? report.decisions.filter((d) => d.player === "human").slice(-1) : report.decisions.filter((d) => d.player !== "human").slice(-1);
  return <aside className="trainer-panel" aria-label={ru ? "Разбор тренера" : "Coach review"}>
    <header><strong>◇ {ru ? "ТРЕНЕР" : "COACH"}</strong><button onClick={onClose} aria-label={ru ? "Закрыть тренера" : "Close coach"}>×</button></header>
    <nav>{([ ["current", ru ? "Ваша рука" : "Your hand"], ["human", ru ? "Разобрать мой ход" : "My decision"], ["ai", ru ? "Ход AI" : "AI decision"], ...(report.resultSummary ? [["hand", ru ? "Разобрать раздачу" : "Review hand"]] : []) ] as [typeof mode, string][]).map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}</nav>
    {mode === "current" ? <Analysis analysis={report.current} language={language} /> : <>
      {selected.length === 0 && <p>{ru ? "В этой раздаче ещё нет завершённого действия для разбора." : "No completed action to review in this hand yet."}</p>}
      {selected.map((d, i) => <article key={d.index}>
        {(i === 0 || selected[i - 1].street !== d.street) && <h4>{streetLabel(d.street, language)}</h4>}
        <h3>{d.title}</h3><small>{d.actionCategory}</small><p>{d.explanation}</p>
        {d.betSizePercent !== undefined && <p>{ru ? "Дополнительное вложение" : "Additional investment"}: {d.betSizePercent.toFixed(0)}% {ru ? "банка перед ходом" : "of pot before action"}</p>}
        <details><summary>{ru ? "Подробнее · ситуация ДО хода" : "Details · BEFORE the action"}</summary><Cards cards={d.board} />{d.analysis && <Analysis analysis={d.analysis} language={language} />}{d.technicalData && <p>{d.technicalData.source}: {d.technicalData.strength?.toFixed(3)} · {ru ? "порог вэлью" : "value threshold"} {d.technicalData.valueThreshold?.toFixed(3)}</p>}</details>
      </article>)}
      {mode === "hand" && <section><h4>SHOWDOWN</h4>{report.showdown.length ? report.showdown.map((p) => <div key={p.player}><p>{playerDisplayName(p.player, language)}: {p.madeHand}</p><Cards cards={p.cards} /></div>) : <p>{ru ? "Вскрытия не было; закрытые карты не используются." : "No showdown; hidden cards are not used."}</p>}<p>{report.takeaway}</p></section>}
    </>}
    {tip && <div className="coach-tip"><p>💡 {tip.text}</p><button onClick={dismissTip}>{ru ? "Понятно, больше не показывать" : "Got it, don't show again"}</button></div>}
    <footer>{ru ? "Зелёный — лучшие пять карт. Жёлтый — дро; если карта участвует в обоих, видны оба контура. Подсветка на столе всегда относится к вашей текущей руке." : "Green: best five. Yellow: draw; both outlines may appear. Table highlights always refer to your current hand."}</footer>
  </aside>;
}
