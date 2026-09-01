import type { Language, PublicGameState } from "../../shared/types";
import { PlayingCard } from "./Card";
import { actionAnnouncement, resultText, strategyInfo, streetLabel, t } from "../i18n";

export function PokerTable({ game, language }: { game: PublicGameState; language: Language }) {
  const aiCards = game.players.ai.cards;
  const lastAIAction = [...game.actions].reverse().find((action) => action.player === "ai" && ["fold", "check", "call", "bet", "raise", "all-in"].includes(action.action));
  return (
    <div className="table-stage">
      <div className="felt-table">
        <div className="felt-line" />
        <div className="opponent-seat">
          <div className={`avatar ${game.aiThinking ? "thinking" : ""}`}>AI<span className="status-dot" /></div>
          <div className="seat-meta"><div><strong>RIVER AI</strong><span className="tag">{strategyInfo[language][game.config.strategy].name}</span></div><b>{game.players.ai.stack.toLocaleString(language === "ru" ? "ru-RU" : "en-US")} <small>{t(language, "chips")}</small></b></div>
          <div className="hole-cards ai-cards">
            <PlayingCard card={aiCards?.[0]} hidden={!aiCards} small delay={100} />
            <PlayingCard card={aiCards?.[1]} hidden={!aiCards} small delay={180} />
          </div>
          {game.button === "ai" && <span className="dealer ai-dealer">D</span>}
          <span className={`blind-badge ai-blind ${game.button === "ai" ? "small-blind" : "big-blind"}`}>{game.button === "ai" ? t(language, "smallBlindShort") : t(language, "bigBlindShort")} <b>·</b> {game.button === "ai" ? game.config.smallBlind : game.config.bigBlind}</span>
        </div>

        {lastAIAction && !game.aiThinking && <div key={`${game.handNumber}-${game.actions.length}`} className={`ai-action-callout action-${lastAIAction.action}`}>
          <span className="action-chip">◆</span>
          <div><small>RIVER AI</small><strong>{actionAnnouncement(lastAIAction, language)}</strong></div>
        </div>}

        <div className="center-table">
          <div className="pot-label"><span>{t(language, "pot")}</span><strong>{game.pot.toLocaleString(language === "ru" ? "ru-RU" : "en-US")}</strong></div>
          <div className="board-cards">
            {[0, 1, 2, 3, 4].map((index) => game.board[index]
              ? <PlayingCard key={game.board[index]} card={game.board[index]} delay={index * 90} />
              : <div className="card-placeholder" key={index} />)}
          </div>
          <div className="street-pill">{streetLabel(game.street, language)}</div>
        </div>

        {game.tableTalk && <div className="table-talk">“{game.tableTalk}”</div>}
        {game.result && <div className="result-banner"><span>{game.result.winners.includes("human") ? "◆" : "◇"}</span><strong>{resultText(game.result, language)}</strong></div>}

        <div className="hero-seat">
          <div className="hole-cards hero-cards">
            <PlayingCard card={game.players.human.cards?.[0]} delay={0} />
            <PlayingCard card={game.players.human.cards?.[1]} delay={80} />
          </div>
          <div className="hero-info"><div><strong>{t(language, "you")}</strong>{game.actor === "human" && <span className="your-turn">{t(language, "yourTurn")}</span>}</div><b>{game.players.human.stack.toLocaleString(language === "ru" ? "ru-RU" : "en-US")} <small>{t(language, "chips")}</small></b></div>
          {game.button === "human" && <span className="dealer hero-dealer">D</span>}
          <span className={`blind-badge hero-blind ${game.button === "human" ? "small-blind" : "big-blind"}`}>{game.button === "human" ? t(language, "smallBlindShort") : t(language, "bigBlindShort")} <b>·</b> {game.button === "human" ? game.config.smallBlind : game.config.bigBlind}</span>
        </div>
      </div>
      {game.aiThinking && <div className="thinking-overlay"><span /><span /><span /> {t(language, "aiThinking")}</div>}
    </div>
  );
}
