import { randomUUID } from "node:crypto";
import { applyAction, createGame, getLegalActions, startNextHand, type EngineAction, type EngineState } from "../poker-engine/game";
import type {
  AIDecision,
  AITrace,
  AIVisibleGameState,
  AdaptiveHandSummary,
  DebugInfo,
  GameConfig,
  HandHistory,
  PlayerId,
  PublicGameState,
} from "../shared/types";
import { dummyDecision } from "./ai/dummyBot";
import { OpenAIBot } from "./ai/openaiBot";
import { validateAndNormalizeDecision } from "./ai/validation";
import { deriveAIContext } from "./ai/context";
import { buildAdaptiveHandSummary, findRepeatedPlayerPatterns } from "./adaptiveHistory";
import { StatsTracker, type ObservedAction } from "./stats";

export interface Session {
  id: string;
  state: EngineState;
  tracker: StatsTracker;
  completedHands: HandHistory[];
  adaptiveHands: AdaptiveHandSummary[];
  finalizedHands: Set<number>;
  aiThinking: boolean;
  lastTrace?: AITrace;
  tableTalk?: string;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  readonly bot = new OpenAIBot();

  create(config: GameConfig): Session {
    const session: Session = {
      id: randomUUID(),
      state: createGame(config),
      tracker: new StatsTracker(config.startingStack, config.bigBlind),
      completedHands: [],
      adaptiveHands: [],
      finalizedHands: new Set(),
      aiThinking: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Session not found");
    return session;
  }

  act(session: Session, action: EngineAction): void {
    const observed = this.describeAction(session.state, "human", action);
    applyAction(session.state, "human", action);
    session.tracker.observe(observed);
    this.finalizeIfNeeded(session);
    if (session.state.actor === "ai") void this.runAI(session);
  }

  next(session: Session): void {
    startNextHand(session.state);
    session.tableTalk = undefined;
    session.lastTrace = undefined;
    if (session.state.actor === "ai") void this.runAI(session);
  }

  private finalizeIfNeeded(session: Session): void {
    const state = session.state;
    if (!state.result || session.finalizedHands.has(state.handNumber)) return;
    session.finalizedHands.add(state.handNumber);
    session.tracker.finish(state);
    session.adaptiveHands.unshift(buildAdaptiveHandSummary(state));
    session.adaptiveHands = session.adaptiveHands.slice(0, 25);
    session.completedHands.unshift({ handNumber: state.handNumber, lines: [...state.handLog], result: structuredClone(state.result) });
  }

  async runAI(session: Session): Promise<void> {
    if (session.aiThinking || session.state.actor !== "ai") return;
    session.aiThinking = true;
    session.tableTalk = undefined;
    try {
      let consecutiveActions = 0;
      while (session.state.actor === "ai" && session.state.street !== "complete" && consecutiveActions < 4) {
        const visible = this.aiVisibleState(session);
        const started = Date.now();
        let decision: AIDecision;
        try {
          if (this.bot.connected) {
            const result = await this.bot.decide(visible, session.state.config.strategy, session.state.config.difficulty, session.state.config.tableTalk, session.state.config.language);
            decision = result.decision;
            session.lastTrace = result.trace;
          } else {
            const raw = dummyDecision(visible, session.state.config.strategy, session.state.config.tableTalk, session.state.config.language);
            const normalized = validateAndNormalizeDecision(raw, visible.legalActions);
            decision = normalized.decision;
            session.lastTrace = {
              provider: "dummy",
              visibleState: visible,
              rawResponse: raw,
              validation: normalized.validation,
              latencyMs: Date.now() - started,
            };
          }
        } catch (error) {
          const raw = dummyDecision(visible, session.state.config.strategy, session.state.config.tableTalk, session.state.config.language);
          const normalized = validateAndNormalizeDecision(raw, visible.legalActions);
          decision = normalized.decision;
          session.lastTrace = {
            provider: "dummy",
            visibleState: visible,
            rawResponse: raw,
            validation: `OpenAI error; local fallback used: ${error instanceof Error ? error.message : "unknown error"}`,
            latencyMs: Date.now() - started,
          };
        }
        session.tableTalk = decision.table_talk || undefined;
        const action: EngineAction = { type: decision.action, amount: decision.amount };
        const observed = this.describeAction(session.state, "ai", action);
        applyAction(session.state, "ai", action);
        session.tracker.observe(observed);
        this.finalizeIfNeeded(session);
        consecutiveActions += 1;
      }
      if (session.state.actor === "ai" && consecutiveActions >= 4) {
        session.lastTrace = {
          provider: "dummy",
          visibleState: this.aiVisibleState(session),
          validation: "Safety limit reached after four consecutive AI actions",
          latencyMs: 0,
        };
      }
    } finally {
      session.aiThinking = false;
      this.finalizeIfNeeded(session);
    }
  }

  private describeAction(state: EngineState, player: PlayerId, action: EngineAction): ObservedAction {
    const playerState = state.players[player];
    const allInTarget = playerState.streetBet + playerState.stack;
    const isAggressive = action.type === "bet"
      || action.type === "raise"
      || (action.type === "all-in" && allInTarget > state.currentBet);
    const amount = action.type === "all-in" ? allInTarget : action.amount ?? 0;
    const facingBet = state.currentBet > playerState.streetBet;
    return { player, action: action.type, street: state.street, amount, isAggressive, facingBet };
  }

  aiVisibleState(session: Session): AIVisibleGameState {
    const state = session.state;
    const context = deriveAIContext(state);
    return {
      game: "Heads-Up No-Limit Texas Hold'em",
      handNumber: state.handNumber,
      street: state.street,
      aiHoleCards: [...state.players.ai.cards],
      board: [...state.board],
      pot: state.pot,
      ...context,
      aiStack: state.players.ai.stack,
      playerStack: state.players.human.stack,
      blinds: { small: state.config.smallBlind, big: state.config.bigBlind },
      position: state.button === "ai" ? "button/small blind" : "big blind",
      button: state.button,
      currentHandActions: [...state.actions],
      recentHands: session.adaptiveHands,
      repeatedPlayerPatterns: findRepeatedPlayerPatterns(session.adaptiveHands),
      legalActions: getLegalActions(state, "ai"),
      playerProfile: session.tracker.profile(),
    };
  }

  publicState(session: Session): PublicGameState {
    const state = session.state;
    const reachedShowdown = Boolean(state.result?.aiHand);
    const debug: DebugInfo | undefined = state.config.debugMode ? {
      internalState: structuredClone(state),
      aiVisibleState: session.lastTrace?.visibleState,
      lastAITrace: session.lastTrace,
    } : undefined;
    return {
      sessionId: session.id,
      handId: state.handId,
      config: state.config,
      handNumber: state.handNumber,
      button: state.button,
      street: state.street,
      board: [...state.board],
      pot: state.pot,
      currentBet: state.currentBet,
      actor: state.actor,
      matchOver: state.matchOver,
      players: {
        human: { ...state.players.human, cards: [...state.players.human.cards] },
        ai: { ...state.players.ai, cards: reachedShowdown ? [...state.players.ai.cards] : null },
      },
      legalActions: state.actor === "human" ? getLegalActions(state, "human") : [],
      actions: [...state.actions],
      handLog: [...state.handLog],
      completedHands: session.completedHands.slice(0, 30),
      result: state.result,
      stats: session.tracker.stats(state.players.human.stack),
      aiStatus: this.bot.connected ? "connected" : "offline",
      aiThinking: session.aiThinking,
      tableTalk: session.tableTalk,
      debug,
    };
  }

  async explain(session: Session): Promise<string> {
    const hand = session.completedHands[0];
    if (!hand) throw new Error("Complete a hand before requesting an explanation");
    if (!session.state.config.coachMode) throw new Error("Coach mode is disabled");
    if (!this.bot.connected) {
      return session.lastTrace?.rawResponse && typeof session.lastTrace.rawResponse === "object" && "reasoning_summary" in session.lastTrace.rawResponse
        ? String((session.lastTrace.rawResponse as { reasoning_summary: unknown }).reasoning_summary)
        : session.state.config.language === "ru"
          ? "Локальный бот выбрал действие по оценке силы руки и настройкам своего стиля. Добавьте OpenAI API-ключ для более подробного разбора."
          : "The local bot selected an action from estimated hand strength and its configured personality. Add an OpenAI API key for a richer post-hand explanation.";
    }
    return this.bot.explain(JSON.stringify({ handHistory: hand.lines, result: hand.result, aiDecisionSummary: session.lastTrace?.rawResponse }), session.state.config.language);
  }
}

export const sessions = new SessionStore();

export function playerName(id: PlayerId): string { return id === "human" ? "You" : "AI"; }
