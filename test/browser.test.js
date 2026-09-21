import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, openConversation, tabLimit } from '../src/page.js';

test('tab limits reject invalid settings and leave attached tabs intact', async () => {
  for (const value of [0, -1, '', '1.5', 'NaN', 'Infinity', '1e3']) assert.throws(() => tabLimit(value));
  assert.equal(tabLimit('2'), 2);
  const existing = { url: () => 'https://example.com' };
  await assert.rejects(openConversation({ pages: () => [existing], newPage: () => assert.fail('must not create a tab') }), /tab limit/);
});

test('managed Chrome reuses one tab, caps popups, persists cookies across restarts and closes', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-browser-'));
  let context;
  try {
    ({ context } = await launch({ profile }));
    const initial = context.pages()[0];
    const page = await openConversation(context, undefined, { reuseBlank: true });
    assert.equal(page, initial);
    assert.doesNotMatch(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
    await context.setOffline(true);
    await context.addCookies([{ name: 'aim-test', value: 'retained', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 }]);
    await assert.rejects(openConversation(context), /tab limit/);
    const closed = new Promise((resolve) => context.once('page', (extra) => extra.on('close', resolve)));
    await context.newPage().catch(() => {});
    await closed;
    assert.equal(context.pages().length, 1);
    const browser = context.browser();
    await context.close();
    assert.equal(browser.isConnected(), false);

    ({ context } = await launch({ profile, maxTabs: 2 }));
    assert.equal((await context.cookies('https://example.com')).find((c) => c.name === 'aim-test')?.value, 'retained');
    await openConversation(context, undefined, { maxTabs: 2 });
    assert.equal(context.pages().length, 2);
    await assert.rejects(openConversation(context, undefined, { maxTabs: 2 }), /tab limit/);
    await context.pages()[1].close();
    await openConversation(context, undefined, { maxTabs: 2 });
    assert.equal(context.pages().length, 2, 'closing an admitted page frees a slot');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
