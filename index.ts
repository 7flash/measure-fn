// ─── ID Generation ───────────────────────────────────────────────────

const toAlpha = (num: number): string => {
  let result = '';
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

  if (value === undefined) return '';
  if (value === null) return 'null';

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'string') {
    const quoted = JSON.stringify(value);

    if (cap === 0) {
      return quoted;
    }

    return quoted.length > cap ? quoted.slice(0, Math.max(0, cap - 1)) + '…"' : quoted;
  }

  try {
    const seen = new WeakSet<object>();

    const str = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') {
        return `${val}n`;
      }

      if (typeof val === 'function') {
        return `[Function: ${val.name || 'anonymous'}]`;
      }

      if (typeof val === 'symbol') {
        return val.toString();
      }

      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }

      return val;
    });

    if (cap === 0) {
      return str;
    }

    return str.length > cap ? str.slice(0, Math.max(0, cap)) + '…' : str;
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

// ─── Timestamps ──────────────────────────────────────────────────────

let timestamps =
  typeof process !== 'undefined' &&
  (process.env.MEASURE_TIMESTAMPS === '1' ||
    process.env.MEASURE_TIMESTAMPS === 'true');

const ts = (): string => {
  if (!timestamps) return '';

  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');

  return `[${h}:${m}:${s}.${ms}] `;
};

// ─── Logger Types ────────────────────────────────────────────────────

export type MeasureEvent = {
  type: 'start' | 'success' | 'error' | 'annotation';
  id: string;
  label: string;
  depth: number;
  duration?: number;
  result?: unknown;
  error?: unknown;
  meta?: Record<string, unknown>;
  budget?: number;
  maxResultLength?: number;
};

export type MeasureAction<T = unknown> =
  | string
  | {
      label: string;
      budget?: number;
      timeout?: number;
      maxResultLength?: number;
      result?: (value: T) => unknown;
      meta?: Record<string, unknown>;
      [key: string]: unknown;
    };

// ─── Configuration ───────────────────────────────────────────────────

export let silent =
  typeof process !== 'undefined' &&
  (process.env.MEASURE_SILENT === '1' ||
    process.env.MEASURE_SILENT === 'true');

let dotEndLabel = true;
let dotChar = '·';

export let logger: ((event: MeasureEvent) => void) | null = null;

export type ConfigureOpts = {
  silent?: boolean;
  logger?: ((event: MeasureEvent) => void) | null;
  timestamps?: boolean;
  maxResultLength?: number;
  dotEndLabel?: boolean;
  dotChar?: string;
};

export const configure = (opts: ConfigureOpts) => {
  if (opts.silent !== undefined) silent = opts.silent;
  if (opts.logger !== undefined) logger = opts.logger;
  if (opts.timestamps !== undefined) timestamps = opts.timestamps;
  if (opts.maxResultLength !== undefined) maxResultLen = opts.maxResultLength;
  if (opts.dotEndLabel !== undefined) dotEndLabel = opts.dotEndLabel;
  if (opts.dotChar !== undefined) dotChar = opts.dotChar;
};

// ─── Shared Helpers ──────────────────────────────────────────────────

const isActionObject = (value: unknown): value is Exclude<MeasureAction, string> => {
  return typeof value === 'object' && value !== null;
};

const buildActionLabel = (actionInternal: MeasureAction): string => {
  if (isActionObject(actionInternal) && 'label' in actionInternal) {
    return String(actionInternal.label);
  }

  return String(actionInternal);
};

const extractBudget = (actionInternal: MeasureAction): number | undefined => {
  if (!isActionObject(actionInternal)) return undefined;
  if (!('budget' in actionInternal)) return undefined;
  if (actionInternal.budget === undefined) return undefined;

  return Number(actionInternal.budget);
};

const extractTimeout = (actionInternal: MeasureAction): number | undefined => {
  if (!isActionObject(actionInternal)) return undefined;
  if (!('timeout' in actionInternal)) return undefined;
  if (actionInternal.timeout === undefined) return undefined;

  return Number(actionInternal.timeout);
};

const extractMaxResultLength = (actionInternal: MeasureAction): number | undefined => {
  if (!isActionObject(actionInternal)) return undefined;
  if (!('maxResultLength' in actionInternal)) return undefined;
  if (actionInternal.maxResultLength === undefined) return undefined;

  return Number(actionInternal.maxResultLength);
};

const extractResultMapper = <T>(
  actionInternal: MeasureAction<T>,
): ((value: T) => unknown) | undefined => {
  if (!isActionObject(actionInternal)) return undefined;
  if (typeof actionInternal.result !== 'function') return undefined;

  return actionInternal.result;
};

const extractMeta = (actionInternal: MeasureAction): Record<string, unknown> | undefined => {
  if (!isActionObject(actionInternal)) return undefined;

  const details: Record<string, unknown> = { ...actionInternal };

  delete details.label;
  delete details.budget;
  delete details.timeout;
  delete details.maxResultLength;
  delete details.result;

  const explicitMeta =
    typeof details.meta === 'object' && details.meta !== null
      ? (details.meta as Record<string, unknown>)
      : undefined;

  delete details.meta;

  const merged = {
    ...details,
    ...(explicitMeta ?? {}),
  };

  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  return merged;
};

const formatMeta = (meta?: Record<string, unknown>): string => {
  if (!meta) return '';

  const params = Object.entries(meta)
    .map(([key, value]) => `${key}=${safeStringify(value, 0)}`)
    .join(' ');

  return ` (${params})`;
};

const mapResultForLog = <T>(actionInternal: MeasureAction<T>, result: T): unknown => {
  const mapper = extractResultMapper(actionInternal);

  if (!mapper) {
    return result;
  }

  try {
    return mapper(result);
  } catch (error) {
    return {
      resultMapperError:
        error instanceof Error ? error.message : String(error),
    };
  }
};

const emit = (event: MeasureEvent, prefix?: string) => {
  if (silent) return;

  if (logger) {
    logger(event);
    return;
  }

  defaultLogger(event, prefix);
};

const defaultLogger = (event: MeasureEvent, prefix?: string) => {
  const pfx = prefix ? `${prefix}:` : '';
  const id = `[${pfx}${event.id}]`;
  const t = ts();

  switch (event.type) {
    case 'start': {
      console.log(`${t}${id} ... ${event.label}${formatMeta(event.meta)}`);
      break;
    }

    case 'success': {
      const endLabel = dotEndLabel
        ? dotChar.repeat(event.label.length + 5)
        : `    ${event.label}`;

      const resultStr =
        event.result !== undefined
          ? safeStringify(event.result, event.maxResultLength)
          : '';

      const arrow = resultStr ? ` → ${resultStr}` : '';

      const budgetWarn =
        event.budget && event.duration !== undefined && event.duration > event.budget
          ? ` ⚠ OVER BUDGET (${formatDuration(event.budget)})`
          : '';

      console.log(
        `${t}${id} ${endLabel} ${formatDuration(event.duration ?? 0)}${arrow}${budgetWarn}`,
      );

      break;
    }

    case 'error': {
      const endLabel = dotEndLabel
        ? dotChar.repeat(event.label.length + 3)
        : `  ${event.label}`;

      const errorMsg =
        event.error instanceof Error ? event.error.message : String(event.error);

      const budgetWarn =
        event.budget && event.duration !== undefined && event.duration > event.budget
          ? ` ⚠ OVER BUDGET (${formatDuration(event.budget)})`
          : '';

      console.log(
        `${t}${id} ✗ ${endLabel} ${formatDuration(event.duration ?? 0)} (${errorMsg})${budgetWarn}`,
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

    case 'annotation': {
      console.log(`${t}${id} = ${event.label}${formatMeta(event.meta)}`);
      break;
    }
  }
};

// ─── Types ───────────────────────────────────────────────────────────

export type MeasureFn = {
  <U>(label: MeasureAction<U>, fn: () => Promise<U>): Promise<U | null>;

  <U>(
    label: MeasureAction<U>,
    fn: (m: MeasureFn, ms: MeasureSyncFn) => Promise<U>,
  ): Promise<U | null>;

  <U>(
    label: MeasureAction<U>,
    fn: (m: MeasureFn) => Promise<U>,
  ): Promise<U | null>;

  <U>(
    label: MeasureAction<U>,
    fn: () => Promise<U>,
    onError: (error: unknown) => U | null | Promise<U | null>,
  ): Promise<U | null>;

  (label: MeasureAction): Promise<null>;
};

export type MeasureSyncFn = {
  <U>(label: MeasureAction<U>, fn: () => U): U | null;

  <U>(label: MeasureAction<U>, fn: (m: MeasureSyncFn) => U): U | null;

  <U>(
    label: MeasureAction<U>,
    fn: () => U,
    onError: (error: unknown) => U | null,
  ): U | null;

  (label: MeasureAction): null;
};

export type TimedResult<T> = {
  result: T | null;
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

// ─── Nested Resolver Factory ─────────────────────────────────────────

const createNestedResolver = (
  isAsync: boolean,
  fullIdChain: string[],
  childCounterRef: { value: number },
  depth: number,
  resolver: <U>(
    fn: any,
    action: MeasureAction<U>,
    chain: (string | number)[],
    depth: number,
    onError?: (error: unknown) => any,
    inheritedMaxLen?: number,
  ) => Promise<U | null> | (U | null),
  prefix?: string,
  inheritedMaxLen?: number,
) => {
  return (...args: any[]) => {
    const label = args[0] as MeasureAction;
    const fn = args[1];
    const onError = args[2];

    if (typeof fn === 'function') {
      const childParentChain = [...fullIdChain, childCounterRef.value++];

      return resolver(
        fn,
        label,
        childParentChain,
        depth + 1,
        typeof onError === 'function' ? onError : undefined,
        inheritedMaxLen,
      );
    }

    emit(
      {
        type: 'annotation',
        id: fullIdChain.join('-'),
        label: buildActionLabel(label),
        depth: depth + 1,
        meta: extractMeta(label),
      },
      prefix,
    );

    return isAsync ? Promise.resolve(null) : null;
  };
};

// ─── Global State ────────────────────────────────────────────────────

let globalRootCounter = 0;

export const resetCounter = () => {
  globalRootCounter = 0;
};

export type ScopeOpts = {
  maxResultLength?: number;
};

const createMeasureImpl = (
  prefix?: string,
  counterRef?: { value: number },
  scopeOpts?: ScopeOpts,
) => {
  const counter =
    counterRef ??
    {
      get value() {
        return globalRootCounter;
      },
      set value(value: number) {
        globalRootCounter = value;
      },
    };

  const scopeMaxLen = scopeOpts?.maxResultLength;
  let _lastError: unknown = null;

  const _measureInternal = async <U>(
    fnInternal: (measure: MeasureFn, measureSync: MeasureSyncFn) => Promise<U>,
    actionInternal: MeasureAction<U>,
    parentIdChain: (string | number)[],
    depth: number,
    onError?: (error: unknown) => U | null | Promise<U | null>,
    inheritedMaxLen?: number,
  ): Promise<U | null> => {
    const start = performance.now();
    const childCounterRef = { value: 0 };
    const label = buildActionLabel(actionInternal);
    const budget = extractBudget(actionInternal);
    const timeout = extractTimeout(actionInternal);
    const localMaxLen = extractMaxResultLength(actionInternal);
    const effectiveMaxLen = localMaxLen ?? inheritedMaxLen;

    const currentId = toAlpha(Number(parentIdChain.pop() ?? 0));
    const fullIdChain: string[] = [
      ...parentIdChain.map((value) => String(value)),
      currentId,
    ];
    const idStr = fullIdChain.join('-');

    emit(
      {
        type: 'start',
        id: idStr,
        label,
        depth,
        meta: extractMeta(actionInternal),
      },
      prefix,
    );

    const measureForNextLevel = createNestedResolver(
      true,
      fullIdChain,
      childCounterRef,
      depth,
      _measureInternal,
      prefix,
      effectiveMaxLen,
    );

    const measureSyncForNextLevel = createNestedResolver(
      false,
      fullIdChain,
      childCounterRef,
      depth,
      _measureInternalSync,
      prefix,
      effectiveMaxLen,
    );

    try {
      let result: U;

      if (timeout && timeout > 0) {
        result = await Promise.race([
          fnInternal(
            measureForNextLevel as MeasureFn,
            measureSyncForNextLevel as MeasureSyncFn,
          ),
          new Promise<never>((_resolve, reject) => {
            setTimeout(
              () => reject(new Error(`Timeout (${formatDuration(timeout)})`)),
              timeout,
            );
          }),
        ]);
      } else {
        result = await fnInternal(
          measureForNextLevel as MeasureFn,
          measureSyncForNextLevel as MeasureSyncFn,
        );
      }

      const duration = performance.now() - start;

      emit(
        {
          type: 'success',
          id: idStr,
          label,
          depth,
          duration,
          result: mapResultForLog(actionInternal, result),
          budget,
          maxResultLength: effectiveMaxLen,
        },
        prefix,
      );

      return result;
    } catch (error) {
      const duration = performance.now() - start;

      emit(
        {
          type: 'error',
          id: idStr,
          label,
          depth,
          duration,
          error,
          budget,
          maxResultLength: effectiveMaxLen,
        },
        prefix,
      );

      _lastError = error;

      if (onError) {
        try {
          return await onError(error);
        } catch (onErrorError) {
          emit(
            {
              type: 'error',
              id: idStr,
              label: `${label} (onError)`,
              depth,
              duration: performance.now() - start,
              error: onErrorError,
              budget,
              maxResultLength: effectiveMaxLen,
            },
            prefix,
          );

          _lastError = onErrorError;
          return null;
        }
      }

      return null;
    }
  };

  const _measureInternalSync = <U>(
    fnInternal: (measure: MeasureSyncFn) => U,
    actionInternal: MeasureAction<U>,
    parentIdChain: (string | number)[],
    depth: number,
    onError?: (error: unknown) => U | null,
    inheritedMaxLen?: number,
  ): U | null => {
    const start = performance.now();
    const childCounterRef = { value: 0 };
    const label = buildActionLabel(actionInternal);
    const budget = extractBudget(actionInternal);
    const localMaxLen = extractMaxResultLength(actionInternal);
    const effectiveMaxLen = localMaxLen ?? inheritedMaxLen;

    const currentId = toAlpha(Number(parentIdChain.pop() ?? 0));
    const fullIdChain: string[] = [
      ...parentIdChain.map((value) => String(value)),
      currentId,
    ];
    const idStr = fullIdChain.join('-');

    emit(
      {
        type: 'start',
        id: idStr,
        label,
        depth,
        meta: extractMeta(actionInternal),
      },
      prefix,
    );

    const measureForNextLevel = createNestedResolver(
      false,
      fullIdChain,
      childCounterRef,
      depth,
      _measureInternalSync,
      prefix,
      effectiveMaxLen,
    );

    try {
      const result = fnInternal(measureForNextLevel as MeasureSyncFn);
      const duration = performance.now() - start;

      emit(
        {
          type: 'success',
          id: idStr,
          label,
          depth,
          duration,
          result: mapResultForLog(actionInternal, result),
          budget,
          maxResultLength: effectiveMaxLen,
        },
        prefix,
      );

      return result;
    } catch (error) {
      const duration = performance.now() - start;

      emit(
        {
          type: 'error',
          id: idStr,
          label,
          depth,
          duration,
          error,
          budget,
          maxResultLength: effectiveMaxLen,
        },
        prefix,
      );

      _lastError = error;

      if (onError) {
        try {
          return onError(error);
        } catch (onErrorError) {
          emit(
            {
              type: 'error',
              id: idStr,
              label: `${label} (onError)`,
              depth,
              duration: performance.now() - start,
              error: onErrorError,
              budget,
              maxResultLength: effectiveMaxLen,
            },
            prefix,
          );

          _lastError = onErrorError;
          return null;
        }
      }

      return null;
    }
  };

  // ─── measure Async ─────────────────────────────────────────────

  const measureFn = async <T = null>(
    arg1: MeasureAction<T>,
    arg2?:
      | ((measure: MeasureFn, measureSync: MeasureSyncFn) => Promise<T>)
      | ((measure: MeasureFn) => Promise<T>)
      | (() => Promise<T>),
    arg3?: (error: unknown) => T | null | Promise<T | null>,
  ): Promise<T | null> => {
    if (typeof arg2 === 'function') {
      return _measureInternal(
        arg2 as any,
        arg1,
        [counter.value++],
        0,
        arg3,
        scopeMaxLen,
      ) as Promise<T | null>;
    }

    const currentId = toAlpha(counter.value++);

    emit(
      {
        type: 'annotation',
        id: currentId,
        label: buildActionLabel(arg1),
        depth: 0,
        meta: extractMeta(arg1),
      },
      prefix,
    );

    return Promise.resolve(null);
  };

  measureFn.timed = async <T = null>(
    arg1: MeasureAction<T>,
    arg2?: ((measure: MeasureFn) => Promise<T>) | (() => Promise<T>),
  ): Promise<TimedResult<T>> => {
    const start = performance.now();
    const result = await measureFn(arg1, arg2 as any);
    const duration = performance.now() - start;

    return {
      result,
      duration,
    };
  };

  measureFn.retry = async <T = null>(
    label: MeasureAction<T>,
    opts: RetryOpts,
    fn: () => Promise<T>,
  ): Promise<T | null> => {
    const attempts = opts.attempts ?? 3;
    const delay = opts.delay ?? 1000;
    const backoff = opts.backoff ?? 1;
    const lbl = buildActionLabel(label);
    const budget = extractBudget(label);
    const effectiveMaxLen = extractMaxResultLength(label) ?? scopeMaxLen;

    for (let i = 0; i < attempts; i += 1) {
      const attempt = i + 1;
      const attemptLabel = `${lbl} [${attempt}/${attempts}]`;
      const start = performance.now();
      const currentId = toAlpha(counter.value++);

      emit(
        {
          type: 'start',
          id: currentId,
          label: attemptLabel,
          depth: 0,
          meta: extractMeta(label),
        },
        prefix,
      );

      try {
        const result = await fn();
        const duration = performance.now() - start;

        emit(
          {
            type: 'success',
            id: currentId,
            label: attemptLabel,
            depth: 0,
            duration,
            result: mapResultForLog(label, result),
            budget,
            maxResultLength: effectiveMaxLen,
          },
          prefix,
        );

        return result;
      } catch (error) {
        const duration = performance.now() - start;

        emit(
          {
            type: 'error',
            id: currentId,
            label: attemptLabel,
            depth: 0,
            duration,
            error,
            budget,
            maxResultLength: effectiveMaxLen,
          },
          prefix,
        );

        _lastError = error;

        if (attempt < attempts) {
          await new Promise((resolve) => {
            setTimeout(resolve, delay * Math.pow(backoff, i));
          });
        }
      }
    }

    return null;
  };

  measureFn.assert = async <T>(
    arg1: MeasureAction<T>,
    arg2: ((measure: MeasureFn) => Promise<T>) | (() => Promise<T>),
  ): Promise<T> => {
    const result = await measureFn(arg1, arg2 as any);

    if (result === null) {
      const cause = _lastError;
      _lastError = null;

      throw new Error(`measure.assert: "${buildActionLabel(arg1)}" failed`, {
        cause,
      });
    }

    return result;
  };

  measureFn.wrap = <A extends any[], R>(
    label: MeasureAction<R>,
    fn: (...args: A) => Promise<R>,
  ): ((...args: A) => Promise<R | null>) => {
    return (...args: A) => measureFn(label, () => fn(...args));
  };

  measureFn.batch = async <T, R>(
    label: MeasureAction<R>,
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    opts?: BatchOpts,
  ): Promise<(R | null)[]> => {
    const lbl = buildActionLabel(label);
    const total = items.length;
    const every = opts?.every ?? Math.max(1, Math.ceil(total / 5));
    const currentId = toAlpha(counter.value++);
    const startTime = performance.now();
    const budget = extractBudget(label);

    emit(
      {
        type: 'start',
        id: currentId,
        label: `${lbl} (${total} items)`,
        depth: 0,
        meta: extractMeta(label),
      },
      prefix,
    );

    const results: (R | null)[] = [];

    for (let i = 0; i < items.length; i += 1) {
      try {
        results.push(await fn(items[i]!, i));
      } catch (error) {
        _lastError = error;
        results.push(null);
      }

      if ((i + 1) % every === 0 && i + 1 < total) {
        const elapsed = (performance.now() - startTime) / 1000;
        const rate = ((i + 1) / elapsed).toFixed(0);

        emit(
          {
            type: 'annotation',
            id: currentId,
            label: `${i + 1}/${total} (${elapsed.toFixed(1)}s, ${rate}/s)`,
            depth: 0,
          },
          prefix,
        );
      }
    }

    const duration = performance.now() - startTime;
    const okCount = results.filter((result) => result !== null).length;

    emit(
      {
        type: 'success',
        id: currentId,
        label: `${lbl} (${total} items)`,
        depth: 0,
        duration,
        result: `${okCount}/${total} ok`,
        budget,
      },
      prefix,
    );

    return results;
  };

  // ─── measureSync ───────────────────────────────────────────────

  const measureSyncFn = <T = null>(
    arg1: MeasureAction<T>,
    arg2?: ((measure: MeasureSyncFn) => T) | (() => T),
    arg3?: (error: unknown) => T | null,
  ): T | null => {
    if (typeof arg2 === 'function') {
      return _measureInternalSync(
        arg2 as any,
        arg1,
        [counter.value++],
        0,
        arg3,
        scopeMaxLen,
      ) as T | null;
    }

    const currentId = toAlpha(counter.value++);

    emit(
      {
        type: 'annotation',
        id: currentId,
        label: buildActionLabel(arg1),
        depth: 0,
        meta: extractMeta(arg1),
      },
      prefix,
    );

    return null;
  };

  measureSyncFn.timed = <T = null>(
    arg1: MeasureAction<T>,
    arg2?: ((measure: MeasureSyncFn) => T) | (() => T),
  ): TimedResult<T> => {
    const start = performance.now();
    const result = measureSyncFn(arg1, arg2 as any);
    const duration = performance.now() - start;

    return {
      result,
      duration,
    };
  };

  measureSyncFn.assert = <T>(
    arg1: MeasureAction<T>,
    arg2: ((measure: MeasureSyncFn) => T) | (() => T),
  ): T => {
    const result = measureSyncFn(arg1, arg2 as any);

    if (result === null) {
      const cause = _lastError;
      _lastError = null;

      throw new Error(`measureSync.assert: "${buildActionLabel(arg1)}" failed`, {
        cause,
      });
    }

    return result;
  };

  measureSyncFn.wrap = <A extends any[], R>(
    label: MeasureAction<R>,
    fn: (...args: A) => R,
  ): ((...args: A) => R | null) => {
    return (...args: A) => measureSyncFn(label, () => fn(...args));
  };

  return {
    measure: measureFn as MeasureFn & {
      timed: <T = null>(
        arg1: MeasureAction<T>,
        arg2?: ((measure: MeasureFn) => Promise<T>) | (() => Promise<T>),
      ) => Promise<TimedResult<T>>;

      retry: <T = null>(
        label: MeasureAction<T>,
        opts: RetryOpts,
        fn: () => Promise<T>,
      ) => Promise<T | null>;

      assert: <T>(
        arg1: MeasureAction<T>,
        arg2: ((measure: MeasureFn) => Promise<T>) | (() => Promise<T>),
      ) => Promise<T>;

      wrap: <A extends any[], R>(
        label: MeasureAction<R>,
        fn: (...args: A) => Promise<R>,
      ) => (...args: A) => Promise<R | null>;

      batch: <T, R>(
        label: MeasureAction<R>,
        items: T[],
        fn: (item: T, index: number) => Promise<R>,
        opts?: BatchOpts,
      ) => Promise<(R | null)[]>;
    },

    measureSync: measureSyncFn as MeasureSyncFn & {
      timed: <T = null>(
        arg1: MeasureAction<T>,
        arg2?: ((measure: MeasureSyncFn) => T) | (() => T),
      ) => TimedResult<T>;

      assert: <T>(
        arg1: MeasureAction<T>,
        arg2: ((measure: MeasureSyncFn) => T) | (() => T),
      ) => T;

      wrap: <A extends any[], R>(
        label: MeasureAction<R>,
        fn: (...args: A) => R,
      ) => (...args: A) => R | null;
    },
  };
};

// ─── Default Global Instance ─────────────────────────────────────────

const globalInstance = createMeasureImpl();

export const measure = globalInstance.measure;
export const measureSync = globalInstance.measureSync;

// ─── Scoped Instances ────────────────────────────────────────────────

export const createMeasure = (scopePrefix: string, opts?: ScopeOpts) => {
  const scopeCounter = {
    value: 0,
  };

  const scoped = createMeasureImpl(scopePrefix, scopeCounter, opts);

  return {
    ...scoped,
    resetCounter: () => {
      scopeCounter.value = 0;
    },
  };
};
