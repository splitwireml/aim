#!/usr/bin/env node
// T1 probe entry: aim "<question>" ["<follow-up>" ...]. The REPL, sessions and lock arrive in T4/T5.
import { connect, openConversation, send, waitForTurn, ConnectError } from '../src/page.js';

// Strip ANSI/OSC escapes and C0/C1 controls except \n and \t (FR-3.10).
const clean = (s) => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

const prompts = process.argv.slice(2);
if (!prompts.length) { console.error('usage: aim "<question>" ["<follow-up>" ...]'); process.exit(1); }

let context;
try { ({ context } = await connect()); } catch (e) {
  if (!(e instanceof ConnectError)) throw e;
  console.error(`${e.message}\nStart the dedicated Chrome profile with --remote-debugging-port=9222 (or set AIM_CDP_URL).`);
  process.exit(2);
}
const page = await openConversation(context);
for (const text of prompts) {
  const t0 = Date.now();
  const { turnId, delivered } = await send(page, text);
  if (delivered !== 'yes') { console.log('[delivery uncertain — check with /open]'); process.exit(0); }
  const t1 = Date.now();
  const { status, answer } = await waitForTurn(page, turnId, { timeoutMs: Number(process.env.AIM_TURN_TIMEOUT_MS) || 120000 });
  console.error(`[turn ${turnId.index}: delivered ${t1 - t0} ms, ${status} after ${Date.now() - t1} ms]`);
  if (answer) {
    console.log(clean(answer.markdown));
    if (answer.citations.length) console.log('\nSources\n' + answer.citations.map((c) => clean(`[${c.marker}] ${c.title} — ${c.url}`)).join('\n'));
  }
  if (status !== 'complete') { console.log('[incomplete — run /open]'); process.exit(0); }
  console.log();
}
process.exit(0); // detach only; Chrome and the tab stay open (FR-6.2)
