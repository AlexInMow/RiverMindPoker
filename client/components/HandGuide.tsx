import type { Card, Language } from "../../shared/types";
import { t } from "../i18n";
import { PlayingCard } from "./Card";

const exampleHands: Card[][] = [
  ["As", "Ks", "Qs", "Js", "Ts"],
  ["9h", "8h", "7h", "6h", "5h"],
  ["Qs", "Qh", "Qd", "Qc", "7s"],
  ["Js", "Jh", "Jd", "8c", "8d"],
  ["Ad", "Jd", "8d", "5d", "2d"],
  ["Tc", "9d", "8s", "7h", "6c"],
  ["7s", "7h", "7d", "Kc", "4s"],
  ["As", "Ad", "5c", "5h", "9s"],
  ["Ks", "Kd", "Jc", "8h", "3s"],
  ["As", "Jd", "9c", "6h", "3s"],
];

const rankingText = {
  ru: [
    ["Роял-флеш", "Стрит от десятки до туза одной масти"],
    ["Стрит-флеш", "Пять карт подряд одной масти"],
    ["Каре", "Четыре карты одного достоинства"],
    ["Фулл-хаус", "Тройка и пара"],
    ["Флеш", "Пять карт одной масти"],
    ["Стрит", "Пять карт подряд"],
    ["Тройка", "Три карты одного достоинства"],
    ["Две пары", "Две разные пары"],
    ["Пара", "Две карты одного достоинства"],
    ["Старшая карта", "Когда комбинация не собралась"],
  ],
  en: [
    ["Royal flush", "Ten through ace in the same suit"],
    ["Straight flush", "Five consecutive cards, same suit"],
    ["Four of a kind", "Four cards of the same rank"],
    ["Full house", "Three of a kind plus a pair"],
    ["Flush", "Five cards of the same suit"],
    ["Straight", "Five consecutive cards"],
    ["Three of a kind", "Three cards of the same rank"],
    ["Two pair", "Two different pairs"],
    ["One pair", "Two cards of the same rank"],
    ["High card", "When no made hand is present"],
  ],
} as const;

export function HandGuide({ language, onClose }: { language: Language; onClose: () => void }) {
  return <aside className="hand-guide" aria-label={t(language, "handGuide")}>
    <div className="hand-guide-inner">
      <header className="hand-guide-head">
        <div><span>10 → 1</span><h2>{t(language, "handGuide")}</h2><p>{t(language, "handGuideSubtitle")}</p></div>
        <button type="button" onClick={onClose} aria-label={t(language, "closeGuide")}>×</button>
      </header>
      <ol className="ranking-list">
        {rankingText[language].map(([name, description], index) => <li key={name}>
          <span className="ranking-number">{10 - index}</span>
          <div className="ranking-content">
            <div className="ranking-title"><strong>{name}</strong><small>{description}</small></div>
            <div className="guide-cards" aria-label={name}>
              {exampleHands[index].map((card) => <PlayingCard key={card} card={card} />)}
            </div>
          </div>
        </li>)}
      </ol>
    </div>
  </aside>;
}
