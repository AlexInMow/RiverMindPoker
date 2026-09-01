import { z } from "zod";
import type { AIDecision, LegalAction } from "../../shared/types";

const DecisionSchema = z.object({
  action: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  amount: z.number().int().nonnegative(),
  reasoning_summary: z.string().max(240),
  table_talk: z.string().max(120),
});

export function fallbackDecision(legal: LegalAction[]): AIDecision {
  const choice = legal.find((item) => item.type === "check")
    ?? legal.find((item) => item.type === "call")
    ?? legal.find((item) => item.type === "fold")
    ?? legal[0];
  if (!choice) throw new Error("No legal AI action is available");
  return {
    action: choice.type,
    amount: choice.amount ?? choice.min ?? 0,
    reasoning_summary: "Safe local fallback selected from the legal actions.",
    table_talk: "",
  };
}

export function validateAndNormalizeDecision(raw: unknown, legal: LegalAction[]): { decision: AIDecision; validation: string } {
  const parsed = DecisionSchema.safeParse(raw);
  if (!parsed.success) return { decision: fallbackDecision(legal), validation: `Invalid schema; fallback used: ${parsed.error.issues[0]?.message ?? "unknown error"}` };
  const allowed = legal.find((item) => item.type === parsed.data.action);
  if (!allowed) return { decision: fallbackDecision(legal), validation: `Illegal '${parsed.data.action}'; fallback used` };

  let amount = parsed.data.amount;
  if (allowed.type === "bet" || allowed.type === "raise") {
    const original = amount;
    amount = Math.max(allowed.min!, Math.min(allowed.max!, Math.round(amount)));
    return { decision: { ...parsed.data, amount }, validation: original === amount ? "Valid" : `Amount clamped from ${original} to ${amount}` };
  }
  amount = allowed.amount ?? 0;
  return { decision: { ...parsed.data, amount }, validation: "Valid" };
}
