# Tasks: `aim` v0

**Status:** Planned; no implementation or QA has run.  
**Owner:** tetraxzx9 · **Author:** Codex · **Reviewer:** Claude · **Date:** 2026-09-16  
**Requirements:** [srs.md](srs.md), with its explicit changes to [prd.md](prd.md).

Build a terminal relay to Google AI Mode with named, resumable sessions. Use Node, `playwright-core`, and built-ins. No agent SDK, daemon, database, or new agent loop.

## Complexity and sequence

**S** = bounded, known work. **M** = several state/error paths. **L** = browser behavior to discover and prove. These are complexity labels, not time estimates. All tasks below are pending; implementation owners are unassigned.

| ID | Task and deliverable | Size | Depends on | Parallelism | Done when |
|---|---|---|---|---|---|
| T1 | Establish the M0 browser connection and turn probe. Minimal package/entry point; attach to dedicated Chrome; send one question and contextual follow-up; inspect actual answer, citation, and completion signals. | L | — | First, one owner | Evidence records Chrome/Node versions, the inspected state, answer attribution, extraction, and observed completion/idle signals. No guessed selectors presented as verified. |
| T2 | Prove session restoration and interrupted-turn recovery. Capture real conversation identity; restart the CLI, then Chrome; continue the intended conversation. Observe when its URL becomes available and what timeout/Ctrl-C leave behind. | L | T1 | Serial with T1; same browser owner | All M0 live checks in the SRS pass with evidence. Wrong-thread redirects fail visibly; local cancellation is not treated as remote cancellation. |
| T3 | Finish `src/page.js`: submission, extraction, conversation validation, attention detection, bounded waiting, and recovery checks. Add the small sanitized HTML fixture tests using the same extractor in an isolated browser. | L | T2 passes | Lane A; parallel with T4 | SRS turn/extraction contracts pass; uncertain sends never retry; fixture checks preserve structure and citation positions. Browser and Google DOM knowledge stays in this module. |
| T4 | Implement the session index and process lock in `bin/aim.js`, extracting `sessions.js` only if it improves readability. Validate names/schema/URLs; replace the index safely; preserve old state on failure; update last-used selection. | M | T2 passes | Lane B; parallel with T3 | New/list/resume records survive restart; duplicate, unknown and corrupt state errors are explicit; existing locks are refused with safe manual recovery instructions. Verified URLs are saved before answer completion when available. |
| T5 | Complete CLI integration: flags, prompt, commands, markdown output, and pending/recovery behavior. Keep `/open`, `/quit` and `/help` usable; reject ordinary prompts while pending/recovering. | M | T3, T4 | Serial integration; Lane B owns `bin/aim.js` | Full command flow and exit codes match SRS NFR-6; no queued prompts, silent fresh chats, duplicate sends, or accidental Chrome shutdown. Page-derived terminal control sequences are removed. |
| T6 | Write minimal setup and recovery documentation. Cover dedicated Chrome, loopback CDP, supported runtime/platforms, commands, lock/index recovery, and known limitations. | S | Draft after T2; final check after T5 | Draft in parallel with T3–T5; separate README owner | Commands match the implementation after T5; documents explain unsaved sessions and incomplete turns. Current service-terms review is recorded without unsupported legal claims. |
| T7 | Run the complete automated suite and integrated live QA below; fix failures and recheck affected flows. Record commit, versions, results, and limitations. | M | T3–T6 | One live browser operator; independent read-only review can run alongside | All release checks pass on the same final revision; evidence distinguishes automated tests from live verification. |
| T8 | Owner walkthrough and handoff. Demonstrate named sessions, a contextual follow-up, both restart paths, and recovery. | S | T7 passes | Serial | Owner can follow setup and use the core workflow; unresolved release failures are reported, not relabeled as optional. |

**M0 gate:** T1–T2 answer whether this product can work. If same-conversation restoration, trustworthy extraction/attribution, or safe completion/recovery cannot be established, stop M1 and record the blocker. A transcript or new chat does not satisfy session continuation. Do not build around unverified Google behavior.

**Practical parallelism:** at most two code lanes after M0: page adapter (T3) and session/CLI work (T4, then T5). T6 can run separately. Keep one writer per shared file; never run two workers against the live authenticated tab. Do not split modules just to create more parallel tasks. No parallelism is required if one implementer is faster.

## Quality assurance

Use Node's native test runner (`node --test`) for the whole package. Run fixture extraction in installed Chrome with a separate disposable test profile and sanitized HTML loaded through `setContent`; no extra test framework. Test the behavior that could lose sessions, mix conversations, or misreport answers. Fixtures prove known cases, not compatibility with Google's current UI.

| Area | Minimum check | Expected result |
|---|---|---|
| Answer fidelity | Paragraphs, headings, lists, code, links, repeated citations, and page control characters | Faithful markdown and observed citation associations; no terminal escape execution. |
| Turn attribution | Existing answer remains visible while a new request starts; delayed completion; replacement of answer DOM | Old text is not accepted as the new answer; quiet text alone is not completion. |
| Single flight and recovery | Input during pending turn; unknown `/commands`; Ctrl-C, timeout, and uncertain send while Google still generates | `/open`, `/quit` and `/help` work; unknown commands never reach Google. Extra prompts are rejected, never queued/retried; prompts resume only after reconciled idle state. |
| Persistence | URL available before completion; incomplete first turn; quit; switching with `/new` or `/resume`; write failure before rename | Save any verified available conversation URL; otherwise warn not saved yet before leaving. Existing valid index survives failed replacement. |
| Index and names | Generated names and collision suffixes; `--name` duplicate rejection; unknown/invalid names; malformed JSON; wrong schema/version; unsupported URL | Names follow SRS defaults; clear errors before mutation/navigation. Corrupt index exits 3 and remains intact; user input errors exit 1 when terminating. |
| Instance lock | Second process; stale or malformed lock; Ctrl-C during a turn; normal and signal exits | Existing lock refused with exit 4; no automatic stale-lock deletion; manual recovery guidance. Ctrl-C recovery retains the lock. `/quit`, Ctrl-D and terminating SIGTERM remove this process's lock. |
| Resume identity | Stored URL opens a fresh-chat redirect, login page, unavailable thread, or wrong conversation | No prompt is submitted to a replacement chat; explain recovery. |
| Selection | Create A and B, resume A, restart with `-c` | Resume A; `/sessions` and last-used state agree. |
| Connection and shutdown | CDP unavailable/non-loopback, tab closed, browser disconnect, `/quit` and Ctrl-D | Unreachable endpoint exits 2; normal exit is 0. Bounded visible failure; no new chat/retry; preserve metadata; detach leaves user Chrome intact. |
| Attention | Sanitized login/consent fixtures and a safely arranged live login-required state; add a CAPTCHA fixture only if naturally encountered | Needs-attention result and usable `/open`; do not provoke bot detection to manufacture a CAPTCHA. |

At integration, reproduce the SRS live checks on a real account: question with citations, contextual follow-up, CLI restart, Chrome restart, and attention handling. Also verify two named sessions remain distinct and that an interrupted wait cannot cause a duplicate turn. Measure extraction/render processing against the SRS target separately from Google latency and the settling interval.

Record results in a concise QA section of the implementation handoff: exact revision, Node/Chrome versions and tested OS, full-suite command/result, live scenarios, timings, and any missing evidence. Run the live check again after changes to selectors or completion/resume behavior. Do not claim Linux verification from a macOS run; if a second supported platform remains untested, record that explicitly before release.

## Release boundary

Release requires T7 and T8, named-session continuity, and no known silent session loss, duplicate submission, wrong-thread continuation, or false-complete answer. Any missing live evidence stays visible as an open gate. Live streaming, rich TUI, transcripts, one-shot JSON and MCP remain later work, outside this task list.
