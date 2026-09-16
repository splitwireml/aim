# PRD: `aim` — a terminal client for Google AI Mode

**Status:** Draft v0.1 · **Owner:** tetraxzx9 · **Authors:** Claude, Codex · **Date:** 2026-09-16
**Source:** #discussing-search-agent-development

## 1. Problem

Google AI Mode is a strong conversational search experience, but it lives only inside a Chrome tab. You have to switch into the browser to use it, the conversation is hard to get out cleanly, and it doesn't fit a terminal-centered workflow.

## 2. Product in one line

`aim` is a terminal chat client for Google AI Mode. You type in the terminal, the message goes to AI Mode in your logged-in Chrome, and the reply (with its sources) comes back to the terminal. Google is the agent; `aim` only transports and renders.

## 3. Goals

- G1. Hold a multi-turn AI Mode conversation entirely from the terminal.
- G2. Show answers faithfully: Google's text, unmodified, with citations kept attached to the claims they support.
- G3. Never lose or duplicate a turn silently: failures are visible and recoverable through Chrome.
- G4. Zero per-query cost and no extra LLM, agent loop, daemon or database.

## 4. Non-goals (v0)

- Our own LLM, summarization, or rewriting of answers.
- Autonomous agent behavior, local file/tool access by AI Mode, MCP server.
- A browser-harness / browser-use base (revisit only if the spike hits a connection problem it already solves).
- Headless or high-volume querying, multi-user or hosted service.
- Rich rendering of images, maps, shopping cards (handled by `/open`).
- Local transcripts, search over history, multiple concurrent tabs.

## 5. Target user

A single developer on their own machine, signed into their own Google account, who works in the terminal and wants AI Mode there.

## 6. User experience

```text
$ aim
aim · connected to Chrome (profile: aim) · new conversation
> what's the best way to store lithium batteries long term
[answer text with inline citation markers [1] [2]]
Sources
 [1] Title — https://…
 [2] Title — https://…
> what about in a hot garage
[follow-up answer in the same Google conversation]
> /open
Opened the conversation in Chrome.
> /quit
```

### Commands (v0)

| Command | Behavior |
|---|---|
| *(text)* | Send as the next turn in the current conversation |
| `/new` | Start a new AI Mode conversation |
| `/open` | Bring the current tab to the front in Chrome |
| `/quit` | Exit; leave Chrome and the conversation intact |
| `/resume <name>` | **Provisional**, see R8 |

## 7. Requirements

### Functional

- **R1 Connection.** Attach to an already-running, dedicated Chrome profile via an explicit CDP endpoint (Playwright `connectOverCDP`). If none is reachable, print setup instructions and exit. Launching Chrome and Chrome's inspect-page opt-in flow are separate, later setup paths — not automatic fallbacks.
- **R2 Single flight.** One active AI Mode tab, one message in flight. Input is blocked while a reply is pending.
- **R3 Send.** First turn navigates to `google.com/search?q=<text>&udm=50`; later turns type into the page's follow-up input and submit. If delivery is uncertain, report it and **do not resubmit automatically**.
- **R4 Answer attribution.** Confirm the reply belongs to *this* submission (for example, a new turn element appears after send) before reading it.
- **R5 Completion.** A turn is complete only on an observed UI completion signal, with a quiet interval as supporting evidence. On timeout: show the partial answer marked **incomplete** and suggest `/open`.
- **R6 Extraction.** Convert the answer to terminal markdown. Preserve the inline citation → source mapping as observed in the page. Do not build citations from a flat list of links.
- **R7 Needs attention.** Detect a login page, CAPTCHA or consent screen and show `needs attention — run /open` instead of failing silently or guessing.
- **R8 Resume (provisional).** Store only `session name → conversation URL` locally. Ship `/resume` only if the milestone proves a reopened URL restores a *writable* conversation. If it doesn't: tell the user and point them to AI Mode history in Google. Never replay a transcript into a new chat.

### Non-functional

- **Stack:** Node (LTS), Playwright, built-in `readline`. No UI framework.
- **Latency:** local overhead ≤ 500 ms beyond Google's own response time.
- **Security:** use a dedicated Chrome profile containing only the needed Google account; bind CDP to localhost only. Document that anything with CDP access controls that browser session.
- **Resilience:** isolate page selectors in one module; ship a saved-page fixture test that fails loudly when extraction breaks.
- **Politeness:** human-paced, one query at a time, visible (non-headless) Chrome.

## 8. Milestones

### M0 — Spike (go/no-go)
All four must pass on a real account:
1. One question → answer and sources extracted correctly (citation mapping intact).
2. One follow-up that clearly uses the prior context.
3. Quit `aim`, restart, continue the same conversation (decides R8).
4. A login/CAPTCHA state produces "needs attention", not a hang or silent failure.

### M1 — Usable v0
R1–R7 complete, `/new` `/open` `/quit`, fixture test, README with Chrome setup.

### M2 — Later (only after M1 is in daily use)
Live progressive display (redraw the current answer, not append tokens), nicer rendering, optional local transcripts, `--json` one-shot mode, MCP/tool interface for coding agents.

## 9. Success criteria

- M0 passes all four checks.
- Owner uses `aim` instead of the Chrome tab for a week of normal questions.
- Zero silent failures: every failed turn is visible as incomplete, uncertain send, or needs attention.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Google changes the page structure | Extraction breaks | Selectors in one module, fixture test, `/open` fallback |
| Bot detection / CAPTCHA | Blocked turns | Visible Chrome, single flight, human pace, R7 |
| Google ToS prohibits automated access | Account risk; caps scope | Personal use only; no hosted/shared/high-volume use |
| Conversation URL not resumable | No `/resume` | R8 is provisional; point to Google history |
| CDP exposes the logged-in session | Session hijack by local processes | Dedicated profile, localhost-only endpoint |

## 11. Open questions

1. Does a captured AI Mode URL reopen as a writable conversation? (M0 #3)
2. What reliable UI signal marks an answer as complete? (M0 #1)
3. Who builds the M0 spike?
