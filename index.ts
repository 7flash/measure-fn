import { AsyncLocalStorage } from "node:async_hooks";

// ─── Context Storage ─────────────────────────────────────────────────

type ContextStorage<TStore> = {
  getStore(): TStore | undefined;
  run<T>(store: TStore, fn: () => T): T;
};

class StackContextStorage<TStore> implements ContextStorage<TStore> {
  private current: TStore | undefined;

  getStore(): TStore | undefined {
    return this.current;
  }

  run<T>(store: TStore, fn: () => T): T {
    const previous = this.current;
    this.current = store;

    try {
      return fn();
    } finally {
      this.current = previous;
    }
  }
}

const createContextStorage = <TStore>(): ContextStorage<TStore> => {
  if (typeof AsyncLocalStorage === "function") {
    return new AsyncLocalStorage<TStore>();
  }

  return new StackContextStorage<TStore>();
};

// ─── ID Generation ───────────────────────────────────────────────────

const toAlpha = (num: number): string => {
  let result = "";
  let n = num;

  do {
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);

  return result;
};

// ─── Types ───────────────────────────────────────────────────────────

export type MaybePromise<T> = T | Promise<T>;

export interface MeasureActionObject<T = unknown> {
  /** Printed when the step starts. */
  start?: () => unknown;

  /** Maps the successful result to the value printed after the arrow. */
  end?: (result: T) => unknown;

  /** Optional recovery. If omitted, measure throws the original error. */
  catch?: (error: unknown) => MaybePromise<T>;

  /** Optional budget warning in ms. */
  budget?: number;

  /** Optional timeout in ms. */
  timeout?: number;

  /** Optional per-measure result print cap. */
  maxResultLength?: number;

  /** Override global auto-summary behavior for this measure. */
  summarize?: boolean;

  /** Override global prefix stripping behavior for this measure. */
  stripScopePrefix?: boolean;
}

export type MeasureAction<T = unknown> = string | MeasureActionObject<T>;
type AnyMeasureAction = MeasureAction<any>;

export type MeasureLogEvent =
  | {
      type: "start";
      id: string;
      rawId: string;
      scope?: string;
      depth: number;
      label: string;
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
      value: unknown;
    };

export type ConfigureOpts = {
  silent?: boolean;
  logger?: ((event: MeasureLogEvent) => void) | null;
  maxResultLength?: number;

  /** Accepted for compatibility. Current default logger is always compact. */
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
  <T>(action: MeasureAction<T>, fn: () => T): T;
  (action: MeasureAction): null;

  root<T>(action: MeasureAction<T>, fn: () => T): T;
  root(action: MeasureAction): null;

  note<T = unknown>(action: MeasureAction<T>): void;

  timed<T>(action: MeasureAction<T>, fn: () => T): TimedResult<T>;

  wrap<A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (...args: A) => R,
  ): (...args: A) => R;
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
    fn: () => Promise<T>,
  ): Promise<T>;

  wrap<A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (...args: A) => MaybePromise<R>,
  ): (...args: A) => Promise<R>;

  batch<T, R>(
    action: MeasureAction<BatchSummary<R>>,
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    opts?: BatchOpts,
  ): Promise<(R | null)[]>;

  /** Backward-compatible alias. */
  measure: MeasureFn;

  /** Backward-compatible alias. */
  measureSync: MeasureSyncFn;

  resetCounter: () => void;
};

export type MeasureInstance = MeasureFn;

// ─── Configuration ───────────────────────────────────────────────────

const DEFAULT_SENSITIVE_KEY =
  /secret|private|mnemonic|seed|keypair|password|authorization|cookie|token|apikey|api_key/i;

const options = {
  timestamps: false,
  summarize: false,
  stripScopePrefix: false,
  maxSummaryDepth: 4,
  maxSummaryStringLength: 160,
  summaryArraySample: 2,
  summaryObjectKeys: 24,
  sensitiveKeyPattern: DEFAULT_SENSITIVE_KEY as RegExp | null,
};

export let silent =
  typeof process !== "undefined" &&
  (process.env.MEASURE_SILENT === "1" || process.env.MEASURE_SILENT === "true");

export let logger: ((event: MeasureLogEvent) => void) | null = null;
let maxResultLen = 0;

export const configure = (opts: ConfigureOpts) => {
  if (opts.silent !== undefined) silent = opts.silent;
  if (opts.logger !== undefined) logger = opts.logger;
  if (opts.maxResultLength !== undefined) {
    maxResultLen = Number.isFinite(opts.maxResultLength)
      ? Math.max(0, Number(opts.maxResultLength))
      : maxResultLen;
  }

  if (opts.timestamps !== undefined) options.timestamps = opts.timestamps;
  if (opts.summarize !== undefined) options.summarize = opts.summarize;
  if (opts.stripScopePrefix !== undefined) {
    options.stripScopePrefix = opts.stripScopePrefix;
  }
  if (opts.maxSummaryDepth !== undefined) {
    options.maxSummaryDepth = Math.max(0, Number(opts.maxSummaryDepth));
  }
  if (opts.maxSummaryStringLength !== undefined) {
    options.maxSummaryStringLength = Math.max(
      0,
      Number(opts.maxSummaryStringLength),
    );
  }
  if (opts.summaryArraySample !== undefined) {
    options.summaryArraySample = Math.max(0, Number(opts.summaryArraySample));
  }
  if (opts.summaryObjectKeys !== undefined) {
    options.summaryObjectKeys = Math.max(0, Number(opts.summaryObjectKeys));
  }
  if (opts.sensitiveKeyPattern !== undefined) {
    if (opts.sensitiveKeyPattern == null) {
      options.sensitiveKeyPattern = null;
    } else if (typeof opts.sensitiveKeyPattern === "string") {
      options.sensitiveKeyPattern = new RegExp(opts.sensitiveKeyPattern, "i");
    } else {
      options.sensitiveKeyPattern = opts.sensitiveKeyPattern;
    }
  }
};

// ─── Safe Stringify / Summary ────────────────────────────────────────

export const summarizeForMeasure = (
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown => {
  if (value == null) return value;

  if (depth >= options.maxSummaryDepth) {
    return { type: typeof value, truncated: "max-depth" };
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (typeof value === "string") {
    const max = options.maxSummaryStringLength;
    if (max === 0 || value.length <= max) return value;
    const head = Math.max(0, Math.floor(max / 2));
    const tail = Math.max(0, Math.min(24, max - head));
    return `${value.slice(0, head)}…${value.slice(-tail)} (${value.length} chars)`;
  }

  if (typeof Response !== "undefined" && value instanceof Response) {
    return { status: value.status, ok: value.ok };
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      cause:
        value.cause == null
          ? undefined
          : summarizeForMeasure(value.cause, depth + 1, seen),
    };
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof URL !== "undefined" && value instanceof URL)
    return value.toString();

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .slice(0, options.summaryArraySample)
      .map(([key, val]) => [
        summarizeForMeasure(key, depth + 1, seen),
        summarizeForMeasure(val, depth + 1, seen),
      ]);

    return { type: "map", size: value.size, sample: entries };
  }

  if (value instanceof Set) {
    const sample = Array.from(value.values())
      .slice(0, options.summaryArraySample)
      .map((item) => summarizeForMeasure(item, depth + 1, seen));

    return { type: "set", size: value.size, sample };
  }

  if (Array.isArray(value)) {
    if (depth >= 2) return { type: "array", length: value.length };

    if (value.length <= 8) {
      return value.map((item) => summarizeForMeasure(item, depth + 1, seen));
    }

    return {
      type: "array",
      length: value.length,
      sample: value
        .slice(0, options.summaryArraySample)
        .map((item) => summarizeForMeasure(item, depth + 1, seen)),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const input = value as Record<string, unknown>;
    const keys = Object.keys(input);
    const isLarge = keys.length > options.summaryObjectKeys;
    const out: Record<string, unknown> = isLarge
      ? { type: "object", keys: keys.length }
      : {};

    for (const key of keys.slice(0, options.summaryObjectKeys)) {
      if (options.sensitiveKeyPattern?.test(key)) {
        out[key] = "[omitted]";
        continue;
      }

      try {
        const item = input[key];

        if (Array.isArray(item) && item.length > 8) {
          out[key] = { type: "array", length: item.length };
          continue;
        }

        out[key] = summarizeForMeasure(item, depth + 1, seen);
      } catch (error) {
        out[key] = {
          type: "unreadable",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (keys.length > options.summaryObjectKeys) {
      out.omittedKeys = keys.length - options.summaryObjectKeys;
    }

    return out;
  }

  return String(value);
};

export const safeStringify = (value: unknown, limit?: number): string => {
  const cap = limit ?? maxResultLen;

  if (value === undefined) return "";
  if (value === null) return "null";

  const input = options.summarize ? summarizeForMeasure(value) : value;

  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }

  if (typeof input === "bigint") return `${input}n`;
  if (typeof input === "function")
    return `[Function: ${input.name || "anonymous"}]`;
  if (typeof input === "symbol") return input.toString();

  if (typeof input === "string") {
    const quoted = JSON.stringify(input);
    if (cap === 0) return quoted;
    return quoted.length > cap
      ? quoted.slice(0, Math.max(0, cap - 1)) + '…"'
      : quoted;
  }

  try {
    const seen = new WeakSet<object>();

    const str = JSON.stringify(input, (key, val) => {
      if (key && options.sensitiveKeyPattern?.test(key)) return "[omitted]";
      if (typeof val === "bigint") return `${val}n`;
      if (typeof val === "function")
        return `[Function: ${val.name || "anonymous"}]`;
      if (typeof val === "symbol") return val.toString();
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });

    if (cap === 0) return str;
    return str.length > cap ? str.slice(0, Math.max(0, cap)) + "…" : str;
  } catch {
    return String(input);
  }
};

// ─── Duration Formatting ─────────────────────────────────────────────

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

// ─── Helpers ─────────────────────────────────────────────────────────

const isActionObject = <T>(
  value: MeasureAction<T>,
): value is MeasureActionObject<T> => {
  return typeof value === "object" && value !== null;
};

const getBudget = (action: AnyMeasureAction): number | undefined => {
  if (!isActionObject(action)) return undefined;
  if (action.budget === undefined) return undefined;
  return Number(action.budget);
};

const getTimeout = (action: AnyMeasureAction): number | undefined => {
  if (!isActionObject(action)) return undefined;
  if (action.timeout === undefined) return undefined;
  return Number(action.timeout);
};

const getMaxResultLength = (action: AnyMeasureAction): number | undefined => {
  if (!isActionObject(action)) return undefined;
  if (action.maxResultLength === undefined) return undefined;
  return Number(action.maxResultLength);
};

const getCatch = <T>(
  action: MeasureAction<T>,
): ((error: unknown) => MaybePromise<T>) | undefined => {
  if (!isActionObject(action)) return undefined;
  if (typeof action.catch !== "function") return undefined;
  return action.catch;
};

const shouldSummarize = (action: AnyMeasureAction): boolean => {
  if (isActionObject(action) && action.summarize !== undefined) {
    return action.summarize;
  }
  return options.summarize;
};

const shouldStripScopePrefix = (action: AnyMeasureAction): boolean => {
  if (isActionObject(action) && action.stripScopePrefix !== undefined) {
    return action.stripScopePrefix;
  }
  return options.stripScopePrefix;
};

const stripRedundantPrefix = (
  scope: string | undefined,
  label: string,
): string => {
  if (!scope) return label;

  const exactScopePrefix = `${scope}:`;
  if (label.startsWith(exactScopePrefix)) {
    return label.slice(exactScopePrefix.length);
  }

  const rootScope = scope.split(":")[0];
  if (rootScope && label.startsWith(`${rootScope}:`)) {
    return label.slice(rootScope.length + 1);
  }

  return label;
};

const formatLabelValue = (
  scope: string | undefined,
  action: AnyMeasureAction,
  value: unknown,
): string => {
  let normalized = value;

  if (typeof normalized === "string" && shouldStripScopePrefix(action)) {
    normalized = stripRedundantPrefix(scope, normalized);
  } else if (shouldSummarize(action)) {
    normalized = summarizeForMeasure(normalized);
  }

  if (typeof normalized === "string") return normalized;
  if (normalized === undefined) return "";
  return safeStringify(normalized, 0);
};

const getStartValue = (action: AnyMeasureAction): unknown => {
  if (typeof action === "string") return action;

  if (typeof action.start === "function") {
    try {
      return action.start();
    } catch (error) {
      return {
        startMapperError:
          error instanceof Error ? error.message : String(error),
      };
    }
  }

  return "";
};

const getEndValue = <T>(action: MeasureAction<T>, result: T): unknown => {
  let value: unknown = result;

  if (isActionObject(action) && typeof action.end === "function") {
    try {
      value = action.end(result);
    } catch (error) {
      value = {
        resultMapperError:
          error instanceof Error ? error.message : String(error),
      };
    }
  }

  return shouldSummarize(action) ? summarizeForMeasure(value) : value;
};

const timeoutPromise = (ms: number): Promise<never> => {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`Timeout (${formatDuration(ms)})`)), ms);
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Default Logger ──────────────────────────────────────────────────

const defaultLogger = (event: MeasureLogEvent) => {
  const id = `[${event.id}]`;

  switch (event.type) {
    case "start": {
      console.log(`${id} → ${event.label}`);
      break;
    }

    case "success": {
      const resultStr =
        event.result !== undefined
          ? safeStringify(event.result, event.maxResultLength)
          : "";
      const resultSuffix = resultStr ? ` → ${resultStr}` : "";
      const budgetWarn =
        event.budget !== undefined && event.duration > event.budget
          ? ` ⚠ over budget ${formatDuration(event.budget)}`
          : "";

      console.log(
        `${id} ✓ ${formatDuration(event.duration)}${resultSuffix}${budgetWarn}`,
      );
      break;
    }

    case "error": {
      const errorMsg =
        event.error instanceof Error
          ? event.error.message
          : String(event.error);
      const budgetWarn =
        event.budget !== undefined && event.duration > event.budget
          ? ` ⚠ over budget ${formatDuration(event.budget)}`
          : "";

      console.log(
        `${id} ✗ ${formatDuration(event.duration)} (${errorMsg})${budgetWarn}`,
      );

      if (event.error instanceof Error) {
        console.error(`${id}`, event.error.stack ?? event.error.message);
        if (event.error.cause) console.error(`${id} Cause:`, event.error.cause);
      } else {
        console.error(`${id}`, event.error);
      }
      break;
    }

    case "annotation": {
      console.log(`${id} = ${event.label}`);
      break;
    }
  }
};

// ─── Measure Implementation ──────────────────────────────────────────

type Span = {
  id: string;
  depth: number;
  childCounter: number;
};

const sharedStorage = createContextStorage<Span>();

type RunOptions = {
  detached?: boolean;
};

const createMeasureImpl = (scope?: string): MeasureFn => {
  const storage = sharedStorage;
  const counter = { value: 0 };

  const formatId = (rawId: string) => (scope ? `${scope}:${rawId}` : rawId);

  const emit = (event: MeasureLogEvent) => {
    if (silent) return;
    if (logger) {
      logger(event);
      return;
    }
    defaultLogger(event);
  };

  const createSpan = (detached = false): Span => {
    const parent = detached ? undefined : storage.getStore();

    if (!parent) {
      return { id: toAlpha(counter.value++), depth: 0, childCounter: 0 };
    }

    const childId = toAlpha(parent.childCounter++);
    return {
      id: `${parent.id}-${childId}`,
      depth: parent.depth + 1,
      childCounter: 0,
    };
  };

  const note = <T = unknown>(action: MeasureAction<T>, opts?: RunOptions) => {
    const span = createSpan(opts?.detached === true);
    const startValue = getStartValue(action);
    const label = formatLabelValue(scope, action, startValue);

    emit({
      type: "annotation",
      id: formatId(span.id),
      rawId: span.id,
      scope,
      depth: span.depth,
      label,
      value: startValue,
    });
  };

  const runMeasured = async <T>(
    action: MeasureAction<T>,
    fn: () => MaybePromise<T>,
    opts?: RunOptions,
  ): Promise<T> => {
    const span = createSpan(opts?.detached === true);
    const startedAt = performance.now();
    const startValue = getStartValue(action);
    const label = formatLabelValue(scope, action, startValue);
    const budget = getBudget(action);
    const timeout = getTimeout(action);
    const maxResultLength = getMaxResultLength(action);

    emit({
      type: "start",
      id: formatId(span.id),
      rawId: span.id,
      scope,
      depth: span.depth,
      label,
      value: startValue,
    });

    return await storage.run(span, async () => {
      try {
        const result =
          timeout !== undefined && timeout > 0
            ? await Promise.race([
                Promise.resolve().then(fn),
                timeoutPromise(timeout),
              ])
            : await fn();

        const duration = performance.now() - startedAt;
        const printedResult = getEndValue(action, result);

        emit({
          type: "success",
          id: formatId(span.id),
          rawId: span.id,
          scope,
          depth: span.depth,
          label,
          duration,
          result: printedResult,
          budget,
          maxResultLength,
        });

        return result;
      } catch (error) {
        const duration = performance.now() - startedAt;
        const printedError = shouldSummarize(action)
          ? summarizeForMeasure(error)
          : error;

        emit({
          type: "error",
          id: formatId(span.id),
          rawId: span.id,
          scope,
          depth: span.depth,
          label,
          duration,
          error: printedError,
          budget,
          maxResultLength,
        });

        const recover = getCatch(action);
        if (recover) return await recover(error);
        throw error;
      }
    });
  };

  const runMeasuredSync = <T>(
    action: MeasureAction<T>,
    fn: () => T,
    opts?: RunOptions,
  ): T => {
    const span = createSpan(opts?.detached === true);
    const startedAt = performance.now();
    const startValue = getStartValue(action);
    const label = formatLabelValue(scope, action, startValue);
    const budget = getBudget(action);
    const maxResultLength = getMaxResultLength(action);

    emit({
      type: "start",
      id: formatId(span.id),
      rawId: span.id,
      scope,
      depth: span.depth,
      label,
      value: startValue,
    });

    return storage.run(span, () => {
      try {
        const result = fn();
        const duration = performance.now() - startedAt;
        const printedResult = getEndValue(action, result);

        emit({
          type: "success",
          id: formatId(span.id),
          rawId: span.id,
          scope,
          depth: span.depth,
          label,
          duration,
          result: printedResult,
          budget,
          maxResultLength,
        });

        return result;
      } catch (error) {
        const duration = performance.now() - startedAt;
        const printedError = shouldSummarize(action)
          ? summarizeForMeasure(error)
          : error;

        emit({
          type: "error",
          id: formatId(span.id),
          rawId: span.id,
          scope,
          depth: span.depth,
          label,
          duration,
          error: printedError,
          budget,
          maxResultLength,
        });

        const recover = getCatch(action);
        if (recover) {
          const result = recover(error);
          if (result && typeof (result as any).then === "function") {
            throw new Error("measureSync catch() must return synchronously");
          }
          return result as T;
        }

        throw error;
      }
    });
  };

  const sync = (<T>(action: MeasureAction<T>, fn?: () => T): T | null => {
    if (typeof fn !== "function") {
      note(action);
      return null;
    }
    return runMeasuredSync(action, fn);
  }) as MeasureSyncFn;

  sync.root = (<T>(action: MeasureAction<T>, fn?: () => T): T | null => {
    if (typeof fn !== "function") {
      note(action, { detached: true });
      return null;
    }
    return runMeasuredSync(action, fn, { detached: true });
  }) as MeasureSyncFn["root"];

  sync.note = note;

  sync.timed = <T>(action: MeasureAction<T>, fn: () => T): TimedResult<T> => {
    const start = performance.now();
    const result = sync(action, fn);
    return { result, duration: performance.now() - start };
  };

  sync.wrap = <A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (...args: A) => R,
  ) => {
    return (...args: A) => sync(action, () => fn(...args));
  };

  const m = (async <T>(
    action: MeasureAction<T>,
    fn?: () => MaybePromise<T>,
  ): Promise<T | null> => {
    if (typeof fn !== "function") {
      note(action);
      return null;
    }
    return await runMeasured(action, fn);
  }) as MeasureFn;

  m.root = (async <T>(
    action: MeasureAction<T>,
    fn?: () => MaybePromise<T>,
  ): Promise<T | null> => {
    if (typeof fn !== "function") {
      note(action, { detached: true });
      return null;
    }
    return await runMeasured(action, fn, { detached: true });
  }) as MeasureFn["root"];

  m.sync = sync;
  m.note = note;

  m.timed = async <T>(
    action: MeasureAction<T>,
    fn: () => MaybePromise<T>,
  ): Promise<TimedResult<T>> => {
    const start = performance.now();
    const result = await m(action, fn);
    return { result, duration: performance.now() - start };
  };

  m.retry = async <T>(
    action: MeasureAction<T>,
    opts: RetryOpts,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const attempts = opts.attempts ?? 3;
    const delay = opts.delay ?? 1000;
    const backoff = opts.backoff ?? 1;
    let lastError: unknown = null;

    for (let i = 0; i < attempts; i++) {
      const attempt = i + 1;
      const suffix = `[${attempt}/${attempts}]`;
      const attemptAction: MeasureAction<T> =
        typeof action === "string"
          ? `${action} ${suffix}`
          : {
              ...action,
              catch: undefined,
              start: () => {
                const value = getStartValue(action);
                const label = formatLabelValue(scope, action, value);
                return label ? `${label} ${suffix}` : suffix;
              },
            };

      try {
        return await m(attemptAction, fn);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await sleep(delay * Math.pow(backoff, i));
      }
    }

    const recover = getCatch(action);
    if (recover) return await recover(lastError);
    throw lastError;
  };

  m.wrap = <A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (...args: A) => MaybePromise<R>,
  ) => {
    return (...args: A) => m(action, () => fn(...args));
  };

  m.batch = async <T, R>(
    action: MeasureAction<BatchSummary<R>>,
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    opts?: BatchOpts,
  ): Promise<(R | null)[]> => {
    const total = items.length;
    const every = opts?.every ?? Math.max(1, Math.ceil(total / 5));

    const batchAction: MeasureAction<BatchSummary<R>> =
      typeof action === "string"
        ? {
            start: () => `${action} (${total} items)`,
            end: (summary) => `${summary.ok}/${summary.total} ok`,
          }
        : {
            ...action,
            start: () => {
              const value = getStartValue(action);
              const label = formatLabelValue(scope, action, value);
              return label ? `${label} (${total} items)` : `${total} items`;
            },
          };

    const summary = await m(batchAction, async () => {
      const results: (R | null)[] = [];

      for (let i = 0; i < items.length; i++) {
        try {
          results.push(await fn(items[i]!, i));
        } catch {
          results.push(null);
        }

        if ((i + 1) % every === 0 && i + 1 < total) {
          const ok = results.filter((result) => result !== null).length;
          note(`${i + 1}/${total} (${ok} ok)`);
        }
      }

      const ok = results.filter((result) => result !== null).length;
      return { ok, total, results };
    });

    return summary.results;
  };

  m.measure = m;
  m.measureSync = sync;
  m.resetCounter = () => {
    counter.value = 0;
  };

  return m;
};

// ─── Default Global Instance ─────────────────────────────────────────

const globalInstance = createMeasureImpl();

export const measure = globalInstance;
export const measureSync = globalInstance.sync;

// ─── Scoped Instances ────────────────────────────────────────────────

export const createMeasure = (scope?: string): MeasureInstance => {
  return createMeasureImpl(scope);
};
