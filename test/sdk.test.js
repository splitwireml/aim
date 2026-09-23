import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { AimSession, AimError } from 'aim-session-sdk';

test('SDK validates options before launching a browser', async () => {
  assert.throws(() => new AimSession(), /AimSession.create/);
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { maxTabs: 0 }, { cdpUrl: '' }, { headless: 'false' }, { profile: '' }, { executablePath: false },
    { cdpUrl: 'http://localhost:9222', profile: '/tmp/unused' }, { cdpUrl: 'https://example.com' }]) {
    await assert.rejects(AimSession.create(options));
  }
});

test('SDK owns and closes a managed browser, including repeated close calls', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-sdk-managed-'));
  let session;
  try {
    session = await AimSession.create({ profile });
    const closing = session.close();
    assert.equal(session.close(), closing);
    await closing;
    await assert.rejects(session.ask('hello'), { code: 'CLOSED' });
    // Reopening the same profile proves the first session released its browser/profile lock.
    session = await AimSession.create({ profile });
    await session[Symbol.asyncDispose]();
  } finally {
    await session?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('SDK asks contextual follow-ups, recovers without replay, and leaves an external browser alive', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-sdk-cdp-'));
  let context, session;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: true, args: ['--remote-debugging-port=0'],
    });
    const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    const cdpUrl = `http://127.0.0.1:${port}`;
    // All requests are intercepted; no signed-in profile or live Google traffic.
    await context.route('**/*', async (route) => {
      const question = new URL(route.request().url()).searchParams.get('q');
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <div data-xid="aim-mars-turn-root"></div>
        <div data-xid="aim-mars-input-plate"><textarea></textarea></div>
        <script>
          window.questions = [];
          window.addTurn = (question) => {
            questions.push(question);
            const turn = document.createElement('section');
            turn.dataset.scopeId = 'turn';
            const query = document.createElement('button');
            query.setAttribute('aria-label', 'Copy ' + question);
            query.textContent = question;
            turn.append(query);
            const answer = document.createElement('div');
            answer.dataset.containerId = 'main-col';
            answer.innerHTML = '<p>' + (questions.length === 1 ? 'Paris' : 'France (following Paris)') +
              '<span><a href="https://example.com/source" aria-label="Example – Geography. Related results"></a><button data-icl-uuid="1">Source</button></span></p>';
            turn.append(answer);
            const footer = document.createElement('div');
            footer.dataset.xid = 'Gd7Hsc';
            footer.innerHTML = '<button aria-label="Copy text">Copy text</button>';
            if (question === 'slow' || question === 'abort') footer.hidden = true;
            turn.append(footer);
            document.querySelector('[data-xid="aim-mars-turn-root"]').append(turn);
          };
          addTurn(${JSON.stringify(question)});
          document.querySelector('textarea').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.value !== 'uncertain') addTurn(event.target.value);
          });
        </script>` });
    });
    const originalTab = context.pages()[0];
    await assert.rejects(AimSession.create({ cdpUrl }), /tab limit/);
    assert.equal(context.browser().isConnected(), true, 'failed setup only disconnects the SDK');
    const opened = context.waitForEvent('page');
    session = await AimSession.create({ cdpUrl, maxTabs: 2 });
    const page = await opened;
    for (const input of ['', '   ', null, 1]) await assert.rejects(session.ask(input), TypeError);
    await assert.rejects(session.ask('invalid timeout', { timeoutMs: -1 }), TypeError);
    await assert.rejects(session.ask('invalid signal', { signal: {} }), TypeError);
    await assert.rejects(session.ask('never sent', { signal: AbortSignal.abort() }), { name: 'AbortError' });

    const first = session.ask('What is the capital of France?');
    await assert.rejects(session.ask('overlap'), { code: 'BUSY' });
    const answer = await first;
    assert.equal(answer.markdown, 'Paris [1]');
    assert.deepEqual(answer.citations, [{ marker: 1, title: 'Geography', url: 'https://example.com/source' }]);
    assert.equal(answer.unresolved, 0);
    assert.match((await session.ask('Which country is it in?')).markdown, /France \(following Paris\)/);
    assert.deepEqual(await page.evaluate(() => questions), ['What is the capital of France?', 'Which country is it in?']);

    await assert.rejects(session.ask('slow', { timeoutMs: 30 }), (error) => {
      assert.ok(error instanceof AimError);
      assert.equal(error.code, 'INCOMPLETE');
      assert.ok(error.answer.markdown);
      return true;
    });
    await assert.rejects(session.ask('must not send during generation'), { code: 'BUSY' });
    await page.locator('[data-xid="Gd7Hsc"]').last().evaluate((el) => { el.hidden = false; });
    await session.ask('recovered');

    const controller = new AbortController();
    const interrupted = session.ask('abort', { signal: controller.signal });
    await page.waitForFunction(() => questions.includes('abort'));
    controller.abort();
    await assert.rejects(interrupted, { code: 'ABORTED' });
    await page.locator('[data-xid="Gd7Hsc"]').last().evaluate((el) => { el.hidden = false; });
    await assert.rejects(session.ask('uncertain'), { code: 'DELIVERY_UNCERTAIN' });
    assert.deepEqual(await page.evaluate(() => questions), [
      'What is the capital of France?', 'Which country is it in?', 'slow', 'recovered', 'abort',
    ], 'no automatic retries or overlapping prompts');

    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<form id="captcha-form"></form>'));
    await assert.rejects(session.ask('blocked by verification'), { code: 'ATTENTION' });
    await page.locator('#captcha-form').evaluate((el) => el.remove());
    // Capture a confirmed thread, then verify that a browser-side switch is rejected.
    await page.evaluate(() => {
      history.replaceState({}, '', '?udm=50&mstk=AUtExfAAAAAAAAAAAAAAAAAAAAA&mtid=threadAAAAAAAA');
      document.body.insertAdjacentHTML('beforeend', '<div data-xid="threads-list-root"><button data-thread-id="threadAAAAAAAA" aria-current="true">Thread</button></div>');
    });
    await session.ask('capture identity');
    await page.evaluate(() => history.replaceState({}, '', '?udm=50&mstk=AUtExfBBBBBBBBBBBBBBBBBBBBB&mtid=threadBBBBBBBB'));
    await assert.rejects(session.ask('wrong thread'), { code: 'CONVERSATION_CHANGED' });

    await session.close();
    assert.equal(page.isClosed(), true);
    assert.equal(originalTab.isClosed(), false);
    assert.equal(context.browser().isConnected(), true);
    assert.equal(await originalTab.evaluate(() => 1 + 1), 2);
    await assert.rejects(session.ask('after close'), { code: 'CLOSED' });
  } finally {
    await session?.close();
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
