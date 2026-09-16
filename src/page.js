// Google AI Mode adapter. The only module that knows Google's page (SRS 2.3, NFR-7).
// Selectors below were observed live on 2026-09-16 (Chrome 152); see docs/evidence/T1.md.
// T1 scope: connect, openConversation, send, waitForTurn, extract.
// Not yet implemented (T2/T3): checkWritable, reconcile, conversationUrl, isConversationUrl, attention detection.
import { chromium } from 'playwright-core';

export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

const SEL = {
  turnRoot: '[data-xid="aim-mars-turn-root"]',
  // One child per user turn: query bubble + answer. Old turns stay in place when a new one is appended.
  turn: '[data-xid="aim-mars-turn-root"] > [data-tr-rsts]',
  answer: '[data-scope-id="turn"] [data-container-id="main-col"]',
  // Footer with "Copy text"/feedback; inserted when the answer body is final (observed completion signal).
  footerCopy: '[data-xid="Gd7Hsc"] button[aria-label="Copy text"]',
  input: '[data-xid="aim-mars-input-plate"] textarea',
};

export class ConnectError extends Error {}

/** @returns {Promise<{browser, context}>} attaches via AIM_CDP_URL; throws ConnectError */
export async function connect(cdpUrl = process.env.AIM_CDP_URL || DEFAULT_CDP_URL) {
  let host;
  try { host = new URL(cdpUrl).hostname; } catch { throw new ConnectError(`invalid AIM_CDP_URL: ${cdpUrl}`); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new ConnectError(`AIM_CDP_URL must be localhost, got ${host}`);
  let browser;
  try { browser = await chromium.connectOverCDP(cdpUrl); } catch (e) { throw new ConnectError(`cannot attach to Chrome at ${cdpUrl}: ${e.message.split('\n')[0]}`); }
  const context = browser.contexts()[0];
  if (!context) throw new ConnectError('Chrome has no default browser context');
  return { browser, context };
}

/** Opens url in a new tab, or a blank tab when url is absent (the first send navigates, FR-3.2). */
export async function openConversation(context, url) {
  const page = await context.newPage();
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Turn containers and their query text ("Copy <query>" label on the query bubble).
function readTurns(page) {
  return page.$$eval(SEL.turn, (els) => els.map((el) => {
    const b = el.querySelector('button[aria-label^="Copy "]:not([aria-label="Copy text"])');
    return b ? b.getAttribute('aria-label').slice(5) : null;
  })).catch(() => []);
}

/**
 * Submits text. First turn (no AI Mode thread in the tab) navigates to the udm=50 URL; later turns type into the input.
 * Delivery is 'yes' only when a new turn container carrying exactly this query appears.
 * @returns {Promise<{turnId: {index: number, text: string}, delivered: 'yes'|'uncertain'}>}
 */
export async function send(page, text, { confirmMs = 15000 } = {}) {
  const before = (await page.$(SEL.turnRoot)) ? await readTurns(page) : null;
  const index = before ? before.length : 0;
  if (!before) {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(text)}&udm=50`, { waitUntil: 'domcontentloaded' });
  } else {
    const input = page.locator(SEL.input);
    await input.fill(text);
    await input.press('Enter');
  }
  const deadline = Date.now() + confirmMs;
  while (Date.now() < deadline) {
    const turns = await readTurns(page);
    if (turns.length > index && turns[index] !== null && norm(turns[index]) === norm(text)) {
      return { turnId: { index, text }, delivered: 'yes' };
    }
    await page.waitForTimeout(200);
  }
  return { turnId: { index, text }, delivered: 'uncertain' };
}

/**
 * Waits for the turn's completion signal (footer "Copy text" button rendered in that turn),
 * then for the answer text to stay unchanged for quietMs. Quiet text alone never completes a turn.
 * @returns {Promise<{status: 'complete'|'incomplete', answer?: {markdown, citations}}>}
 */
export async function waitForTurn(page, turnId, { timeoutMs = 120000, quietMs = 1500, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null, stableSince = 0;
  while (Date.now() < deadline) {
    const s = await probeTurn(page, turnId);
    if (s && s.text !== last) { last = s.text; stableSince = Date.now(); }
    if (s && s.signal && s.text && Date.now() - stableSince >= quietMs) {
      return { status: 'complete', answer: await extractTurn(page, turnId) };
    }
    await page.waitForTimeout(pollMs);
  }
  return { status: 'incomplete', answer: (await extractTurn(page, turnId)) || undefined };
}

// Attribution: only the container at turnId.index whose query equals turnId.text is inspected.
async function probeTurn(page, { index, text }) {
  const el = page.locator(SEL.turn).nth(index);
  if (!(await el.count())) return null;
  const query = await el.locator('button[aria-label^="Copy "]:not([aria-label="Copy text"])').first().getAttribute('aria-label', { timeout: 1000 }).catch(() => null);
  if (!query || norm(query.slice(5)) !== norm(text)) return null;
  return el.evaluate((t, sel) => {
    const a = t.querySelector(sel.answer);
    const f = t.querySelector(sel.footerCopy);
    return { text: a ? a.innerText : '', signal: !!f && f.checkVisibility() };
  }, SEL);
}

async function extractTurn(page, turnId) {
  if (!(await probeTurn(page, turnId))) return null;
  const answer = page.locator(SEL.turn).nth(turnId.index).locator(SEL.answer);
  if (!(await answer.count())) return null;
  return answer.evaluate(extract);
}

/**
 * Converts an answer root (main-col) to markdown. Runs in the page; must stay self-contained.
 * Citation chips: <span><a href aria-label="Site (+N) – Title. Related results"></a><button data-icl-uuid>…</button></span>.
 * Chips without an <a href> ("Related results" only) have no source in the DOM: skipped, and counted as unresolved when shown.
 * @returns {{markdown: string, citations: {marker: number, title: string, url: string}[], unresolved: number}}
 */
export function extract(root) {
  const citations = [];
  let unresolved = 0;
  const SKIP = /^(SCRIPT|STYLE|SVG|IMG|NOSCRIPT|TEMPLATE)$/i;
  const BLOCK = /^(DIV|P|UL|OL|LI|PRE|TABLE|H[1-6]|BLOCKQUOTE|SECTION)$/;
  const hidden = (el) => el.getAttribute('aria-hidden') === 'true' || el.matches('[data-xid="Gd7Hsc"],[data-ignore-copy]') ||
    getComputedStyle(el).display === 'none'; // not checkVisibility(): wrappers use display:contents

  const cite = (btn) => {
    const a = btn.parentElement && btn.parentElement.querySelector(':scope > a[href]');
    if (!a) { // icon-only chip: usually visibility:hidden (not shown to the user); a shown one has no source in the DOM
      if (getComputedStyle(btn).visibility !== 'hidden') unresolved++;
      return '';
    }
    const url = a.href;
    let c = citations.find((x) => x.url === url);
    if (!c) {
      const label = (a.getAttribute('aria-label') || '').replace(/\.?\s*related results$/i, '');
      const i = label.indexOf(' – ');
      c = { marker: citations.length + 1, title: (i >= 0 ? label.slice(i + 3) : label).trim() || url, url };
      citations.push(c);
    }
    return `[${c.marker}]`;
  };

  const inline = (node) => {
    if (node.nodeType === 3) return node.textContent.replace(/[\s ]+/g, ' ');
    if (node.nodeType !== 1 || SKIP.test(node.tagName) || hidden(node)) return '';
    const el = node;
    if (el.tagName === 'BUTTON') return el.hasAttribute('data-icl-uuid') ? ' ' + cite(el) : '';
    if (el.tagName === 'A' && el.parentElement.querySelector(':scope > button[data-icl-uuid]')) return '';
    if (BLOCK.test(el.tagName) || el.getAttribute('role') === 'heading') return '\n\n' + block(el) + '\n\n';
    const inner = [...el.childNodes].map(inline).join('');
    if (!inner.trim()) return inner;
    const pad = (mark) => inner.replace(/^(\s*)(.*?)(\s*)$/s, `$1${mark}$2${mark}$3`);
    switch (el.tagName) {
      case 'STRONG': case 'B': return pad('**');
      case 'EM': case 'I': return pad('_');
      case 'CODE': return '`' + el.textContent + '`';
      case 'A': return el.href ? `[${inner.trim()}](${el.href})` : inner;
      case 'BR': return '\n';
      default: return inner;
    }
  };

  const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  const block = (el, depth = 0) => {
    const tag = el.tagName;
    const kids = () => tidy([...el.childNodes].map(inline).join(''));
    if (el.getAttribute('role') === 'heading') return '### ' + kids().replace(/\n+/g, ' ');
    if (/^H[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + kids().replace(/\n+/g, ' ');
    if (tag === 'PRE') return '```\n' + el.textContent.replace(/\n$/, '') + '\n```';
    if (tag === 'UL' || tag === 'OL') {
      return [...el.children].filter((li) => li.tagName === 'LI' && !hidden(li)).map((li, i) => {
        const body = [...li.childNodes].map((n) => (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL') ? '\n' + block(n, depth + 1) + '\n' : inline(n))).join('');
        const text = tidy(body);
        if (!text) return null;
        const indent = '  '.repeat(depth);
        return indent + (tag === 'OL' ? `${i + 1}. ` : '- ') + text.replace(/\n\n/g, '\n').replace(/\n(?!\s*(?:- |\d+\. ))/g, '\n' + indent + '  ');
      }).filter(Boolean).join('\n');
    }
    if (tag === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => tidy([...td.childNodes].map(inline).join('')).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const line = (r) => '| ' + r.join(' | ') + ' |';
      return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n');
    }
    return kids();
  };

  return { markdown: tidy(block(root)), citations, unresolved };
}
