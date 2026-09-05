import type { Language, PlayerId, PublicGameState, Seat } from "../../shared/types";
import { PlayingCard } from "./Card";
import { actionAnnouncement, playerDisplayName, resultText, strategyInfo, streetLabel, t } from "../i18n";

const locale = (language: Language) => language === "ru" ? "ru-RU" : "en-US";

function Marker({ game, playerId, language }: { game: PublicGameState; playerId: PlayerId; language: Language }) {
  const blind = playerId === game.smallBlindPlayer
    ? { label: t(language, "smallBlindShort"), amount: game.config.smallBlind, className: "small-blind" }
    : playerId === game.bigBlindPlayer
      ? { label: t(language, "bigBlindShort"), amount: game.config.bigBlind, className: "big-blind" }
      : undefined;
  return <>
    {game.button === playerId && <span className="dealer seat-dealer">D</span>}
    {blind && <span className={`blind-badge seat-blind ${blind.className}`}>{blind.label} <b>·</b> {blind.amount}</span>}
  </>;
}

function OpponentSeat({ game, seat, slot, language }: { game: PublicGameState; seat: Seat; slot: number; language: Language }) {
  const player = game.players[seat.playerId]!;
  const thinking = game.aiThinkingPlayer === seat.playerId;
  const stateLabel = player.eliminated ? (language === "ru" ? "ВЫБЫЛ" : "OUT") : player.folded ? (language === "ru" ? "ПАС" : "FOLDED") : player.allIn ? (language === "ru" ? "ОЛЛ-ИН" : "ALL-IN") : undefined;
  return <div className={`opponent-seat opponent-slot-${slot} ${game.actor === seat.playerId ? "active-seat" : ""} ${player.folded || player.eliminated ? "inactive-seat" : ""}`}>
    <div className={`avatar ${thinking ? "thinking" : ""}`}>AI {slot}<span className="status-dot" /></div>
    <div className="seat-meta">
      <div><strong>{playerDisplayName(seat.playerId, language)}</strong><span className="tag">{stateLabel ?? game.positions[seat.playerId] ?? strategyInfo[language][seat.strategy ?? game.config.strategy].name}</span></div>
      <b>{player.stack.toLocaleString(locale(language))} <small>{t(language, "chips")}</small></b>
      {player.streetBet > 0 && <span className="seat-bet">{language === "ru" ? "СТАВКА" : "BET"} {player.streetBet.toLocaleString(locale(language))}</span>}
    </div>
    {!player.eliminated && <div className="hole-cards ai-cards">
      <PlayingCard card={player.cards?.[0]} hidden={!player.cards} small delay={100 + slot * 30} />
      <PlayingCard card={player.cards?.[1]} hidden={!player.cards} small delay={180 + slot * 30} />
    </div>}
    <Marker game={game} playerId={seat.playerId} language={language} />
  </div>;
}

export function PokerTable({ game, language }: { game: PublicGameState; language: Language }) {
  const displayPot = game.result?.pot ?? game.pot;
  const displayedPots = game.result?.pots ?? game.sidePots;
  const opponents = game.seats.filter((seat) => seat.kind === "ai");
  const lastAIAction = [...game.actions].reverse().find((action) => action.player !== "human" && ["fold", "check", "call", "bet", "raise", "all-in"].includes(action.action));
  const human = game.players.human;
  return (
    <div className={`table-stage player-count-${game.seats.length}`}>
      <div className="felt-table">
        <div className="felt-line" />
        {opponents.map((seat, index) => <OpponentSeat key={seat.playerId} game={game} seat={seat} slot={index + 1} language={language} />)}
        {lastAIAction && !game.aiThinking && <div key={`${game.handNumber}-${game.actions.length}`} className={`ai-action-callout action-${lastAIAction.action}`}>
          <span className="action-chip">◆</span><div><small>{playerDisplayName(lastAIAction.player, language)}</small><strong>{actionAnnouncement(lastAIAction, language)}</strong></div>
        </div>}
        <div className="center-table">
          <div className="pot-label"><span>{t(language, "pot")}</span><strong>{displayPot.toLocaleString(locale(language))}</strong></div>
          {displayedPots.length > 1 && <div className="side-pot-labels">{displayedPots.map((pot, index) => <span key={index}>{language === "ru" ? (index === 0 ? "ОСНОВНОЙ" : `ПОБОЧНЫЙ ${index}`) : (index === 0 ? "MAIN" : `SIDE ${index}`)} <b>{pot.amount.toLocaleString(locale(language))}</b></span>)}</div>}
          <div className="board-cards">{[0, 1, 2, 3, 4].map((index) => game.board[index] ? <PlayingCard key={game.board[index]} card={game.board[index]} delay={index * 90} /> : <div className="card-placeholder" key={index} />)}</div>
          <div className="street-pill">{streetLabel(game.street, language)}</div>
        </div>
        {game.tableTalk && <div className="table-talk">“{game.tableTalk}”</div>}
        {game.result && <div className="result-banner"><span>{game.result.winners.includes("human") ? "◆" : "◇"}</span><strong>{resultText(game.result, language)}</strong></div>}
        <div className={`hero-seat ${game.actor === "human" ? "active-seat" : ""} ${human.eliminated ? "inactive-seat" : ""}`}>
          <div className="hole-cards hero-cards"><PlayingCard card={human.cards?.[0]} delay={0} /><PlayingCard card={human.cards?.[1]} delay={80} /></div>
          <div className="hero-info"><div><strong>{t(language, "you")}</strong><span className="tag">{human.eliminated ? (language === "ru" ? "ВЫБЫЛ" : "OUT") : human.folded ? (language === "ru" ? "ПАС" : "FOLDED") : game.actor === "human" ? t(language, "yourTurn") : game.positions.human}</span></div><b>{human.stack.toLocaleString(locale(language))} <small>{t(language, "chips")}</small></b>{human.streetBet > 0 && <span className="seat-bet">{language === "ru" ? "СТАВКА" : "BET"} {human.streetBet.toLocaleString(locale(language))}</span>}</div>
          <Marker game={game} playerId="human" language={language} />
        </div>
      </div>
      {game.aiThinking && <div className="thinking-overlay"><span /><span /><span /> {playerDisplayName(game.aiThinkingPlayer ?? "ai", language)} {language === "ru" ? "думает" : "is thinking"}</div>}
    </div>
  );
}
