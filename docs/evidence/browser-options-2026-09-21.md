# Lightweight browsers for AIM — 2026-09-21

## Recommendation

**Obscura was the strongest Rust candidate on paper, but the subsequent signed-in live check failed.** See the [live result](obscura-live-2026-09-21.md): the English question appeared, but Google returned “Something went wrong” with no answer. Visible Chrome passed the same question and follow-up. Obscura's headless CDP server fits AIM's existing Playwright connection, and Obscura documents disk persistence for cookies and localStorage. Keep it experimental; cookie persistence did not establish live answer compatibility. Website login persistence is the requirement here; Chrome account sync and importing a Chrome profile directory are separate capabilities.

The subsequent native headless Chrome 153 check passed the question and contextual follow-up; AIM now uses that full browser with one-tab limits and shutdown on exit. See the [live diagnosis](obscura-live-2026-09-21.md#subsequent-headless-diagnosis-and-fix). No reviewed primary source establishes that any independent lightweight engine reliably supports signed-in Google AI Mode end to end, or proves which browser is most efficient on AIM's workload. These are findings from the sources reviewed, not claims that such support is impossible.

## Candidates

| Browser | Engine and automation | Persistent website sign-in | Assessment for AIM |
| --- | --- | --- | --- |
| **Obscura** | Rust browser with V8; headless CDP; documented Playwright connection. Apache-2.0. | `--storage-dir` stores cookies and localStorage; limited Playwright storage-state support. | Adapter connects, but the signed-in live query failed. Keep experimental. |
| **Lightpanda** | Zig with V8, not Rust; headless CDP and WebDriver BiDi. AGPL-3.0. | Current source imports cookie files in `serve`; automatic cookie-jar output is exposed for other modes, not `serve`. | Credible efficiency candidate, but restart persistence needs additional verification/integration. |
| **h5i** | Rust engine behind its own browser CLI; also offers Chromium and Lightpanda engines. | `--restore` carries the saved cookie jar into a new session; `--cookie-jar` imports one. | More adapter work. Own docs recommend Chromium for broad compatibility and say h5i is slower on script-heavy pages. |
| **OxiBrowser** | Rust with Boa JavaScript; CDP server. MIT. | `BrowserConfig.cookie_file` provides a cookie persistence hook. | Promising, but CDP claims and cookie support do not establish Google AI Mode compatibility. |
| **Servo / Servoshell** | Rust web engine; Servoshell documents headless and WebDriver settings. | No AIM-ready persistent-login/CDP recipe established by this review. | Requires a different automation integration; not a small browser swap. |
| **Verso** | Servo-based browser. | Not evaluated further. | Upstream says it is no longer maintained; repository archived. |

Sources for table: [Obscura README](https://github.com/h4ckf0r0day/obscura), [Obscura persistence](https://github.com/h4ckf0r0day/obscura/blob/main/docs/Persist-cookies-and-storage.md), [Lightpanda README](https://github.com/lightpanda-io/browser), [Lightpanda configuration](https://github.com/lightpanda-io/browser/blob/main/src/Config.zig), [h5i manual](https://github.com/h5i-dev/h5i/blob/main/docs/MANUAL.md), [OxiBrowser README](https://github.com/project-oxi/oxibrowser), [OxiBrowser configuration](https://github.com/project-oxi/oxibrowser/blob/main/crates/oxibrowser-core/src/config.rs), [Servoshell preferences](https://doc.servo.org/servoshell/prefs/struct.ServoShellPreferences.html), [Verso maintenance notice](https://github.com/versotile-org/verso).

## Obscura details

The project supplies macOS ARM64 builds and a CDP server. Its storage directory uses `cookies.json` and per-origin localStorage files, loaded at startup and saved on navigation/graceful shutdown. That is a useful persistent session mechanism, but not proof that Google accepts the session. [README](https://github.com/h4ckf0r0day/obscura), [storage architecture](https://github.com/h4ckf0r0day/obscura/wiki/Architecture-overview).

Use `chromium.connectOverCDP(...)`, not Playwright's own `connect` protocol. Obscura's current guide identifies incomplete service workers and Web APIs and limited `BrowserContext` storage-state save/restore. It recommends `--storage-dir` instead. Playwright itself describes CDP as lower fidelity and officially supports that connection for Chromium-based browsers; compatibility with Obscura depends on Obscura's implementation. [Obscura Playwright guide](https://github.com/h4ckf0r0day/obscura/blob/main/docs/Use-with-Playwright.md), [Playwright connection API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).

### Local smoke evidence

The implementation task tested **Obscura v0.2.3, macOS ARM64 rendering build** on 2026-09-21:

- CDP connected and exposed a default context.
- Navigation to an HTTP fixture using `domcontentloaded` succeeded.
- AIM's actual extraction code returned 1,934 characters and four citations from the fixture.
- `checkVisibility`, `innerText`, and `getComputedStyle` were present; Playwright `locator.fill()` and Enter key dispatch succeeded (this was a textarea input check, not a live submitted prompt).
- The signed-out Google AI Mode landing page loaded and exposed two textareas.
- `setContent()` waiting for `load` timed out: compatibility is not complete.
- A disposable persistent test cookie survived server shutdown and restart.
- The real AIM CLI attached to Obscura and exited with status 0, leaving zero external tabs.
- The managed shell separately passed cookie persistence from visible Chromium to headless shell; the 26-test suite covers tab limits, cleanup, and existing conversation behavior.

These are bounded local smoke observations, not upstream benchmark results. No Google credentials were transferred during these initial smoke checks. A later user-authorized signed-in check imported cookies locally and is documented separately in the [live result](obscura-live-2026-09-21.md). The fixture result does not establish successful extraction from a live AI Mode answer.

## Other candidates: important distinctions

Lightpanda's current `Config.cookieFile()` includes `serve`, while `cookieJarFile()` excludes it. Its cookie module implements JSON load/save, and CDP implements storage-cookie operations; this supports a possible application-managed cookie export path, not an assertion of a complete persistent browser profile. [Configuration](https://github.com/lightpanda-io/browser/blob/main/src/Config.zig), [cookie file implementation](https://github.com/lightpanda-io/browser/blob/main/src/cookies.zig), [CDP storage](https://github.com/lightpanda-io/browser/blob/main/src/server/cdp/domains/storage.zig).

h5i's restore explicitly copies cookies only. It deliberately lacks some browser capabilities, and its documented network/session behavior differs from a general browser. Selecting its Chromium engine would preserve broad compatibility but would not give the Rust engine's resource characteristics. [Current manual](https://github.com/h5i-dev/h5i/blob/main/docs/MANUAL.md).

OxiBrowser's current README identifies Boa, html5ever, and a Blitz/Stylo/Taffy rendering pipeline; the repository tagline's “Servo-powered” wording should not be read as evidence that it runs the complete Servo browser engine. Its cookie configuration alone does not establish a full persistent profile or authenticated Google support. [README](https://github.com/project-oxi/oxibrowser), [configuration](https://github.com/project-oxi/oxibrowser/blob/main/crates/oxibrowser-core/src/config.rs).

## Efficiency and acceptance criteria

Obscura advertises about 30 MB memory versus 200+ MB for headless Chrome; Lightpanda advertises a 16-fold peak-memory difference and nine-fold runtime difference in its benchmark. These are project-published measurements with different engines, feature coverage, pages, and environments—not measured AIM savings. Do not rank them by headline numbers. [Obscura benchmark table](https://github.com/h4ckf0r0day/obscura#benchmarks), [Lightpanda benchmark table](https://github.com/lightpanda-io/browser#benchmarks).

Chromium's headless shell is a separate, slimmer headless implementation, while regular modern headless Chrome shares the normal browser implementation. The shell itself has no visible login window. An early experiment shared a dedicated profile between headed Chromium and the shell: cookies persisted, but the live answer check failed. AIM therefore uses full installed Chrome for both visible sign-in and headless operation. [Chrome headless-shell documentation](https://developer.chrome.com/docs/automation-and-testing/headless-chrome-shell). Playwright's persistent context supports a dedicated user-data directory for cookies and local storage. [Persistent-context API](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

For AIM, compare total browser-process memory and completed-query latency at the same tab limit, including idle state and failed queries. Require a successful answer with citations, a conversation follow-up, restart with retained authentication, and repeated requests staying under the configured tab cap. Keep the tab cap in AIM so the limit applies whichever engine is selected; an engine's worker count is not necessarily its open-tab count.
