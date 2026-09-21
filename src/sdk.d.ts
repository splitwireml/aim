export interface AimAnswer {
  markdown: string;
  citations: { marker: number; title: string; url: string }[];
  /** Visible citation chips whose source could not be extracted. */
  unresolved: number;
}

export interface AimSessionOptions {
  /** Attach to a localhost CDP browser instead of launching Chrome. Defaults to AIM_CDP_URL. */
  cdpUrl?: string;
  /** Dedicated Chrome profile directory. Defaults to AIM_PROFILE_DIR or the CLI profile. */
  profile?: string;
  executablePath?: string;
  headless?: boolean;
  maxTabs?: number;
  /** Answer-wait timeout, excluding submission and readiness checks. Default: 120000. */
  timeoutMs?: number;
}

export interface AimAskOptions {
  timeoutMs?: number;
  /** Stops local waiting only; Google may continue generating. */
  signal?: AbortSignal;
}

export class AimError extends Error {
  code: 'BUSY' | 'ATTENTION' | 'CONVERSATION_CHANGED' | 'DELIVERY_UNCERTAIN' | 'ABORTED' | 'INCOMPLETE' | 'CLOSED';
  answer?: AimAnswer;
  constructor(code: AimError['code'], message: string, answer?: AimAnswer);
}

export class AimSession {
  private constructor();
  static create(options?: AimSessionOptions): Promise<AimSession>;
  ask(question: string, options?: AimAskOptions): Promise<AimAnswer>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
