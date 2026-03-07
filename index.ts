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
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'string') {
    const q = JSON.stringify(value);
    if (cap === 0) return q;
    return q.length > cap ? q.slice(0, cap - 1) + '…"' : q;
  }
  try {
    const seen = new WeakSet();
    const str = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
      if (typeof val === 'bigint') return `${val}n`;
      return val;
    });
    if (cap === 0) return str;
    return str.length > cap ? str.slice(0, cap) + '…' : str;
  } catch {
    return String(value);
  }
};

// ─── Duration Formatting ─────────────────────────────────────────────

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

// ─── Timestamps ──────────────────────────────────────────────────────

let timestamps =
  typeof process !== 'undefined' && (process.env.MEASURE_TIMESTAMPS === '1' || process.env.MEASURE_TIMESTAMPS === 'true');

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

// ─── Configuration ───────────────────────────────────────────────────

export let silent =
  typeof process !== 'undefined' && (process.env.MEASURE_SILENT === '1' || process.env.MEASURE_SILENT === 'true');

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

const buildActionLabel = (actionInternal: string | object): string => {
  return typeof actionInternal === 'object' && actionInternal !== null && 'label' in actionInternal
    ? String(actionInternal.label)
    : String(actionInternal);
};

const extractBudget = (actionInternal: string | object): number | undefined => {
  if (typeof actionInternal !== 'object' || actionInternal === null) return undefined;
  if ('budget' in actionInternal) return Number((actionInternal as any).budget);
  return undefined;
};

const extractTimeout = (actionInternal: string | object): number | undefined => {
  if (typeof actionInternal !== 'object' || actionInternal === null) return undefined;
  if ('timeout' in actionInternal) return Number((actionInternal as any).timeout);
  return undefined;
};

const extractMaxResultLength = (actionInternal: string | object): number | undefined => {
  if (typeof actionInternal !== 'object' || actionInternal === null) return undefined;
  if ('maxResultLength' in actionInternal) return Number((actionInternal as any).maxResultLength);
  return undefined;
};

const extractMeta = (actionInternal: string | object): Record<string, unknown> | undefined => {
  if (typeof actionInternal !== 'object' || actionInternal === null) return undefined;
  const details = { ...actionInternal };
  if ('label' in details) delete (details as any).label;
  if ('budget' in details) delete (details as any).budget;
  if ('maxResultLength' in details) delete (details as any).maxResultLength;
  if (Object.keys(details).length === 0) return undefined;
  return details as Record<string, unknown>;
};

const formatMeta = (meta?: Record<string, unknown>): string => {
  if (!meta) return '';
  const params = Object.entries(meta)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  return ` (${params})`;
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
    case 'start':
      console.log(`${t}${id} ... ${event.label}${formatMeta(event.meta)}`);
      break;
    case 'success': {
      const endLabel = dotEndLabel ? dotChar.repeat(event.label.length) : event.label;
      const resultStr = event.result !== undefined ? safeStringify(event.result, event.maxResultLength) : '';
      const arrow = resultStr ? ` → ${resultStr}` : '';
      const budgetWarn = event.budget && event.duration! > event.budget
        ? ` ⚠ OVER BUDGET (${formatDuration(event.budget)})`
        : '';
      console.log(`${t}${id} ${endLabel} ${formatDuration(event.duration!)}${arrow}${budgetWarn}`);
      break;
    }
    case 'error': {
      const endLabel = dotEndLabel ? dotChar.repeat(event.label.length) : event.label;
      const errorMsg = event.error instanceof Error ? event.error.message : String(event.error);
      const budgetWarn = event.budget && event.duration! > event.budget
        ? ` ⚠ OVER BUDGET (${formatDuration(event.budget)})`
        : '';
      console.log(`${t}${id} ✗ ${endLabel} ${formatDuration(event.duration!)} (${errorMsg})${budgetWarn}`);
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
    case 'annotation':
      console.log(`${t}${id} = ${event.label}${formatMeta(event.meta)}`);
      break;
  }
};

// ─── Types ───────────────────────────────────────────────────────────

export type MeasureFn = {
  <U>(label: string | object, fn: () => Promise<U>): Promise<U | null>;
  <U>(label: string | object, fn: (m: MeasureFn) => Promise<U>): Promise<U | null>;
  (label: string | object): Promise<null>;
};

export type MeasureSyncFn = {
  <U>(label: string | object, fn: () => U): U | null;
  <U>(label: string | object, fn: (m: MeasureSyncFn) => U): U | null;
  (label: string | object): null;
};

export type TimedResult<T> = { result: T | null; duration: number };

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
  resolver: <U>(fn: any, action: any, chain: (string | number)[], depth: number, onError?: (error: unknown) => any, inheritedMaxLen?: number) => Promise<U | null> | (U | null),
  prefix?: string,
  inheritedMaxLen?: number
) => {
  return (...args: any[]) => {
    const label = args[0];
    const fn = args[1];
    const onError = args[2];

    if (typeof fn === 'function') {
      const childParentChain = [...fullIdChain, childCounterRef.value++];
      return resolver(fn, label, childParentChain, depth + 1, typeof onError === 'function' ? onError : undefined, inheritedMaxLen);
    } else {
      emit({
        type: 'annotation',
        id: fullIdChain.join('-'),
        label: buildActionLabel(label),
        depth: depth + 1,
        meta: extractMeta(label),
      }, prefix);
      return isAsync ? Promise.resolve(null) : null;
    }
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

const createMeasureImpl = (prefix?: string, counterRef?: { value: number }, scopeOpts?: ScopeOpts) => {
  const counter = counterRef ?? { get value() { return globalRootCounter; }, set value(v) { globalRootCounter = v; } };
  const scopeMaxLen = scopeOpts?.maxResultLength;
  let _lastError: unknown = null;

  const _measureInternal = async <U>(
    fnInternal: (measure: MeasureFn) => Promise<U>,
    actionInternal: string | object,
    parentIdChain: (string | number)[],
    depth: number,
    onError?: (error: unknown) => any,
    inheritedMaxLen?: number
  ): Promise<U | null> => {
    const start = performance.now();
    const childCounterRef = { value: 0 };
    const label = buildActionLabel(actionInternal);
    const budget = extractBudget(actionInternal);
    const timeout = extractTimeout(actionInternal);
    const localMaxLen = extractMaxResultLength(actionInternal);
    const effectiveMaxLen = localMaxLen ?? inheritedMaxLen;

    const currentId = toAlpha(Number(parentIdChain.pop() ?? 0));
    const fullIdChain: string[] = [...parentIdChain.map(v => String(v)), currentId];
    const idStr = fullIdChain.join('-');

    emit({
      type: 'start',
      id: idStr,
      label,
      depth,
      meta: extractMeta(actionInternal),
    }, prefix);

    const measureForNextLevel = createNestedResolver(true, fullIdChain, childCounterRef, depth, _measureInternal, prefix, effectiveMaxLen);

    try {
      let result: U;
      if (timeout && timeout > 0) {
        result = await Promise.race([
          fnInternal(measureForNextLevel as MeasureFn),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout (${formatDuration(timeout)})`)), timeout)
          ),
        ]);
      } else {
        result = await fnInternal(measureForNextLevel as MeasureFn);
      }
      const duration = performance.now() - start;
      emit({ type: 'success', id: idStr, label, depth, duration, result, budget, maxResultLength: effectiveMaxLen }, prefix);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      emit({ type: 'error', id: idStr, label, depth, duration, error, budget, maxResultLength: effectiveMaxLen }, prefix);
      _lastError = error;
      if (onError) {
        try {
          return onError(error);
        } catch (onErrorError) {
          emit({ type: 'error', id: idStr, label: `${label} (onError)`, depth, duration: performance.now() - start, error: onErrorError, budget, maxResultLength: effectiveMaxLen }, prefix);
          _lastError = onErrorError;
          return null;
        }
      }
      return null;
    }
  };

  const _measureInternalSync = <U>(
    fnInternal: (measure: MeasureSyncFn) => U,
    actionInternal: string | object,
    parentIdChain: (string | number)[],
    depth: number,
    _onError?: ((error: unknown) => any) | undefined,
    inheritedMaxLen?: number
  ): U | null => {
    const start = performance.now();
    const childCounterRef = { value: 0 };
    const label = buildActionLabel(actionInternal);
    const hasNested = fnInternal.length > 0;
    const budget = extractBudget(actionInternal);
    const localMaxLen = extractMaxResultLength(actionInternal);
    const effectiveMaxLen = localMaxLen ?? inheritedMaxLen;

    const currentId = toAlpha(Number(parentIdChain.pop() ?? 0));
    const fullIdChain: string[] = [...parentIdChain.map(v => String(v)), currentId];
    const idStr = fullIdChain.join('-');

    if (hasNested) {
      emit({
        type: 'start',
        id: idStr,
        label,
        depth,
        meta: extractMeta(actionInternal),
      }, prefix);
    }

    const measureForNextLevel = createNestedResolver(false, fullIdChain, childCounterRef, depth, _measureInternalSync, prefix, effectiveMaxLen);

    try {
      const result = fnInternal(measureForNextLevel as MeasureSyncFn);
      const duration = performance.now() - start;
      emit({ type: 'success', id: idStr, label, depth, duration, result, budget, maxResultLength: effectiveMaxLen }, prefix);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      emit({ type: 'error', id: idStr, label, depth, duration, error, budget, maxResultLength: effectiveMaxLen }, prefix);
      _lastError = error;
      return null;
    }
  };

  // ─── measure (async) ───────────────────────────────────────────

  const measureFn = async <T = null>(
    arg1: string | object,
    arg2?: ((measure: MeasureFn) => Promise<T>) | ((measure: MeasureFn) => T),
    arg3?: (error: unknown) => any
  ): Promise<T | null> => {
    if (typeof arg2 === 'function') {
      return _measureInternal(arg2 as any, arg1, [counter.value++], 0, arg3, scopeMaxLen) as Promise<T | null>;
    } else {
      const currentId = toAlpha(counter.value++);
      emit({
        type: 'annotation',
        id: currentId,
        label: buildActionLabel(arg1),
        depth: 0,
        meta: extractMeta(arg1),
      }, prefix);
      return Promise.resolve(null);
    }
  };

  measureFn.timed = async <T = null>(
    arg1: string | object,
    arg2?: ((measure: MeasureFn) => Promise<T>)
  ): Promise<TimedResult<T>> => {
    const start = performance.now();
    const result = await measureFn(arg1, arg2);
    const duration = performance.now() - start;
    return { result, duration };
  };

  measureFn.retry = async <T = null>(
    label: string | object,
    opts: RetryOpts,
    fn: () => Promise<T>
  ): Promise<T | null> => {
    const attempts = opts.attempts ?? 3;
    const delay = opts.delay ?? 1000;
    const backoff = opts.backoff ?? 1;
    const lbl = buildActionLabel(label);
    const budget = extractBudget(label);

    for (let i = 0; i < attempts; i++) {
      const attempt = i + 1;
      const attemptLabel = `${lbl} [${attempt}/${attempts}]`;
      const start = performance.now();
      const currentId = toAlpha(counter.value++);

      emit({
        type: 'start',
        id: currentId,
        label: attemptLabel,
        depth: 0,
        meta: extractMeta(label),
      }, prefix);

      try {
        const result = await fn();
        const duration = performance.now() - start;
        emit({ type: 'success', id: currentId, label: attemptLabel, depth: 0, duration, result, budget }, prefix);
        return result;
      } catch (error) {
        const duration = performance.now() - start;
        emit({ type: 'error', id: currentId, label: attemptLabel, depth: 0, duration, error, budget }, prefix);
        if (attempt < attempts) {
          await new Promise(r => setTimeout(r, delay * Math.pow(backoff, i)));
        }
      }
    }
    return null;
  };

  measureFn.assert = async <T>(
    arg1: string | object,
    arg2: ((measure: MeasureFn) => Promise<T>) | (() => Promise<T>)
  ): Promise<T> => {
    const result = await measureFn(arg1, arg2 as any);
    if (result === null) {
      const cause = _lastError;
      _lastError = null;
      throw new Error(`measure.assert: "${buildActionLabel(arg1)}" failed`, { cause });
    }
    return result;
  };

  measureFn.wrap = <A extends any[], R>(
    label: string | object,
    fn: (...args: A) => Promise<R>
  ): ((...args: A) => Promise<R | null>) => {
    return (...args: A) => measureFn(label, () => fn(...args));
  };

  measureFn.batch = async <T, R>(
    label: string | object,
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    opts?: BatchOpts
  ): Promise<(R | null)[]> => {
    const lbl = buildActionLabel(label);
    const total = items.length;
    const every = opts?.every ?? Math.max(1, Math.ceil(total / 5));
    const currentId = toAlpha(counter.value++);
    const startTime = performance.now();

    emit({
      type: 'start',
      id: currentId,
      label: `${lbl} (${total} items)`,
      depth: 0,
      meta: extractMeta(label),
    }, prefix);

    const results: (R | null)[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        results.push(await fn(items[i]!, i));
      } catch {
        results.push(null);
      }
      if ((i + 1) % every === 0 && i + 1 < total) {
        const elapsed = (performance.now() - startTime) / 1000;
        const rate = ((i + 1) / elapsed).toFixed(0);
        emit({
          type: 'annotation',
          id: currentId,
          label: `${i + 1}/${total} (${elapsed.toFixed(1)}s, ${rate}/s)`,
          depth: 0,
        }, prefix);
      }
    }

    const duration = performance.now() - startTime;
    const budget = extractBudget(label);
    emit({
      type: 'success',
      id: currentId,
      label: `${lbl} (${total} items)`,
      depth: 0,
      duration,
      result: `${results.filter(r => r !== null).length}/${total} ok`,
      budget,
    }, prefix);
    return results;
  };

  // ─── measureSync ───────────────────────────────────────────────

  const measureSyncFn = <T = null>(
    arg1: string | object,
    arg2?: ((measure: MeasureSyncFn) => T)
  ): T | null => {
    if (typeof arg2 === 'function') {
      return _measureInternalSync(arg2, arg1, [counter.value++], 0, undefined, scopeMaxLen) as T | null;
    } else {
      const currentId = toAlpha(counter.value++);
      emit({
        type: 'annotation',
        id: currentId,
        label: buildActionLabel(arg1),
        depth: 0,
        meta: extractMeta(arg1),
      }, prefix);
      return null;
    }
  };

  measureSyncFn.timed = <T = null>(
    arg1: string | object,
    arg2?: ((measure: MeasureSyncFn) => T)
  ): TimedResult<T> => {
    const start = performance.now();
    const result = measureSyncFn(arg1, arg2);
    const duration = performance.now() - start;
    return { result, duration };
  };

  measureSyncFn.assert = <T>(
    arg1: string | object,
    arg2: ((measure: MeasureSyncFn) => T) | (() => T)
  ): T => {
    const result = measureSyncFn(arg1, arg2 as any);
    if (result === null) {
      const cause = _lastError;
      _lastError = null;
      throw new Error(`measureSync.assert: "${buildActionLabel(arg1)}" failed`, { cause });
    }
    return result;
  };

  measureSyncFn.wrap = <A extends any[], R>(
    label: string | object,
    fn: (...args: A) => R
  ): ((...args: A) => R | null) => {
    return (...args: A) => measureSyncFn(label, () => fn(...args));
  };

  return { measure: measureFn, measureSync: measureSyncFn };
};

// ─── Default (global) instance ───────────────────────────────────────

const globalInstance = createMeasureImpl();

export const measure = globalInstance.measure;
export const measureSync = globalInstance.measureSync;

// ─── Scoped instances ────────────────────────────────────────────────

export const createMeasure = (scopePrefix: string, opts?: ScopeOpts) => {
  const scopeCounter = { value: 0 };
  const scoped = createMeasureImpl(scopePrefix, scopeCounter, opts);
  return {
    ...scoped,
    resetCounter: () => { scopeCounter.value = 0; },
  };
};

// ─── Utility exports ─────────────────────────────────────────────────

export { formatDuration };
