import os from 'node:os';
import path from 'node:path';
import * as P from './page.js';

export class AimError extends Error {
  constructor(code, message, answer) {
    super(message);
    this.name = 'AimError';
    this.code = code;
    if (answer) this.answer = answer;
  }
}

function timeout(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('timeoutMs must be a positive integer');
  return value;
}

/** One live Google AI Mode conversation. Create asynchronously; close in a finally block. */
export class AimSession {
  #browser;
  #context;
  #page;
  #external;
  #timeoutMs;
  #busy = false;
  #closing;
  #url = null;

  constructor({ browser, context, page, external, timeoutMs } = {}) {
    if (!page) throw new TypeError('Use await AimSession.create()');
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#external = external;
    this.#timeoutMs = timeoutMs;
  }

  static async create({
    cdpUrl = process.env.AIM_CDP_URL,
    profile = process.env.AIM_PROFILE_DIR,
    executablePath = process.env.AIM_BROWSER_EXECUTABLE,
    headless = true,
    maxTabs = process.env.AIM_MAX_TABS ?? 1,
    timeoutMs = 120000,
  } = {}) {
    timeout(timeoutMs);
    maxTabs = P.tabLimit(maxTabs);
    if (typeof headless !== 'boolean') throw new TypeError('headless must be a boolean');
    for (const [name, value] of Object.entries({ profile, executablePath })) {
      if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new TypeError(`${name} must be a non-empty string`);
    }
    if (cdpUrl !== undefined && (typeof cdpUrl !== 'string' || !cdpUrl)) throw new TypeError('cdpUrl must be a non-empty string');
    if (cdpUrl && (profile !== undefined || executablePath !== undefined || !headless)) {
      throw new TypeError('Unset cdpUrl/AIM_CDP_URL to use managed browser options');
    }
    const external = Boolean(cdpUrl);
    let browser, context;
    try {
      ({ browser, context } = external ? await P.connect(cdpUrl) : await P.launch({
        profile: path.resolve(profile ?? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'aim', 'chrome')),
        headless, maxTabs, executablePath,
      }));
      const page = await P.openConversation(context, !external && !headless ? 'https://www.google.com/search?udm=50' : undefined,
        { maxTabs, reuseBlank: !external });
      return new AimSession({ browser, context, page, external, timeoutMs });
    } catch (error) {
      // For CDP connections browser.close() disconnects; it does not stop the external browser.
      await (external ? browser?.close() : context?.close())?.catch(() => {});
      throw error;
    }
  }

  /** Returns a complete answer with Markdown and citations; errors may carry a partial answer. */
  async ask(question, { timeoutMs = this.#timeoutMs, signal } = {}) {
    if (typeof question !== 'string' || !question.trim()) throw new TypeError('question must be a non-empty string');
    timeout(timeoutMs);
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
    this.#assertOpen();
    if (this.#busy) throw new AimError('BUSY', 'A question is already in progress; await it before asking another');
    signal?.throwIfAborted();
    this.#busy = true;
    try {
      const state = await P.reconcile(this.#page);
      if (state === 'attention') throw new AimError('ATTENTION', 'Google needs sign-in or verification in a visible browser');
      if (state !== 'idle') throw new AimError('BUSY', 'Google is still answering; no question was sent');
      if (this.#url) {
        const writable = await P.checkWritable(this.#page, this.#url);
        if (writable === 'attention') throw new AimError('ATTENTION', 'Google needs sign-in or verification in a visible browser');
        if (writable !== 'writable') throw new AimError('CONVERSATION_CHANGED', 'The original conversation is no longer writable');
      }
      this.#assertOpen();
      signal?.throwIfAborted();
      const { turnId, delivered } = await P.send(this.#page, question.trim());
      if (delivered !== 'yes') {
        if (await P.detectAttention(this.#page)) throw new AimError('ATTENTION', 'Google needs sign-in or verification in a visible browser');
        throw new AimError('DELIVERY_UNCERTAIN', 'Delivery could not be confirmed; the question was not retried');
      }
      const { status, answer } = await P.waitForTurn(this.#page, turnId, { timeoutMs, signal });
      this.#assertOpen();
      if (status === 'complete') return answer;
      if (await P.detectAttention(this.#page)) throw new AimError('ATTENTION', 'Google needs sign-in or verification in a visible browser', answer);
      throw new AimError(signal?.aborted ? 'ABORTED' : 'INCOMPLETE', 'Stopped waiting; Google may still be answering', answer);
    } finally {
      if (!this.#closing) this.#url = await P.conversationUrl(this.#page, this.#url).catch(() => null) || this.#url;
      this.#busy = false;
    }
  }

  #assertOpen() {
    if (this.#closing || this.#page.isClosed() || !this.#browser.isConnected()) throw new AimError('CLOSED', 'This session is closed');
  }

  /** Closes this tab and disconnects, or shuts down a browser started by this session. */
  close() {
    return this.#closing ??= (async () => {
      if (!this.#external) return this.#context.close();
      try { await this.#page.close(); }
      finally { await this.#browser.close(); }
    })();
  }

  async [Symbol.asyncDispose]() { await this.close(); }
}
