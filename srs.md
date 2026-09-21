# SRS: `aim` — a terminal client for Google AI Mode

> **Scope update, 2026-09-21:** The owner accepted the [limited personal tool](README.md) after the restoration investigation. This document retains the broader original requirements; unsupported requirements and the original M0 gate are not claimed as passed.

**Status:** Draft v0.3 (reviewed by Codex) · **Owner:** tetraxzx9 · **Authors:** Claude (author), Codex (reviewer) · **Date:** 2026-09-16
**Companion:** [`prd.md`](prd.md) · **Source:** #discussing-search-agent-development

Keywords **MUST**, **MUST NOT**, **SHOULD**, **MAY** are used as in RFC 2119. Nothing here has been implemented. Statements about Google AI Mode page behavior are assumptions until the M0 spike verifies them.

## 1. Introduction

### 1.1 Purpose
Specify the software requirements for `aim` v0: a terminal chat client that relays a Google AI Mode conversation from a logged-in Chrome to the terminal, with named, resumable sessions.

### 1.2 Scope
In scope: interactive REPL, relay of turns to/from AI Mode, extraction of answers with citations, named sessions that survive CLI and browser restarts, visible failure states.

Out of scope for v0: any LLM or agent orchestration of our own, MCP/tool interface, local transcripts, live streaming display, multiple concurrent sessions or processes, headless or high-volume use, rendering images/maps/shopping cards.

### 1.3 Changes from the PRD
- **Sessions are a release requirement,** not provisional (owner: "sessions are important"). The PRD's R8 is superseded by §3.4. If M0 cannot prove that a Google conversation can be reopened and continued, that is a **product blocker**, recorded as such. Sessions are not silently dropped.
- The CLI offers a minimal set of chat terminal controls in the spirit of Claude Code / pi (§3.1–3.2). It does not aim for feature parity with either.
- **PRD latency target clarified:** the PRD's "≤ 500 ms overhead" applies to extraction and rendering only. It excludes Google's response time and the completion settling interval (NFR-1).

### 1.4 Definitions
- **Turn:** one user message and the AI Mode answer it produces.
- **Session:** a user-named handle for one Google AI Mode conversation, stored as `name → conversation URL`.
- **Conversation URL:** the URL Chrome shows for the conversation *after* Google assigns it (not the initial `udm=50` search URL). It carries the **conversation identity** used to confirm that the intended conversation was restored.
- **Recovery state:** a session state entered after a local wait ended without a confirmed-complete turn. New prompts are rejected until the page is reconciled (FR-3.8).
- **Adapter:** `src/page.js`, the only module that knows about Google's page.

## 2. Overall description

### 2.1 Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| AI agent SDK | **None** | No agent orchestration is needed. Google is the agent; `aim` runs a fixed send → wait → extract sequence. Browser Use, LangGraph, OpenAI Agents SDK, Mastra, Vercel AI SDK and similar solve a problem we don't have. Revisit only if a later milestone adds our own agent loop. If an M2 tool interface is built, `@modelcontextprotocol/sdk` is a protocol library, not an agent SDK. |
| Browser automation | `playwright-core` | Attaches to an existing Chrome over CDP; no bundled browsers. browser-harness reconsidered only if M0 hits a connection problem it already solves. |
| Runtime | Node LTS, ES modules | Built-ins cover REPL (`readline`), files (`fs`), tests (`node:test`). |
| Terminal UI | `readline`, plain markdown text | Adopt a TUI library only if multiline input or redraw demonstrably needs it. |
| Types | None; JSDoc on module contracts | No build step. |
| Storage | One JSON file | No database. |

### 2.2 Structure

```text
aim/
  package.json          dependencies: playwright-core
  bin/aim.js            REPL, commands, session index, lock, printing
  src/page.js           Google adapter: connect, open, send, waitForTurn, extract, detectAttention
  test/page.test.js     node:test + Playwright setContent against fixtures
  test/fixtures/*.html  sanitized, post-hydration answer subtrees
```

`sessions.js` MAY be extracted from `bin/aim.js` only if session persistence crowds the REPL. No other modules in v0.

### 2.3 Adapter contract (`src/page.js`)

```js
/** @returns {Promise<{browser, context}>} attaches via AIM_CDP_URL; throws ConnectError */
connect()
/** Opens url, or a fresh AI Mode page when url is absent. @returns {Promise<Page>} */
openConversation(context, url?)
/** Confirms the page shows the conversation identified by expectedUrl AND accepts follow-ups.
 *  @returns {Promise<'writable'|'wrong_conversation'|'not_writable'|'attention'>} */
checkWritable(page, expectedUrl)
/** After an unconfirmed turn: inspects the page and reports whether generation has stopped.
 *  @returns {Promise<'idle'|'generating'|'attention'>} */
reconcile(page)
/** Submits text. @returns {Promise<{turnId, delivered: 'yes'|'uncertain'}>} */
send(page, text)
/** @returns {Promise<{status: 'complete'|'incomplete'|'attention', answer?}>} */
waitForTurn(page, turnId, {timeoutMs})
/** @returns {{markdown: string, citations: {marker, title, url}[]}} runs in page */
extract(answerRoot)
/** Conversation URL currently shown by the tab, or null if not yet assigned. */
conversationUrl(page)
/** True only for supported Google HTTPS AI Mode conversation URLs. */
isConversationUrl(url)
```

All selectors and Google-specific heuristics live in this module.

### 2.4 Operating environment
- macOS or Linux, Node LTS.
- A **dedicated** Chrome profile, signed into one Google account, already running with a CDP endpoint on localhost.
- Endpoint from `AIM_CDP_URL`, default `http://127.0.0.1:9222`.

### 2.5 Assumptions to verify in M0
- A1. AI Mode conversations have a stable URL that, reopened later (including after a Chrome restart), shows a writable conversation with prior context. **Blocking.**
- A2. A page signal exists that marks an answer as complete.
- A3. A new turn can be identified as belonging to a specific submission.
- A4. Citation markers in the answer can be mapped to their source links from the rendered DOM.
- A5. The timing of conversation-URL availability is unverified; it may be observable only after the answer completes. Persistence behavior for either timing is defined by FR-4.2–FR-4.3.
- A6. The page exposes a state that distinguishes "still generating" from "idle".

## 3. Functional requirements

### 3.1 CLI invocation

| Invocation | Behavior |
|---|---|
| `aim` | Start a new session with a generated name (`YYYYMMDD-HHMM`, suffixed `-2`, `-3` if taken) |
| `aim --name <name>` | Start a new session with that name; error if it exists |
| `aim -c` | Resume the most recently used session |
| `aim -r <name>` | Resume the named session; error if unknown |
| `aim --help` | Usage |

- FR-1.1 Argument parsing MUST use `node:util` `parseArgs`. No CLI framework.
- FR-1.2 The startup line MUST show the session name, whether it is new or resumed, and the CDP endpoint.

### 3.2 REPL commands

| Command | Behavior |
|---|---|
| *(text)* | Send as the next turn of the current session |
| `/new [name]` | Start a new session; error on a duplicate name |
| `/sessions` | List sessions: name, last used, current marker |
| `/resume <name>` | Switch to a session; error on an unknown name |
| `/open` | Bring the current tab to the front in Chrome |
| `/quit` (or Ctrl-D) | Exit; leave Chrome and the conversation intact |
| `/help` | List commands |

- FR-2.1 Unknown `/commands` MUST print an error and MUST NOT be sent to Google.
- FR-2.2 Session names MUST match `^[a-z0-9][a-z0-9._-]{0,63}$`.

### 3.3 Turn relay
- FR-3.1 **Single flight.** Exactly one tab and one pending turn per process.
- FR-3.2 **First turn** of a new session navigates to `https://www.google.com/search?q=<urlencoded text>&udm=50`.
- FR-3.3 **Follow-up turns** MUST first pass `checkWritable(page, storedUrl)` with result `writable`; then type into the page's follow-up input and submit.
- FR-3.4 **Attribution.** An answer is accepted only if it belongs to the `turnId` returned by `send` (A3).
- FR-3.5 **Completion.** `complete` requires the observed completion signal (A2); a quiet interval (default 1500 ms of unchanged answer) is supporting evidence only.
- FR-3.6 **Timeout** (default 120 s, `AIM_TURN_TIMEOUT_MS`): print any partial answer marked `[incomplete — run /open]`.
- FR-3.7 **Uncertain delivery.** If `send` returns `uncertain`, print `[delivery uncertain — check with /open]`. The CLI MUST NOT resend automatically.
- FR-3.8 **Pending and recovery.**
  - While a turn is pending, `/open`, `/quit` and `/help` MUST work. Any other input MUST be rejected with `[waiting for answer]` and MUST NOT be queued or submitted later.
  - Ctrl-C stops *local waiting only*; it does not cancel Google's generation. Ctrl-C, timeout (FR-3.6) and uncertain delivery (FR-3.7) MUST put the session into the **recovery state**.
  - In the recovery state, before accepting any new prompt, the CLI MUST call `reconcile(page)`. Only `idle` returns the session to normal; `generating` prints `[Google is still answering — wait or /open]` and rejects the prompt; `attention` follows FR-3.9. When `idle`, the CLI SHOULD re-extract and print the latest answer if it differs from what was shown.
- FR-3.9 **Attention states.** Login page, CAPTCHA, consent or unusual-traffic interstitial MUST produce `[needs attention — run /open]` and put the session into the recovery state.
- FR-3.10 **Terminal safety.** All page-derived text (answer, titles, URLs) MUST have terminal control sequences (C0/C1 controls except `\n` and `\t`, and ANSI escape sequences) stripped before printing.

### 3.4 Sessions (release requirement)
- FR-4.1 The session index is stored at `$XDG_CONFIG_HOME/aim/sessions.json` (default `~/.config/aim/sessions.json`):
  ```json
  { "version": 1, "last": "battery-research",
    "sessions": { "battery-research": { "url": "https://…", "createdAt": "…", "lastUsedAt": "…" } } }
  ```
- FR-4.2 **Save early.** As soon as `conversationUrl(page)` returns a URL that passes `isConversationUrl`, the CLI MUST persist it, without waiting for the answer to complete. This applies on every path: complete, incomplete, attention, Ctrl-C and `/quit` (A5). The initial `udm=50` search URL MUST NOT be stored.
- FR-4.3 **Not saved yet.** If no conversation URL has been observed, the session is not persisted, and `/quit`, `/new` and `/resume` MUST warn `[this conversation is not saved yet]` before leaving it.
- FR-4.4 **No erasure.** An incomplete, uncertain or attention outcome MUST NOT remove or blank an existing session entry. The stored URL is replaced only by another valid conversation URL for the same session.
- FR-4.5 **Resume.** `-c`, `-r` and `/resume` MUST open the stored URL, then run `checkWritable(page, storedUrl)`:
  - `writable`: the intended conversation was restored and accepts follow-ups. Continue.
  - `wrong_conversation` (for example, a redirect to a fresh chat) or `not_writable`: print `[session cannot be continued in Google — see AI Mode history, /open]`. The CLI MUST NOT start a fresh chat under the same name and MUST NOT replay text into a new chat.
  - `attention`: as FR-3.9.
- FR-4.6 **Recency.** `last` and the session's `lastUsedAt` MUST be updated on a successful resume and whenever a turn is accepted by Google, so `-c` resumes the most recently active session.
- FR-4.7 Sessions MUST survive CLI restart and Chrome restart (A1).
- FR-4.8 **Atomic writes.** Write to a temp file in the same directory, then `rename`.
- FR-4.9 **Corrupt index.** The index is corrupt if it is malformed JSON *or* valid JSON with an invalid shape: unsupported `version`; `sessions` not an object; a name failing FR-2.2; `url` not a string passing `isConversationUrl`; `createdAt`/`lastUsedAt` not ISO strings; `last` not null and not an existing name. A corrupt index MUST produce an error naming the file and the first problem, and exit with code 3. The CLI MUST NOT reset or overwrite it.
- FR-4.10 **Single instance.** On start, create the lock with `fs.openSync(lockPath, 'wx')` and write the PID. If the lock already exists, exit with code 4 and print: the PID recorded in it, how to check whether that process is still running, and the path to delete once it is confirmed gone. v0 performs **no automatic stale-lock takeover**. The lock is held for the whole life of the process and removed only when the process exits (`/quit`, Ctrl-D, SIGTERM, or a fatal error). Ctrl-C during a turn enters the recovery state (FR-3.8) and does not exit, so it MUST NOT release the lock.

### 3.5 Output and extraction
- FR-5.1 `extract` MUST preserve paragraphs, headings, ordered and unordered lists, code blocks, inline code and links as markdown. Flattening with `textContent` is not acceptable.
- FR-5.2 Citations MUST keep their observed position in the text as `[n]`, followed by a `Sources` list `[n] Title — URL`. Citations MUST NOT be built from an unordered list of links.
- FR-5.3 Output is plain markdown text; no styling framework. Answers are never rewritten or summarized.
- FR-5.4 Extraction is implemented as a small DOM walker inside `page.evaluate`. Replacing it with `turndown` is permitted if fixtures show the walker cannot convert the answer structure correctly without becoming complex.
- FR-5.5 Output MUST pass FR-3.10 sanitization before printing.

### 3.6 Connection
- FR-6.1 On start, attach via `AIM_CDP_URL`. If unreachable, print setup instructions (dedicated profile, how to start Chrome with a localhost debugging port) and exit non-zero.
- FR-6.2 v0 MUST NOT launch or close Chrome. `/quit` detaches only.
- FR-6.3 **Tab closed or browser disconnected** during a session MUST produce a visible error (`[Chrome tab closed / browser disconnected — /quit, then aim -r <name>]`) and put the session into the recovery state. Session metadata MUST be preserved. The CLI MUST NOT open a replacement chat or resend the pending message. Recovery is quit, restart and resume; v0 has no automatic reconnect.

## 4. Non-functional requirements
- NFR-1 **Processing time:** extraction plus rendering ≤ 500 ms per turn. This excludes Google's response time and the completion settling interval (FR-3.5), which are measured separately.
- NFR-2 **Dependencies:** one runtime dependency (`playwright-core`); `turndown` permitted per FR-5.4. Any other addition needs a written reason.
- NFR-3 **Security:** CDP endpoint MUST be localhost. README MUST state that any local process with CDP access controls the signed-in session, and MUST recommend a dedicated profile containing only the needed account.
- NFR-4 **Pacing:** visible Chrome, one query at a time, no retries or background querying.
- NFR-5 **Terms (unresolved):** whether automated access to AI Mode through a personal browser is compatible with Google's terms has not been verified. It is an open launch-review item (§7). Until reviewed, the README MUST describe `aim` as a personal tool and MUST NOT encourage shared, hosted or high-volume use.
- NFR-6 **Exit codes:** 0 normal, 1 user error, 2 connection failure, 3 corrupt session index, 4 lock held.
- NFR-7 **Maintainability:** all Google selectors in `src/page.js`; no other module references Google DOM.

## 5. Verification

### 5.1 Automated (`node --test`)
- T-1 **Extraction fixtures:** sanitized, post-hydration answer subtrees (captured from the live DOM, not View Source) loaded into a disposable Playwright page via `setContent`, using installed Chrome with a separate test profile — never the live AI Mode tab. Assert markdown structure and citation mapping (FR-5.1, FR-5.2).
- T-2 **Attention fixtures:** login, CAPTCHA and consent snapshots return `attention` (FR-3.9).
- T-3 **Session index:** atomic write; malformed and invalid-shape files refused and left unchanged; duplicate/unknown names; name pattern; non-conversation URLs rejected; incomplete outcome does not erase an entry; `last`/`lastUsedAt` updated on resume and accepted turn (FR-2.2, FR-4.2–4.4, FR-4.6, FR-4.8, FR-4.9).
- T-4 **Lock:** second instance refused with exit code 4 and recovery instructions; lock retained after Ctrl-C during a turn; lock removed only on process exit (FR-4.10).
- T-5 **Recovery state:** with a stubbed adapter whose `reconcile` returns `generating` then `idle`, a prompt entered after Ctrl-C/timeout is rejected, not queued, and accepted only after `idle` (FR-3.8).
- T-6 **Terminal safety:** page text containing ANSI/OSC sequences and C0/C1 controls prints without them (FR-3.10).
- T-7 **Resume identity:** `checkWritable` returns `wrong_conversation` for a fresh-chat fixture when a different conversation URL is expected (FR-4.5).
- T-8 **Disconnect:** with a stubbed adapter that emits tab-closed / browser-disconnected during a pending turn, the CLI shows the error, enters recovery, keeps the session entry, and neither resends nor opens a new chat (FR-6.3).

Fixtures protect known cases only; they cannot detect a future Google change. That needs the live check in 5.2.

### 5.2 Live check (M0 spike, manual, real account)
1. New session: one question → complete answer with correct citation mapping (A2, A3, A4).
2. Follow-up that clearly depends on prior context.
3. `/quit` *while the answer is still generating*: when a valid conversation URL is available, verify it was saved immediately; when none is available, verify the unsaved warning was shown, no invalid URL entry was written, and any pre-existing entry was preserved (A5, FR-4.2–FR-4.4).
4. `/quit`, restart `aim -c`, continue the conversation (FR-4.5, FR-4.7, A1).
5. Restart Chrome, `aim -r <name>`, continue (A1).
6. Ctrl-C during generation, try a new prompt (rejected), wait, prompt accepted after Google finishes (A6, FR-3.8).
7. Use a login-required state (for example, signed out in the dedicated profile) → `needs attention`, no hang. Do not deliberately provoke a CAPTCHA.

**Exit criteria:** all seven pass. If 3, 4 or 5 fails, record a **product blocker** on sessions and stop before M1.

## 6. Traceability

| PRD goal | Requirements |
|---|---|
| G1 terminal conversation | FR-1, FR-2, FR-3, FR-4 |
| G2 faithful answers | FR-5 |
| G3 no silent loss or duplication | FR-3.4–3.10, FR-4.2–4.10, FR-6.3 |
| G4 no extra LLM, daemon or database | §2.1, NFR-2 |

## 7. Open items
1. A1–A6 are unverified; M0 decides them. A1 or A5 failing is a product blocker.
2. Launch review: compatibility with Google's terms (NFR-5).
3. Who builds M0.

## 8. Sources
- Playwright `BrowserType.connectOverCDP`: https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- Playwright `Page.setContent`: https://playwright.dev/docs/api/class-page#page-set-content
- Node.js test runner: https://nodejs.org/api/test.html
- Node.js `util.parseArgs`: https://nodejs.org/api/util.html#utilparseargsconfig
- Node.js `readline`: https://nodejs.org/api/readline.html
- Chrome remote debugging changes (Chrome 136): https://developer.chrome.com/blog/remote-debugging-port
- Google Search Help, AI Mode: https://support.google.com/websearch/answer/16011537
- Google AI features and query fan-out: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Owner clarification, event `36e9f17f40738976de78a35334d4df50f5170ea6d38be2ca0220935392f65c81` (2026-09-16): removed the A5 before-completion URL assumption and branched live check 3 on valid URL availability.
