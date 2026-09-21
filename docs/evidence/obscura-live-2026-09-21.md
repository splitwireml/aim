# Obscura signed-in live check — 2026-09-21

## Result

**Follow-up correction:** native Chrome 153 **passed headlessly** with the same signed-in profile when launched with its normal desktop browser identifier. It answered Paris, then Seine River, with one tab. The earlier headless failures did not establish that headless operation was impossible.

Obscura 0.2.3 did not produce a Google AI Mode answer in this run. The same account in visible Chrome 153 answered the question and contextual follow-up successfully. The earlier offline fixture checks were insufficient to establish live compatibility.

The user signed in manually in a dedicated Chrome profile. Only Google-domain cookies were transferred locally to a separate Obscura storage directory. No cookie values, account identifiers, conversation tokens, or raw authenticated page dumps are included here.

## Observations

| Check | Result |
| --- | --- |
| Visible Chrome, first question | Complete: “The capital of France is **Paris**.” |
| Visible Chrome, contextual follow-up | Complete: “The **Seine River** runs directly through Paris.” |
| Import Google cookies into Obscura | Authentication cookies appeared in the importing connection and on disk. |
| Reconnect without server restart | A new CDP connection returned zero Google cookies. |
| Restart Obscura with the storage directory | A new connection returned 26 Google cookies, including authentication cookies. |
| First Obscura question before restart | Delivery uncertain; attention detection true; no answer. This did not test a correctly loaded authenticated session. |
| Obscura question after restart | Delivery uncertain; no completed answer; Arabic UI. |
| Obscura with explicit English | Question bubble and turn root present, but zero answer roots. Google displayed “Something went wrong” and “Try again”; attention detection false. |
| Tab count | One Obscura page during the question checks. Probe pages were closed and the Obscura process stopped afterward. |
| Chromium headless shell | Imported login persisted across restart and Google's signed-in account UI appeared. The question produced no answer, including with `hl=en`. Waiting 15 seconds for the landing-page input also timed out. |
| Full headless Chromium 151 | Same imported account, `locale: en-US`: delivery uncertain, no answer roots, no attention challenge detected. This comparison did not pass either. |

Question: “What is the capital of France? Answer in one sentence.” Follow-up in the successful visible-browser control: “Which river runs through that city? Answer in one sentence.”

The explicit-English check used `hl=en` and `Accept-Language: en-US,en;q=0.9`, establishing that English selectors alone do not fix the missing answer. Obscura logged `importScripts is not defined` in an earlier run and `Cannot set properties of undefined (setting 'onmessage')` during the authenticated runs. These are compatibility clues; the check did not isolate the exact cause of Google's error.

## Implication

Keep Obscura experimental for AIM. Persistent cookie support and successful fixture extraction do not establish that Google's live JavaScript and answer transport work. In this build, importing cookies and then reconnecting also requires checking actual connection state; a successful write to disk is not enough. No CAPTCHA bypass or repeated automatic query retry was added.

At the end of the initial comparison, only visible Chrome had passed the live question and follow-up. The subsequent headless diagnosis below supersedes that preliminary result. The differences between browser builds, launch modes, and initial navigation mean this check does not isolate a single cause for every failed engine. All temporary headless browser processes were closed; the user's dedicated signed-in visible window was retained.

## Subsequent headless diagnosis and fix

- Restarted the exact working Chrome 153 build and native profile with `--headless=new`. Google displayed “AI Mode is not currently available on your device or account”.
- A landing-page check also used a stale input selector: the current landing page has a visible “Ask anything” textarea outside the older `aim-mars-input-plate` container. That timeout was not a reliable capability check.
- Relaunched native Chrome headlessly with its own desktop user-agent string (same version and platform). The actual adapter's first-question navigation and follow-up both completed: Paris, then Seine River. One tab remained open.
- The slim shell did not complete the comparable check. A later managed-launch comparison triggered Google's unusual-traffic/CAPTCHA page, so no further live queries were attempted.
- The managed launcher now uses installed Chrome, discovers its actual desktop identifier, and launches with native profile storage instead of Playwright's test keychain. A temporary blank browser used to discover the identifier is closed before the signed-in profile launches.
- Restored the user's previously authorized, locally saved Google cookies into the native profile after the earlier test-keychain comparison. Verified that authentication cookies survive a managed-browser restart. The native profile is now `~/.config/aim/chrome`; no cookie values are committed.
- Automated checks verify the desktop identifier, one-tab startup, popup limits, cookie persistence, and browser shutdown. The final managed launcher was checked without submitting another live query after Google's challenge.

The successful live path is full Chrome in headless mode; Obscura remains unsuccessful. Resource control is concrete (one tab and no managed browser after exit), but no RAM-percentage benchmark was performed.
