# FlowLens

**Observe the journey. Discover the friction.**

FlowLens is a usability-testing workspace. You give it a website, your own persona, a goal and
success criteria. A real TinyFish browser agent attempts the task while you watch it live, and
FlowLens turns what actually happened into an evidence-backed UX report.

FlowLens never generates personas, never fakes browser sessions or screenshots, and never
reports a failed or stopped run as a usability verdict.

---

## Run it (3 steps)

You need [Node.js](https://nodejs.org) 22 or newer.

1. **Add your keys.** In this `flowlens` folder, copy `.env.example` to a new file named
   `.env.local` and paste your TinyFish API key after `TINYFISH_API_KEY=`.
   (If `TINYFISH_API_KEY` is already exported in your terminal profile, FlowLens picks it up
   from there and you can skip this.)
2. **Install** (first time only): `npm install`
3. **Start**: `npm run dev`, then open <http://localhost:3000>

To check the TinyFish connection on its own: `npm run check:tinyfish` (runs one small, real
automation on example.com and prints every event).

### Optional: AI interpretation

Add `ANTHROPIC_API_KEY` to `.env.local` to have Claude interpret the evidence into findings,
hypotheses and persona-specific relevance. Without it, reports are an **evidence summary**:
findings are assembled by fixed rules from what the agent reported, and every report says so.
Either way, the task outcome and checkpoint results come only from observed data; the AI
can't change them.

---

## How a session works

```
Test setup  ──POST /api/sessions──▶  validate + SSRF check ──▶ TinyFish run-sse stream
                                                                      │
Live view   ◀──SSE /api/sessions/:id/events◀── normalized events ◀────┘
   │  (iframe of TinyFish's streaming_url, read-only)
   │  Stop test ──POST /api/sessions/:id/cancel──▶ TinyFish /v1/runs/:id/cancel
   ▼
UX report   ◀── evidence summary (+ optional AI interpretation) ◀── run result + step screenshots
```

| Route | Purpose |
| --- | --- |
| `POST /api/sessions` | Validate inputs, check the URL is public, start a real TinyFish run |
| `GET /api/sessions/:id` | Session state, events, report |
| `GET /api/sessions/:id/events` | Server-Sent Events with replay (`Last-Event-ID`) after disconnects |
| `POST /api/sessions/:id/cancel` | Cancels the TinyFish run |
| `POST /api/sessions/:id/notes` | Designer-authored observations (labelled as human notes) |
| `GET /api/sessions/:id/evidence/:stepId` | Step screenshot proxied from TinyFish (key stays server-side) |
| `GET /api/config` | Which integrations are configured (never the keys) |

**Execution status vs task outcome.** Execution (`CREATED → STARTING → RUNNING → ANALYSING →
COMPLETED`, or `FAILED` / `CANCELLED`) says whether the run worked. Task outcome (`COMPLETED`,
`PARTIAL`, `BLOCKED`, `NOT_COMPLETED`, `INCONCLUSIVE`) is decided separately from your success
criteria. "Execution completed, task blocked" is a valid result.

**Evidence references.** Every finding cites evidence: `E#` timeline events received from
TinyFish, `S#` step screenshots, `C#` agent checkpoint reports, `A#` agent actions, `O#` agent
obstacles, `N#` your notes. CAPTCHAs, logins and unreachable sites are listed as **test
blockers**, not usability findings.

---

## Project structure

```
app/                     pages (setup, live session, report) and API routes
components/test-setup/   Screen 1 — form and review panel
components/live-session/ Screen 2 — browser preview, activity timeline, notes
components/ux-report/    Screen 3 — report sections, finding cards, evidence
lib/tinyfish/            SDK client, agent instruction, output schema, runner, errors
lib/evaluator/           evidence summary (rules) and optional Claude interpretation
lib/session-store/       in-memory sessions, lifecycle transitions, SSE snapshots
lib/security/            URL validation and DNS-based SSRF protection
lib/design/theme.ts      Blade theme (brand colour, Inter)
tests/                   unit tests (Vitest) and end-to-end scripts (Playwright + Chrome)
```

## Design system

Built on **Razorpay Blade** (components, tokens, accessibility), white-labelled with
`createTheme({ brandColor: "#2142B5" })` and Inter for all text. To keep to one component
system, the app uses Blade components and Blade icons throughout, with a few small
styled-components (browser frame, screenshot thumbnails) that read Blade theme tokens, instead
of also adding Tailwind or Lucide.

## Testing

```
npm test                 # 67 unit tests: URL security, validation, schema rules, lifecycle,
                         # outcome logic, evidence-backed findings, error mapping, AI guardrails
npm run typecheck
npm run lint
npm run e2e:validation   # form validation in Chrome (needs `npm run dev`; starts no runs)
npm run e2e:flow -- <config.json> <out-dir>   # full real run in Chrome (uses TinyFish balance)
```

## Things to know

- **Storage is in memory.** Sessions disappear when FlowLens restarts. This is deliberate for
  the local MVP; the session store is the seam for a database later.
- **TinyFish allows 2 runs at once** on this plan. A third gets a clear "TinyFish is busy" error.
- **Each run is capped at 8 minutes** (`AGENT_MAX_DURATION_SECONDS` in `lib/tinyfish/runner.ts`).
- **TinyFish's safety filter** occasionally declines a goal. FlowLens shows TinyFish's reason
  and suggests rephrasing; it isn't treated as a usability problem.
- **Live stream** comes from TinyFish and ends with the run. FlowLens doesn't record it; the
  report uses TinyFish's step screenshots instead. Occasionally TinyFish lists a screenshot it
  can't serve; the report then says "Screenshot not available" rather than substituting one.
- **Device emulation**: runs use a desktop browser. Device preferences in a persona are noted
  as a limitation in the report.
- **Not for production as-is**: add authentication, persistent storage and retention policies
  before deploying anywhere other than your own computer.
