---
name: measure-fn
description: Add measured, observable operations with measure-fn while preserving application outcomes, explicit failure ownership, safe retries, browser context, and one scope definition per source file.
---

# measure-fn implementation guide

Use `measure-fn` to observe meaningful application boundaries without accidentally changing application behavior. The measured callback owns the business result and original error. Measurement, formatting, and logging are observers unless the caller explicitly selects recovery or a deadline changes the waiting outcome.

Read `README.md` for the complete public API and runtime contract. Prefer canonical APIs over legacy aliases. This guide defines implementation conventions, safety rules, and failure ownership for coding agents.

## Structure scopes by ownership

Define at most one `createMeasure()` scope in a source file. Name it for the subsystem owned by that module, not a temporary function or implementation detail.

```ts
import { createMeasure } from "measure-fn";
import { readAccount } from "./account-store.js";

const payments = createMeasure("payments");

export async function settlePayment(id: string) {
  return await payments.root("settle payment", async () => {
    const account = await readAccount(id);
    return await settle(account);
  });
}
```

The imported `account-store.js` module should own its own scope if it needs one. Do not define another module's scope locally merely to create colorful nested output.

If several files intentionally share one scope, define it once in a dedicated owner module and import that instance. Do not repeatedly call `createMeasure("payments")` across files.

Use `.root()` at independent entry points: HTTP requests, messages, jobs, commands, scheduled ticks, and recovery sessions. Use ordinary measurements for meaningful nested stages.

```ts
const result = await payments("prepare transaction", async () => {
  return await prepareTransaction();
});
```

On Node.js and Bun, nested measurements automatically share asynchronous context, including across different scopes. Do not manually duplicate trace identifiers to create this relationship.

Avoid measuring trivial expressions or every helper solely to increase log depth. Prefer descriptive operation names such as `load account`, `prepare transaction`, and `persist checkpoint` over `step 1`, `run`, or `handler`.

## Use the canonical API

The scoped instance is callable. Prefer these public forms:

| Operation | API |
| --- | --- |
| Asynchronous measurement | `await m(action, fn)` |
| Synchronous measurement | `m.sync(action, fn)` |
| Independent root | `m.root(action, fn)` |
| Synchronous root | `m.sync.root(action, fn)` |
| Retry | `m.retry(action, options, fn)` |
| Sequential batch | `m.batch(action, items, fn, options?)` |
| Reusable wrapper | `m.wrap(action, fn)` |
| Synchronous wrapper | `m.sync.wrap(action, fn)` |
| Timed result | `m.timed(action, fn)` |
| Synchronous timed result | `m.sync.timed(action, fn)` |
| Annotation | `m.note(action)` |
| Browser context binding | `m.bindContext()` |

`m.measure` and `m.measureSync` remain legacy aliases. Use `m()` and `m.sync()` in new code.

Ordinary asynchronous measurements return `Promise<T>`, including when their callbacks return synchronous values. Synchronous measurements return `T` directly.

Calling an asynchronous measurement without a callback creates an annotation and returns `Promise<null>`. The synchronous equivalent returns `null`. `.note()` returns `void`.

Use ESM imports. Node.js 18+, Bun, and browser bundlers are supported; no CommonJS build is shipped. CommonJS callers must use dynamic `import()`.

## Preserve application outcomes

By default, measured callbacks must return their original results or propagate their original errors.

```ts
const profile = await users("load profile", async () => {
  return await store.loadProfile(userId);
});
```

Use an action object to customize observation or provide explicit recovery:

```ts
const response = await api.root(
  {
    start: () => "GET /health",
    end: (response: Response) => ({ status: response.status }),
    error: (error) => ({
      code: errorCode(error),
      message: safeErrorMessage(error),
    }),
    catch: () => new Response("degraded", { status: 503 }),
  },
  async () => await buildHealthResponse(),
);
```

The action fields have different responsibilities:

- `start()` supplies the start-log value.
- `end(result)` supplies the success-log value without changing `result`.
- `error(error)` supplies the failure-log value without changing the thrown error.
- `catch(error)` explicitly converts a final failure into a valid recovery result.
- `budget` marks slow work without changing control flow.
- `timeout` sets a deadline for asynchronous measurements.

**The `error()` mapper must be used when a sanitized or structured logged failure is needed.** It receives the original error and controls the logged error value. The caller still receives the original failure unless an explicit `catch` recovers it.

```ts
await api(
  {
    start: () => "read remote state",
    error: (error) => ({
      code: errorCode(error),
      message: safeErrorMessage(error),
    }),
  },
  async () => await readRemoteState(),
);
```

Keep `start`, `end`, and `error` mappers synchronous, pure, and side-effect-free. A throwing or asynchronous error mapper is diagnosed as `errorMapperError` rather than replacing the application's failure. Observation mappers may be skipped in global silent mode.

Do not place required persistence, auditing, recovery, or other business side effects inside observation mappers.

An action `catch` runs as explicit recovery, not as an observation mapper. A recovered failure still produces an error event, not a second success event. If recovery itself throws, its error propagates.

Never silently replace missing data, failed invariants, unknown write outcomes, or authorization failures with `null`, `0`, `{}`, an empty array, or stale state unless the caller's contract explicitly permits that recovery.

Synchronous callbacks and synchronous recovery must remain synchronous. Do not return promise-like results from `m.sync()` or `m.sync.wrap()` for ordinary synchronous functions. Do not specify `timeout` on synchronous actions.

## Retry only when the operation owner permits it

**Without `retryIf`, `.retry()` treats every failure as eligible for retry until the attempt limit is reached.** This includes permanent failures and uncertain writes.

Always make retry eligibility deliberate. Use `retryIf(error, attempt)` to classify failures rather than assuming retries are safe.

```ts
const state = await rpc.retry(
  {
    start: () => "read remote state",
    error: (error) => ({
      code: errorCode(error),
      message: safeErrorMessage(error),
    }),
  },
  {
    attempts: 3,
    delay: 100,
    backoff: 2,
    retryIf: (error, attempt) => isTransientReadError(error),
  },
  async () => await readRemoteState(),
);
```

`attempts` includes the initial attempt. `delay` defaults to 1000 milliseconds; `backoff` multiplies subsequent delays.

`retryIf` receives the original failure and the attempt number after each failed attempt except the last. It may return a boolean or `PromiseLike<boolean>`. Returning `false` stops retries. Returning a non-boolean value causes a `TypeError`.

An action's `catch` applies only as final explicit recovery after retry processing stops or is exhausted. It does not turn every failed attempt into success.

Follow these rules:

1. Retry only when the operation is repeatable and the failure is classified as transient.
2. Always guard writes. Do not automatically retry a write whose previous attempt might have committed.
3. Keep one retry owner per operation. Avoid stacking transport, SDK, and application retry loops without a total-attempt budget.
4. Bound both attempt count and overall elapsed time at the application level.
5. Never automatically retry a multi-step state-changing workflow unless the complete workflow is demonstrably idempotent and recoverable.
6. Treat cancellation, authorization errors, validation failures, and invariant failures as non-retryable unless an explicit domain policy proves otherwise.

The retry helper does not automatically classify errors, add jitter, honor `Retry-After`, cancel previous attempts, guarantee idempotency, or impose an overall workflow deadline.

For repeatable HTTP reads, consider connection failures, response consumption, and decoding. A rejected `fetch()` can occur before any response status exists.

A timeout limits how long the measurement waits. It does not cancel the callback or undo a submitted write. Retrying timed-out work can overlap a still-running previous attempt. Use an `AbortSignal` with cooperative I/O and ensure unsafe overlap cannot occur.

## Give every failure an owner

Choose retry, recovery, deferral, reconciliation, or termination from operation semantics, not merely from the presence of an exception.

For repeatable reads with classified transient infrastructure failures, retry within explicit limits, then defer if fresh data remains unavailable. For missing, invalid, or stale data, preserve validation failure or return an explicitly deferred result.

For configuration, authorization, or invariant failures, disable the affected operation or terminate deliberately rather than repeating the same request.

For a write whose response is lost, treat the outcome as unknown. A timeout or connection reset does not prove the remote system failed to commit.

Persist sufficient operation metadata before submission, pause dependent writes, and reconcile durable state before retrying or rebuilding the operation.

```ts
const pending = await journal.prepare({ operationId, target });

try {
  const receipt = await payments(
    "submit payment",
    async () => await client.submit(pending),
  );

  await journal.confirm(operationId, receipt);
  return receipt;
} catch (error) {
  await journal.markUnknown(operationId, error);
  throw error;
}
```

Use durable reconciliation on restart before enabling dependent writes. In-memory flags and process supervisors are not substitutes for persisted recovery state.

For shutdown or cancellation, stop scheduling, propagate `AbortSignal` to cooperative I/O, settle owned work, and clean up. Do not reclassify deliberate shutdown as a transient retry.

For logger failures, let `measure-fn` contain them. Use `onLoggerError` as a separate diagnostic channel, not a business recovery mechanism. Telemetry failures must not turn successful application work into failure.

## Own recurring and background failures

Long-running processes need explicit failure ownership for startup, each recurring unit, detached promises, scheduled waits, and shutdown.

Every created promise must be awaited or have a contained rejection handler.

A recurring loop should distinguish completed work, deferred work, paused writes because of an unknown outcome, deliberate shutdown, and fatal failure.

```ts
while (!signal.aborted) {
  try {
    await worker.root("cycle", async () => {
      await runCycle(signal);
    });
  } catch (error) {
    const state = classifyCycleFailure(error);

    if (state === "fatal") throw error;
    if (state === "pause-writes") writesEnabled = false;
  }

  await waitForNextCycle(signal);
}
```

Do not log a failed cycle as success simply because the process continues.

A top-level catch may report and clean up; it cannot resume a loop that has already exited. Process-level unhandled-error hooks are last-resort diagnostics, not a recovery strategy for state-changing work.

## Bind browser context before any await

Node.js and Bun retain asynchronous parentage through shared `AsyncLocalStorage`.

Browser builds do not guarantee parent context across asynchronous boundaries. **Call `.bindContext()` inside the active parent before the first `await`.** Use the returned bound instance for subsequent measured operations.

```ts
import { createMeasure } from "measure-fn/browser";

const extension = createMeasure("extension");

await extension.root("message", async () => {
  const step = extension.bindContext();

  await Promise.resolve();

  return await step("apply state", async () => {
    return await applyState();
  });
});
```

Capture a fresh binding for each independent browser event, request, or message. Do not store one module-global binding and assume it identifies the current request.

Calling `bindContext()` outside an active measurement produces a binding that starts new roots.

If later work uses another scope, pass an appropriate binding or capture that scope's binding while the intended parent is active. A binding does not automatically restore context for unrelated unbound asynchronous calls.

Browser bundlers can select the browser export automatically. Explicit `measure-fn/browser` imports are also supported. Do not import `dist/index.js` directly in browser code or bypass `node:async_hooks` errors by marking that Node-only module external.

## Use wrap() according to function type

`.wrap()` creates reusable measured functions that preserve arguments and `this`.

Ordinary asynchronous wrappers return promises. Synchronous ordinary functions should use `.sync.wrap()` when a synchronous return is required.

**Generator and async-generator functions passed to `.wrap()` return iterators, not promises.** Do not await the wrapped generator call itself.

```ts
const readRows = db.wrap("read rows", async function* () {
  for await (const row of source()) {
    yield row;
  }
});

for await (const row of readRows()) {
  await processRow(row);
}
```

Wrapped generators remain lazy. Their span starts on the first `next()` and finishes when iteration completes, throws, or returns early. This measures sequence consumption rather than iterator creation.

Nested measured operations during iteration appear under the generator's span.

The same lazy iterator contract applies to synchronous generators. Use normal iterator consumption (`for...of`, `next()`, or `return()`) as appropriate.

Wrappers are not constructor wrappers and do not copy arbitrary custom properties attached to the original function.

## Use helpers for their actual contracts

Use `.timed()` when the caller needs both the result and its measured duration:

```ts
const { result, duration } = await api.timed("compute", compute);
```

The synchronous equivalent is `api.sync.timed()`. Duration measures the callback, excluding start and terminal logger overhead, while parent durations include child work.

Use `.batch()` for sequential processing that should continue across individual item failures. It preserves input order and returns a result array, substituting `null` for failed items.

A successful `null` and failed item are indistinguishable in that returned array. Use tagged application results if this distinction matters.

For a batch action object, `end` receives `{ ok, total, results }`; `ok` counts successful items, including those that returned `null`.

Use `.note()` for meaningful annotations without a measured callback. Avoid excessive notes that obscure operation boundaries.

Use `.resetCounter()` only to reset display root counters. It does not reset active child counters or unique `traceId` values.

## Configure verbosity and bounded values

```ts
import { configure, createMeasure } from "measure-fn";

configure({
  maxValueLength: 300,
  errorDetails: false,
});

const rpc = createMeasure("server:rpc-gate", {
  level: "errors",
  slowThreshold: 1000,
  maxValueLength: 300,
  compactIds: true,
});
```

`level` supports `info` (default), `errors`, and `silent`.

At `errors`, failures and successful operations exceeding `slowThreshold` or their action `budget` remain visible. Starts and annotations are suppressed. Slow success lines retain their operation labels.

`MEASURE_LEVEL="server:rpc-gate=errors,*=info"` selects exact scopes with wildcard fallback. Explicit scope options override environment rules, which override `configure({ level })`.

Environment rules are read at module load. Duplicate scope rules use the last match; malformed rules throw.

Scope levels filter built-in console output only. Custom logger middleware still receives events. Global `configure({ silent: true })` disables all observation, including middleware and observation mappers, while operation semantics continue to apply.

### maxValueLength

`maxValueLength` is the canonical printed-value length cap. Its default is 300 characters, including the final `…` truncation marker. Set `0` to disable truncation.

```ts
await rpc(
  {
    start: () => "full diagnostic",
    maxValueLength: 0,
  },
  async () => largeValue,
);
```

Precedence is action, then scope, then global configuration.

The cap covers console start, annotation, success, and failure values. Current error formatting also bounds error messages, details, and causes rather than allowing unlimited error output.

This is a rendered-string limit, not a general object-traversal or allocation budget. Returned application values and structured middleware payloads are not truncated by the display cap.

Prefer small `end` and `error` projections or bounded summarization for large or sensitive objects.

The legacy `maxResultLength` alias remains supported and wins when both names are set at the same configuration tier. Setting global `maxValueLength` clears a previously configured global alias.

Structured terminal event types retain the compatibility field name `maxResultLength`.

### compactIds

Use `configure({ compactIds: true })` globally or `createMeasure("api", { compactIds: true })` for an individual scope.

With compact IDs enabled, per-trace identifiers use short values such as `#a` and `#b` instead of growing ancestor paths.

Compact IDs are disabled by default. Scope settings override the global setting.

`event.id` remains scope-qualified when a scope exists, `event.parentId` references the exact parent ID, and `event.traceId` identifies the local root.

Compact identifiers restart per trace. Correlate using `(traceId, id)`, not `id` alone. The `#` prefix distinguishes compact IDs from hierarchical path IDs when modes are mixed.

Do not construct parent IDs by splitting paths or assuming that `event.rawId` always contains an ancestor chain. Use the supplied `parentId` and `traceId` fields.

## Keep diagnostics safe and causal

Preserve raw failures for application control flow, but log small, sanitized diagnostics containing relevant error codes, messages, stages, attempts, and recovery outcomes.

The built-in logger renders scoped events as `[scope] path`. With colors enabled, only the bracketed scope token receives ANSI color. Labels, status markers, durations, payloads, errors, and other text remain plain.

Scope colors remain stable for the loaded runtime. Unscoped output remains uncolored.

Use `traceId` and `parentId` to correlate nested events instead of repeating full stack traces at every layer. `traceId` is local to the loaded runtime, not a cross-process request identifier.

Keep `errorDetails` disabled in normal application output. Enable it temporarily for debugging or send richer diagnostics to a dedicated secure sink.

With detailed errors enabled, the formatter remembers original error objects so the same propagated error's stack and cause are not repeatedly printed at enclosing measured spans. Distinct errors remain distinct. Primitive thrown values cannot use this object-identity deduplication.

Nested error events may describe one failure propagating through multiple measurements. Do not equate error-line count with independent failure count.

Key-based redaction cannot find secrets embedded in arbitrary strings, URLs, labels, stack traces, or request bodies. Sanitize those values before logging.

When summarization is disabled, custom middleware may receive raw object references. Console redaction does not sanitize those references before middleware receives them. Apply sink-specific redaction before export.

## Keep logger failures observational

A custom logger is middleware:

```ts
configure({
  logger(event, next) {
    if (event.label.startsWith("health:")) return;
    next();
  },
  onLoggerError(error, event) {
    reportLoggerFailure(error, event);
  },
});
```

Calling `next()` delegates to built-in output and respects scope filtering. Omitting it suppresses built-in output. `next()` is idempotent.

`event.data` is the normalized payload for all event types: start and annotation correspond to `value`, success to `result`, and failure to `error`.

Logger exceptions, console failures, and rejected logger promises are contained. Asynchronous loggers are best effort, are not awaited, and have no built-in flush lifecycle.

Do not place required application side effects in logger middleware. Call `next()` synchronously if console ordering matters.

## Repository and testing rules

Keep only `README.md` and `SKILL.md` as Markdown documents in this repository. Do not add `CHANGELOG.md`, `docs/*.md`, migration reports, temporary review notes, or additional example READMEs.

Put public API behavior, migration information, and usage examples in `README.md`. Keep durable implementation and agent conventions in this file. Put executable examples in source files.

Follow the repository's one-scope-definition-per-file convention and unique ownership of literal scope names.

Run the relevant checks when changing implementation behavior:

```sh
npm ci
npm run check
npm run test:bun
npm pack
```

`npm run check` includes typechecking, runtime builds, Node.js and browser behavior suites, and installed-package validation.

When adding regression tests, cover application outcomes as well as emitted diagnostics:

- `retryIf` prevents unwanted retries, including unsafe writes; omitted `retryIf` retains retry-all behavior.
- `retryIf` receives the original error and attempt number, supports asynchronous booleans, and rejects non-boolean results.
- Action `error()` maps logged values without replacing the original thrown error; throwing or asynchronous mappers remain observer failures.
- Generator and async-generator wrappers return iterators, remain lazy, measure consumption, and preserve nested spans.
- Browser parentage is retained through a binding captured before the first `await`.
- `maxValueLength` bounds printed values and errors without changing callback results or middleware payloads.
- `compactIds` preserves exact parent relationships and trace identity, including mixed ID modes.
- Color tests verify that only `[scope]` receives ANSI coloring.

Treat tests as validation of the current public contract, not as permission to introduce additional undocumented APIs.

The governing rule is simple: measurement observes work, while the application retains ownership of results, retries, writes, recovery, cancellation, and shutdown.
