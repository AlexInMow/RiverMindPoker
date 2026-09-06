import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { SessionStore } from "./session";
import { openDatabase } from "./db/database";
import { PokerRepository } from "./db/repository";
import { getDataDirectory, getDatabasePath } from "./db/paths";

const databasePath = getDatabasePath();
const repository = new PokerRepository(openDatabase(databasePath));
const sessions = new SessionStore(repository);

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
  opponentCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
}).refine((value) => value.smallBlind < value.bigBlind, { message: "Small blind must be below big blind" })
  .refine((value) => value.startingStack >= value.bigBlind * 10, { message: "Starting stack must be at least 10 big blinds" });

const ActionSchema = z.object({
  type: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  amount: z.number().int().nonnegative().optional(),
});

const SessionConfigSchema = ConfigSchema.and(z.object({ profileId: z.string().uuid() }));
const ProfileNameSchema = z.string().trim().min(1).max(40);
const ReviewSchema = z.object({ isMarkedForReview: z.boolean(), reviewNote: z.string().trim().max(1_000).default("") });
const FilterSchema = z.object({
  scope: z.enum(["all", "session", "last100", "last500"]).optional(), sessionId: z.string().uuid().optional(),
  tableSize: z.preprocess((value) => value === undefined ? undefined : Number(value), z.union([z.literal(2), z.literal(3), z.literal(4)]).optional()),
  strategy: z.enum(["balanced", "tag", "lag", "nit", "calling-station", "maniac", "tricky", "adaptive"]).optional(),
  showdown: z.enum(["all", "showdown", "no-showdown"]).optional(), result: z.enum(["all", "profitable", "losing", "neutral"]).optional(),
  marked: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional(),
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, aiStatus: sessions.bot.connected ? "connected" : "offline", model: sessions.bot.connected ? sessions.bot.model : null });
});

app.get("/api/info", (_request, response) => response.json({ dataDirectory: getDataDirectory(), databasePath, schemaVersion: 1 }));

app.get("/api/profiles", (_request, response) => response.json(repository.listProfiles()));
app.post("/api/profiles", (request, response, next) => {
  try { response.status(201).json(repository.createProfile(ProfileNameSchema.parse(request.body.displayName))); }
  catch (error) { next(error); }
});
app.patch("/api/profiles/:id", (request, response, next) => {
  try { response.json(repository.renameProfile(request.params.id, ProfileNameSchema.parse(request.body.displayName))); }
  catch (error) { next(error); }
});
app.delete("/api/profiles/:id", (request, response, next) => {
  try { repository.deleteProfile(request.params.id); response.status(204).end(); }
  catch (error) { next(error); }
});
app.get("/api/profiles/:id/stats", (request, response, next) => {
  try { response.json(repository.lifetimeStats(request.params.id, FilterSchema.parse(request.query))); }
  catch (error) { next(error); }
});
app.get("/api/profiles/:id/sessions", (request, response, next) => {
  try { const query = FilterSchema.parse(request.query); response.json(repository.listSessions(request.params.id, query.limit, query.offset)); }
  catch (error) { next(error); }
});
app.get("/api/profiles/:id/hands", (request, response, next) => {
  try { response.json(repository.listHands(request.params.id, FilterSchema.parse(request.query))); }
  catch (error) { next(error); }
});
app.get("/api/hands/:id", (request, response, next) => {
  try { response.json(repository.getHand(request.params.id)); }
  catch (error) { next(error); }
});
app.patch("/api/hands/:id/review", (request, response, next) => {
  try { const review = ReviewSchema.parse(request.body); response.json(repository.updateReview(request.params.id, review.isMarkedForReview, review.reviewNote)); }
  catch (error) { next(error); }
});
app.post("/api/profiles/:id/export", (request, response, next) => {
  try {
    const filters = FilterSchema.parse(request.body ?? {});
    const exported = repository.exportProfile(request.params.id, filters);
    if (request.query.format === "csv") {
      const lines = ["hand_id,completed_at,hand_number,net_chips,total_pot,players,strategy,showdown,tags"];
      for (const hand of exported.hands) lines.push([hand.id, hand.completedAt, hand.handNumber, hand.humanNet, hand.totalPot, hand.opponentCount + 1, hand.strategy, hand.reachedShowdown, hand.tags.join("|")].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
      response.type("text/csv").send(lines.join("\n"));
    } else response.json(exported);
  } catch (error) { next(error); }
});
app.post("/api/backup", async (_request, response, next) => {
  try { response.json({ path: await repository.backup() }); }
  catch (error) { next(error); }
});

app.post("/api/sessions", (request, response, next) => {
  try {
    const { profileId, ...config } = SessionConfigSchema.parse(request.body);
    const session = sessions.create(config, undefined, profileId);
    response.status(201).json(sessions.publicState(session));
  } catch (error) { next(error); }
});

app.post("/api/sessions/:id/end", (request, response, next) => {
  try { sessions.end(sessions.get(request.params.id)); response.status(204).end(); }
  catch (error) { next(error); }
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
  response.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
});

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`RiverMind server listening on http://${displayHost}:${port} (bind ${host})`);
  console.log(sessions.bot.connected ? `OpenAI connected (${sessions.bot.model})` : "OPENAI_API_KEY missing — using local DummyBot");
});
