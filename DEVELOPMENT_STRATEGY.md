---
title: "Aim — Development Strategy, Allocation and Sprints"
tags: [aim, planning, sprints, team]
status: active
created: 2026-09-16
---

# Aim development strategy

**Owner:** tetraxzx9 · **Managers:** Claude and Codex · **Version:** 1.2, 2026-09-16 (final joint manager plan; T1/T2 verification exception clarified)  
**Scope:** Execution plan only. No implementation or QA is claimed by this document.

## Source of truth

The project is `/Users/mali/Development/aim`. At planning time it contains `prd.md`, `srs.md` and `tasks.md`; no Git repository or implementation was present in that directory.

- [SRS](/Users/mali/Development/aim/srs.md), especially §1.3, §2.3 and §5, governs the product; its explicit changes supersede the earlier PRD.
- [Backlog](/Users/mali/Development/aim/tasks.md) T1–T8 governs dependencies and acceptance criteria.
- [PRD](/Users/mali/Development/aim/prd.md) supplies background.
- Owner direction: Buzz thread `9f10a6d8694ce006aa2d78a4fc2926ea9fb147b4ff304dfc4f06ee108e0f3288`; context/worktree constraint `a21d8aaa1c3e2029128c83a23330a07c2e60207dcbfab5ce57c9071687c45021`; Claude's corrected allocation `0cd62baca618518a01d52affeb411ccaaeacbfc526f01dc2506b5fd790304f79`, all in #aim-development. Claude approved the allocation with the T3 Chrome handoff correction in event `d128bfdebbfb0390ed1361a27a2db1ace9b1c5e3ab4b69e6c94fc97a3ab97bb5`; that correction is incorporated below.

Named sessions are required for release. Use Node, `playwright-core`, built-ins and the existing SRS adapter contract. Keep browser/Google knowledge in `src/page.js`; session/CLI work belongs in `bin/aim.js`, with `sessions.js` extracted only if readability warrants it. Do not implement the earlier proposed `browser.js`/`turn.js`/`extract.js` split or replace the SRS contract with a new `TurnResult` interface.

## Managers and workers

| Role | Configuration | Responsibility |
|---|---|---|
| Claude manager | Existing configuration | Brief one development worker, resolve foundation decisions and hard blockers, assess M0 evidence. Read concise summaries rather than source code. |
| Claude development worker | Exactly Claude manager's model/configuration | T1 → T2 → T3, serial; owns `src/page.js`. No child agents or additional concurrent Claude workers. |
| Codex manager | Existing configuration | Schedule bounded work, manage dependencies/worktrees, request independent verification and consolidate evidence. No product implementation. |
| Codex easy/medium worker | `gpt-5.6-luna`, reasoning `max` | Minimal S0 setup, T6 documentation and bounded supporting tasks with explicit file ownership. |
| Codex engineering/review worker | `gpt-5.6-terra`, reasoning `max` | T4 persistence/lock, T5 integration, harder fixes and independent code/test verification. Reviewer is separate from the author. |
| Codex browser verifier | `gpt-6-astra`, reasoning `medium` | Browser/computer verification of M0 and T7, recording observed behavior and evidence. |
| Owner | tetraxzx9 | Product decisions, credentials/login when required, T8 walkthrough and subsequent daily use. |

Codex currently has three worker slots alongside its manager. These are a ceiling, not a target: normally one implementer plus a reviewer, adding a documentation worker when independent work exists. Keep at most two code lanes across both teams after M0. No worker recursively delegates. If a requested model/configuration is unavailable, report that before substituting it.

## Sprints and allocation

Sprints end on evidence, not invented calendar estimates. T1/T2 discover live behavior, so dates can be estimated only after the spike.

| Sprint | Work and owner | Dependencies and exit |
|---|---|---|
| S0 — Ready to work | Codex → Luna: minimal package/Git setup, preserve the existing specifications, establish task branches/worktrees and tracking. | Check for an existing Aim Buzz project/repository and local checkout before creating anything; reuse them. Create a Buzz repository bound to this channel only if absent. No duplicate project. Minimal setup only; browser behavior remains T1. |
| S1 — M0 foundation | Claude → one worker: T1 connection/turn probe, then T2 restoration and interrupted-turn recovery. Codex → Terra checks implementation/test evidence; Astra independently verifies live behavior after browser handoff. | T1 precedes T2. All seven SRS §5.2 checks must pass. Claude records the evidence-based go/no-go; Codex supplies independent verification. A failure stops M1 and goes to the owner as a blocker. |
| S2 — Parallel implementation | Claude worker: T3 page adapter and sanitized fixtures. Codex → Terra: T4 session index and lock. Codex → Luna: T6 documentation draft. | Begins only after T2 passes. T3 and T4 run in parallel; T6 may draft after T2. Exit: page contract/fixtures and persistence/lock checks pass, each on a recorded revision. |
| S3 — Integration and verification | Codex → Terra: T5 CLI integration after T3+T4. Luna finalizes T6 after T5. A fresh Terra reviewer plus Astra execute T7; original file owners fix failures. | Entire automated package suite and required live checks pass on the same final integrated revision. T6 is complete. Missing evidence remains an open gate. |
| S4 — Owner handoff | T8: owner walkthrough, organized by Codex. Claude worker reserved for hard foundation failures. | Owner demonstrates named sessions, contextual follow-up, CLI and Chrome restarts, and recovery. Then one week of ordinary use informs later priorities; M2 features stay outside this plan. |

T1/T2 may use the minimal CLI/persistence needed to prove real restart and interruption behavior. T4 hardens this into the release implementation; the spike must not substitute a manually reopened new chat for verified continuation.

## Worktrees and shared resources

After the initial repository bootstrap, all implementation happens on task branches in worktrees, never by editing the default branch. Reuse an existing task worktree when continuing that task.

| Lane | Suggested worktree | Sole writer |
|---|---|---|
| Page, T1–T3 | `/Users/mali/Development/aim-wt/page` | Claude development worker |
| Session/CLI, T4 then T5 | `/Users/mali/Development/aim-wt/cli` | Assigned Terra worker |
| Documentation, T6 | `/Users/mali/Development/aim-wt/docs` | Assigned Luna worker |
| Review/live QA | Disposable worktree at the exact candidate commit | Read-only reviewer/verifier |

Managers record the branch, worktree, base commit and owned files in each brief. T1 bootstrap may touch the entry point; transfer its ownership explicitly before T4. One worker owns shared package/lockfile edits at a time. A designated integration worker serializes merges, resolves conflicts and runs checks on the merged candidate. Never run concurrent Git mutations in the same worktree; do not delete a worktree with unmerged work.

Git worktrees do not isolate Chrome or the session index. The live-profile order is Claude's worker (T1–T2) → Astra (M0 verification) → Claude's worker (T3 capture from the live post-hydration DOM) → Astra (T7). Each handoff is explicit; T4 and T6 do not need the live profile. Schedule one live operator at a time; others use sanitized fixtures and disposable local test profiles/state. Parallel tests set a separate disposable `XDG_CONFIG_HOME` per worktree so session indexes and locks cannot collide; live checks use the reserved live state. Record who holds the live profile and which revision they are exercising. Never copy the authenticated browser profile into a repository or evidence artifact.

## Keep context small

1. Start Codex workers with `fork_turns="none"` and an explicit model/reasoning setting. Supply task ID, goal, worktree/base revision, owned files, relevant SRS sections, dependencies, acceptance checks and a bounded attempt/checkpoint budget; do not copy the conversation history.
2. Claude maintains exactly one worker. Reuse it for the coherent T1–T3 foundation; if a fresh context is needed, end/checkpoint the previous session before replacing it with the same configuration.
3. Store detailed commands, results and sanitized evidence in `docs/evidence/T<n>.md`. T2 evidence includes a pass/fail matrix for all seven M0 checks and assumptions A1–A6, with timestamps, observed UI signals and supporting artifacts. Keep large logs/artifacts outside manager context; reference paths. Never include credentials, cookies or unrelated personal browsing content.
4. Worker handoffs are at most ten lines: task/status, branch/worktree, base and resulting commit, changed files, behavior, whole-suite command/result, live evidence path, limitations, blocker and next dependency. A passing assertion without evidence is not completion.
5. Managers read handoffs and task status. Open relevant evidence only for failures, disputed claims or gate decisions; delegate source inspection to the reviewer. Reviewers receive the spec and diff, not the author's expected conclusions.
6. Checkpoint before ending a task; a new worker reads that task's brief and evidence, not every earlier transcript. Keep the task register current with owner/model, dependency, state and evidence pointer.
7. No idle teams, repeated status polling or speculative subtasks. After two failed attempts, report the failure mechanism and hand the bounded blocker to Claude's existing worker; do not launch a growing chain of replacements.

## Verification and release gates

The authoritative checklists remain SRS §5 and `tasks.md`; do not replace them with a fixed number of arbitrary questions.

- **M0:** correct answer/citations, contextual follow-up, quit during generation with the session saved, CLI restart continuation, Chrome restart continuation, Ctrl-C recovery without queued/duplicate prompts, and safe login-attention handling. Failed restoration is a product blocker, never optional resume.
- **Automated:** Node's native `node --test` for the entire package. Cover extraction/attribution, safe index replacement, schema/name/URL validation, process-lock behavior, terminal-control sanitization, command availability during pending/recovery and exit codes. Fixture tests use the production extractor in isolated installed Chrome via `setContent`.
- **Live:** Astra compares the terminal result and citations with the real page, verifies distinct named sessions and recovery, and records Node/Chrome/OS versions, revision and limitations. Saved HTML fidelity is unproven until capture/replay matches the observed answer and citation positions. Do not manufacture a CAPTCHA.
- **Revision discipline:** record `git rev-parse HEAD` in the same environment as checks, plus any working-tree changes. T7 evidence must cover the final integrated revision. Changes to selectors, completion or resume invalidate relevant earlier live checks.
- **Performance/platform:** measure extraction/render time separately from Google latency and the settling interval. State which platforms were actually tested. Luna records the current service-terms review in T6; Codex tracks its status and the owner resolves the open launch-review item. While unresolved, enforce the SRS NFR-5 personal-tool documentation and no encouragement of shared, hosted or high-volume use. No legal conclusion is asserted in this planning document.
- **Release:** T7 and T8 must pass, with no known silent session loss, duplicate submission, wrong-thread continuation or false-complete answer. A manager summary alone cannot waive these gates.

## Merge policy

These are planned gates, not installed branch protection or existing CI. S0 establishes the repository and records which protections the host actually enforces. Configure PR/patch-only changes, no force-push and no deletion on the default branch where supported. Required review/check enforcement must be verified rather than inferred from a protection setting. Until automated enforcement exists, Codex checks the evidence before authorizing the designated integration worker to merge; no new owner approval round is needed for routine merges within authorized implementation work.

Every code PR must satisfy:

1. **Scope:** linked T-ID, stated acceptance criteria, small coherent diff, no unrelated edits. Spike PRs may land partial work but must label unproven behavior; a merge never substitutes for the M0 or release gates.
2. **Independent review:** a fresh Terra/max reviewer checks the actual diff against relevant SRS requirements and callers. The implementing worker cannot approve its own work. Resolve correctness, data-loss, security and required-behavior findings before merge; record optional cleanup separately.
3. **Tests:** behavior-changing code includes meaningful regression/acceptance checks, and the complete package `node --test` suite passes on the integrated candidate. A zero-test scaffold run is explicitly reported as bootstrap only. No focused-test-only or skipped-required-test pass counts as the gate.
4. **Live evidence when relevant:** changes to browser selectors, submission, completion, extraction, restoration or user-visible CLI/browser integration require Astra/medium evidence for affected real workflows. Docs-only changes and isolated persistence changes do not require redundant live queries; persistence receives isolated process/filesystem checks and the full workflow at T7. Failures or unavailable live access leave the relevant gate open. **T1/T2-only exception:** while Claude's worker exclusively holds the live profile, spike PRs may merge with that worker's recorded live evidence and an explicit "independent live verification pending; unproven spike" label. Independent Terra review and the full available package suite still apply. After the T2 handoff, Astra verifies all seven M0 checks on the combined spike revision; only a passing result closes the deferred independent-live gate. M1 cannot start before that result. This exception does not apply to T3 or later PRs.
5. **Exact candidate:** the integration worker prepares the merge candidate against current main in an integration worktree. Evidence records base/head/candidate revisions and a clean tree. If main moves, prepare a new candidate and rerun the full suite; rerun affected live checks when the new candidate changes their behavior. Promote only the verified candidate, without a different untested resolution.
6. **Handoff:** evidence path, passing checks, reviewer outcome and limitations are recorded. Verify outgoing attribution against repository policy before pushing. Managers receive the compact summary, not raw test logs or source dumps.

T7 separately requires all release scenarios on the same final revision; T8 requires the owner's walkthrough. Neither can be waived by merging individual PRs. If a merged change breaks main, stop integration and have a worker revert that change or submit a verified minimal fix before taking more work.

## Code size and test budget

Planning estimate only, before the live-browser spike: **900–1,600 lines of runtime JavaScript and 600–1,000 lines of tests**, roughly **1,500–2,600 total**. This excludes blank lines, comments, saved HTML fixtures, documentation, dependency lockfiles and dependencies. Runtime estimate: page adapter 400–700, CLI 250–450, persistence/lock 250–450; these responsibilities need not become separate files.

Re-estimate after T2, when the DOM/extraction and recovery behavior are known. Line count is a complexity signal, not a quota or merge gate. Crossing roughly 2,000 runtime lines triggers a short scope/design check for avoidable machinery; it does not justify compressing readable code or removing safety checks. No speculative framework, build pipeline or additional test framework.

Implementers own tests alongside their change; the independent reviewer checks that assertions demonstrate observable behavior and fail for the relevant bug. Use Node's native test runner, temporary directories and real child processes where process behavior matters:

| Test layer | Essential coverage | Owner |
|---|---|---|
| Page fixtures | Structure and citation positions, repeated citations, terminal controls, old-answer attribution, delayed/replaced DOM, completion signal versus quiet text, attention states | Claude worker, T3; Terra reviews |
| Filesystem/process | Invalid/corrupt index, failed replacement preserving old data, early URL persistence, two-process lock contention, lock cleanup/retention and exit codes | Terra implementer, T4; independent Terra reviews |
| CLI integration | Arguments/commands, rejected pending prompts, usable help/open/quit, Ctrl-C/timeout/uncertain-send recovery, no retry, selection and detach behavior | Terra implementer, T5; independent Terra reviews |
| Real browser | All seven M0 checks; final named-session separation, both restart paths, recovery, citations and timing | Astra, M0/T7 |

Use controlled failures for filesystem and recovery checks; do not rely only on successful runs. Use fixtures/fakes for deterministic failure scenarios, and live Chrome to establish actual Google behavior. Do not add an arbitrary coverage percentage or test-count quota: every safety-critical behavior in the existing task checklist must have a passing check and evidence. A new bug gets a reproducing regression check before or with its fix.

## Tracking and communication

At execution kickoff, reuse T1–T8 as the tracking IDs; create/link corresponding Buzz issues without duplicating existing ones. Assign issues to the responsible manager identity and record the actual worker/model in the issue. Use the signed assignment operation, not names in the body alone.

All coordination stays in #aim-development (`b164ba14-4c53-4feb-b867-46690b96bdd8`). PRs opened from this work carry that channel ID. Post only actionable starts, blockers, gate decisions and completed handoffs; completion messages mention the delegator. Link issue/PR/repository deep links returned by Buzz. Do not announce a project, repository or completed check until it actually exists.

**Next execution step:** S0, followed by Claude's single-worker T1 brief. This planning deliverable does not claim S0, implementation or QA has run.
