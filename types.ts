export type MaybePromise<T> = T | PromiseLike<T>;

export interface MeasureActionObject<T = unknown> {
  /** Printed when the step starts. */
  start?: () => unknown;

  /** Maps the successful result to the value printed after the arrow. */
  end?: (result: T) => unknown;

  /** Optional recovery. If omitted, measure throws the original error. */
  catch?: (error: unknown) => MaybePromise<T>;

  /** Optional budget warning in ms. */
  budget?: number;

  /** Deadline in ms (0 disables it). Does not cancel the operation. */
  timeout?: number;

  /** Optional per-measure result print cap. */
  maxResultLength?: number;

  /** Override global auto-summary behavior for this measure. */
  summarize?: boolean;

  /** Override global prefix stripping behavior for this measure. */
  stripScopePrefix?: boolean;
}

export type MeasureAction<T = unknown> = string | MeasureActionObject<T>;
export type MeasureSyncActionObject<T = unknown> = Omit<
  MeasureActionObject<T>,
  "catch" | "timeout"
> & {
  catch?: (error: unknown) => T;
  /** Synchronous work cannot be interrupted by a timer. */
  timeout?: never;
};
export type MeasureSyncAction<T = unknown> =
  string | MeasureSyncActionObject<T>;
type SyncValue<T> = T extends PromiseLike<unknown> ? never : T;

export type MeasureLogEvent = {
  /** Unique root identifier within this loaded runtime; unchanged by resetCounter(). */
  traceId: string;
  /** Display ID of the direct parent, including its scope. */
  parentId: string | undefined;
} & (
  | {
      type: "start";
      id: string;
      rawId: string;
      scope?: string;
      depth: number;
      label: string;
      /** Normalized event payload. Same value as `value` for start events. */
      data: unknown;
      value: unknown;
    }
  | {
      type: "success";
      id: string;
      rawId: string;
      scope?: string;
      depth: number;
      label: string;
      duration: number;
      /** Normalized event payload. Same value as `result` for success events. */
      data: unknown;
      result: unknown;
      budget?: number;
      maxResultLength?: number;
    }
  | {
      type: "error";
      id: string;
      rawId: string;
      scope?: string;
      depth: number;
      label: string;
      duration: number;
      /** Normalized event payload. Same value as `error` for error events. */
      data: unknown;
      error: unknown;
      budget?: number;
      maxResultLength?: number;
    }
  | {
      type: "annotation";
      id: string;
      rawId: string;
      scope?: string;
      depth: number;
      label: string;
      /** Normalized event payload. Same value as `value` for annotations. */
      data: unknown;
      value: unknown;
    }
);

export type MeasureLogNext = () => void;

export type MeasureLogger = (
  event: MeasureLogEvent,
  next: MeasureLogNext,
) => void;

export type ConfigureOpts = {
  silent?: boolean;

  /**
   * Optional log middleware.
   *
   * Call next() to preserve the built-in log output and add your own behavior.
   * Omit next() to fully replace the built-in logger.
   */
  logger?: MeasureLogger | null;

  /** Receives observer failures without replacing the operation's result/error. */
  onLoggerError?: ((error: unknown, event: MeasureLogEvent) => void) | null;

  /** Enable ANSI colors, disable them, or auto-detect terminal support. */
  colors?: boolean | "auto";

  maxResultLength?: number;

  /** Prefix built-in output with an ISO timestamp. */
  timestamps?: boolean;

  /** Auto-summarize measured results before printing/logging. */
  summarize?: boolean;

  /** Strip duplicated scope prefixes from labels, e.g. solard:start -> start. */
  stripScopePrefix?: boolean;

  /** Redact object keys matching this pattern during summary/stringify. */
  sensitiveKeyPattern?: RegExp | string | null;

  /** Maximum recursive depth for auto-summary. */
  maxSummaryDepth?: number;

  /** String truncation length used by auto-summary. */
  maxSummaryStringLength?: number;

  /** Number of array items included in auto-summary samples. */
  summaryArraySample?: number;

  /** Number of object keys included in auto-summary. */
  summaryObjectKeys?: number;
};

export type TimedResult<T> = {
  result: T;
  duration: number;
};

export type RetryOpts = {
  attempts?: number;
  delay?: number;
  backoff?: number;
};

export type BatchOpts = {
  every?: number;
};

export type BatchSummary<R> = {
  ok: number;
  total: number;
  results: (R | null)[];
};

export type MeasureSyncFn = {
  <T>(action: MeasureSyncAction<T>, fn: () => SyncValue<T>): T;
  (action: MeasureSyncAction): null;

  root<T>(action: MeasureSyncAction<T>, fn: () => SyncValue<T>): T;
  root(action: MeasureSyncAction): null;

  note<T = unknown>(action: MeasureSyncAction<T>): void;

  timed<T>(
    action: MeasureSyncAction<T>,
    fn: () => SyncValue<T>,
  ): TimedResult<T>;

  wrap<This, A extends unknown[], R>(
    action: MeasureSyncAction<R>,
    fn: (this: This, ...args: A) => SyncValue<R>,
  ): (this: This, ...args: A) => R;
};

export type MeasureFn = {
  <T>(action: MeasureAction<T>, fn: () => MaybePromise<T>): Promise<T>;
  (action: MeasureAction): Promise<null>;

  root<T>(action: MeasureAction<T>, fn: () => MaybePromise<T>): Promise<T>;
  root(action: MeasureAction): Promise<null>;

  sync: MeasureSyncFn;

  note<T = unknown>(action: MeasureAction<T>): void;

  timed<T>(
    action: MeasureAction<T>,
    fn: () => MaybePromise<T>,
  ): Promise<TimedResult<T>>;

  retry<T>(
    action: MeasureAction<T>,
    opts: RetryOpts,
    fn: () => MaybePromise<T>,
  ): Promise<T>;

  wrap<This, A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (this: This, ...args: A) => MaybePromise<R>,
  ): (this: This, ...args: A) => Promise<R>;

  batch<T, R>(
    action: MeasureAction<BatchSummary<R>>,
    items: readonly T[],
    fn: (item: T, index: number) => MaybePromise<R>,
    opts?: BatchOpts,
  ): Promise<(R | null)[]>;

  /** Backward-compatible alias. */
  measure: MeasureFn;

  /** Backward-compatible alias. */
  measureSync: MeasureSyncFn;

  /** Capture the current parent for callbacks that run after an async boundary. */
  bindContext(): MeasureFn;

  /** Reset display root IDs for this instance; trace IDs are never reset. */
  resetCounter: () => void;
};

export type MeasureInstance = MeasureFn;
