#!/usr/bin/env node
// Limited personal CLI: named sessions, verified history import, REPL and pending/recovery.
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from '../src/page.js';

// Strip ANSI/OSC escapes and C0/C1 controls except \n and \t (FR-3.10).
const clean = (s) => String(s).replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const say = (s) => process.stdout.write(s + '\n');
const HELP = 'commands: /open /quit /help (Ctrl-D quits; Ctrl-C stops waiting locally)';
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// ponytail: no lock and shallow index validation; these limits are documented for this single-instance personal tool.
const indexPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'aim', 'sessions.json');
function loadIndex() {
  let raw;
  try { raw = fs.readFileSync(indexPath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { version: 1, last: null, sessions: {} }; throw e; }
  let idx;
  try { idx = JSON.parse(raw); } catch (e) { console.error(`corrupt session index ${indexPath}: ${e.message}`); process.exit(3); }
  if (idx?.version !== 1 || typeof idx.sessions !== 'object' || !idx.sessions) { console.error(`corrupt session index ${indexPath}: unsupported shape`); process.exit(3); }
  return idx;
}
function saveIndex(idx) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2) + '\n');
  fs.renameSync(tmp, indexPath);
}

const { values } = parseArgs({ options: { name: { type: 'string' }, url: { type: 'string' }, continue: { type: 'boolean', short: 'c' }, resume: { type: 'string', short: 'r' }, help: { type: 'boolean' }, headed: { type: 'boolean' }, profile: { type: 'string' }, 'max-tabs': { type: 'string' }, 'keep-tab': { type: 'boolean' } } });
if (values.help) { say("usage: aim [--name <name>] | --url <google-history-url> [--name <name>] | -c | -r <name>\nbrowser: headless by default; --headed --profile <directory> --max-tabs <n> (default 1)\nexternal browser: AIM_CDP_URL=<localhost URL>; --keep-tab preserves its conversation tab on exit\nimport: aim --url 'https://www.google.com/search?udm=50&mstk=…&mtid=…' [--name <name>]\n" + HELP); process.exit(0); }
let maxTabs;
try { maxTabs = P.tabLimit(values['max-tabs'] ?? process.env.AIM_MAX_TABS ?? 1); }
catch (e) { console.error(e.message); process.exit(1); }
const importing = values.url !== undefined;
if (importing && (values.continue || values.resume)) { console.error('--url cannot be combined with --continue or --resume'); process.exit(1); }
const importUrl = importing ? P.toConversationUrl(values.url) : null;
if (importing && !importUrl) { console.error('invalid Google AI Mode conversation URL'); process.exit(1); }

const index = loadIndex();
let name = values.resume ?? (values.continue ? index.last : values.name);
const resuming = Boolean(values.resume || values.continue);
if (resuming && !index.sessions[name]) { console.error(values.continue ? 'no session to continue' : `unknown session: ${name}`); process.exit(1); }
if (!resuming) {
  if (name && index.sessions[name]) { console.error(`session already exists: ${name}`); process.exit(1); }
  if (name && !NAME.test(name)) { console.error(`invalid session name: ${name}`); process.exit(1); }
  if (!name) {
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const base = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    name = base;
    for (let i = 2; index.sessions[name]; i++) name = `${base}-${i}`;
  }
}
const expectedUrl = resuming ? index.sessions[name].url : importUrl;

const cdp = process.env.AIM_CDP_URL;
if (values['keep-tab'] && !cdp) { console.error('--keep-tab requires an external browser via AIM_CDP_URL'); process.exit(1); }
const profile = path.resolve(values.profile || process.env.AIM_PROFILE_DIR || path.join(path.dirname(indexPath), 'chrome'));
if (cdp && (values.headed || values.profile || process.env.AIM_PROFILE_DIR || process.env.AIM_BROWSER_EXECUTABLE)) {
  console.error('Unset AIM_CDP_URL to use managed browser/profile options.'); process.exit(1);
}
let browser, context, page;
try {
  ({ browser, context } = cdp ? await P.connect(cdp) : await P.launch({ profile, headless: !values.headed, maxTabs, executablePath: process.env.AIM_BROWSER_EXECUTABLE }));
  page = await P.openConversation(context, expectedUrl || (!cdp && values.headed ? 'https://www.google.com/search?udm=50' : undefined), { maxTabs, reuseBlank: !cdp });
} catch (e) {
  if (!cdp) await context?.close().catch(() => {});
  console.error(`${clean(e.message)}\n${cdp ? 'Check the dedicated localhost CDP browser and --max-tabs.' : 'Install Google Chrome (or set AIM_BROWSER_EXECUTABLE); use --headed to sign in. Close any other browser using this AIM profile.'}`);
  process.exit(2);
}
say(`aim: session ${name} (${resuming ? 'resumed' : importing ? 'import' : 'new'}) via ${cdp || (values.headed ? 'managed browser (visible)' : 'managed browser (headless)')}; max tabs ${maxTabs}`);
if (!resuming && !importing) say('[warning: reopening this session may be unavailable; import its Google AI Mode history URL with --url]');

let state = 'idle'; // idle | pending | recovery
let saved = resuming;
let canSave = !expectedUrl; // restored/imported tabs are saved only after checkWritable says writable (FR-4.4)
let shown = null; // markdown last printed
let abort = null;
let quitting = false;

const recover = (msg) => { state = 'recovery'; say(msg); };
const disconnected = () => { if (!quitting) recover(`[Browser tab closed / browser disconnected — /quit, then aim -r ${name}]`); };
page.on('close', disconnected);
browser.on('disconnected', disconnected);

// Serialized: a ticker save in flight must not turn /quit's or turn-end's save into a no-op (seen live in T2 run s1).
let inflight = null;
async function saveUrl({ skipIfBusy = false } = {}) {
  if (inflight && skipIfBusy) return;
  while (inflight) await inflight;
  inflight = doSave().finally(() => { inflight = null; });
  return inflight;
}
async function doSave() {
  if (!canSave) return;
  const cur = index.sessions[name];
  const url = await P.conversationUrl(page, cur?.url ?? expectedUrl).catch(() => null); // final URL only (null until Google assigns mtid)
  if (!url) return;
  const now = new Date().toISOString();
  if (cur?.url === url) return;
  index.sessions[name] = { url, createdAt: cur?.createdAt ?? now, lastUsedAt: now };
  index.last = name;
  saveIndex(index);
  if (!saved) say(`[session ${name} saved]`);
  saved = true;
}

function print(answer) {
  if (!answer) return;
  shown = answer.markdown;
  say(clean(answer.markdown));
  if (answer.citations.length) say('\nSources\n' + answer.citations.map((c) => clean(`[${c.marker}] ${c.title} — ${c.url}`)).join('\n'));
}

if (expectedUrl) {
  const entry = index.sessions[name];
  const r = await P.checkWritable(page, expectedUrl, { firstPrompt: entry?.firstPrompt });
  if (r === 'attention') recover('[needs attention — run /open]');
  else if (r !== 'writable') { say('[session cannot be continued in Google — see AI Mode history, /open]'); state = 'blocked'; }
  else {
    canSave = true;
    if (entry) {
      entry.lastUsedAt = new Date().toISOString();
      index.last = name;
      saveIndex(index);
    }
    await saveUrl();
    const pending = await P.reconcile(page);
    if (pending === 'attention') recover('[needs attention — run /open]');
    else if (pending === 'generating') recover('[Google is still answering — wait or /open]');
  }
}

async function turn(text) {
  let checked = false;
  if (state === 'blocked') return say('[session cannot be continued in Google — see AI Mode history, /open]');
  if (state === 'recovery') {
    state = 'pending'; // no second prompt while reconciling
    const r = await P.reconcile(page).catch(() => 'generating');
    if (r !== 'idle') { state = 'recovery'; return say(r === 'attention' ? '[needs attention — run /open]' : '[Google is still answering — wait or /open]'); }
    const entry = index.sessions[name];
    const expected = entry?.url ?? expectedUrl;
    if (expected) {
      const writable = await P.checkWritable(page, expected, { firstPrompt: entry?.firstPrompt });
      if (writable === 'attention') return recover('[needs attention — run /open]');
      if (writable !== 'writable') { state = 'blocked'; return say('[session cannot be continued in Google — see AI Mode history, /open]'); }
      if (!canSave) {
        canSave = true;
        if (entry) {
          entry.lastUsedAt = new Date().toISOString();
          index.last = name;
          saveIndex(index);
        }
        await saveUrl();
      }
      checked = true;
    }
    const latest = await P.latestAnswer(page);
    if (latest && latest.markdown !== shown) print(latest);
    state = 'idle';
  }
  state = 'pending';
  const entry = index.sessions[name];
  const expected = entry?.url ?? expectedUrl;
  if (expected && !checked) {
    const r = await P.checkWritable(page, expected, { firstPrompt: entry?.firstPrompt });
    if (r === 'attention') return recover('[needs attention — run /open]');
    if (r !== 'writable') { state = 'blocked'; return say('[session cannot be continued in Google — see AI Mode history, /open]'); }
  }
  const { turnId, delivered } = await P.send(page, text);
  if (delivered !== 'yes') { await saveUrl(); return recover('[delivery uncertain — check with /open]'); }
  if (!saved) say('[waiting for Google to assign a conversation URL]');
  abort = new AbortController();
  const { status, answer } = await P.waitForTurn(page, turnId, { timeoutMs: Number(process.env.AIM_TURN_TIMEOUT_MS) || 120000, signal: abort.signal });
  const interrupted = abort.signal.aborted;
  abort = null;
  await saveUrl();
  if (saved) { index.sessions[name].lastUsedAt = new Date().toISOString(); index.last = name; saveIndex(index); }
  if (status === 'complete') { print(answer); state = 'idle'; return; }
  if (answer && !interrupted) print(answer);
  if (await P.detectAttention(page).catch(() => false)) return recover('[needs attention — run /open]');
  recover(interrupted ? '[stopped waiting locally — Google may still be answering; prompts resume when it is idle]' : '[incomplete — run /open]');
}

// Save early (FR-4.2): the URL can appear after a timeout or Ctrl-C, so poll for the whole process, not per turn.
const ticker = setInterval(() => saveUrl({ skipIfBusy: true }), 250);

async function quit() {
  if (quitting) return;
  quitting = true;
  clearInterval(ticker);
  try {
    await saveUrl();
    if (!saved) say('[this conversation is not saved yet]');
  } catch (e) {
    // Keep the live conversation available when recording it failed.
    quitting = false;
    console.error(`[could not save session: ${clean(e.message)}; browser left open]`);
    return;
  }
  if ((!cdp || !values['keep-tab']) && (state === 'pending' || state === 'recovery')) say('[closing the conversation tab; an unfinished answer may be interrupted]');
  try {
    if (!cdp) await context.close();
    else if (!values['keep-tab']) await page.close();
  } catch (e) { console.error(`[browser cleanup failed: ${clean(e.message)}]`); process.exit(2); }
  process.exit(0); // Never close an externally owned browser or its other tabs.
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const onInterrupt = () => { if (abort) abort.abort(); else say('[use /quit or Ctrl-D to exit]'); };
rl.on('SIGINT', onInterrupt);
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', quit);
rl.on('close', quit);
rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  if (text === '/quit') return quit();
  if (text === '/help') return say(HELP);
  if (text === '/open') {
    if (!cdp && !values.headed) return say('[headless browser: /quit, then restart with --headed and the same profile; import from Google history if resume fails]');
    return page.bringToFront().catch(() => say('[tab unavailable]'));
  }
  if (text.startsWith('/')) return say(`[unknown command: ${clean(text.split(/\s/)[0])}]`);
  if (state === 'pending') return say('[waiting for answer]');
  try { await turn(text); } catch (e) { recover(`[error: ${clean(e.message.split('\n')[0])} — /open]`); }
});
