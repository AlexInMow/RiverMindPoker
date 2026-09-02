# RiverMind Poker

RiverMind is a local heads-up No-Limit Texas Hold'em app for macOS. A deterministic TypeScript engine is the dealer and arbiter; OpenAI (or the offline DummyBot) is only a player and receives a deliberately restricted `AIVisibleGameState`.

## Card dealing and fairness

The backend poker engine is the only source of truth for cards. For every hand it creates a new standard 52-card deck and shuffles it exactly once with Fisher–Yates. Each swap index comes from Node.js `crypto.randomInt()`, which provides an unbiased cryptographically secure integer without modulo reduction.

Cards are then removed sequentially from the end of the shuffled deck. In heads-up play, the button/small blind receives the first hole card, the big blind receives the second, and this order repeats for the second hole card. The engine burns one card before the flop, one before the turn, and one before the river. Burn cards stay out of the normal player and AI projections. The explicitly enabled local developer mode can still display private engine diagnostics for auditing.

Every public engine mutation verifies that the remaining deck, both players' hole cards, the board, and burn cards contain exactly the original 52 unique cards. It also verifies one shuffle per hand ID, immutable hole cards, and a forward-only draw counter. The React frontend displays server-projected state and cannot create, shuffle, deal, or replace cards.

## MVP features

- Complete heads-up hands from blinds through showdown, including folds, checks, calls, bets, raises, effective all-ins, split pots, button rotation, and future-facing side-pot layers.
- Tested in-house 5–7 card evaluator.
- Eight opponent personalities and three difficulty levels.
- OpenAI Responses API with strict JSON Schema output, server-side validation, amount clamping, and automatic DummyBot fallback.
- Explicit AI information boundary: the request contains the AI cards, board, public stacks/actions, legal actions, recent summaries, and aggregate player profile—never the human hole cards.
- Dark responsive poker table, bet slider and pot-size shortcuts, table talk, coach explanation, hand log, session statistics, chip graph, and developer diagnostics.
- Russian-first interface with an instant `RU / EN` switch on both the lobby and the table; action history, statistics, local-bot speech, and coach output follow the selected language.
- Settings and recent session summaries saved in browser local storage.

## Requirements

- macOS with Node.js 20 or newer
- An OpenAI API key is optional

## Install

```bash
npm ci
cp .env.example .env
```

Copying `.env` is optional when using the built-in local bot. The local `.env` file is ignored by Git and must never be committed.

## Development

Start the Express API and Vite development server together:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` requests to the Express server at `http://localhost:3001`.

## Production build and local server

```bash
npm run build
npm start
```

Open [http://localhost:3001](http://localhost:3001). The Express server serves the built React client from `dist/client`.

The convenience command below builds and starts the production-style app in one step:

```bash
npm run app
```

If `OPENAI_API_KEY` is blank, the header shows **AI API Offline · Local Bot** and the whole game remains playable without API charges.

## Running as a service on macOS

RiverMindPoker can run as a per-user macOS LaunchAgent. The service uses the production build, starts automatically after login, runs independently of Terminal/Codex/ChatGPT, and is restarted by `launchd` after an unexpected exit.

Install or update the service (this also creates a fresh production build):

```bash
npm run service:install
```

Open [http://localhost:3001](http://localhost:3001).

The installer generates a machine-specific file at `~/Library/LaunchAgents/com.rivermind.poker.plist`. Absolute project and Node.js paths are written only to that local file; the repository stores a portable template.

Service commands:

```bash
npm run service:status   # inspect launchd status and PID
npm run service:logs     # show the last 100 stdout/stderr lines
npm run service:start    # load and start an installed service
npm run service:stop     # stop it for the current login session
npm run service:restart  # restart immediately
npm run service:uninstall # stop it and disable automatic startup
```

Logs are stored outside the repository:

```text
~/Library/Logs/RiverMindPoker/server.log
~/Library/Logs/RiverMindPoker/server-error.log
```

After changing application code, run `npm run service:install` again to rebuild and restart the installed service. The existing `npm run dev`, `npm start`, and `npm run app` workflows remain available for development and manual operation.

## Environment variables

Create `.env` from `.env.example` and set only the values needed locally:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4-mini
PORT=3001
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | No | Enables model-generated poker decisions and coach explanations. When empty, the local DummyBot is used. |
| `OPENAI_MODEL` | No | OpenAI model used by the server. Defaults to `gpt-5.4-mini`. |
| `PORT` | No | Express production server port. Defaults to `3001`. |

The browser bundle never reads or receives `OPENAI_API_KEY`. Keep real keys only in the ignored local `.env` file or another server-side secret store.

## Verify and build

```bash
npm test
npm run typecheck
npm run build
```

## Architecture

```text
client/                 React UI, local persistence and API client
  components/           Table, cards, controls, setup and side panels
server/                 Express session API and public-state projection
  ai/                   prompts, OpenAI adapter, DummyBot and validation
shared/                 transport-safe domain types
poker-engine/           deck, rules, action legality and hand evaluator
tests/                  evaluator, game flow and AI-isolation tests
```

The core trust boundary is one-way:

```text
EngineState (private, complete)
  ├─> PublicGameState (human UI; AI cards hidden until showdown)
  └─> AIVisibleGameState (AI request; human cards structurally absent)
```

Developer mode intentionally exposes full internal state in the local UI for fairness auditing, alongside the exact AI-visible state, raw structured response, validation outcome, latency, and token usage. This does not change the smaller object sent to OpenAI.

## Current persistence boundary

The MVP keeps live authoritative tables in server memory and persists settings plus recent completed-hand/stat snapshots in `localStorage`. The module boundaries allow the session repository to be replaced with SQLite when profiles, resumable tables, or multi-table play are added. This app uses virtual chips only and is not a real-money gambling product.

The OpenAI request follows the official Responses API Structured Outputs pattern documented in the [OpenAI API reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create).
