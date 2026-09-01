import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { sessions } from "./session";

const app = express();
app.use(express.json({ limit: "100kb" }));

const ConfigSchema = z.object({
  language: z.enum(["ru", "en"]),
  startingStack: z.number().int().min(500).max(1_000_000),
  smallBlind: z.number().int().min(1),
  bigBlind: z.number().int().min(2),
  strategy: z.enum(["balanced", "tag", "lag", "nit", "calling-station", "maniac", "tricky", "adaptive"]),
  difficulty: z.enum(["casual", "strong", "expert"]),
  tableTalk: z.boolean(),
  coachMode: z.boolean(),
  debugMode: z.boolean(),
}).refine((value) => value.smallBlind < value.bigBlind, { message: "Small blind must be below big blind" })
  .refine((value) => value.startingStack >= value.bigBlind * 10, { message: "Starting stack must be at least 10 big blinds" });

const ActionSchema = z.object({
  type: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  amount: z.number().int().nonnegative().optional(),
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, aiStatus: sessions.bot.connected ? "connected" : "offline", model: sessions.bot.connected ? sessions.bot.model : null });
});

app.post("/api/sessions", (request, response, next) => {
  try {
    const config = ConfigSchema.parse(request.body);
    const session = sessions.create(config);
    response.status(201).json(sessions.publicState(session));
  } catch (error) { next(error); }
});

app.get("/api/sessions/:id", (request, response, next) => {
  try { response.json(sessions.publicState(sessions.get(request.params.id))); }
  catch (error) { next(error); }
});

app.post("/api/sessions/:id/action", (request, response, next) => {
  try {
    const session = sessions.get(request.params.id);
    const action = ActionSchema.parse(request.body);
    if (session.aiThinking) throw new Error("AI is already thinking");
    sessions.act(session, action);
    response.json(sessions.publicState(session));
  } catch (error) { next(error); }
});

app.post("/api/sessions/:id/next", (request, response, next) => {
  try {
    const session = sessions.get(request.params.id);
    if (session.aiThinking) throw new Error("AI is already thinking");
    sessions.next(session);
    response.json(sessions.publicState(session));
  } catch (error) { next(error); }
});

app.post("/api/sessions/:id/language", (request, response, next) => {
  try {
    const session = sessions.get(request.params.id);
    session.state.config.language = z.enum(["ru", "en"]).parse(request.body.language);
    response.json(sessions.publicState(session));
  } catch (error) { next(error); }
});

app.post("/api/sessions/:id/explain", async (request, response, next) => {
  try { response.json({ explanation: await sessions.explain(sessions.get(request.params.id)) }); }
  catch (error) { next(error); }
});

const clientDist = resolve(process.cwd(), "dist/client");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*splat", (_request, response) => response.sendFile(resolve(clientDist, "index.html")));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : error instanceof Error ? error.message : "Unknown error";
  response.status(message === "Session not found" ? 404 : 400).json({ error: message });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`RiverMind server listening on http://localhost:${port}`);
  console.log(sessions.bot.connected ? `OpenAI connected (${sessions.bot.model})` : "OPENAI_API_KEY missing — using local DummyBot");
});
