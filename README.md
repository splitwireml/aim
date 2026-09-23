# AIM

A JavaScript/TypeScript SDK and CLI for Google AI Mode. Create a session, ask questions, and continue the conversation with follow-ups. Answers include Markdown and source citations.

Requires **Node.js 24 or later**, installed **Google Chrome**, and a Google account with AI Mode access. Chrome is not downloaded during installation. AIM controls a local browser; it is not an official Google API or a browser-side JavaScript library.

## Install and sign in

After publication to npm:

```sh
npm install aim-session-sdk
npx aim --headed
```

Sign into Google in the visible browser, then type `/quit` in the terminal. The SDK and CLI reuse that saved login. Use `npx aim --headed --max-tabs 2` if login needs a popup. The complete fresh-device sign-in workflow has not yet been verified end to end.

The default dedicated profile is `$XDG_CONFIG_HOME/aim/chrome` or `~/.config/aim/chrome`. To use another profile, set `AIM_PROFILE_DIR` for both sign-in and SDK usage. Do not point AIM at a profile already open in Chrome.

## SDK

```js
import { AimSession } from 'aim-session-sdk';

const session = await AimSession.create();
try {
  const answer = await session.ask('What is the capital of France?');
  console.log(answer.markdown);
  console.log(answer.citations); // [{ marker, title, url }]

  const followUp = await session.ask('What is its population?');
  console.log(followUp.markdown);
} finally {
  await session.close();
}
```

Each object owns one live conversation. Keep it open to retain context; SDK sessions cannot be reopened after closing and do not write the CLI session index. Await each question before asking another. `close()` is safe to repeat and supports `await using` through `Symbol.asyncDispose`.

TypeScript declarations are included. Use TypeScript 5.2 or later with Node module resolution (`NodeNext`), and include `ESNext.Disposable` in your `lib` settings when your target does not already include it.

### Options

`AimSession.create(options)` accepts:

| Option | Default | Purpose |
| --- | --- | --- |
| `profile` | `AIM_PROFILE_DIR` or the default above | Dedicated Chrome profile directory. |
| `headless` | `true` | Set `false` to display managed Chrome. |
| `executablePath` | `AIM_BROWSER_EXECUTABLE` or installed Chrome | Custom Chromium-compatible executable. |
| `maxTabs` | `AIM_MAX_TABS` or `1` | Total tab limit. |
| `cdpUrl` | `AIM_CDP_URL` | Attach to an existing browser on localhost. |
| `timeoutMs` | `120000` | Answer-wait timeout in milliseconds. |

`ask(question, { timeoutMs, signal })` supports a per-answer timeout and an `AbortSignal`. The timeout covers answer waiting; submission and readiness checks take additional time. Cancellation stops local waiting, so Google may continue generating. The next `ask()` checks readiness before submitting. Questions are never automatically retried.

`ask()` returns `{ markdown, citations, unresolved }` only after a complete answer. `unresolved` counts visible citation chips without an extractable source.

Import `AimError` and inspect `error.code` to handle `BUSY`, `ATTENTION`, `CONVERSATION_CHANGED`, `DELIVERY_UNCERTAIN`, `ABORTED`, `INCOMPLETE`, or `CLOSED`. Incomplete/interrupted answers may be available as `error.answer`. Invalid arguments throw `TypeError`; an already-aborted signal throws its abort reason. Browser and connection failures may also propagate.

Without `cdpUrl`, closing a session shuts down its managed browser. With `cdpUrl`, closing a session closes only its tab and disconnects, leaving the external browser and other tabs running. External browsers must already have room for a new tab; `maxTabs` counts existing tabs. Do not combine `cdpUrl` with managed profile/executable options or `headless: false`.

## CLI

```sh
npx aim                     # New conversation
npx aim --name research      # Named conversation
npx aim -c                  # Try continuing the last saved conversation
npx aim -r research         # Try continuing a named conversation
npx aim --help
```

Type a question and wait for the answer before asking a follow-up. `/help` shows commands, `/open` brings a visible tab forward, and `/quit` or Ctrl-D exits. Ctrl-C stops local waiting. If Google needs verification, quit and restart with `--headed` and the same profile.

To import a conversation, select it in Google's AI Mode history and copy its browser address:

```sh
npx aim --name saved --url 'PASTE_THE_GOOGLE_HISTORY_ADDRESS_HERE'
```

AIM removes the original query from the URL before navigation and verifies the conversation identity before accepting follow-ups. Reopening newly created conversations is unreliable because Google can change their identity; a saved address does not guarantee restoration. Imported history conversations passed live checks on one account, but reopening after a full Chrome restart remains unverified.

Use `--keep-tab` only with an external browser via `AIM_CDP_URL` if the live tab must survive CLI exit. CLI session addresses are stored in `$XDG_CONFIG_HOME/aim/sessions.json` or `~/.config/aim/sessions.json`; treat this as private account data.

## Limits

- Run one CLI process at a time. The CLI index has no process lock. Use distinct dedicated profiles for independent managed SDK sessions, and quit the CLI before using its profile in the SDK.
- Closing a session can interrupt an unfinished answer. There is no automatic sign-in, CAPTCHA solver, or query retry.
- Browser markup can change. Live checks covered macOS, Chrome 153, and an English interface. Linux and Windows remain unverified; automated SDK checks use offline browser fixtures.
- Some source chips hide additional links. AIM returns only sources it can observe.
- This is a personal tool. Compatibility with Google's terms has not been reviewed, and Google compatibility is not guaranteed.

## Develop and release

From a source checkout:

```sh
npm ci
npm test
npm pack --dry-run
```

The tests require installed Chrome and use disposable profiles and offline fixtures, not your signed-in browser. The npm package includes only the runtime, types, README, and package manifest. Detailed usage and historical browser evidence remain in the source checkout under `docs/`.

To publish from the source checkout, sign into npm with an account allowed to publish the package, then run `npm publish`. The `prepublishOnly` script runs the test suite before publishing. Publication is public; the name is not reserved until a successful publish. Version `0.1.0` is the initial release candidate.

## License

UNLICENSED. All rights reserved; no open-source license has been granted.
