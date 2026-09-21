# aim

A small terminal client for Google AI Mode. Ask questions, read answers with source links, and continue the conversation with follow-up questions.

This is the limited personal version requested on September 21, 2026. New conversations work while the tool is open. Reopening a newly created conversation is not reliable: Google can change its identity. The tool refuses an uncertain match rather than sending your question to a different conversation.

Conversations selected from Google's saved AI Mode history reopened with a stable identity in the live checks. You can import one using its browser address. This was tested on one account on macOS; reopening after a full Chrome restart remains unverified.

## Setup

Requires Node.js 24 and installed Google Chrome. From this directory:

```sh
npm ci
```

Start a dedicated Chrome profile with local debugging enabled. On macOS:

```sh
open -na "Google Chrome" --args \
  --user-data-dir="$HOME/.aim-chrome-profile" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 --no-first-run
```

Sign in to the Google account you want to use in that window. If this dedicated profile is already open without debugging, close only that profile and start it again with the command above. The tool attaches to Chrome; it does not launch or close it.

Use this profile only for the needed account. Any local process with access to the debugging port can control its signed-in browser session. Keep the endpoint on localhost. `AIM_CDP_URL` can select another localhost endpoint.

## Use

Start a new conversation:

```sh
npm start
# Optional name:
npm start -- --name research
```

Type your question, press Enter, and wait for the answer before asking a follow-up.

To continue a conversation already in Google's history:

1. In the dedicated Chrome window, open AI Mode history and select the conversation.
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
| `/open` | Bring the conversation's Chrome tab to the front. |
| `/help` | Show available commands. |
| `/quit` or Ctrl-D | Exit and leave Chrome open. |
| Ctrl-C | Stop waiting locally. Google may still be answering. |

During an answer, additional questions are rejected, not queued. After an interruption, retry once Google finishes; the tool checks that it is ready. A sign-in or consent message needs your attention in Chrome. Sign-in detection has controlled checks, but the complete signed-out workflow remains unverified.

## Limits

- Run **one aim process at a time**. This version does not have a process lock.
- Session addresses live in `$XDG_CONFIG_HOME/aim/sessions.json`, or `~/.config/aim/sessions.json`. Treat this file as private account data. Keep a copy before editing it; validation is still limited.
- Some citation chips hide additional sources. The tool prints links it can observe; it does not invent missing links.
- Browser markup can change. Live checks covered macOS, Chrome 153, and an English interface. Linux is untested.
- Use this as a personal tool. Compatibility with Google's terms has not been reviewed; this project does not claim otherwise.

## Checks

```sh
npm test
```

The suite uses Node's test runner, isolated temporary state, and installed Chrome for offline answer fixtures. It does not use the signed-in browser. See the [limited-tool checks](docs/evidence/limited-tool-2026-09-21.md), [earlier verification](docs/evidence/M0-2026-09-21.md), and [restoration investigation](docs/evidence/restoration-feasibility-2026-09-21.md) for the live results and remaining limitations.
