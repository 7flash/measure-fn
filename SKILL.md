---
name: measure-fn
description: Add measured, observable operations with measure-fn while preserving application outcomes, explicit failure ownership, and one scope definition per source file.
---

# measure-fn implementation guide

Use `measure-fn` to observe meaningful application boundaries without changing the behavior of the code being measured. The callback result and original application error are the source of truth. Measurement, formatting, and logging are observers unless the caller explicitly chooses recovery.

Read `README.md` for the complete public API and runtime contract. Do not create additional Markdown documentation in this repository. Put public behavior, migration notes, examples, and recovery explanations in `README.md`; keep contributor and agent implementation rules here.

## Structure scopes by ownership

Define at most one `createMeasure()` scope in a source file. The scope should identify the subsystem owned by that module, not a temporary function name. A file can call functions imported from modules that own other scopes; do not define those other scopes locally just to make nested logs colorful.

Preferred:

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

The imported `account-store.js` module should own its own scope if it needs one. If several files intentionally share one scope, define it once in a dedicated owner module and import that instance. Do not duplicate `createMeasure("payments")` across files.

Use `.root()` at independent entry points: requests, messages, jobs, commands, scheduled ticks, and recovery sessions. Use ordinary nested measurements for meaningful stages beneath the root. Avoid measuring trivial property access, tiny expressions, or every helper solely to increase log depth.

Names should describe operations rather than implementation trivia. Prefer `load account`, `prepare transaction`, and `persist checkpoint` over generic labels such as `step 1`, `run`, or `handler`.

## Preserve outcomes

The measured callback owns the business result. By default, let its error propagate unchanged.

```ts
const profile = await users("load profile", async () => {
  return await store.loadProfile(userId);
});
```

Use an action `catch` only when the caller can legitimately accept the recovery value as the result of that operation.

```ts
const response = await api.root(
  {
    start: () => "GET /health",
    catch: () => new Response("degraded", { status: 503 }),
  },
  async () => await buildHealthResponse(),
);
```

Do not use recovery to hide missing data, failed invariants, unknown write outcomes, or authorization errors. Never replace an unexpected failure with `null`, `0`, `{}`, an empty array, or stale state unless the caller's type and semantics explicitly define that value as recovery.

Keep `start`, `end`, and `error` mappers synchronous and pure. They are observation projections and may be skipped in silent mode. Use `error` to emit a sanitized diagnostic while preserving the original failure for control flow. Do not put required side effects inside observation mappers.

Sync measurements must remain synchronous. Do not return a promise from `measureSync`, `m.sync`, or sync recovery. Do not add a timeout to sync work.

## Give every failure an owner

Choose recovery from the operation semantics, not from the fact that an exception occurred.

For a repeatable read with a classified transient failure, retry within explicit attempt and elapsed-time limits, then defer if fresh data is still unavailable. For invalid or stale read data, keep the validation failure or return an explicit deferred result. For configuration, authorization, or invariant failures, disable the affected operation or terminate deliberately instead of repeating the same request.

For a write whose response is lost, treat the result as unknown. Persist enough operation metadata before submission to reconcile later, pause dependent writes, and determine what happened before rebuilding or repeating the operation. A timeout or connection reset does not prove that the remote side failed to commit.

For shutdown or cancellation, stop scheduling work and propagate an `AbortSignal` to cooperative I/O. Do not translate shutdown into a transient retry.

For logger failures, let `measure-fn` contain them. Use `onLoggerError` only as a separate diagnostic channel. Never make successful application work fail because telemetry failed.

## Retry deliberately

`m.retry()` repeats the complete callback after failures. Use `retryIf(error, attempt)` when the operation owner can distinguish transient failures from permanent ones. Returning `false` stops further attempts; any action `catch` still runs only as final explicit recovery.

```ts
const state = await rpc.retry(
  {
    start: () => "read remote state",
    error: (error) => ({ code: errorCode(error), message: safeErrorMessage(error) }),
  },
  {
    attempts: 3,
    delay: 100,
    backoff: 2,
    retryIf: (error) => isTransientReadError(error),
  },
  async () => await readRemoteState(),
);
```

Keep retry ownership at the layer that can classify the error. Keep one retry owner per operation. Do not stack transport, SDK, and application retry loops without an explicit total-attempt budget.

A measurement timeout limits how long the caller waits. It does not cancel the callback. If a timed-out attempt can continue running, starting another attempt can overlap it. Pass an `AbortSignal` to cooperative I/O and wait for cancellation or settlement when overlap would be unsafe.

Never wrap a multi-step state-changing workflow in a generic automatic retry unless the whole workflow is demonstrably idempotent and recoverable as one unit.

## Own recurring and background failures

A long-running process needs explicit failure ownership around startup, each recurring unit, detached/background promises, scheduled waits, and shutdown. Every created promise must be awaited or have a contained rejection handler.

A recurring loop should distinguish at least these states: completed work, deferred work because inputs are unavailable, paused writes because a previous outcome is unknown, deliberate shutdown, and fatal failure. Do not log a failed cycle as success merely because the process continues.

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

A top-level catch can report and clean up; it cannot resume a loop that has already returned. Process-level unhandled-error hooks are diagnostics, not a recovery strategy for state-changing work.

## Keep diagnostics safe and causal

Preserve raw errors for control flow, but emit a small diagnostic projection containing the operation, stage, error code, message, attempt number, and recovery outcome. The built-in logger keeps failures to one line by default; do not enable `errorDetails` globally in normal application output. Use it temporarily when debugging, or send richer diagnostics to a dedicated sink. Use `traceId` and `parentId` to connect nested events instead of printing the same full stack at every layer.

Key-based redaction does not remove secrets embedded inside arbitrary strings, URLs, stack traces, labels, or request bodies. Sanitize those values before they reach the logger. Treat custom logger payloads as raw references when summarization is disabled and apply sink-specific redaction before export.

Nested error events can represent one error propagating through several measured spans. Do not interpret the number of error lines as the number of independent failures.

## Use browser context explicitly

Node and Bun retain asynchronous parentage through shared `AsyncLocalStorage`. Browser builds guarantee automatic nesting only while synchronous context is active. Capture a binding inside the parent before the first `await` and use the binding for later measured work that must remain attached.

```ts
const extension = createMeasure("extension");

await extension.root("message", async () => {
  const step = extension.bindContext();
  await Promise.resolve();
  return await step("apply state", async () => await applyState());
});
```

Capture a new binding for each independent browser event. Do not keep a module-global binding and assume it identifies the current request.

## Keep console identity simple

The built-in logger renders scoped events as `[scope] path`. With colors enabled, only `[scope]` receives ANSI color. Do not add colors to labels, status markers, durations, payloads, errors, or complete lines. The scope is the visual identity; the rest of the line should remain semantically neutral and easy to copy, diff, and search.

Different active scopes should receive different colors while palette entries are available, and one scope must retain its assigned color for the lifetime of the loaded runtime. Unscoped measurements stay plain even when colors are enabled.

Keep internal event identity separate from presentation. `event.id` remains the scoped identifier, `event.rawId` remains the hierarchical path, and console formatting may present them as `[scope] rawId` without changing event contracts.

## Use helpers for their actual contracts

Use `.timed()` when the caller needs both a result and the exact measured duration. Use `.wrap()` for reusable ordinary functions while preserving `this`. Use `.batch()` for sequential work that should continue across item failures, remembering that its legacy result array cannot distinguish a failed item from a successful `null`. Use `.note()` for meaningful checkpoints that do not wrap callback work.

Use `end` projections or summarization for large or sensitive results. `maxResultLength` limits the final display string; it is not a traversal or allocation budget.

When writing tests for logging, assert both the plain visible line and ANSI boundaries. A color test should prove that `[scope]` is the only colored segment, not merely that an escape sequence exists somewhere in the string.

## Repository documentation rule

Keep only `README.md` and `SKILL.md` as Markdown files. Do not add `CHANGELOG.md`, `docs/*.md`, `examples/README.md`, review notes, migration notes, or temporary Markdown reports. Condense durable public information into `README.md` and durable implementation rules into this file. Put executable examples in source files and machine-readable configuration in its native format. `npm run check:repo` enforces the Markdown rule, one real `createMeasure()` definition per non-test TypeScript file, unique ownership for literal scope names, and the package publish allowlist.


## Scope verbosity and bounded values

```typescript
const rpc = createMeasure("server:rpc-gate", {
  level: "errors", slowThreshold: 1000, maxValueLength: 300,
});
configure({ maxValueLength: 300, errorDetails: true });
await rpc({ start: () => "full diagnostic", maxValueLength: 0 }, () => largeValue);
```

`level` supports `info` (default), `errors`, and `silent`. At `errors`, failures
and successful calls above `slowThreshold` (milliseconds; default 1000) or their
action `budget` print; slow success lines include their label. Starts and notes
are suppressed. `MEASURE_LEVEL="server:rpc-gate=errors,*=info"` selects exact
scopes with a wildcard fallback. Explicit scope options win over environment
rules, which win over `configure({ level })`. Rules are read at module load;
duplicate scopes use the last rule and malformed rules throw.

Scope levels filter only built-in console output: logger middleware receives all
events, and `next()` respects the scope filter. `configure({ silent: true })`
continues to disable all observation, including middleware.

`maxValueLength` caps console start/note values and end values at 300 characters
by default, including the final `…`; 0 allows full output. Action options override
scope options, which override global configuration. The existing
`maxResultLength` alias wins when both names are supplied at the same tier.
`configure({ maxValueLength })` clears a previously configured global alias.
Middleware payloads and operation results are not truncated; existing
`summarize` and redaction settings still apply. `safeStringify` uses the global
cap unless an explicit limit is supplied. Full diagnostic stacks and causes are
exempt from the value cap.

Error details remain opt-in through `errorDetails` or `MEASURE_ERROR_DETAILS=1`.
When enabled, a WeakSet remembers the original thrown object even with
summarization enabled: its stack and redacted cause print once at the first
visible failure, while enclosing failures retain their compact `✗` line.
Distinct errors with equal messages still print independently. Primitive thrown
values cannot be remembered in a WeakSet and print at each failure.