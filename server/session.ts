import { randomUUID } from "node:crypto";
import { applyAction, createGame, currentSidePots, getLegalActions, isAIPlayer, playerIds, playerName, startNextHand, type EngineAction, type EngineState } from "../poker-engine/game";
import type { RandomIndex } from "../poker-engine/cards";
import type {
  AIDecision,
  ActionType,
  AIPlayerId,
  AITrace,
  AIVisibleGameState,
  AdaptiveHandSummary,
  DebugInfo,
  GameConfig,
  HandHistory,
  PlayerId,
  PublicGameState,
} from "../shared/types";
import { dummyDecisionWithTrace } from "./ai/dummyBot";
import { OpenAIBot } from "./ai/openaiBot";
import { validateAndNormalizeDecision } from "./ai/validation";
import { deriveAIContext } from "./ai/context";
import { deriveAdaptivePolicy } from "./ai/adaptivePolicy";
import { calibrateAdaptiveDecision } from "./ai/adaptiveGuard";
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
  aiThinkingPlayer?: AIPlayerId;
  lastTrace?: AITrace;
  lastTraces: Partial<Record<AIPlayerId, AITrace>>;
  tableTalk?: string;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  readonly bot = new OpenAIBot();

  create(config: GameConfig, randomIndex?: RandomIndex): Session {
    const session: Session = {
      id: randomUUID(),
      state: createGame(config, randomIndex),
      tracker: new StatsTracker(config.startingStack, config.bigBlind),
      completedHands: [],
      adaptiveHands: [],
      finalizedHands: new Set(),
      aiThinking: false,
      lastTraces: {},
    };
    this.sessions.set(session.id, session);
    if (session.state.actor && isAIPlayer(session.state.actor)) void this.runAI(session);
    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Session not found");
    return session;
  }

  act(session: Session, action: EngineAction): void {
    const street = session.state.street;
    const facingBet = session.state.currentBet > session.state.players.human.streetBet;
    const actionIndex = session.state.actions.length;
    applyAction(session.state, "human", action);
    this.observeAppliedAction(session, "human", actionIndex, street, facingBet);
    this.finalizeIfNeeded(session);
    if (session.state.actor && isAIPlayer(session.state.actor)) void this.runAI(session);
  }

  next(session: Session): void {
    startNextHand(session.state);
    session.tableTalk = undefined;
    session.lastTrace = undefined;
    session.lastTraces = {};
    if (session.state.actor && isAIPlayer(session.state.actor)) void this.runAI(session);
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
    if (session.aiThinking || !session.state.actor || !isAIPlayer(session.state.actor)) return;
    session.aiThinking = true;
    session.tableTalk = undefined;
    try {
      let consecutiveActions = 0;
      while (session.state.actor && isAIPlayer(session.state.actor) && session.state.street !== "complete") {
        if (consecutiveActions >= 200) throw new Error("AI action loop safety guard reached");
        const aiId = session.state.actor;
        const aiStrategy = session.state.seats.find((seat) => seat.playerId === aiId)?.strategy ?? session.state.config.strategy;
        session.aiThinkingPlayer = aiId;
        const visible = this.aiVisibleState(session, aiId);
        const started = Date.now();
        let decision: AIDecision;
        try {
          if (this.bot.connected) {
            const result = await this.bot.decide(visible, aiStrategy, session.state.config.difficulty, session.state.config.tableTalk, session.state.config.language);
            decision = result.decision;
            session.lastTrace = result.trace;
            session.lastTraces[aiId] = result.trace;
          } else {
            const local = dummyDecisionWithTrace(visible, aiStrategy, session.state.config.tableTalk, session.state.config.language);
            const raw = local.decision;
            const normalized = validateAndNormalizeDecision(raw, visible.legalActions);
            decision = normalized.decision;
            session.lastTrace = {
              provider: "dummy",
              visibleState: visible,
              rawResponse: raw,
              validation: normalized.validation,
              latencyMs: Date.now() - started,
              localDecisionTrace: local.trace,
            };
            session.lastTraces[aiId] = session.lastTrace;
          }
        } catch (error) {
          const local = dummyDecisionWithTrace(visible, aiStrategy, session.state.config.tableTalk, session.state.config.language);
          const raw = local.decision;
          const normalized = validateAndNormalizeDecision(raw, visible.legalActions);
          decision = normalized.decision;
          session.lastTrace = {
            provider: "dummy",
            visibleState: visible,
            rawResponse: raw,
            validation: `OpenAI error; local fallback used: ${error instanceof Error ? error.message : "unknown error"}`,
            latencyMs: Date.now() - started,
            localDecisionTrace: local.trace,
          };
          session.lastTraces[aiId] = session.lastTrace;
        }
        const calibrated = calibrateAdaptiveDecision(decision, visible, aiStrategy);
        decision = calibrated.decision;
        if (calibrated.adjustment && session.lastTrace) {
          session.lastTrace.validation = `${session.lastTrace.validation}; ${calibrated.adjustment}`;
          if (session.lastTrace.localDecisionTrace) {
            session.lastTrace.localDecisionTrace.chosenAction = decision.action;
            session.lastTrace.localDecisionTrace.reasonSummary = `${session.lastTrace.localDecisionTrace.reasonSummary} ${calibrated.adjustment}`;
          }
        }
        session.tableTalk = decision.table_talk || undefined;
        const action: EngineAction = { type: decision.action, amount: decision.amount };
        const street = session.state.street;
        const facingBet = session.state.currentBet > session.state.players[aiId]!.streetBet;
        const actionIndex = session.state.actions.length;
        applyAction(session.state, aiId, action);
        this.observeAppliedAction(session, aiId, actionIndex, street, facingBet);
        this.finalizeIfNeeded(session);
        consecutiveActions += 1;
      }
    } finally {
      session.aiThinking = false;
      session.aiThinkingPlayer = undefined;
      this.finalizeIfNeeded(session);
    }
  }

  private observeAppliedAction(session: Session, player: PlayerId, actionIndex: number, street: EngineState["street"], facingBet: boolean): void {
    const recorded = session.state.actions[actionIndex];
    if (!recorded || recorded.player !== player || !["fold", "check", "call", "bet", "raise", "all-in"].includes(recorded.action)) {
      throw new Error("Engine did not record the applied player action");
    }
    session.tracker.observe({
      player,
      action: recorded.action as ActionType,
      street,
      amount: recorded.effectiveAmount ?? recorded.amount ?? 0,
      isAggressive: recorded.aggressive ?? false,
      facingBet,
    } satisfies ObservedAction);
  }

  aiVisibleState(session: Session, aiId: AIPlayerId = "ai"): AIVisibleGameState {
    const state = session.state;
    const context = deriveAIContext(state, aiId);
    const playerProfile = session.tracker.profile();
    const repeatedPlayerPatterns = findRepeatedPlayerPatterns(session.adaptiveHands);
    return {
      game: "No-Limit Texas Hold'em",
      playerId: aiId,
      playerCount: state.seats.length,
      activePlayers: state.seats.filter((seat) => !state.players[seat.playerId]!.eliminated).length,
      playersLeftInHand: state.seats.filter((seat) => !state.players[seat.playerId]!.eliminated && !state.players[seat.playerId]!.folded).length,
      seats: state.seats.map((seat) => ({ ...seat })),
      positions: { ...state.positions },
      publicPlayers: state.seats.map((seat) => {
        const { cards: _cards, ...publicPlayer } = state.players[seat.playerId]!;
        return { ...publicPlayer, cards: null };
      }),
      handNumber: state.handNumber,
      street: state.street,
      aiHoleCards: [...state.players[aiId]!.cards],
      board: [...state.board],
      pot: state.pot,
      ...context,
      opponentEffectiveStacks: Object.fromEntries(state.seats.filter((seat) => seat.playerId !== aiId && !state.players[seat.playerId]!.eliminated).map((seat) => [seat.playerId, Math.min(state.players[aiId]!.stack + state.players[aiId]!.totalContribution, state.players[seat.playerId]!.stack + state.players[seat.playerId]!.totalContribution)])),
      aiStack: state.players[aiId]!.stack,
      playerStack: state.players.human.stack,
      blinds: { small: state.config.smallBlind, big: state.config.bigBlind },
      position: state.positions[aiId] ?? "",
      button: state.button,
      smallBlindPlayer: state.smallBlindPlayer,
      bigBlindPlayer: state.bigBlindPlayer,
      sidePots: currentSidePots(state),
      currentHandActions: [...state.actions],
      recentHands: session.adaptiveHands,
      repeatedPlayerPatterns,
      counterStrategy: deriveAdaptivePolicy(playerProfile, repeatedPlayerPatterns),
      legalActions: getLegalActions(state, aiId),
      playerProfile,
    };
  }

  publicState(session: Session): PublicGameState {
    const state = session.state;
    const reachedShowdown = Boolean(state.result?.evaluatedHands);
    const stackTotal = playerIds(state).reduce((sum, id) => sum + state.players[id]!.stack, 0);
    const debug: DebugInfo | undefined = state.config.debugMode ? {
      internalState: structuredClone(state),
      seats: state.seats.map((seat) => ({ ...seat })),
      button: state.button,
      smallBlindPlayer: state.smallBlindPlayer,
      bigBlindPlayer: state.bigBlindPlayer,
      actor: state.actor,
      currentBet: state.currentBet,
      minRaise: state.minRaise,
      playerDiagnostics: Object.fromEntries(state.seats.map((seat) => {
        const current = state.players[seat.playerId]!;
        return [seat.playerId, { stack: current.stack, streetBet: current.streetBet, contribution: current.totalContribution, folded: current.folded, allIn: current.allIn, eliminated: current.eliminated, raiseRight: !current.folded && !current.allIn && !current.eliminated && !state.raiseLocked.includes(seat.playerId) }];
      })),
      aiVisibleState: session.lastTrace?.visibleState,
      aiVisibleStates: Object.fromEntries(state.seats.filter((seat) => seat.kind === "ai").map((seat) => [seat.playerId, this.aiVisibleState(session, seat.playerId as AIPlayerId)])),
      sidePots: currentSidePots(state),
      totalChipInvariant: { expected: state.expectedTotalChips, stacks: stackTotal, pot: state.pot, actual: stackTotal + state.pot, valid: stackTotal + state.pot === state.expectedTotalChips },
      lastAITrace: session.lastTrace,
    } : undefined;
    return {
      sessionId: session.id,
      handId: state.handId,
      config: state.config,
      handNumber: state.handNumber,
      button: state.button,
      smallBlindPlayer: state.smallBlindPlayer,
      bigBlindPlayer: state.bigBlindPlayer,
      seats: state.seats.map((seat) => ({ ...seat })),
      positions: { ...state.positions },
      street: state.street,
      board: [...state.board],
      pot: state.pot,
      currentBet: state.currentBet,
      actor: state.actor,
      matchOver: state.matchOver,
      players: Object.fromEntries(playerIds(state).map((id) => [id, {
        ...state.players[id]!,
        cards: id === "human" || reachedShowdown && Boolean(state.result?.evaluatedHands?.[id]) ? [...state.players[id]!.cards] : null,
      }])) as PublicGameState["players"],
      sidePots: currentSidePots(state),
      legalActions: state.actor === "human" ? getLegalActions(state, "human") : [],
      actions: [...state.actions],
      handLog: [...state.handLog],
      completedHands: session.completedHands.slice(0, 30),
      result: state.result,
      stats: session.tracker.stats(state.players.human.stack),
      aiStatus: this.bot.connected ? "connected" : "offline",
      aiThinking: session.aiThinking,
      aiThinkingPlayer: session.aiThinkingPlayer,
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
export { playerName };
