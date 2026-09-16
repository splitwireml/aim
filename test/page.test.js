import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { extract, connect, ConnectError } from '../src/page.js';

// Installed Chrome, fresh temporary profile, JS disabled: never the live AI Mode tab (SRS T-1).
let browser, page;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await (await browser.newContext({ javaScriptEnabled: false, offline: true })).newPage();
});
after(() => browser?.close());

test('extract: live-captured answer keeps structure, citation positions and repeated sources', async () => {
  await page.setContent(readFileSync(new URL('./fixtures/answer-table-citations.html', import.meta.url), 'utf8'));
  const { markdown, citations, unresolved } = await page.locator('[data-container-id="main-col"]').evaluate(extract);

  assert.match(markdown, /^\*\*It is physically impossible\*\* to traditional hard-boil .* give it\. \[1\]\n\n/);
  assert.match(markdown, /\n### The Science Behind the Failed Breakfast\n/);
  assert.match(markdown, /temperature thresholds: \[1\]\n\n- \*\*Egg Yolks:\*\* Require/);
  assert.match(markdown, /to firmly set\. \[3\]\n/);
  assert.match(markdown, /\| Location \| Water Boiling Point \| Hard-Boil Time \| Result \|\n\| --- \| --- \| --- \| --- \|\n\| \*\*Sea Level\*\* \|/);
  assert.doesNotMatch(markdown, /AI can make mistakes|Copy text|Related results/);

  assert.deepEqual(citations.map((c) => c.marker), [1, 2, 3, 4]);
  assert.equal(citations[0].url, 'https://www.iflscience.com/this-is-why-you-cant-boil-an-egg-on-mount-everest-74028');
  assert.equal(citations[0].title, 'This Is Why You Can’t Boil An Egg On Mount Everest | IFLScience');
  assert.equal(citations[1].title, "Atmospheric Pressure: You Can't Boil an Egg on Mount Everest");
  assert.equal(markdown.match(/\[1\]/g).length, 2, 'same source reuses its marker');
  assert.equal(unresolved, 0, 'hidden link-less chip (live: visibility:hidden) is ignored');

  await page.setContent('<div id=r>Shown icon-only chip.<span><span aria-hidden="true">&nbsp;</span><button data-icl-uuid="x" aria-label="Related results"></button></span></div>');
  const shown = await page.locator('#r').evaluate(extract);
  assert.deepEqual([shown.markdown, shown.citations, shown.unresolved], ['Shown icon-only chip.', [], 1], 'no source invented; counted as unresolved');
});

test('connect: refuses non-localhost CDP endpoints before attaching', async () => {
  await assert.rejects(connect('http://192.168.1.5:9222'), ConnectError);
  await assert.rejects(connect('not a url'), ConnectError);
});
