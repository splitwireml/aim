# aim

A small terminal client for Google AI Mode. Ask questions, read answers with source links, and continue the conversation with follow-up questions.

**Live browser status (September 21):** native headless Chrome 153 passed a signed-in question and contextual follow-up using its normal desktop browser identifier. AIM now launches installed Chrome headlessly with native profile storage, one tab by default, and browser shutdown on exit. Obscura remains experimental and failed the live answer check. See the [live results](docs/evidence/obscura-live-2026-09-21.md).

This is the limited personal version requested on September 21, 2026. New conversations work while the tool is open. Reopening a newly created conversation is not reliable: Google can change its identity. The tool refuses an uncertain match rather than sending your question to a different conversation.

Conversations selected from Google's saved AI Mode history reopened with a stable identity in the live checks. You can import one using its browser address. This was tested on one account on macOS; reopening after a full Chrome restart remains unverified.

## Setup

Requires Node.js 24. Install the dependencies:

```sh
npm ci
```

### Obscura (experimental Rust engine)

[Obscura](https://github.com/h4ckf0r0day/obscura) runs headlessly without Chromium. Install its binary from the official releases, then start a dedicated server in one terminal:

```sh
mkdir -p "$HOME/.config/aim/obscura"
chmod 700 "$HOME/.config/aim/obscura"
obscura serve --host 127.0.0.1 --port 9223 \
  --storage-dir "$HOME/.config/aim/obscura" --max-connections 1
```

In another terminal:

```sh
AIM_CDP_URL=http://127.0.0.1:9223 npm start -- --max-tabs 1
```

The storage directory retains Obscura cookies and localStorage across server restarts. It is **not a Chromium profile**; pointing it at your Chrome profile will not import your login. Obscura has no visible window for `/open`. A Google sign-in/CAPTCHA that needs a visible browser requires the Chromium option below. The signed-in live check failed: after loading the imported session and forcing English, Google displayed “Something went wrong” instead of an answer. See the [live result](docs/evidence/obscura-live-2026-09-21.md). Local checks on Obscura 0.2.3 passed CDP connection, the actual AIM answer extractor, textarea input, and the signed-out Google landing page. See [browser research and limitations](docs/evidence/browser-options-2026-09-21.md).

Keep the server on localhost and its storage directory private. Stop the server with Ctrl-C when finished to release its memory; AIM closes only its own conversation tab on exit. `--keep-tab` retains that tab if you need to preserve an ongoing conversation. Repeated retained tabs count toward the limit.

### Managed headless Chrome (default)

Requires installed Google Chrome. Without `AIM_CDP_URL`, AIM starts Chrome headlessly, reuses its startup tab, and shuts it down on exit. Sign in once in visible mode:

```sh
npm start -- --headed
```

Sign into Google, then `/quit`. Subsequent `npm start` runs headlessly using the same full profile. The profile defaults to `$XDG_CONFIG_HOME/aim/chrome` or `~/.config/aim/chrome`. `--profile <directory>` or `AIM_PROFILE_DIR` selects another **dedicated** profile. `AIM_BROWSER_EXECUTABLE` selects a custom Chromium-compatible executable; Obscura uses the CDP setup above instead.

AIM discovers the installed browser's actual version and platform with a short-lived blank browser, then launches the signed-in profile using Chrome's normal desktop identifier. Google's device check rejected the default `HeadlessChrome` identifier. Native profile storage avoids Playwright's test-keychain settings. Neither CAPTCHA handling nor automatic query retries are added. If Google asks for verification, quit and restart with `--headed`.

`--max-tabs N` (or `AIM_MAX_TABS=N`) sets the limit; default **1**. Managed browsers close excess popup tabs. External CDP browsers refuse a new AIM tab when already at the limit and do not evict existing tabs. Use `--max-tabs 2` when a visible login needs a popup.

The live headless question and follow-up passed with a native launch. The managed launcher passed local profile-persistence, tab-limit, and shutdown checks. Google later issued an unusual-traffic challenge during comparisons, so a further live query through the final managed launcher was not attempted. These checks do not establish indefinite Google compatibility or a measured RAM reduction.

To keep using an existing dedicated Chrome/Chromium browser, set `AIM_CDP_URL` explicitly. Managed-browser options cannot change an externally running browser's profile or visibility.

## Use

Start a new conversation:

```sh
npm start
# Optional name:
npm start -- --name research
```

Type your question, press Enter, and wait for the answer before asking a follow-up.

To continue a conversation already in Google's history:

1. In the visible browser window, open AI Mode history and select the conversation.
2. Wait for it to load, then copy the browser address.
3. Start the tool with that address, keeping the quotes:

```sh
npm start -- --name research-history --url 'PASTE_THE_ADDRESS_HERE'
```

The tool checks the conversation before saving it. The original question is removed from the address before navigation, so importing does not replay it. If Google returns a different conversation, importing is refused.

After a successful import, try continuing the most recently used conversation or a named one:

```sh
npm start -- -c
npm start -- -r research-history
```

If reopening is refused, use `/open` and continue in Google, or select the intended conversation in Google's history and import it under a new name. A saved entry means the address was recorded; it does not guarantee Google will preserve that conversation identity later.

| Command | Action |
| --- | --- |
| `/open` | Bring a visible browser tab forward; headless mode prints restart instructions. |
| `/help` | Show available commands. |
| `/quit` or Ctrl-D | Save, close the AIM tab, and stop a managed browser. External servers stay running. |
| Ctrl-C | Stop waiting locally. Google may still be answering. |

During an answer, additional questions are rejected, not queued. After an interruption, retry once Google finishes; the tool checks that it is ready. A sign-in or consent message needs your attention in a visible browser (`--headed`). Sign-in detection has controlled checks, but the complete signed-out workflow remains unverified.

## Limits

- Exiting closes the conversation tab by default, including unfinished or unsaved conversations. Use an external visible browser with `--keep-tab` when the live tab must survive exit.
- Run **one aim process at a time**. This version does not have a process lock.
- Session addresses live in `$XDG_CONFIG_HOME/aim/sessions.json`, or `~/.config/aim/sessions.json`. Treat this file as private account data. Keep a copy before editing it; validation is still limited.
- Some citation chips hide additional sources. The tool prints links it can observe; it does not invent missing links.
- Browser markup can change. Live checks covered macOS, Chrome 153, and an English interface. Linux is untested.
- Use this as a personal tool. Compatibility with Google's terms has not been reviewed; this project does not claim otherwise.

## Checks

```sh
npm test
```

The suite uses Node's test runner, isolated temporary state, and installed Chrome for offline answer fixtures and disposable profiles for browser lifecycle checks. It does not use the signed-in browser. See the [limited-tool checks](docs/evidence/limited-tool-2026-09-21.md), [earlier verification](docs/evidence/M0-2026-09-21.md), and [restoration investigation](docs/evidence/restoration-feasibility-2026-09-21.md) for the live results and remaining limitations.
