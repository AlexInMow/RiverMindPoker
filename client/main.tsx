import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameConfig, Language, PublicGameState } from "../shared/types";
import { api } from "./api";
import { Controls } from "./components/Controls";
import { PokerTable } from "./components/PokerTable";
import { Setup } from "./components/Setup";
import { SidePanel } from "./components/SidePanel";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { HandGuide } from "./components/HandGuide";
import { t } from "./i18n";
import "./styles.css";

function App() {
  const [game, setGame] = useState<PublicGameState | null>(null);
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("rivermind:language") === "en" ? "en" : "ru");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [explanation, setExplanation] = useState<string>();
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  useEffect(() => {
    const sessionId = localStorage.getItem("rivermind:active-session");
    if (!sessionId) return;
    setBusy(true);
    void api.getSession(sessionId)
      .then(setGame)
      .catch(() => localStorage.removeItem("rivermind:active-session"))
      .finally(() => setBusy(false));
  }, []);

  const start = async (config: GameConfig) => {
    setBusy(true); setError(undefined);
    try {
      const session = await api.createSession(config);
      localStorage.setItem("rivermind:active-session", session.sessionId);
      setGame(session);
    }
    catch (err) { setError(err instanceof Error ? err.message : t(language, "openError")); }
    finally { setBusy(false); }
  };

  const refresh = useCallback(async (id: string) => {
    try {
      const state = await api.getSession(id);
      setGame(state);
    } catch (err) { setError(err instanceof Error ? err.message : t(language, "refreshError")); }
  }, [language]);

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    localStorage.setItem("rivermind:language", nextLanguage);
    if (game) void api.language(game.sessionId, nextLanguage).then(setGame).catch(() => undefined);
  };

  useEffect(() => {
    if (!game) return;
    localStorage.setItem("rivermind:active-session", game.sessionId);
    localStorage.setItem("rivermind:last-session", JSON.stringify({ stats: game.stats, completedHands: game.completedHands }));
  }, [game]);

  const leaveSession = () => {
    localStorage.removeItem("rivermind:active-session");
    setGame(null);
  };

  useEffect(() => {
    if (!game?.aiThinking) return;
    const timer = window.setInterval(() => void refresh(game.sessionId), 450);
    return () => window.clearInterval(timer);
  }, [game?.aiThinking, game?.sessionId, refresh]);

  const nextHand = async () => {
    if (!game || busy || game.aiThinking || game.street !== "complete") return;
    setBusy(true); setError(undefined); setExplanation(undefined);
    try { setGame(await api.next(game.sessionId)); }
    catch (err) { setError(err instanceof Error ? err.message : t(language, "nextError")); }
    finally { setBusy(false); }
  };

  const act = async (type: string, amount?: number) => {
    if (!game || busy || game.aiThinking) return;
    setBusy(true); setError(undefined); setExplanation(undefined);
    try { setGame(await api.action(game.sessionId, { type, amount })); }
    catch (err) { setError(err instanceof Error ? err.message : t(language, "actionError")); }
    finally { setBusy(false); }
  };

  const explain = async () => {
    if (!game) return;
    setBusy(true);
    try { setExplanation((await api.explain(game.sessionId)).explanation); }
    catch (err) { setError(err instanceof Error ? err.message : t(language, "explainError")); }
    finally { setBusy(false); }
  };

  if (!game) return <><Setup onStart={start} loading={busy} language={language} onLanguage={changeLanguage} />{error && <Toast message={error} onClose={() => setError(undefined)} />}</>;
  return (
    <div className="game-shell">
      <header className="game-header">
        <div className="brand compact"><span className="brand-chip">R</span><span>RIVERMIND</span></div>
        <div className="game-meta"><span>{t(language, "hand")} <strong>#{game.handNumber}</strong></span><i /><span>{t(language, "blinds").toUpperCase()} <strong>{game.config.smallBlind} / {game.config.bigBlind}</strong></span><i /><span className={`api-state ${game.aiStatus}`}><b />{game.aiStatus === "connected" ? t(language, "apiConnected") : t(language, "apiOffline")}</span></div>
        <div className="header-actions"><LanguageSwitch language={language} onChange={changeLanguage} /><button className="leave-table" onClick={leaveSession}>{t(language, "leave")}</button></div>
      </header>
      <div className={`game-layout ${guideOpen ? "guide-open" : ""}`}>
        <HandGuide language={language} onClose={() => setGuideOpen(false)} />
        <section className="play-area">
          {!guideOpen && <button type="button" className="hand-guide-trigger" onClick={() => setGuideOpen(true)} aria-expanded={false}>
            <span>?</span><b>{t(language, "handGuide")}</b>
          </button>}
          <PokerTable game={game} language={language} />
          <Controls game={game} language={language} disabled={busy || game.aiThinking || (game.street !== "complete" && game.actor !== "human")} onAction={act} onNext={nextHand} />
          {game.street === "complete" && game.config.coachMode && <button className="coach-button" disabled={busy} onClick={explain}>◇ {t(language, "why")}</button>}
          {game.matchOver && <SessionComplete humanWon={game.players.ai.stack === 0} language={language} onNewSession={leaveSession} />}
        </section>
        <SidePanel game={game} language={language} />
      </div>
      {explanation && <div className="coach-modal"><div><button onClick={() => setExplanation(undefined)}>×</button><span>{t(language, "coachReview")}</span><h3>{t(language, "decisionSummary")}</h3><p>{explanation}</p></div></div>}
      {error && <Toast message={error} onClose={() => setError(undefined)} />}
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) { return <div className="toast"><span>!</span>{message}<button onClick={onClose}>×</button></div>; }

function SessionComplete({ humanWon, language, onNewSession }: { humanWon: boolean; language: Language; onNewSession: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 2200);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="session-over" role="status" aria-live="polite">
    <span>{t(language, "matchFinished")}</span>
    <strong>{humanWon ? t(language, "youWonMatch") : t(language, "aiWonMatch")}</strong>
    <p>{t(language, "reviewFinalHand")}</p>
    <button onClick={onNewSession}>{t(language, "newSession")}</button>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
