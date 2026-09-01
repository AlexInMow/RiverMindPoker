import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { AIDecision, AITrace, AIVisibleGameState, Difficulty, Language, Strategy } from "../../shared/types";
import { decisionInstructions } from "./prompts";
import { validateAndNormalizeDecision } from "./validation";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["fold", "check", "call", "bet", "raise", "all-in"] },
    amount: { type: "integer", minimum: 0 },
    reasoning_summary: { type: "string", maxLength: 240 },
    table_talk: { type: "string", maxLength: 120 },
  },
  required: ["action", "amount", "reasoning_summary", "table_talk"],
} as const;

export class OpenAIBot {
  private client: OpenAI | null;
  readonly model: string;

  constructor(apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || "gpt-5.4-mini") {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.model = model;
  }

  get connected(): boolean { return this.client !== null; }

  async decide(state: AIVisibleGameState, strategy: Strategy, difficulty: Difficulty, tableTalk: boolean, language: Language): Promise<{ decision: AIDecision; trace: AITrace }> {
    if (!this.client) throw new Error("OpenAI is not configured");
    const instructions = decisionInstructions(strategy, difficulty, tableTalk, language);
    const request: ResponseCreateParamsNonStreaming = {
      model: this.model,
      stream: false,
      store: false,
      instructions,
      input: JSON.stringify(state),
      reasoning: { effort: difficulty === "expert" ? "high" : difficulty === "strong" ? "medium" : "low" },
      text: { format: { type: "json_schema", name: "poker_action", strict: true, schema: RESPONSE_SCHEMA } },
    };
    const started = Date.now();
    const response = await this.client.responses.create(request);
    const latencyMs = Date.now() - started;
    let raw: unknown;
    try { raw = JSON.parse(response.output_text); } catch { raw = response.output_text; }
    const { decision, validation } = validateAndNormalizeDecision(raw, state.legalActions);
    return {
      decision,
      trace: {
        provider: "openai",
        visibleState: state,
        request,
        rawResponse: raw,
        validation,
        latencyMs,
        usage: response.usage ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
      },
    };
  }

  async explain(prompt: string, language: Language): Promise<string> {
    if (!this.client) return language === "ru" ? "OpenAI отключён. Добавьте API-ключ для разбора от AI-тренера." : "OpenAI is offline. Enable an API key for a model-generated coach explanation.";
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      instructions: `You are a poker coach. Give a concise post-hand explanation in 3-5 sentences. Discuss range, pot odds, board texture, sizing, and value/bluff logic when relevant. Do not expose chain-of-thought; provide only a useful summary. Respond in ${language === "ru" ? "Russian" : "English"}.`,
      input: prompt,
    });
    return response.output_text;
  }
}
