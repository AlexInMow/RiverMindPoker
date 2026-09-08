import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameConfig, Language, PublicGameState } from "../shared/types";
import type { LocalPlayerProfile } from "../shared/history";
import { api } from "./api";
import { Controls } from "./components/Controls";
import { PokerTable } from "./components/PokerTable";
import { Setup } from "./components/Setup";
import { SidePanel } from "./components/SidePanel";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { HandGuide } from "./components/HandGuide";
import { t } from "./i18n";
import { ProfileSelect } from "./components/ProfileSelect";
import { ProfileDashboard } from "./components/ProfileDashboard";
import "./styles.css";
import { CoachPanel } from "./components/CoachPanel";
import type { CoachReport } from "../shared/coach";

function App() {
  const [game, setGame] = useState<PublicGameState | null>(null);
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("rivermind:language") === "en" ? "en" : "ru");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachReport, setCoachReport] = useState<CoachReport>();
  const [guideOpen, setGuideOpen] = useState(false);
  const [profile, setProfile] = useState<LocalPlayerProfile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (!coachOpen || !game?.config.coachMode) return;
    let cancelled = false;
    void api.coach(game.sessionId).then((report) => { if (!cancelled) setCoachReport(report); }).catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [coachOpen, game?.sessionId, game?.handId, game?.actions.length, game?.aiThinking, game?.config.language]);

  useEffect(() => {
    const activeId = localStorage.getItem("rivermind:active-profile");
    void api.profiles().then((profiles) => {
      const active = activeId ? profiles.find((candidate) => candidate.id === activeId) ?? null : null;
      setProfile(active);
      if (!active) localStorage.removeItem("rivermind:active-session");
    }).finally(() => setProfileReady(true));
  }, []);

  useEffect(() => {
    if (!profileReady || !profile) return;
    const sessionId = localStorage.getItem("rivermind:active-session");
    if (!sessionId) return;
    setBusy(true);
    void api.getSession(sessionId)
      .then(setGame)
      .catch(() => localStorage.removeItem("rivermind:active-session"))
      .finally(() => setBusy(false));
  }, [profileReady, profile?.id]);

  const start = async (config: GameConfig) => {
    setBusy(true); setError(undefined);
    try {
      if (!profile) throw new Error(language === "ru" ? "Сначала выберите профиль" : "Select a profile first");
      const session = await api.createSession(config, profile.id);
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
    if (game) void api.endSession(game.sessionId).catch(() => undefined);
    localStorage.removeItem("rivermind:active-session");
    setGame(null);
  };

  const selectProfile = (nextProfile: LocalPlayerProfile) => {
    localStorage.setItem("rivermind:active-profile", nextProfile.id);
    setProfile(nextProfile); setProfileOpen(false);
  };

  const switchProfile = () => {
    localStorage.removeItem("rivermind:active-profile");
    localStorage.removeItem("rivermind:active-session");
    setGame(null); setProfile(null); setProfileOpen(false);
  };

  useEffect(() => {
    if (!game?.aiThinking) return;
    const timer = window.setInterval(() => void refresh(game.sessionId), 450);
    return () => window.clearInterval(timer);
  }, [game?.aiThinking, game?.sessionId, refresh]);

  const nextHand = async () => {
    if (!game || busy || game.aiThinking || game.street !== "complete") return;
    setBusy(true); setError(undefined); setCoachReport(undefined);
    try { setGame(await api.next(game.sessionId)); }
    catch (err) { setError(err instanceof Error ? err.message : t(language, "nextError")); }
    finally { setBusy(false); }
  };

  const act = async (type: string, amount?: number) => {
    if (!game || busy || game.aiThinking) return;
    setBusy(true); setError(undefined); setCoachReport(undefined);
    try { setGame(await api.action(game.sessionId, { type, amount })); }
    catch (err) { setError(err instanceof Error ? err.message : t(language, "actionError")); }
    finally { setBusy(false); }
  };

  const activeCoach = coachOpen && coachReport?.handId === game?.handId && coachReport?.actionCount === game?.actions.length ? coachReport : undefined;

  if (!profileReady) return <div className="profile-loading">RIVERMIND</div>;
  if (!profile) return <ProfileSelect language={language} onLanguage={changeLanguage} onSelect={selectProfile} />;
  if (profileOpen) return <ProfileDashboard profile={profile} language={language} currentSessionId={game?.sessionId} onBack={() => setProfileOpen(false)} />;
  if (!game) return <><div className="setup-profile-bar"><button onClick={switchProfile}>← {language === "ru" ? "Сменить игрока" : "Switch player"}</button><b>{profile.displayName}</b><button onClick={() => setProfileOpen(true)}>{language === "ru" ? "Профиль и история" : "Profile & history"} →</button></div><Setup onStart={start} loading={busy} language={language} onLanguage={changeLanguage} />{error && <Toast message={error} onClose={() => setError(undefined)} />}</>;
  return (
    <div className="game-shell">
      <header className="game-header">
        <div className="brand compact"><span className="brand-chip">R</span><span>RIVERMIND</span></div>
        <div className="game-meta"><span>{t(language, "hand")} <strong>#{game.handNumber}</strong></span><i /><span>{t(language, "blinds").toUpperCase()} <strong>{game.config.smallBlind} / {game.config.bigBlind}</strong></span><i /><span className={`api-state ${game.aiStatus}`}><b />{game.aiStatus === "connected" ? t(language, "apiConnected") : t(language, "apiOffline")}</span></div>
        <div className="header-actions"><button className="leave-table" onClick={() => setProfileOpen(true)}>{profile.displayName}</button><LanguageSwitch language={language} onChange={changeLanguage} /><button className="leave-table" onClick={leaveSession}>{t(language, "leave")}</button></div>
      </header>
      <div className={`game-layout ${guideOpen ? "guide-open" : ""}`}>
        <HandGuide language={language} onClose={() => setGuideOpen(false)} />
        <section className="play-area">
          {!guideOpen && <button type="button" className="hand-guide-trigger" onClick={() => setGuideOpen(true)} aria-expanded={false}>
            <span>?</span><b>{t(language, "handGuide")}</b>
          </button>}
          <PokerTable game={game} language={language} coach={activeCoach?.current} />
          <Controls game={game} language={language} disabled={busy || game.aiThinking || (game.street !== "complete" && game.actor !== "human")} onAction={act} onNext={nextHand} />
          {game.config.coachMode && <button className="coach-button" onClick={() => setCoachOpen(!coachOpen)} aria-expanded={coachOpen}>◇ {language === "ru" ? "Тренер" : "Coach"}</button>}
          {game.matchOver && <SessionComplete humanWon={game.seats.filter((seat) => seat.kind === "ai").every((seat) => game.players[seat.playerId]?.eliminated)} language={language} onNewSession={leaveSession} />}
        </section>
        {coachOpen && game.config.coachMode ? (activeCoach ? <CoachPanel key={game.handId} report={activeCoach} language={language} onClose={() => setCoachOpen(false)} /> : <aside className="trainer-panel"><button onClick={() => setCoachOpen(false)}>×</button><p>{language === "ru" ? "Готовим разбор…" : "Preparing review…"}</p></aside>) : <SidePanel game={game} language={language} />}
      </div>
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
