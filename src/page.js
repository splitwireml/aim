// Google AI Mode adapter. The only module that knows Google's page (SRS 2.3, NFR-7).
// Selectors were observed live on 2026-09-16 (Chrome 152); see docs/evidence/T1.md and T2.md.
import { chromium } from 'playwright-core';

export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

const SEL = {
  turnRoot: '[data-xid="aim-mars-turn-root"]',
  scope: '[data-scope-id="turn"]',
  answer: '[data-container-id="main-col"]',
  // Footer with "Copy text"/feedback; inserted when the answer body is final (observed completion signal).
  footerCopy: '[data-xid="Gd7Hsc"] button[aria-label="Copy text"]',
  input: '[data-xid="aim-mars-input-plate"] textarea',
  currentThread: '[data-xid="threads-list-root"] button[data-thread-id][aria-current="true"]',
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

/**
 * Conversation URL: `mstk` selects the thread (observed: a mismatched `mtid` is rewritten to mstk's thread),
 * `mtid` is the thread id used to confirm identity. `q` is dropped so reopening never resubmits a prompt.
 */
export function isConversationUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const p = u.searchParams;
  return u.protocol === 'https:' && u.hostname === 'www.google.com' && u.pathname === '/search' &&
    p.get('udm') === '50' && /^[\w-]{20,}$/.test(p.get('mstk') || '') && /^[\w-]{10,}$/.test(p.get('mtid') || '') && !p.has('q');
}

export function toConversationUrl(pageUrl) {
  let u;
  try { u = new URL(pageUrl); } catch { return null; }
  const out = new URL('https://www.google.com/search?udm=50');
  for (const k of ['mstk', 'mtid', 'csuir']) if (u.searchParams.has(k)) out.searchParams.set(k, u.searchParams.get(k));
  return u.hostname === 'www.google.com' && u.searchParams.get('udm') === '50' && isConversationUrl(out.href) ? out.href : null;
}

/**
 * Final conversation URL for the tab, or null. Only a URL Google itself has put in the address bar (`mstk` and `mtid`)
 * whose `mtid` equals the highlighted history entry's thread id counts: the same identity checkWritable requires on
 * resume. The address-bar `mtid` can be briefly provisional (live QA: id A in the URL while history already showed
 * final id B, replaced ~40 ms later), so an unconfirmed URL is not saved. Observed (T2): `mstk` appears 0.6-10.8 s
 * after acceptance, `mtid` ~0.3-2.7 s later. The early `data-session-thread-id` is never used (Review fix 3).
 * @returns {Promise<string|null>}
 */
export async function conversationUrl(page) {
  const { url, shown, current } = await resolvedThread(page);
  return shown && shown === current ? url : null;
}

// Thread Google resolves for the tab: address-bar conversation URL, its mtid, and the highlighted history entry's id.
async function resolvedThread(page) {
  const url = toConversationUrl(page.url());
  const current = await page.locator(SEL.currentThread).first().getAttribute('data-thread-id', { timeout: 500 }).catch(() => null);
  return { url, shown: url && threadOf(url), current };
}

const threadOf = (url) => new URL(url).searchParams.get('mtid');
const debug = process.env.AIM_DEBUG ? (...a) => console.error('[debug]', Date.now() % 1e6, ...a) : () => {};
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Runs in the page. Turns = query bubbles ("Copy <query>" outside answers) paired with the answer scope that
// contains the bubble (restored threads) or follows it before the next bubble (turns added in this tab).
function readTurnsInPage(sel) {
  const root = document.querySelector(sel.turnRoot);
  if (!root) return null;
  const qs = [...root.querySelectorAll('button[aria-label^="Copy "]')]
    .filter((b) => b.getAttribute('aria-label') !== 'Copy text' && !b.closest('[data-container-id]'));
  const scopes = [...root.querySelectorAll(sel.scope)];
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return qs.map((q, i) => {
    const next = qs[i + 1];
    const scope = scopes.find((s) => s.contains(q) || (after(q, s) && !(next && (s.contains(next) || after(next, s)))));
    const answer = scope && scope.querySelector(sel.answer);
    const footer = scope && scope.querySelector(sel.footerCopy);
    return { query: q.getAttribute('aria-label').slice(5), answer, text: answer ? answer.innerText : '', signal: !!footer && footer.checkVisibility() };
  });
}

// Passed as an expression string: nested eval inside Google's page could be blocked by its CSP.
const turnsExpr = (tail) => `(${readTurnsInPage})(${JSON.stringify(SEL)})${tail}`;

async function readTurns(page) {
  return page.evaluate(turnsExpr('?.map(({ query, text, signal }) => ({ query, text, signal }))'));
}

/** Login, consent, CAPTCHA or unusual-traffic page. URL/markup patterns are not verified live (see T2.md). */
export async function detectAttention(page) {
  let u;
  try { u = new URL(page.url()); } catch { return false; }
  if (/^(accounts|consent)\.google\./.test(u.hostname) || u.pathname.startsWith('/sorry')) return true;
  return page.evaluate(() => !!document.querySelector('iframe[src*="recaptcha"], form#captcha-form, form[action*="/sorry"]')).catch(() => false);
}

/**
 * Confirms the tab shows the conversation identified by expectedUrl and accepts follow-ups.
 * Identity (always required): the thread id Google resolves (URL mtid and the highlighted history entry) must equal
 * expectedUrl's mtid. firstPrompt, when given, is only an extra check on the first query, never a substitute:
 * two threads can share a first query. A stored URL whose mtid is not a thread id fails closed.
 * @returns {Promise<'writable'|'wrong_conversation'|'not_writable'|'attention'>}
 */
export async function checkWritable(page, expectedUrl, { firstPrompt, timeoutMs = 15000, pollMs = 250 } = {}) {
  const want = threadOf(expectedUrl);
  const deadline = Date.now() + timeoutMs;
  let turns = null;
  while (Date.now() < deadline) {
    if (await detectAttention(page)) return 'attention';
    const { shown, current } = await resolvedThread(page);
    turns = await readTurns(page).catch(() => null);
    if ((shown && shown !== want) || (current && current !== want)) return 'wrong_conversation';
    if (firstPrompt !== undefined && turns && turns.length && norm(turns[0].query) !== norm(firstPrompt)) return 'wrong_conversation';
    if (turns && turns.length && shown === want && current === want && (await page.locator(SEL.input).isVisible())) return 'writable';
    await page.waitForTimeout(pollMs);
  }
  return turns && turns.length ? 'not_writable' : 'wrong_conversation'; // no turns: fresh chat
}

/**
 * After an unconfirmed turn: 'generating' while the last turn has no completion footer.
 * @returns {Promise<'idle'|'generating'|'attention'>}
 */
export async function reconcile(page) {
  if (await detectAttention(page)) return 'attention';
  const turns = await readTurns(page);
  return turns && turns.length && !turns[turns.length - 1].signal ? 'generating' : 'idle';
}

/**
 * Submits text. First turn (no AI Mode thread in the tab) navigates to the udm=50 URL; later turns type into the input.
 * Delivery is 'yes' only when a new turn carrying exactly this query appears at the expected index.
 * @returns {Promise<{turnId: {index: number, text: string}, delivered: 'yes'|'uncertain'}>}
 */
export async function send(page, text, { confirmMs = 15000 } = {}) {
  const before = await readTurns(page).catch(() => null);
  const index = before ? before.length : 0;
  debug('send index', index);
  try {
    if (!before) {
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(text)}&udm=50`, { waitUntil: 'domcontentloaded' });
    } else {
      const input = page.locator(SEL.input);
      await input.fill(text);
      await input.press('Enter');
    }
  } catch {
    return { turnId: { index, text }, delivered: 'uncertain' };
  }
  const deadline = Date.now() + confirmMs;
  while (Date.now() < deadline) {
    const turns = await readTurns(page).catch(() => null);
    debug('send confirm', turns && turns.length);
    if (turns && turns.length > index && norm(turns[index].query) === norm(text)) return { turnId: { index, text }, delivered: 'yes' };
    await page.waitForTimeout(200);
  }
  return { turnId: { index, text }, delivered: 'uncertain' };
}

/**
 * Waits for the turn's completion signal (footer "Copy text" button in that turn), then for the answer text
 * to stay unchanged for quietMs. Quiet text alone never completes a turn. `signal` aborts local waiting only.
 * @returns {Promise<{status: 'complete'|'incomplete', answer?: {markdown, citations, unresolved}}>}
 */
export async function waitForTurn(page, turnId, { timeoutMs = 120000, quietMs = 1500, pollMs = 250, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null, stableSince = 0;
  while (Date.now() < deadline && !signal?.aborted) {
    const t = await probeTurn(page, turnId);
    debug('wait poll', turnId.index, t ? `signal=${t.signal} len=${t.text.length}` : 'no turn');
    if (t && t.text !== last) { last = t.text; stableSince = Date.now(); }
    if (t && t.signal && t.text && Date.now() - stableSince >= quietMs) {
      const answer = await extractTurn(page, turnId); // null if the turn was replaced after attribution: never 'complete' without it
      return answer ? { status: 'complete', answer } : { status: 'incomplete' };
    }
    await page.waitForTimeout(pollMs);
  }
  return { status: 'incomplete', answer: (await extractTurn(page, turnId).catch(() => null)) || undefined };
}

// Attribution: only the turn at turnId.index whose query equals turnId.text is inspected.
async function probeTurn(page, { index, text }) {
  const turns = await readTurns(page).catch(() => null);
  const t = turns && turns[index];
  return t && norm(t.query) === norm(text) ? t : null;
}

async function extractTurn(page, turnId) {
  if (!(await probeTurn(page, turnId))) return null;
  const handle = await page.evaluateHandle(turnsExpr(`?.[${Number(turnId.index)}]?.answer ?? null`));
  const el = handle.asElement();
  return el ? el.evaluate(extract) : null;
}

/** Latest turn's answer, if complete; used after recovery. */
export async function latestAnswer(page) {
  const turns = await readTurns(page).catch(() => null);
  if (!turns || !turns.length || !turns[turns.length - 1].signal) return null;
  return extractTurn(page, { index: turns.length - 1, text: turns[turns.length - 1].query });
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
