# Limited personal tool — 2026-09-21

## Accepted scope

After the bounded restoration investigation, the owner requested the features that already work, without more elaborate restoration machinery. This deliverable is a limited personal tool, not a claim that the broader original M0 or release checklist passed.

Included: new questions, source links, contextual follow-ups, pending/interrupted-answer recovery, browser access, safe exit, named local records, and strict import of a conversation selected from Google's native AI Mode history. Automatic reopening of newly created conversations remains best effort and is explicitly warned about. Process locking, complete index validation, and additional session-management commands were not added.

## Changes

- Added `--url <google-history-url>` with an optional name. The adapter accepts only the default Google HTTPS search origin without credentials and removes the original question before navigation.
- Imported records are written only after the expected conversation passes strict identity and input checks. Wrong-conversation redirects remain blocked; attention recovery repeats the same verification before saving or sending.
- Retained the earlier safety fixes: every saved follow-up is checked, a changed thread cannot overwrite the saved URL, and an unfinished restored answer remains in recovery.
- Added `npm start`, a README with setup and usage, and scope notes in the original planning documents.

## Verification

- Implementer full suite: `npm test` — **23 passed, 0 failed**.
- Independent final focused suite: `node --test test/m0.test.js` — **13 passed, 0 failed**.
- Independent review: no findings in the final limited-tool diff.
- `git diff --check` and `npm start -- --help`: pass.
- Live native-history import and named resume: pass using the real CLI, a scratch session index, and the dedicated signed-in Chrome. Import saved the exact verified thread with no `q` parameter. Resume remained writable and advanced recency. The conversation stayed at two turns; no question was submitted or replayed. The CLI exited normally and left Chrome running.

No Chrome-restart claim is made. Natural end-to-end signed-out recovery remains unverified. The older reports retain their original failing results for newly created conversation restoration.

## Revision identity

Base: `d237fc33503c17b8558de7f464df1010d01d3a57` with the reviewed working changes on `task/page-t1-t3`. Final runtime SHA-256:

- `bin/aim.js`: `64bdc75f38e3ff3c5c5da9dac26c76c5d310c52e7d8a25230a8d0b8e978ae580`
- `src/page.js`: `8372556b6b55954e53731a24191e7feec88fa193fc0fa9a082ef1cd766d95337`

Live smoke preceded only comment changes in the CLI and validation rejecting credential-bearing/nondefault-port URLs in the adapter. The valid Google-native URL used by the smoke is unaffected; those newly rejected cases are covered by automated checks.

The checked runtime and documentation are promoted together to local main. No remote push or publishing is part of this handoff.
