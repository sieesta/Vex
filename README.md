# Vex — Affective Conversational Voice Agent

> **Canonical single-key deliverable:** the app built to the requested spec lives in
> [`vex-app/`](vex-app/README.md) and runs with `npm run vex:dev` at
> <http://localhost:5200>. If the static production preview is already using :5200, run
> `npm run vex:dev -- --port 5202` instead. The material below describes an earlier
> experimental key-pool variant that shares the repository but not the active entry point.

An Intelligent Systems course project: a fast, human-feeling voice conversation with a
stateful emotion engine, live telemetry, and a multi-account Groq key pool with automatic
failover. Everything runs in the browser — no backend, no database, no credit card.

## Stack

React 19 + Vite 8 + Tailwind CSS 4 (`@tailwindcss/vite`) + `lucide-react`.

## Run it

```bash
npm install
npm run dev     # open the printed localhost URL
npm run build   # production bundle in dist/
npm run preview # preview the production bundle
```

Chrome or Edge gives the best experience (Web Speech API). Other browsers work in
text-only mode via the bottom input bar.

## Architecture

- `src/hooks/useBanterAgent.js` — the whole engine: FSM (`IDLE → LISTENING → THINKING →
  SPEAKING → …`), barge-in, cumulative frustration/emotion model, Web Audio visualizer,
  barge-in, speech recognition, and the **key-rotation manager**.
- `src/lib/keyPool.js` — key parsing, validation, status metadata and masking helpers.
- `src/lib/persona.js` — system prompt, strict JSON parsing and offline banter.
- `src/lib/speech.js` — Orpheus 195-char safety guard + `speechSynthesis` fallback.
- `src/lib/audioMeter.js` — `AudioContext` + `AnalyserNode` (`fftSize = 64`).
- `src/components/` — header, orb, telemetry HUD, controls, subtitles, key pool modal.

## Free API setup

Create one or more free keys at <https://console.groq.com/keys>, then put them in a
local `.env` file:

```env
VITE_GROQ_API_KEYS=gsk_first_key,gsk_second_key
```

Use `.env.example` as the template. The app reads these values when Vite starts. It uses
Gemini 2.5 Flash TTS is the primary multilingual voice engine when `VITE_GEMINI_API_KEY` is
configured; Groq is used only as a text fallback if Gemini is unavailable. Gemini accepts
comma- or whitespace-separated keys in that variable and rotates through them when a Live
connection fails. Rotate
through active keys on rate limits, and keeps transient cooldown state in memory.
Restart the dev server after changing `.env`. Never commit `.env` or publish these keys.

- **Brain:** `openai/gpt-oss-120b` for English and `qwen/qwen3.8-27b` for Taglish,
  Tagalog, Japanese, Korean and Spanish, using JSON-first prompts with plain-text fallback.
- **Voice:** Free Gemini TTS is the primary voice engine for every configured language. Filipino
  speech uses a bright, youthful teen-like delivery with varied giggles, teasing pauses,
  playful sighs and short conversational timing; Gemini voice instructions remove bracketed
  performance tags from the spoken line. Browser speech is only a fallback. English Orpheus
  remains available when Gemini is not configured. Inputs are hard-truncated to 195 characters
  for Orpheus.
- **Ears:** `SpeechRecognition` with interim results for live captions.
- **Language modes:** Taglish (PH), Pure Tagalog, English (Orpheus), Japanese, Korean and
  Spanish are persisted locally. Angelo and Blessica are selected for Filipino speech;
  Austin and Hannah are available for English Orpheus speech. If a requested Microsoft
  Online voice is not installed, the browser chooses the best matching system voice.

## Multi-account failover

Each configured key is `{ id, label, key, status, cooldownUntil, requestsUsed }` and is
kept in memory for the current session. A single `fetchWithKeyRotation()` wrapper handles every
Groq request:

- uses the current active key, round-robinned across accounts;
- **429** → `retry-after > 120s` or a daily/RPD/quota message marks the key
  `exhausted`; otherwise it gets a `cooldown` timer. Vex immediately retries the exact
  same request with the next usable key;
- **401/403** → key becomes `invalid` and is skipped;
- expired cooldowns revive automatically; an error is only surfaced when no key can
  serve the turn.

The **Key Pool** modal shows live status badges with countdowns and request counters,
plus a *Reset Key Statuses* button. Keys are managed only through `.env`.

## Privacy

Voice, spice mode, frustration and the last 16 messages stay in `localStorage` on your
device. Requests go straight from your browser to `api.groq.com`; because this is a
Vite client app, `VITE_*` values are included in the browser bundle. Use a server-side
proxy for production secrets.
