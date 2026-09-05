import { useState } from "react";
import type { Difficulty, GameConfig, Language, OpponentCount, Strategy } from "../../shared/types";
import { difficultyNames, strategyInfo, t } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";

const strategies: Strategy[] = ["balanced", "tag", "lag", "nit", "calling-station", "maniac", "tricky", "adaptive"];

const defaults: GameConfig = {
  language: "ru", startingStack: 10000, smallBlind: 50, bigBlind: 100, opponentCount: 1, strategy: "balanced", difficulty: "strong", tableTalk: true, coachMode: false, debugMode: false,
};

export function Setup({ onStart, loading, language, onLanguage }: { onStart: (config: GameConfig) => void; loading: boolean; language: Language; onLanguage: (language: Language) => void }) {
  const saved = localStorage.getItem("rivermind:settings");
  const [config, setConfig] = useState<GameConfig>(() => saved ? { ...defaults, ...JSON.parse(saved) } : defaults);
  const update = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const start = () => { const localized = { ...config, language }; localStorage.setItem("rivermind:settings", JSON.stringify(localized)); onStart(localized); };

  return (
    <main className="setup-shell">
      <section className="setup-hero">
        <div className="brand"><span className="brand-chip">R</span><span>RIVERMIND</span></div>
        <div className="eyebrow">{t(language, "headsUp")}</div>
        <h1>{t(language, "hero1")}<br /><em>{t(language, "hero2")}</em></h1>
        <p>{t(language, "intro")}</p>
        <div className="fairness-note"><span className="shield">◆</span><div><strong>{t(language, "isolated")}</strong><small>{t(language, "noCards")}</small></div></div>
      </section>
      <section className="setup-panel">
        <LanguageSwitch language={language} onChange={onLanguage} className="setup-language" />
        <div className="setup-title"><div><span className="eyebrow">{t(language, "newTable")}</span><h2>{t(language, "chooseOpponent")}</h2></div><span className="live-dot">{t(language, "local")}</span></div>
        <div className="opponent-picker">
          <span>{t(language, "opponents")}</span>
          <div>{([1, 2, 3] as OpponentCount[]).map((count) => <button type="button" key={count} className={config.opponentCount === count ? "selected" : ""} onClick={() => update("opponentCount", count)}>{count}</button>)}</div>
        </div>
        <div className="strategy-grid">
          {strategies.map((strategy) => (
            <button key={strategy} className={`strategy-card ${config.strategy === strategy ? "selected" : ""}`} onClick={() => update("strategy", strategy)}>
              <span className="strategy-icon">{strategyInfo[language][strategy].name[0]}</span><span><strong>{strategyInfo[language][strategy].name}</strong><small>{strategyInfo[language][strategy].description}</small></span>
            </button>
          ))}
        </div>
        <div className="config-row three">
          <label><span>{t(language, "difficulty")}</span><select value={config.difficulty} onChange={(event) => update("difficulty", event.target.value as Difficulty)}><option value="casual">{difficultyNames[language].casual}</option><option value="strong">{difficultyNames[language].strong}</option><option value="expert">{difficultyNames[language].expert}</option></select></label>
          <label><span>{t(language, "startingStack")}</span><input type="number" min="500" step="500" value={config.startingStack} onChange={(event) => update("startingStack", Number(event.target.value))} /></label>
          <label><span>{t(language, "blinds")}</span><div className="blind-inputs"><input aria-label={t(language, "smallBlind")} type="number" min="1" value={config.smallBlind} onChange={(event) => update("smallBlind", Number(event.target.value))} /><i>/</i><input aria-label={t(language, "bigBlind")} type="number" min="2" value={config.bigBlind} onChange={(event) => update("bigBlind", Number(event.target.value))} /></div></label>
        </div>
        <div className="toggle-row">
          <Toggle label={t(language, "tableTalk")} checked={config.tableTalk} onChange={(value) => update("tableTalk", value)} />
          <Toggle label={t(language, "coachMode")} checked={config.coachMode} onChange={(value) => update("coachMode", value)} />
          <Toggle label={t(language, "debugMode")} checked={config.debugMode} onChange={(value) => update("debugMode", value)} />
        </div>
        <button className="take-seat" disabled={loading} onClick={start}>{loading ? t(language, "opening") : t(language, "takeSeat")}<span>→</span></button>
        <p className="disclaimer">{t(language, "disclaimer")}</p>
      </section>
    </main>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track"><i /></span><b>{label}</b></label>;
}
