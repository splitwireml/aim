# Exact restoration feasibility — 2026-09-21

**Verdict:** **Partially viable, but automatic restoration of a newly created `aim` session is still unproven.** Google can reopen an exact thread once that thread exists in native AI Mode history. A new live thread used by `aim` was not present in full native history, and reopening even Google's complete live-tab URL converted it to a different persistent history identity. No stable invariant exposed by the page proves that conversion is the same exact thread without falling back to title or transcript comparison.

This investigation used only the existing `live-20260921` test conversation. Some inspected Google-native URLs contained the existing first query; reopening them was verified not to add a turn. No source files were changed and no new prompt was submitted.

## Environment

- Commit: `d237fc33503c17b8558de7f464df1010d01d3a57`, with the existing concurrent uncommitted safety changes preserved.
- Chrome 153.0.8010.48, dedicated AIM profile on `127.0.0.1:9222`.
- Node v24.16.0 and `playwright-core` 1.62.1.
- No account identifier, conversation token, query value, or private history title is recorded here.

## Approach 1: exact native-history lookup

Opening Google's **AI Mode history** control expanded the sidebar from 10 to 20 exact `button[data-thread-id]` entries.

- The thread id saved from the original live `aim` tab was absent from the full 20-entry native history list.
- The different thread id produced by reopening that saved URL in the earlier M0 run was present.
- Selection was always by exact `data-thread-id`; no title or transcript matching was used.
- The original live tab continued to show the saved id as its current sidebar item, but clicking that already-current exact item did not change or canonicalize its URL.

The original id therefore appears to be live-tab state that Google does not expose as a persistent native-history entry.

## Approach 2: Google-native URL versus AIM's whitelist

Clicking the exact persistent history entry produced a Google URL with these parameter names:

```text
udm, sxsrf, mstk, mtid, csuir, aep, q, ved, atvm
```

The `q` value was non-empty and equaled the test conversation's first query. Its value is intentionally omitted.

Three navigation observations were made:

| Navigation | Exact URL id = highlighted history id | User turns | Input visible |
|---|---:|---:|---:|
| Native-history selection | yes | 2 | yes |
| New tab with Google's full native URL | yes | 2 | yes |
| New tab with AIM's `udm,mstk,mtid,csuir` subset and no `q` | yes | 2 | yes |

The full native URL did not replay `q`: the conversation remained at two turns. The stripped URL also preserved the exact persistent identity. Therefore the extra native parameters, including `q`, are not required to restore an already-persistent history thread, and `toConversationUrl`'s whitelist is not the cause of that thread's identity stability.

The original live tab differed:

| State | URL keys | URL id = original highlighted id | User turns |
|---|---|---:|---:|
| Before exact-current click | `q,mstk,csuir,mtid,udm` | yes | 2 |
| After exact-current click | same | yes | 2 |
| New tab reopening that complete Google URL | same keys | **no**; Google selected another id | 2 |

Keeping the original `q` and Google's complete live-tab URL did not prevent the identity change. This rules out AIM's URL shortening as the root cause of the new-session failure.

## Feasibility boundary

Reliable exact restore is available for a thread already present in native AI Mode history: exact native selection works, and the current four-parameter stored URL is sufficient afterward.

Reliable automatic capture of a newly created `aim` conversation is not established. The only observed path from its live-only id to a persistent history id is to reopen the URL and accept Google's rewritten identity. The page exposes no immutable link between the two ids. Treating identical titles or transcripts as proof would violate the strict identity requirement and can select the wrong conversation.

A future implementation would need one of these before claiming FR-4.5/FR-4.7:

1. a Google-exposed immutable relation from the live id to the persistent history id; or
2. a product decision that Google's deterministic rewrite of the exact saved URL is itself authoritative canonicalization, with tests showing wrong or stale URLs still fail closed.

No browser-restart or contextual-follow-up run was added because the unresolved step is capturing the correct persistent identity for a new session. Repeating later stages would not resolve that proof gap.

## Official context

Google documents [continuing conversations through AI Mode history](https://support.google.com/websearch/answer/16011537?co=GENIE.Platform%3DDesktop&hl=en). It separately documents that [following up on a shared thread creates a new private thread](https://support.google.com/websearch/answer/16517651?co=GENIE.Platform%3DDesktop&hl=en). These explain why matching conversation text alone is insufficient evidence of identity; they do not establish that the tested live-tab URL is a shared link. The conclusions above come from the live observations, not an undocumented assumption about URL parameters.
