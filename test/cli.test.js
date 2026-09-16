import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fake playwright-core: real src/page.js runs against a stubbed page. STUB_RESOLVE is the URL a stored URL resolves to
// (its mtid is the thread Google shows); STUB_TURNS are the turns shown. Prints "STUB sent" if a prompt is submitted.
// STUB_SENT_URL is the page URL after the first send; STUB_EARLY_ID is the early data-session-thread-id.
const pwSrc = `const say = (s) => process.stdout.write('STUB ' + s + '\\n');
const turns = JSON.parse(process.env.STUB_TURNS);
let url = 'about:blank', loaded = false;
const page = {
  on() {}, bringToFront: async () => {}, waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)), url: () => url,
  goto: async (u) => { if (u.includes('q=')) { say('sent'); url = process.env.STUB_SENT_URL || u; } else url = process.env.STUB_RESOLVE; loaded = true; },
  evaluate: async (x) => (typeof x === 'function' ? false : loaded ? turns : null),
  evaluateHandle: async () => { say('extracted'); return { asElement: () => null }; },
  locator: (sel) => ({ first() { return this; }, isVisible: async () => true, fill: async () => say('sent'), press: async () => {},
    getAttribute: async () => (loaded && (/session-thread-id/.test(sel) ? process.env.STUB_EARLY_ID : /thread-id/.test(sel) && new URL(url).searchParams.get('mtid'))) || null }),
};
export const chromium = { connectOverCDP: async () => ({ on() {}, contexts: () => [{ newPage: async () => page }] }) };`;
const pwHook = `data:text/javascript,${encodeURIComponent(`import { registerHooks } from 'node:module';
registerHooks({ resolve: (s, c, next) => s === 'playwright-core' ? { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(pwSrc)}`)}, shortCircuit: true } : next(s, c) });`)}`;

const BLOCKED = '[session cannot be continued in Google — see AI Mode history, /open]';
const gurl = (mstk, mtid) => `https://www.google.com/search?udm=50&mstk=${mstk}&mtid=${mtid}&csuir=1`;
const A = gurl('AUtExfAAAAAAAAAAAAAAAAAAAAA', 'threadAAAAAAAA'), B = gurl('AUtExfBBBBBBBBBBBBBBBBBBBBB', 'threadBBBBBBBB');

// Runs aim with the fake page; types `line`, ends stdin once `done(out)` holds (or after 20 s).
async function runAim(args, { index, resolve = '', turns, line, done, env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-cli-'));
  const file = path.join(dir, 'aim', 'sessions.json');
  if (index) { fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, index); }
  const child = spawn(process.execPath, ['--import', pwHook, new URL('../bin/aim.js', import.meta.url).pathname, ...args],
    { env: { ...process.env, ...env, XDG_CONFIG_HOME: dir, STUB_RESOLVE: resolve, STUB_TURNS: JSON.stringify(turns) } });
  let out = '', ended = false;
  const end = () => { if (!ended) { ended = true; child.stdin.end(); } };
  const timer = setTimeout(end, 20000);
  child.stdout.on('data', (d) => { out += d; if (done(out)) setTimeout(end, 300); });
  child.stdin.write(line + '\n');
  const code = await new Promise((r) => child.on('exit', r));
  clearTimeout(timer);
  return { code, out, index: fs.existsSync(file) ? fs.readFileSync(file) : null };
}

test('cli: resume is blocked when the page resolves to another thread with the same first prompt', async () => {
  const q = 'Same first question';
  for (const stored of [A, gurl('AUtExfAAAAAAAAAAAAAAAAAAAAA', 'provisionalAAAA')]) { // final and provisional entry A
    const index = Buffer.from(JSON.stringify({ version: 1, last: 'a', sessions: {
      a: { url: stored, createdAt: 'x', lastUsedAt: 'x', firstPrompt: q },
      b: { url: B, createdAt: 'x', lastUsedAt: 'x', firstPrompt: q } } }, null, 2) + '\n');
    const r = await runAim(['-r', 'a'], { index, resolve: B, turns: [{ query: q, text: 'b', signal: true }], line: 'must not be sent',
      done: (o) => o.includes('STUB sent') || o.split(BLOCKED).length > 2 });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.split(BLOCKED).length, 3, `blocked on resume and on the prompt:\n${r.out}`);
    assert.ok(!r.out.includes('STUB sent'), 'nothing sent');
    assert.ok(r.index.equals(index), 'index byte-identical');
  }
});

test('cli: resume is accepted when the page resolves to the stored thread', async () => {
  const q = 'Same first question';
  const index = JSON.stringify({ version: 1, last: 'a', sessions: { a: { url: A, createdAt: 'x', lastUsedAt: 'x', firstPrompt: q } } });
  const r = await runAim(['-r', 'a'], { index, resolve: A, turns: [{ query: q, text: 'a', signal: true }], line: 'follow-up',
    done: (o) => o.includes('STUB sent') || o.includes(BLOCKED) });
  assert.ok(r.out.includes('STUB sent') && !r.out.includes(BLOCKED), r.out);
  assert.equal(JSON.parse(r.index).sessions.a.url, A);
});

test('cli: quit before Google puts the final mtid in the URL saves nothing (early thread id is never used)', async () => {
  const index = Buffer.from(JSON.stringify({ version: 1, last: 'a', sessions: { a: { url: A, createdAt: 'x', lastUsedAt: 'x', firstPrompt: 'q' } } }, null, 2) + '\n');
  const r = await runAim(['--name', 's'], { index, turns: [{ query: 'hello', text: '', signal: false }], line: 'hello',
    env: { STUB_SENT_URL: 'https://www.google.com/search?udm=50&mstk=AUtExfSSSSSSSSSSSSSSSSSSSSS&csuir=1', STUB_EARLY_ID: 'earlySESSIONidAA' },
    done: (o) => o.includes('[waiting for Google to assign a conversation URL]') });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes('STUB sent'), r.out);
  assert.ok(r.out.includes('[this conversation is not saved yet]') && !r.out.includes('saved]'), `unsaved warning expected:\n${r.out}`);
  assert.ok(r.index.equals(index), 'no new entry; existing entries byte-identical');
});

test('cli: completion signal with a null extraction is reported incomplete, not silently idle', async () => {
  const r = await runAim(['--name', 'n'], { turns: [{ query: 'hello', text: 'answer', signal: true }], line: 'hello',
    done: (o) => o.includes('STUB extracted') });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes('STUB extracted'), r.out);
  assert.ok(r.out.includes('[incomplete — run /open]'), `visible recovery message expected:\n${r.out}`);
});
