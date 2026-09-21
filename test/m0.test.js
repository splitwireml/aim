import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pwSrc = `const say = (s) => process.stdout.write('STUB ' + s + '\\n');
let url = 'about:blank', turns = null, input = '', firstAt = 0, openedAt = 0;
const currentUrl = () => process.env.STUB_AFTER_URL && Date.now() - openedAt >= Number(process.env.STUB_SWITCH_MS || 0) ? process.env.STUB_AFTER_URL : url;
const shownTurns = () => turns && turns.map((turn, i) => ({ ...turn, signal: i ? turn.signal : Date.now() - firstAt >= Number(process.env.STUB_GENERATE_MS || 500) }));
const page = {
  on() {}, bringToFront: async () => {}, waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)), url: currentUrl,
  goto: async (u) => {
    if (u.includes('q=')) {
      const query = new URL(u).searchParams.get('q');
      turns = [{ query, text: 'first answer', signal: false }];
      firstAt = Date.now();
      url = u;
      say('sent ' + query);
    } else {
      url = process.env.STUB_ATTENTION_URL || process.env.STUB_RESOLVE_URL || u;
      turns = process.env.STUB_TURNS ? JSON.parse(process.env.STUB_TURNS) : turns;
      openedAt = Date.now();
      firstAt = openedAt;
    }
  },
  evaluate: async (x) => typeof x === 'function' ? false : shownTurns(),
  evaluateHandle: async () => ({ asElement: () => ({ evaluate: async () => ({ markdown: 'first answer', citations: [], unresolved: 0 }) }) }),
  locator: () => ({
    first() { return this; }, isVisible: async () => true,
    getAttribute: async () => { try { return new URL(currentUrl()).searchParams.get('mtid'); } catch { return null; } },
    fill: async (text) => { input = text; },
    press: async () => { turns.push({ query: input, text: '', signal: false }); say('sent ' + input); },
  }),
};
export const chromium = { connectOverCDP: async () => { say('connected'); return { on() {}, contexts: () => [{ newPage: async () => page }] }; } };`;
const pwHook = `data:text/javascript,${encodeURIComponent(`import { registerHooks } from 'node:module';
registerHooks({ resolve: (s, c, next) => s === 'playwright-core' ? { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(pwSrc)}`)}, shortCircuit: true } : next(s, c) });`)}`;
const cli = new URL('../bin/aim.js', import.meta.url).pathname;
const gurl = 'https://www.google.com/search?udm=50&mstk=AUtExfAAAAAAAAAAAAAAAAAAAAA&mtid=threadAAAAAAAA&csuir=1';

function start(args, env = {}, index = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-m0-'));
  const file = path.join(dir, 'aim', 'sessions.json');
  if (index !== null) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, index); }
  const child = spawn(process.execPath, ['--import', pwHook, cli, ...args], {
    env: { ...process.env, ...env, XDG_CONFIG_HOME: dir },
  });
  return { child, dir, file };
}

async function finish(child, act, timeoutMs = 5000, expectedCode = 0) {
  let out = '', err = '', timedOut = false;
  child.stdout.on('data', (data) => { out += data; act(out, child); });
  child.stderr.on('data', (data) => { err += data; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  clearTimeout(timer);
  assert.equal(timedOut, false, `CLI timed out:\n${out}${err}`);
  assert.equal(code, expectedCode, err || out);
  return out + err;
}

for (const attentionUrl of ['https://accounts.google.com/v3/signin', 'https://consent.google.com/m']) {
  test(`CLI reports attention and never submits on ${new URL(attentionUrl).hostname}`, async () => {
    const index = JSON.stringify({ version: 1, last: 'saved', sessions: {
      saved: { url: gurl, createdAt: '2026-09-21T00:00:00.000Z', lastUsedAt: '2026-09-21T00:00:00.000Z' },
    } }, null, 2) + '\n';
    const { child, dir, file } = start(['-r', 'saved'], { STUB_ATTENTION_URL: attentionUrl }, index);
    let prompted = false, ended = false;
    const out = await finish(child, (text) => {
      const count = text.split('[needs attention — run /open]').length - 1;
      if (count === 1 && !prompted) { prompted = true; child.stdin.write('must not be sent\n'); }
      if (count === 2 && !ended) { ended = true; child.stdin.end(); }
    });
    assert.equal(out.split('[needs attention — run /open]').length - 1, 2, out);
    assert.doesNotMatch(out, /STUB sent/);
    assert.equal(fs.readFileSync(file, 'utf8'), index, 'attention must not rewrite the saved session');
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('interrupted turn rejects overlapping and still-generating prompts without replay, then sends once after idle', async () => {
  const { child, dir } = start(['--name', 'recover'], { STUB_GENERATE_MS: '500' });
  let overlapped = false, interrupted = false, retried = false, scheduled = false, ended = false;
  child.stdin.write('first\n');
  const out = await finish(child, (text) => {
    if (text.includes('STUB sent first') && !overlapped) { overlapped = true; child.stdin.write('overlap\n'); }
    if (text.includes('[waiting for answer]') && !interrupted) { interrupted = true; child.kill('SIGINT'); }
    if (text.includes('[stopped waiting locally') && !retried) { retried = true; child.stdin.write('during-generation\n'); }
    if (text.includes('[Google is still answering') && !scheduled) {
      scheduled = true;
      setTimeout(() => child.stdin.write('accepted\n'), 550);
    }
    if (text.includes('STUB sent accepted') && !ended) { ended = true; child.stdin.end(); }
  });
  assert.match(out, /\[waiting for answer\]/);
  assert.match(out, /\[Google is still answering — wait or \/open\]/);
  assert.match(out, /\[warning: reopening this session may be unavailable;/);
  assert.deepEqual(out.match(/^STUB sent .*$/gm), ['STUB sent first', 'STUB sent accepted'], out);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sign-in recovery rejects a different conversation before submitting', async () => {
  const other = gurl.replaceAll('A', 'B');
  const index = JSON.stringify({ version: 1, last: 'saved', sessions: {
    saved: { url: gurl, createdAt: '2026-09-21T00:00:00.000Z', lastUsedAt: '2026-09-21T00:00:00.000Z' },
  } }, null, 2) + '\n';
  const { child, dir, file } = start(['-r', 'saved'], {
    STUB_ATTENTION_URL: 'https://accounts.google.com/v3/signin',
    STUB_AFTER_URL: other,
    STUB_SWITCH_MS: '100',
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'old answer', signal: true }]),
  }, index);
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('[needs attention — run /open]') && !prompted) {
      prompted = true;
      setTimeout(() => child.stdin.write('must not be sent\n'), 120);
    }
    if ((text.includes('STUB sent') || text.includes('[session cannot be continued')) && !ended) {
      ended = true;
      child.stdin.end();
    }
  });
  assert.match(out, /\[session cannot be continued in Google — see AI Mode history, \/open\]/);
  assert.doesNotMatch(out, /STUB sent/);
  assert.doesNotMatch(out, /first answer/, 'an unverified conversation must not be printed');
  assert.equal(fs.readFileSync(file, 'utf8'), index);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('successful sign-in recovery completes resume metadata before submitting', async () => {
  const refreshed = gurl.replace('AUtExfAAAAAAAAAAAAAAAAAAAAA', 'AUtExfCCCCCCCCCCCCCCCCCCCCC');
  const before = '2026-09-21T00:00:00.000Z';
  const index = JSON.stringify({ version: 1, last: 'saved', sessions: {
    saved: { url: gurl, createdAt: before, lastUsedAt: before },
  } }, null, 2) + '\n';
  const { child, dir, file } = start(['-r', 'saved'], {
    STUB_ATTENTION_URL: 'https://accounts.google.com/v3/signin',
    STUB_AFTER_URL: refreshed,
    STUB_SWITCH_MS: '100',
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'old answer', signal: true }]),
  }, index);
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('[needs attention — run /open]') && !prompted) {
      prompted = true;
      setTimeout(() => child.stdin.write('accepted\n'), 120);
    }
    if (text.includes('STUB sent accepted') && !ended) { ended = true; child.stdin.end(); }
  });
  assert.deepEqual(out.match(/^STUB sent .*$/gm), ['STUB sent accepted'], out);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.last, 'saved');
  assert.equal(saved.sessions.saved.url, refreshed);
  assert.notEqual(saved.sessions.saved.lastUsedAt, before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a resumed session neither submits nor overwrites its URL after the tab changes conversation', async () => {
  const other = gurl.replaceAll('A', 'B');
  const index = JSON.stringify({ version: 1, last: 'saved', sessions: {
    saved: { url: gurl, createdAt: '2026-09-21T00:00:00.000Z', lastUsedAt: '2026-09-21T00:00:00.000Z' },
  } }, null, 2) + '\n';
  const { child, dir, file } = start(['-r', 'saved'], {
    STUB_RESOLVE_URL: gurl,
    STUB_AFTER_URL: other,
    STUB_SWITCH_MS: '150',
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'old answer', signal: true }]),
  }, index);
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('(resumed)') && !prompted) {
      prompted = true;
      setTimeout(() => child.stdin.write('must not be sent\n'), 300);
    }
    if ((text.includes('STUB sent') || text.includes('[session cannot be continued')) && !ended) {
      ended = true;
      setTimeout(() => child.stdin.end(), 300);
    }
  });
  assert.match(out, /\[session cannot be continued in Google — see AI Mode history, \/open\]/);
  assert.doesNotMatch(out, /STUB sent/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.saved.url, gurl);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resume with an unfinished turn rejects prompts until generation becomes idle', async () => {
  const index = JSON.stringify({ version: 1, last: 'saved', sessions: {
    saved: { url: gurl, createdAt: '2026-09-21T00:00:00.000Z', lastUsedAt: '2026-09-21T00:00:00.000Z' },
  } }, null, 2) + '\n';
  const { child, dir } = start(['-r', 'saved'], {
    STUB_RESOLVE_URL: gurl,
    STUB_GENERATE_MS: '500',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'partial answer', signal: false }]),
  }, index);
  let tried = false, scheduled = false, ended = false;
  const out = await finish(child, (text) => {
    const waiting = text.split('[Google is still answering — wait or /open]').length - 1;
    if (text.includes('(resumed)') && !tried) { tried = true; setTimeout(() => child.stdin.write('during-generation\n'), 80); }
    if (waiting === 2 && !scheduled) {
      scheduled = true;
      setTimeout(() => child.stdin.write('accepted\n'), 550);
    }
    if ((text.includes('STUB sent during-generation') || text.includes('STUB sent accepted')) && !ended) {
      ended = true;
      child.stdin.end();
    }
  });
  assert.equal(out.split('[Google is still answering — wait or /open]').length - 1, 2, out);
  assert.deepEqual(out.match(/^STUB sent .*$/gm), ['STUB sent accepted'], out);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ticker accepts a refreshed URL token only when the confirmed thread id is unchanged', async () => {
  const refreshed = gurl.replace('AUtExfAAAAAAAAAAAAAAAAAAAAA', 'AUtExfCCCCCCCCCCCCCCCCCCCCC');
  const index = JSON.stringify({ version: 1, last: 'saved', sessions: {
    saved: { url: gurl, createdAt: '2026-09-21T00:00:00.000Z', lastUsedAt: '2026-09-21T00:00:00.000Z' },
  } }, null, 2) + '\n';
  const { child, dir, file } = start(['-r', 'saved'], {
    STUB_RESOLVE_URL: gurl,
    STUB_AFTER_URL: refreshed,
    STUB_SWITCH_MS: '150',
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'old answer', signal: true }]),
  }, index);
  let ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('(resumed)') && !ended) {
      ended = true;
      setTimeout(() => child.stdin.end(), 500);
    }
  });
  assert.doesNotMatch(out, /session cannot be continued/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.saved.url, refreshed);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('imports a verified native-history URL under a generated name without replaying its q parameter', async () => {
  const supplied = gurl + '&q=must-not-replay';
  const { child, dir, file } = start(['--url', supplied], {
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'old answer', signal: true }]),
  });
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (/\[session .* saved\]/.test(text) && !prompted) { prompted = true; child.stdin.write('continue here\n'); }
    if (text.includes('STUB sent continue here') && !ended) { ended = true; child.stdin.end(); }
  });
  assert.deepEqual(out.match(/^STUB sent .*$/gm), ['STUB sent continue here'], out);
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.match(index.last, /^\d{8}-\d{4}$/);
  assert.equal(index.sessions[index.last].url, gurl);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import mismatch blocks without submitting or changing the existing index', async () => {
  const other = gurl.replaceAll('A', 'B');
  const index = JSON.stringify({ version: 1, last: 'existing', sessions: {
    existing: { url: other, createdAt: '2026-09-21T00:00:00.000Z', lastUsedAt: '2026-09-21T00:00:00.000Z' },
  } }, null, 2) + '\n';
  const { child, dir, file } = start(['--url', gurl, '--name', 'candidate'], {
    STUB_RESOLVE_URL: other,
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'other question', text: 'other answer', signal: true }]),
  }, index);
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('[session cannot be continued') && !prompted) { prompted = true; child.stdin.write('must not be sent\n'); }
    if (text.split('[session cannot be continued').length === 3 && !ended) { ended = true; child.stdin.end(); }
  });
  assert.doesNotMatch(out, /STUB sent|other answer/);
  assert.equal(fs.readFileSync(file, 'utf8'), index);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import attention persists only after the expected conversation is verified', async () => {
  const { child, dir, file } = start(['--url', gurl, '--name', 'imported'], {
    STUB_ATTENTION_URL: 'https://accounts.google.com/v3/signin',
    STUB_AFTER_URL: gurl,
    STUB_SWITCH_MS: '100',
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'old question', text: 'old answer', signal: true }]),
  });
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('[needs attention — run /open]') && !prompted) {
      assert.equal(fs.existsSync(file), false, 'attention must not persist an unverified import');
      prompted = true;
      setTimeout(() => child.stdin.write('continue here\n'), 120);
    }
    if (text.includes('STUB sent continue here') && !ended) { ended = true; child.stdin.end(); }
  });
  assert.deepEqual(out.match(/^STUB sent .*$/gm), ['STUB sent continue here'], out);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.imported.url, gurl);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import attention followed by a different conversation remains unsaved and blocked', async () => {
  const other = gurl.replaceAll('A', 'B');
  const { child, dir, file } = start(['--url', gurl, '--name', 'candidate'], {
    STUB_ATTENTION_URL: 'https://accounts.google.com/v3/signin',
    STUB_AFTER_URL: other,
    STUB_SWITCH_MS: '100',
    STUB_GENERATE_MS: '0',
    STUB_TURNS: JSON.stringify([{ query: 'other question', text: 'other answer', signal: true }]),
  });
  let prompted = false, ended = false;
  const out = await finish(child, (text) => {
    if (text.includes('[needs attention — run /open]') && !prompted) {
      prompted = true;
      setTimeout(() => child.stdin.write('must not be sent\n'), 120);
    }
    if (text.includes('[session cannot be continued') && !ended) { ended = true; child.stdin.end(); }
  });
  assert.doesNotMatch(out, /STUB sent|other answer/);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('invalid or conflicting imports are rejected before browser connection', async () => {
  for (const args of [
    ['--url', gurl.replace('https:', 'http:')],
    ['--url', gurl.replace('/search?', '/not-search?')],
    ['--url', gurl.replace('www.google.com', 'www.google.com:444')],
    ['--url', gurl.replace('https://', 'https://user:pass@')],
    ['--url', gurl, '-c'],
    ['--url', gurl, '-r', 'saved'],
  ]) {
    const { child, dir, file } = start(args);
    const out = await finish(child, () => {}, 5000, 1);
    assert.doesNotMatch(out, /STUB connected/);
    assert.equal(fs.existsSync(file), false);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
