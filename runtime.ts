import {
  finiteNumber,
  integer,
  MAX_TIMER_MS,
  options,
  silent,
  scopeLevel,
  validateScopeOptions,
} from "./config.js";
import type { ContextStorage, Span } from "./context.js";
import { formatDuration, toAlpha } from "./format.js";
import { consumeThenable, emit } from "./logger.js";
import {
  errorMessage,
  stringifyForLog,
  summarizeForMeasure,
} from "./serialization.js";
import type {
  BatchSummary,
  MaybePromise,
  MeasureAction,
  MeasureActionObject,
  MeasureFn,
  MeasureSyncFn,
  MeasureScopeOptions,
  TimedResult,
} from "./types.js";

type AnyAction = MeasureAction<any>;
type RunOptions = {
  detached?: boolean;
  onDuration?: (duration: number) => void;
};
const actionObject = <T>(
  action: MeasureAction<T>,
): MeasureActionObject<T> | undefined =>
  typeof action === "object" && action !== null ? action : undefined;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const summarize = (action: AnyAction, value: unknown): unknown =>
  (actionObject(action)?.summarize ?? options.summarize)
    ? summarizeForMeasure(value)
    : value;

function startValue(action: AnyAction): unknown {
  if (typeof action === "string") return action;
  try {
    const result = action.start ? action.start() : "";
    if (consumeThenable(result, () => {}))
      return { startMapperError: "start() must return synchronously" };
    return result;
  } catch (error) {
    return { startMapperError: errorMessage(error) };
  }
}

function labelValue(
  scope: string | undefined,
  action: AnyAction,
  value: unknown,
): string {
  if (
    typeof value === "string" &&
    (actionObject(action)?.stripScopePrefix ?? options.stripScopePrefix) &&
    scope
  ) {
    const prefix = value.startsWith(`${scope}:`)
      ? `${scope}:`
      : `${scope.split(":")[0]}:`;
    if (value.startsWith(prefix)) value = value.slice(prefix.length);
  }
  value = summarize(action, value);
  return typeof value === "string" ? value : stringifyForLog(value, 0);
}

function endValue<T>(action: MeasureAction<T>, result: T): unknown {
  let value: unknown = result;
  try {
    const map = actionObject(action)?.end;
    if (map) {
      value = map(result);
      if (consumeThenable(value, () => {}))
        value = { resultMapperError: "end() must return synchronously" };
    }
  } catch (error) {
    value = { resultMapperError: errorMessage(error) };
  }
  return summarize(action, value);
}

function settings(action: AnyAction, sync = false, scopeOptions: MeasureScopeOptions = {}) {
  if (
    typeof action !== "string" &&
    (typeof action !== "object" || action === null)
  )
    throw new TypeError("action must be a string or action object");
  const obj = actionObject(action);
  for (const name of ["start", "end", "catch"] as const) {
    if (obj?.[name] !== undefined && typeof obj[name] !== "function")
      throw new TypeError(`${name} must be a function`);
  }
  const budget =
    obj?.budget === undefined ? undefined : finiteNumber("budget", obj.budget);
  if (obj?.maxValueLength !== undefined) integer("maxValueLength", obj.maxValueLength);
  if (obj?.maxResultLength !== undefined) integer("maxResultLength", obj.maxResultLength);
  const maxResultLength = obj?.maxResultLength ?? obj?.maxValueLength ??
    scopeOptions.maxResultLength ?? scopeOptions.maxValueLength ??
    options.maxResultLength ?? options.maxValueLength;
  const timeout =
    obj?.timeout === undefined
      ? undefined
      : finiteNumber("timeout", obj.timeout, 0, MAX_TIMER_MS);
  if (sync && timeout !== undefined)
    throw new TypeError(
      "measureSync does not support timeout; use measure instead",
    );
  return { budget, maxResultLength, timeout };
}

async function withTimeout<T>(
  fn: () => MaybePromise<T>,
  timeout: number | undefined,
): Promise<T> {
  if (!timeout) return await fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timeout (${formatDuration(timeout)})`)),
      timeout,
    );
  });
  try {
    // Invoke immediately while synchronous browser context is active.
    return await Promise.race([Promise.resolve(fn()), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Each platform entry owns one storage and one monotonically increasing trace counter. */
export function createMeasureRuntime(storage: ContextStorage<Span>) {
  let traceCounter = 0;

  function createImpl(
    scope?: string,
    counter = { value: 0 },
    boundParent?: Span | null,
    scopeOptions: MeasureScopeOptions = {},
  ): MeasureFn {
    const actionSettings = (action: AnyAction, sync = false) => settings(action, sync, scopeOptions);
    const policy = (cap: number, originalError?: unknown) => ({
      level: scopeOptions.level ?? scopeLevel(scope),
      slowThreshold: scopeOptions.slowThreshold ?? options.slowThreshold,
      maxValueLength: cap,
      originalError,
    });
    const formatId = (id: string) => (scope ? `${scope}:${id}` : id);
    const createSpan = (detached = false): Span => {
      const parent = detached
        ? undefined
        : boundParent === undefined
          ? storage.getStore()
          : boundParent;
      const id = parent
        ? `${parent.id}-${toAlpha(parent.childCounter++)}`
        : toAlpha(counter.value++);
      return {
        id,
        fullId: formatId(id),
        traceId: parent?.traceId ?? String(++traceCounter),
        parentId: parent?.fullId,
        depth: parent ? parent.depth + 1 : 0,
        childCounter: 0,
      };
    };
    const metadata = (span: Span, label: string) => ({
      id: span.fullId,
      rawId: span.id,
      traceId: span.traceId,
      parentId: span.parentId,
      scope,
      depth: span.depth,
      label,
    });

    const note = (action: AnyAction, opts?: RunOptions) => {
      const { maxResultLength } = actionSettings(action);
      if (silent) return;
      const span = createSpan(opts?.detached);
      const value = startValue(action);
      emit({
        ...metadata(span, labelValue(scope, action, value)),
        type: "annotation",
        value,
        data: value,
      }, policy(maxResultLength));
    };

    const run = async <T>(
      action: MeasureAction<T>,
      fn: () => MaybePromise<T>,
      opts?: RunOptions,
    ): Promise<T> => {
      const { budget, maxResultLength, timeout } = actionSettings(action);
      const span = createSpan(opts?.detached);
      const observed = !silent;
      const value = observed ? startValue(action) : undefined;
      const meta = metadata(
        span,
        observed ? labelValue(scope, action, value) : "",
      );
      if (observed) emit({ ...meta, type: "start", value, data: value }, policy(maxResultLength));
      const startedAt = performance.now();
      return await storage.run(span, async () => {
        let result: T;
        try {
          result = timeout ? await withTimeout(fn, timeout) : await fn();
        } catch (error) {
          const duration = performance.now() - startedAt;
          opts?.onDuration?.(duration);
          if (observed && !silent) {
            const printed = summarize(action, error);
            emit({
              ...meta,
              type: "error",
              duration,
              error: printed,
              data: printed,
              budget,
              maxResultLength,
            }, policy(maxResultLength, error));
          }
          const recover = actionObject(action)?.catch;
          if (recover) return await recover(error);
          throw error;
        }
        const duration = performance.now() - startedAt;
        opts?.onDuration?.(duration);
        if (observed && !silent) {
          const printed = endValue(action, result);
          emit({
            ...meta,
            type: "success",
            duration,
            result: printed,
            data: printed,
            budget,
            maxResultLength,
          }, policy(maxResultLength));
        }
        return result;
      });
    };

    const runSync = <T>(
      action: MeasureAction<T>,
      fn: () => T,
      opts?: RunOptions,
    ): T => {
      const { budget, maxResultLength } = actionSettings(action, true);
      const span = createSpan(opts?.detached);
      const observed = !silent;
      const value = observed ? startValue(action) : undefined;
      const meta = metadata(
        span,
        observed ? labelValue(scope, action, value) : "",
      );
      if (observed) emit({ ...meta, type: "start", value, data: value }, policy(maxResultLength));
      const startedAt = performance.now();
      return storage.run(span, () => {
        let result: T;
        try {
          result = fn();
          if (consumeThenable(result, () => {}))
            throw new TypeError(
              "measureSync callback must return synchronously",
            );
        } catch (error) {
          const duration = performance.now() - startedAt;
          opts?.onDuration?.(duration);
          if (observed && !silent) {
            const printed = summarize(action, error);
            emit({
              ...meta,
              type: "error",
              duration,
              error: printed,
              data: printed,
              budget,
              maxResultLength,
            }, policy(maxResultLength, error));
          }
          const recover = actionObject(action)?.catch;
          if (recover) {
            const recovered = recover(error);
            if (consumeThenable(recovered, () => {}))
              throw new TypeError(
                "measureSync catch() must return synchronously",
              );
            return recovered as T;
          }
          throw error;
        }
        const duration = performance.now() - startedAt;
        opts?.onDuration?.(duration);
        if (observed && !silent) {
          const printed = endValue(action, result);
          emit({
            ...meta,
            type: "success",
            duration,
            result: printed,
            data: printed,
            budget,
            maxResultLength,
          }, policy(maxResultLength));
        }
        return result;
      });
    };

    const sync = ((action: AnyAction, fn?: () => unknown) => {
      if (fn === undefined) {
        actionSettings(action, true);
        note(action);
        return null;
      }
      if (typeof fn !== "function")
        throw new TypeError("callback must be a function");
      return runSync(action, fn);
    }) as MeasureSyncFn;
    sync.root = ((action: AnyAction, fn?: () => unknown) => {
      if (fn === undefined) {
        actionSettings(action, true);
        note(action, { detached: true });
        return null;
      }
      if (typeof fn !== "function")
        throw new TypeError("callback must be a function");
      return runSync(action, fn, { detached: true });
    }) as MeasureSyncFn["root"];
    sync.note = (action) => {
      actionSettings(action, true);
      note(action);
    };
    sync.timed = <T>(action: MeasureAction<T>, fn: () => T): TimedResult<T> => {
      let duration = 0;
      const result = runSync(action, fn, {
        onDuration: (ms) => {
          duration = ms;
        },
      });
      return { result, duration };
    };
    sync.wrap = <This, A extends unknown[], R>(
      action: MeasureAction<R>,
      fn: (this: This, ...args: A) => R,
    ) =>
      function (this: This, ...args: A): R {
        return runSync(action, () => fn.apply(this, args));
      };

    const m = (async (action: AnyAction, fn?: () => unknown) => {
      if (fn === undefined) {
        note(action);
        return null;
      }
      if (typeof fn !== "function")
        throw new TypeError("callback must be a function");
      return await run(action, fn);
    }) as MeasureFn;
    m.root = (async (action: AnyAction, fn?: () => unknown) => {
      if (fn === undefined) {
        note(action, { detached: true });
        return null;
      }
      if (typeof fn !== "function")
        throw new TypeError("callback must be a function");
      return await run(action, fn, { detached: true });
    }) as MeasureFn["root"];
    m.sync = sync;
    m.note = note;
    m.timed = async <T>(
      action: MeasureAction<T>,
      fn: () => MaybePromise<T>,
    ): Promise<TimedResult<T>> => {
      let duration = 0;
      const result = await run(action, fn, {
        onDuration: (ms) => {
          duration = ms;
        },
      });
      return { result, duration };
    };
    m.wrap = <This, A extends unknown[], R>(
      action: MeasureAction<R>,
      fn: (this: This, ...args: A) => MaybePromise<R>,
    ) =>
      function (this: This, ...args: A): Promise<R> {
        return run(action, () => fn.apply(this, args));
      };

    m.retry = async (action, opts, fn) => {
      actionSettings(action);
      const attempts = integer("attempts", opts.attempts ?? 3, 1);
      const delay = finiteNumber("delay", opts.delay ?? 1000, 0, MAX_TIMER_MS);
      const backoff = finiteNumber(
        "backoff",
        opts.backoff ?? 1,
        Number.MIN_VALUE,
      );
      let lastError: unknown;
      const attemptMeasure = createImpl(
        scope,
        counter,
        boundParent === undefined ? (storage.getStore() ?? null) : boundParent,
        scopeOptions,
      );
      for (let i = 0; i < attempts; i++) {
        const suffix = `[${i + 1}/${attempts}]`;
        const attemptAction =
          typeof action === "string"
            ? `${action} ${suffix}`
            : {
                ...action,
                catch: undefined,
                start: () => {
                  const label = labelValue(scope, action, startValue(action));
                  return label ? `${label} ${suffix}` : suffix;
                },
              };
        try {
          return await attemptMeasure(attemptAction, fn);
        } catch (error) {
          lastError = error;
          if (i + 1 < attempts && delay > 0)
            await sleep(Math.min(MAX_TIMER_MS, delay * backoff ** i));
        }
      }
      const recover = actionObject(action)?.catch;
      if (recover) return await recover(lastError);
      throw lastError;
    };

    m.batch = async <T, R>(
      action: MeasureAction<BatchSummary<R>>,
      items: readonly T[],
      fn: (item: T, index: number) => MaybePromise<R>,
      opts?: { every?: number },
    ) => {
      const total = items.length;
      const every = integer(
        "every",
        opts?.every ?? Math.max(1, Math.ceil(total / 5)),
        1,
      );
      const batchAction: MeasureAction<BatchSummary<R>> = {
        ...(actionObject(action) ?? {}),
        start: () => {
          const label = labelValue(scope, action, startValue(action));
          return label ? `${label} (${total} items)` : `${total} items`;
        },
        end:
          actionObject(action)?.end ??
          ((summary) => `${summary.ok}/${summary.total} ok`),
      };
      const summary = await m(batchAction, async () => {
        const span = storage.getStore();
        const results: (R | null)[] = [];
        let ok = 0;
        for (let i = 0; i < total; i++) {
          try {
            // Re-enter for each callback: browser context does not survive await.
            results.push(
              await (span
                ? storage.run(span, () => fn(items[i]!, i))
                : fn(items[i]!, i)),
            );
            ok++;
          } catch {
            results.push(null);
          }
          if ((i + 1) % every === 0 && i + 1 < total) {
            const report = () =>
              createImpl(scope, counter, undefined, scopeOptions).note(`${i + 1}/${total} (${ok} ok)`);
            if (span) storage.run(span, report);
            else report();
          }
        }
        return { ok, total, results };
      });
      return summary.results;
    };
    m.measure = m;
    m.measureSync = sync;
    m.bindContext = () =>
      createImpl(scope, counter, storage.getStore() ?? boundParent ?? null, scopeOptions);
    m.resetCounter = () => {
      counter.value = 0;
    };
    return m;
  }
  const measure = createImpl();
  return {
    measure,
    measureSync: measure.sync,
    createMeasure: (scope?: string, opts: MeasureScopeOptions = {}) =>
      createImpl(scope, undefined, undefined, validateScopeOptions(opts)),
  };
}