import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Stub for src/page.js: no Chrome. A provisional URL exists before send() returns; send() is held open until the
// ticker has had a chance to save (or 1 s), which reproduces the race deterministically. Inline: node --test runs any .mjs under test/.
const stubSrc = `import fs from 'node:fs';
export const DEFAULT_CDP_URL = 'stub';
export class ConnectError extends Error {}
const on = () => {};
export const connect = async () => ({ browser: { on }, context: {} });
export const openConversation = async () => ({ on, bringToFront: async () => {} });
export const conversationUrl = async () => ({ url: 'https://www.google.com/search?udm=50&mstk=AUtExfSTUB&mtid=early&csuir=1', provisional: true });
export async function send() {
  const f = process.env.XDG_CONFIG_HOME + '/aim/sessions.json';
  for (let t = 0; t < 1000 && !fs.existsSync(f); t += 20) await new Promise((r) => setTimeout(r, 20));
  return { turnId: { index: 0, text: 'hello' }, delivered: 'yes' };
}
export const waitForTurn = () => { process.stdout.write('STUB waiting\\n'); return new Promise(() => {}); };`;
const stub = `data:text/javascript,${encodeURIComponent(stubSrc)}`;
const hook = `data:text/javascript,${encodeURIComponent(`import { registerHooks } from 'node:module';
registerHooks({ resolve: (s, c, next) => s.endsWith('/src/page.js') ? { url: ${JSON.stringify(stub)}, shortCircuit: true } : next(s, c) });`)}`;

test('cli: provisional URL seen before send() returns is saved with firstPrompt (quit before final mtid)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-cli-'));
  const child = spawn(process.execPath, ['--import', hook, new URL('../bin/aim.js', import.meta.url).pathname, '--name', 's'], { env: { ...process.env, XDG_CONFIG_HOME: dir } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.includes('STUB waiting')) child.stdin.end(); });
  child.stdin.write('hello\n');
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, out);
  const entry = JSON.parse(fs.readFileSync(path.join(dir, 'aim', 'sessions.json'), 'utf8')).sessions.s;
  assert.equal(entry.firstPrompt, 'hello', 'provisional entry without firstPrompt would reject the right thread on resume');
});
