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
      // Browser fallback is intentionally sync-stack only. Browsers do not have
      // AsyncLocalStorage, and keeping one global context alive across awaits
      // makes overlapping timers/polls nest into each other forever.
      return fn();
    } finally {
      this.current = previous;
    }
  }
}

const getNativeAsyncLocalStorage = ():
  | (new <T>() => ContextStorage<T>)
  | undefined => {
  try {
    // Keep this dynamic so browser bundlers do not include node:async_hooks.
    // eslint-disable-next-line no-new-func
    const getRequire = new Function(
      "try { return typeof require === 'function' ? require : undefined; } catch { return undefined; }",
    ) as () => ((id: string) => any) | undefined;

    const req = getRequire();
    if (!req) return undefined;

    const mod = req("node:async_hooks");
    const AsyncLocalStorage = mod?.AsyncLocalStorage;

    return typeof AsyncLocalStorage === "function"
      ? AsyncLocalStorage
      : undefined;
  } catch {
    return undefined;
  }
};

const createContextStorage = <TStore>(): ContextStorage<TStore> => {
  const AsyncLocalStorage = getNativeAsyncLocalStorage();

  if (AsyncLocalStorage) {
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

// ─── Safe Stringify ──────────────────────────────────────────────────

let maxResultLen = 0;

export const safeStringify = (value: unknown, limit?: number): string => {
  const cap = limit ?? maxResultLen;

  if (value === undefined) return "";
  if (value === null) return "null";

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "bigint") {
    return `${value}n`;
  }

  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (typeof value === "string") {
    const quoted = JSON.stringify(value);

    if (cap === 0) return quoted;

    return quoted.length > cap
      ? quoted.slice(0, Math.max(0, cap - 1)) + '…"'
      : quoted;
  }

  try {
    const seen = new WeakSet<object>();

    const str = JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") {
        return `${val}n`;
      }

      if (typeof val === "function") {
        return `[Function: ${val.name || "anonymous"}]`;
      }

      if (typeof val === "symbol") {
        return val.toString();
      }

      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }

      return val;
    });

    if (cap === 0) return str;

    return str.length > cap
      ? str.slice(0, Math.max(0, cap)) + "…"
      : str;
  } catch {
    return String(value);
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

export type MeasureFn = {
  <T>(action: MeasureAction<T>, fn: () => MaybePromise<T>): Promise<T>;
  (action: MeasureAction): Promise<null>;

  root<T>(action: MeasureAction<T>, fn: () => MaybePromise<T>): Promise<T>;
  root(action: MeasureAction): Promise<null>;

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

export type MeasureInstance = {
  measure: MeasureFn;
  measureSync: MeasureSyncFn;
  resetCounter: () => void;
};

// ─── Configuration ───────────────────────────────────────────────────

export let silent =
  typeof process !== "undefined" &&
  (process.env.MEASURE_SILENT === "1" ||
    process.env.MEASURE_SILENT === "true");

export let logger: ((event: MeasureLogEvent) => void) | null = null;


export const configure = (opts: ConfigureOpts) => {
  if (opts.silent !== undefined) silent = opts.silent;
  if (opts.logger !== undefined) logger = opts.logger;
  if (opts.maxResultLength !== undefined) maxResultLen = opts.maxResultLength;
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

const formatLabelValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return safeStringify(value, 0);
};

const getStartValue = (action: AnyMeasureAction): unknown => {
  if (typeof action === "string") return action;

  if (typeof action.start === "function") {
    try {
      return action.start();
    } catch (error) {
      return {
        startMapperError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return "";
};

const getEndValue = <T>(action: MeasureAction<T>, result: T): unknown => {
  if (isActionObject(action) && typeof action.end === "function") {
    try {
      return action.end(result);
    } catch (error) {
      return {
        resultMapperError:
          error instanceof Error ? error.message : String(error),
      };
    }
  }

  return result;
};

const timeoutPromise = (ms: number): Promise<never> => {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout (${formatDuration(ms)})`));
    }, ms);
  });
};

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

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
        event.error instanceof Error ? event.error.message : String(event.error);

      const budgetWarn =
        event.budget !== undefined && event.duration > event.budget
          ? ` ⚠ over budget ${formatDuration(event.budget)}`
          : "";

      console.log(
        `${id} ✗ ${formatDuration(event.duration)} (${errorMsg})${budgetWarn}`,
      );

      if (event.error instanceof Error) {
        console.error(`${id}`, event.error.stack ?? event.error.message);

        if (event.error.cause) {
          console.error(`${id} Cause:`, event.error.cause);
        }
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

// This is intentionally shared by every createMeasure("scope") instance.
// Scope says who logged the line. The shared span path says where the line
// belongs in the current trace tree.
const sharedStorage = createContextStorage<Span>();

type RunOptions = {
  detached?: boolean;
};

const createMeasureImpl = (scope?: string): MeasureInstance => {
  const storage = sharedStorage;
  const counter = { value: 0 };

  const formatId = (rawId: string) => {
    return scope ? `${scope}:${rawId}` : rawId;
  };

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
      return {
        id: toAlpha(counter.value++),
        depth: 0,
        childCounter: 0,
      };
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
    const value = getStartValue(action);
    const label = formatLabelValue(value);

    emit({
      type: "annotation",
      id: formatId(span.id),
      rawId: span.id,
      scope,
      depth: span.depth,
      label,
      value,
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
    const label = formatLabelValue(startValue);
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

        emit({
          type: "error",
          id: formatId(span.id),
          rawId: span.id,
          scope,
          depth: span.depth,
          label,
          duration,
          error,
          budget,
          maxResultLength,
        });

        const recover = getCatch(action);

        if (recover) {
          return await recover(error);
        }

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
    const label = formatLabelValue(startValue);
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

        emit({
          type: "error",
          id: formatId(span.id),
          rawId: span.id,
          scope,
          depth: span.depth,
          label,
          duration,
          error,
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

  const measureFn = (async <T>(
    action: MeasureAction<T>,
    fn?: () => MaybePromise<T>,
  ): Promise<T | null> => {
    if (typeof fn !== "function") {
      note(action);
      return null;
    }

    return await runMeasured(action, fn);
  }) as MeasureFn;

  measureFn.root = (async <T>(
    action: MeasureAction<T>,
    fn?: () => MaybePromise<T>,
  ): Promise<T | null> => {
    if (typeof fn !== "function") {
      note(action, { detached: true });
      return null;
    }

    return await runMeasured(action, fn, { detached: true });
  }) as MeasureFn["root"];

  measureFn.note = note;

  measureFn.timed = async <T>(
    action: MeasureAction<T>,
    fn: () => MaybePromise<T>,
  ): Promise<TimedResult<T>> => {
    const start = performance.now();
    const result = await measureFn(action, fn);

    return {
      result,
      duration: performance.now() - start,
    };
  };

  measureFn.retry = async <T>(
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
                const label = formatLabelValue(value);
                return label ? `${label} ${suffix}` : suffix;
              },
            };

      try {
        return await measureFn(attemptAction, fn);
      } catch (error) {
        lastError = error;

        if (attempt < attempts) {
          await sleep(delay * Math.pow(backoff, i));
        }
      }
    }

    const recover = getCatch(action);

    if (recover) {
      return await recover(lastError);
    }

    throw lastError;
  };

  measureFn.wrap = <A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (...args: A) => MaybePromise<R>,
  ) => {
    return (...args: A) => measureFn(action, () => fn(...args));
  };

  measureFn.batch = async <T, R>(
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
              const label = formatLabelValue(value);
              return label ? `${label} (${total} items)` : `${total} items`;
            },
          };

    const summary = await measureFn(batchAction, async () => {
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

      return {
        ok,
        total,
        results,
      };
    });

    return summary.results;
  };

  const measureSyncFn = (<T>(
    action: MeasureAction<T>,
    fn?: () => T,
  ): T | null => {
    if (typeof fn !== "function") {
      note(action);
      return null;
    }

    return runMeasuredSync(action, fn);
  }) as MeasureSyncFn;

  measureSyncFn.root = (<T>(
    action: MeasureAction<T>,
    fn?: () => T,
  ): T | null => {
    if (typeof fn !== "function") {
      note(action, { detached: true });
      return null;
    }

    return runMeasuredSync(action, fn, { detached: true });
  }) as MeasureSyncFn["root"];

  measureSyncFn.note = note;

  measureSyncFn.timed = <T>(
    action: MeasureAction<T>,
    fn: () => T,
  ): TimedResult<T> => {
    const start = performance.now();
    const result = measureSyncFn(action, fn);

    return {
      result,
      duration: performance.now() - start,
    };
  };

  measureSyncFn.wrap = <A extends unknown[], R>(
    action: MeasureAction<R>,
    fn: (...args: A) => R,
  ) => {
    return (...args: A) => measureSyncFn(action, () => fn(...args));
  };

  return {
    measure: measureFn,
    measureSync: measureSyncFn,
    resetCounter: () => {
      counter.value = 0;
    },
  };
};

// ─── Default Global Instance ─────────────────────────────────────────

const globalInstance = createMeasureImpl();

export const measure = globalInstance.measure;
export const measureSync = globalInstance.measureSync;

// ─── Scoped Instances ────────────────────────────────────────────────

export const createMeasure = (scope?: string): MeasureInstance => {
  return createMeasureImpl(scope);
};
