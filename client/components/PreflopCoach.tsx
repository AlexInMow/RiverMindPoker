import type { PreflopAnalysis } from "../../shared/preflopCoach";
import type { Language } from "../../shared/types";
import { PlayingCard } from "./Card";

export function PreflopCoach({ analysis: p, language }: { analysis: PreflopAnalysis; language: Language }) {
  const ru = language === "ru";
  return <section className="preflop-coach">
    <h4>PREFLOP · {p.handClass}</h4>
    <div className="coach-cards">{p.cards.map((card) => <PlayingCard key={card} card={card} />)}</div>
    <p title={p.ratingMeaning}>{ru ? "Рейтинг стартовой руки" : "Starting hand rating"} ⓘ</p>
    <meter min={0} max={100} value={p.rating} aria-label={ru ? "Рейтинг, не вероятность победы" : "Rating, not win probability"} />
    <h3>{p.rating} / 100 · {p.category}</h3>
    <small>{ru ? "Рейтинг — не вероятность победы." : "Rating is not win probability."}</small>
    <p>{ru ? "Добровольный вход за фишки" : "Voluntary investment"}: <strong>{p.playFrequency}</strong></p>
    <h4>{p.position} · {p.recommendedAction?.toUpperCase() ?? (ru ? "Ожидание хода" : "Waiting for turn")}</h4>
    <p>{p.explanation}</p>
    <ul>{p.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    {p.openSizing && <p>{ru ? "Пример обычного открытия" : "Example open sizing"}: {p.openSizing.min}–{p.openSizing.max} ({p.openSizing.min / p.openSizing.bigBlind}–{p.openSizing.max / p.openSizing.bigBlind} BB). {ru ? "В пределах разрешённого рейза." : "Within legal raise limits."}</p>}
    <details><summary>{ru ? "Подробнее о префлопе" : "Preflop details"}</summary>
      <p>{p.ratingMeaning}</p><p>{ru ? "Рейтинг постоянен; практическая играбельность меняется с контекстом. Частота словесная, эвристическая, не измеренная mixed strategy." : "Rating is fixed; practical playability changes with context. Frequency is qualitative and heuristic, not a measured mixed strategy."}</p>
      <p>{p.contextLabel} · {ru ? "уровень ставки" : "bet level"}: {p.betLevel}</p>
      <p>{ru ? "Игроков" : "Players"}: {p.playerCount} · {ru ? "в руке" : "in hand"}: {p.playersInHand}{p.aggressorPosition ? ` · ${ru ? "агрессор" : "aggressor"}: ${p.aggressorPosition}` : ""}</p>
      <p>{p.positionExplanation}</p><p>{ru ? "Эффективный стек" : "Effective stack"}: {p.effectiveStackBb.toFixed(1)} BB · {p.stackCategory}</p><p>{p.stackExplanation}</p>
      {p.traits.map((trait) => <p key={trait.id}>{trait.text}</p>)}
      {p.alternatives.map((line) => <p key={line}>{line}</p>)}
      <p>{p.equity ? `${p.equity.rangeAssumption}: ${(p.equity.equity * 100).toFixed(1)}% (${p.equity.method})` : ru ? "Equity против диапазонов не рассчитано." : "Equity against ranges is not calculated."}</p>
    </details>
  </section>;
}
