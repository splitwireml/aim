# M0 automated evidence — 2026-09-21

**Result:** pass for the bounded automated checks below.

## Code under test

- Base revision: `d237fc33503c17b8558de7f464df1010d01d3a57`
- Automated-slice working changes: `src/page.js`, `bin/aim.js`, new `test/m0.test.js`, and this report
- Concurrent working change present during the final run: `tasks.md` (not changed by this automated slice)
- Command: `npm test`
- Result: 23 tests passed, 0 failed, 0 skipped; 4.99 s
- `git diff --check`: pass

The baseline suite passed 10/10 before these changes. New regressions reproduced three safety failures before the runtime fix: a prompt could be submitted after attention redirected a resumed tab to another conversation; a resumed tab could change conversation and then accept a prompt/overwrite the stored URL; and a restored unfinished turn was treated as ready for another prompt.

## New deterministic coverage

| Check | Result |
|---|---|
| Sign-in and consent URL attention | `accounts.google.com` and `consent.google.com` print `[needs attention — run /open]`; the attempted prompt is not submitted and the saved index remains byte-identical. |
| Interrupted-turn recovery | Ctrl-C stops local waiting; input while pending and while Google is still generating is rejected; the post-idle prompt is submitted exactly once. The fake records only `first` and `accepted`, with no queued replay. |
| Attention followed by a wrong conversation | The resumed session revalidates its stored identity before sending or printing an answer, blocks the prompt, and leaves the index unchanged. |
| Successful sign-in recovery | A resumed session that returns to the confirmed thread completes the resume transition before sending: recency is updated and a same-thread URL refresh is persisted. |
| Follow-up after tab drift | Every saved-session follow-up revalidates the stored conversation. A changed confirmed thread is blocked; no prompt is submitted and the stored URL is not overwritten by the save ticker. |
| Unfinished restored turn | A matching resumed conversation whose latest turn lacks the completion signal enters recovery, rejects a prompt while generating, and submits once after it becomes idle. |
| Same-thread URL refresh | A changed `mstk` is persisted when the address-bar `mtid`, highlighted thread id, and stored thread id still agree. |
| Native-history import | `--url` strips `q`, opens the sanitized URL, and persists it under an explicit or generated name only after strict writable verification. |
| Import failure paths | Wrong/fresh identities and post-attention mismatches stay blocked and unsaved; no page answer is printed and no prompt is submitted. |
| Import trust boundary | HTTP, wrong-path, non-default-port and credential-bearing URLs, plus `--url` combined with `-c`/`-r`, are rejected before browser connection. |

Existing tests still pass for extraction/citation structure, loopback-only CDP validation, conversation URL sanitization, resume identity, provisional URL rejection, save timing, and null extraction recovery.

## Evidence boundary

`test/m0.test.js` runs the real adapter and CLI against an in-process fake `playwright-core`, with a fresh temporary `XDG_CONFIG_HOME` per case. These checks prove CLI state transitions, submission counts, and index writes; they do not prove current Google selectors or live account behavior.

`test/page.test.js` launches an installed Chrome headlessly with a new offline context and loads a sanitized fixture via `setContent`. It does not attach to a CDP endpoint, the live AI Mode tab, or user browser data.

No live browser or account was accessed for this automated run. CAPTCHA behavior remains outside this bounded check, and the unresolved live restoration result in [the current live report](M0-live-2026-09-21.md) is not changed by fixture tests.
