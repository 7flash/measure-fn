# measure-fn

`measure-fn` is a zero-runtime-dependency TypeScript/JavaScript wrapper that times named operations, tracks nested work, and prints compact structured logs without changing your application's results or errors.

## Install

```bash
npm install measure-fn
```

Works with Node.js 18+, Bun, and browser bundlers. The package ships compiled ESM, TypeScript declarations, and a separate browser build.

There is no CommonJS build. Use ESM imports or dynamic `import()` from CommonJS.

## 30-second example

Create a scope, wrap an operation with `.root()`, and measure the steps inside it.

```ts
import { createMeasure } from "measure-fn";

const api = createMeasure("api");

const count = await api.root("GET /users", async () => {
  const users = await api("load users", async () => {
    return [{ id: 1 }, { id: 2 }];
  });

  return await api("count users", async () => users.length);
});

console.log(count); // 2
```

With colors disabled, the built-in logger prints something like:

```text
[api] a → GET /users
[api] a-a → load users
[api] a-a ✓ 0.40ms → [{"id":1},{"id":2}]
[api] a-b → count users
[api] a-b ✓ 0.08ms → 2
[api] a ✓ 0.95ms → 2
```

Durations are illustrative.

Each line contains a scope (`api`), a hierarchy path (`a-a`), an operation label, and, when the operation finishes, its status, duration, and result or error.

The parent operation includes the time spent in its children.

The wrapped callback still returns its normal result. If it throws, the measurement logs the failure and rethrows the original error unless you explicitly configure recovery.

Three conventions are enough to get started:

- Use `createMeasure("scope")` once in the module that owns a subsystem.
- Use `.root()` for independent entry points such as HTTP requests, jobs, messages, CLI commands, and recurring worker cycles.
- Use ordinary measured calls for meaningful steps inside a root. Avoid measuring every trivial expression.

## Node.js, Bun, and browsers

The most important runtime difference is how parent context survives `await`.

### Node.js and Bun: automatic asynchronous context

Node.js and Bun use a shared `AsyncLocalStorage` context within the loaded package. Nested measurements remain connected across ordinary asynchronous boundaries.

```ts
const api = createMeasure("api");

await api.root("request", async () => {
  await Promise.resolve();

  await api("query database", async () => {
    return [{ id: 1 }];
  });
});
```

`query database` is automatically a child of `request`.

Different scopes also share this context. A database measurement can become a child of an API measurement without manually passing trace identifiers.

### Browser: call bindContext() before the first await

The browser build cannot reliably track asynchronous parentage using a global synchronous stack.

**Capture the parent with `.bindContext()` while that parent is active, before crossing an asynchronous boundary.** Use the returned bound measure instance for subsequent operations.

Wrong:

```ts
import { createMeasure } from "measure-fn/browser";

const ui = createMeasure("ui");

await ui.root("message", async () => {
  await Promise.resolve();

  // Wrong: the active parent may have been lost.
  await ui("read state", async () => ({ enabled: true }));
});
```

Right:

```ts
import { createMeasure } from "measure-fn/browser";

const ui = createMeasure("ui");

await ui.root("message", async () => {
  // Capture the parent BEFORE any await.
  const step = ui.bindContext();

  await Promise.resolve();

  const state = await step("read state", async () => {
    return { enabled: true };
  });

  return await step("apply state", () => state);
});
```

Both `read state` and `apply state` now retain `message` as their parent.

Capture a fresh binding for each browser request, event, or message. Calling `bindContext()` outside an active measurement produces a binding that starts new roots.

If a helper uses another scope after an asynchronous boundary, pass it an appropriate binding or capture its own binding while the intended parent is still active. A browser binding does not automatically restore parentage for unrelated unbound calls inside later asynchronous callbacks.

### Browser bundling

Browser bundlers, including esbuild with `platform: "browser"`, select `dist/browser.js` using the package export conditions.

You can explicitly import the browser entry:

```ts
import { createMeasure } from "measure-fn/browser";
```

Keep browser bundles targeted at browsers. Do not import `dist/index.js` directly or mark `node:async_hooks` external to bypass bundling errors. That would leave a Node-only import in browser code.

## Organize scopes by ownership

Prefer one scope definition per file. Give each subsystem its own scope and compose normal functions across modules.

For example, `db.ts` owns database measurements:

```ts
import { createMeasure } from "measure-fn";

const db = createMeasure("db");

export async function queryUsers() {
  return await db("SELECT users", async () => {
    return [{ id: 1 }];
  });
}
```

Then `users.ts` owns user-related measurements:

```ts
import { createMeasure } from "measure-fn";
import { queryUsers } from "./db.js";

const users = createMeasure("users");

export async function loadUsers() {
  return await users.root("load users", async () => {
    return await queryUsers();
  });
}
```

In Node.js and Bun, the `db` measurement automatically becomes a child of `users`.

A scope identifies the subsystem responsible for work. The measurement hierarchy identifies the operation's actual parent.

If multiple files intentionally share one scope, define it in one small owner module and import it. Avoid creating unrelated scopes side by side in an orchestration file or repeatedly creating independent instances with the same scope name.

## API reference

A scoped instance returned by `createMeasure()` is callable and has methods for synchronous work, roots, annotations, timings, retries, batches, and wrappers.

### measure(action, fn)

The usual measurement is an asynchronous call to the instance.

```ts
const api = createMeasure("api");

const result = await api("load settings", async () => {
  return { enabled: true };
});
```

Signature:

```ts
<T>(
  action: MeasureAction<T>,
  fn: () => T | PromiseLike<T>,
) => Promise<T>
```

`action` is either a string or an action object.

The callback can return a synchronous value or a promise-like value. The measurement always returns a promise of the callback result.

By default, callback failures are logged and the original error is rethrown.

Use `.root()` when the operation should begin an independent hierarchy:

```ts
await api.root("request", async () => {
  return await api("load settings", loadSettings);
});
```

Both ordinary calls and `.root()` also support annotations without callbacks:

```ts
const value = await api("checkpoint"); // null
```

The no-callback asynchronous overload returns `Promise<null>`.

### measureSync(action, fn)

Use `.sync()` for synchronous operations.

```ts
const result = api.sync("parse config", () => {
  return JSON.parse('{"enabled":true}');
});
```

Signature:

```ts
<T>(
  action: MeasureSyncAction<T>,
  fn: () => T,
) => T
```

The synchronous API returns the original value directly, not a promise.

```ts
const config = api.sync.root("initialize", () => {
  return api.sync("read defaults", () => ({ enabled: true }));
});
```

Synchronous callbacks and synchronous recovery callbacks must remain synchronous.

The sync types disallow promise-like results, and the runtime rejects them if encountered. Synchronous actions cannot specify `timeout`, because a JavaScript timer cannot interrupt blocking synchronous work.

A synchronous annotation also returns `null`:

```ts
const value = api.sync("initialized"); // null
```

### Action objects

Use an action object when a measurement needs custom start, success, or error output, recovery, a budget, or a deadline.

```ts
const settings = await api(
  {
    start: () => "load settings",

    end: (result: { enabled: boolean }) => ({
      enabled: result.enabled,
    }),

    error: (error) => ({
      message: error instanceof Error ? error.message : String(error),
    }),

    catch: () => ({ enabled: false }),

    budget: 100,
    timeout: 2_000,
  },
  async () => {
    return { enabled: true };
  },
);
```

The supported action fields are:

| Field | Type | Behavior |
| --- | --- | --- |
| `start` | `() => unknown` | Produces the value printed when the operation starts. |
| `end` | `(result: T) => unknown` | Maps the successful result to the logged success value. |
| `error` | `(error: unknown) => unknown` | Maps the failure to the logged error value. |
| `catch` | `(error: unknown) => T \| PromiseLike<T>` | Explicitly recovers from an operation failure. |
| `budget` | `number` | Warns when duration exceeds this many milliseconds. |
| `timeout` | `number` | Sets a deadline in milliseconds. `0` disables it. |
| `maxValueLength` | `number` | Overrides the printed value cap for this action. `0` disables truncation. |
| `maxResultLength` | `number` | Backward-compatible alias for `maxValueLength`. |
| `summarize` | `boolean` | Overrides automatic summarization for this action. |
| `stripScopePrefix` | `boolean` | Overrides duplicate scope-prefix stripping for this action. |

The sync action type supports the same fields except that `timeout` is forbidden and `catch` must return `T` synchronously.

#### start, end, and error only change observation

The three mappers do not transform the application's return value or thrown error.

```ts
const result = await api(
  {
    start: () => "calculate",
    end: (value: number) => ({ answer: value }),
  },
  () => 42,
);

// result === 42
// The success log contains {"answer":42}.
```

The `error` mapper receives the original failure and produces the value used in the error log.

```ts
await api(
  {
    start: () => "read remote data",
    error: (error) => ({
      message: error instanceof Error ? error.message : String(error),
    }),
  },
  async () => {
    throw new Error("connection failed");
  },
);
```

The caller still receives the original `Error("connection failed")`.

This is useful when you need to emit a small diagnostic such as `{ code, message, stage }` without changing error-based application control flow.

Observation mappers are synchronous. If a mapper throws or returns an asynchronous result, the observer failure is diagnosed rather than replacing the application's outcome.

Keep observation mappers pure and side-effect-free. Global silent mode skips them.

#### catch explicitly changes the result

Without `catch`, failures propagate unchanged.

With `catch`, the callback's failure can be converted into a valid recovery value:

```ts
const value = await api(
  {
    start: () => "optional lookup",
    catch: () => null,
  },
  async () => {
    throw new Error("not found");
  },
);

// value === null
```

A recovered failure still produces an error event. It does not produce a second success event for the recovery value.

Use recovery only when its value is valid for the caller. Do not silently replace missing, invalid, or stale data with invented usable values.

If the recovery callback throws, its error propagates.

For synchronous actions, recovery must be synchronous:

```ts
const value = api.sync(
  {
    start: () => "read optional config",
    catch: () => null,
  },
  () => {
    throw new Error("missing");
  },
);
```

### Budgets and timeouts

A budget measures performance. It does not change control flow.

```ts
await api(
  {
    start: () => "read cache",
    budget: 50,
  },
  readCache,
);
```

If the operation exceeds 50 milliseconds, the built-in logger can report a budget warning. At the `errors` log level, a successful operation exceeding its budget is also visible.

A timeout changes the waiting outcome:

```ts
await api(
  {
    start: () => "fetch remote data",
    timeout: 2_000,
  },
  fetchRemoteData,
);
```

A timeout is a deadline, **not cancellation**.

When the timer fires, the measurement rejects. The timer is cleared when the measurement settles.

A timeout does not:

- Interrupt blocking JavaScript.
- Cancel an already-running callback.
- Abort network operations automatically.
- Undo a submitted write or transaction.

The underlying operation may continue after the timeout. Retrying timed-out work can therefore overlap attempts.

Use an `AbortSignal` with cooperative I/O when cancellation matters.

Timeouts and retry delays must fit the platform timer range of `0` through `2,147,483,647` milliseconds.

### retry(action, opts, fn)

`.retry()` repeats a callback after failures, up to the configured attempt limit.

```ts
const flags = await api.retry(
  "read feature flags",
  {
    attempts: 3,
    delay: 100,
    backoff: 2,
    retryIf: (error) => isTransientReadError(error),
  },
  async () => await readFeatureFlags(),
);
```

Options:

| Option | Type | Behavior |
| --- | --- | --- |
| `attempts` | `number` | Maximum number of attempts, including the initial attempt. |
| `delay` | `number` | Initial delay between attempts, in milliseconds. Defaults to **1000 ms**. |
| `backoff` | `number` | Multiplier applied to retry delays. |
| `retryIf` | `(error: unknown, attempt: number) => boolean \| PromiseLike<boolean>` | Decides whether a particular failure can be retried. |

**Without `retryIf`, every failure is eligible for retry until the attempt limit is reached.**

That includes failures caused by invalid input, authorization, business rules, and uncertain writes. The library does not know which operations are safe to repeat.

Always guard writes. Prefer a restrictive `retryIf` predicate for repeatable reads, and never blindly retry a write whose previous outcome may already have committed.

`retryIf` receives the original error and the attempt number. It may be synchronous or asynchronous. Returning `false` stops further attempts.

An action's `catch` applies as final explicit recovery, rather than silently converting each individual failed attempt into success.

The retry helper does not classify failures, add jitter, honor `Retry-After`, cancel previous attempts, or guarantee idempotency. It also does not provide a whole-workflow elapsed-time deadline.

Avoid stacking independent retry loops in a transport, an SDK, and the application. Their attempt counts multiply.

For HTTP reads, remember that a rejected `fetch()` may have no response status at all. A policy based only on HTTP status can miss connection resets and failures before headers arrive. A repeatable-read retry boundary should cover connection, response consumption, and decoding, with an overall deadline and cooperative cancellation where available.

### batch(action, items, fn, opts?)

`.batch()` processes items sequentially, keeps their original order, and continues after individual failures.

```ts
const results = await api.batch(
  "process items",
  [1, 2, 3],
  async (item, index) => item * 2,
  { every: 1 },
);

// [2, 4, 6]
```

Its callback receives `(item, index)` and may return a value synchronously or asynchronously.

The input is a readonly array. The returned promise resolves to an array of results.

The optional `every` number controls periodic batch progress reporting.

A failed item contributes `null` and processing continues.

```ts
const results = await api.batch(
  "process items",
  [1, 2, 3],
  async (item) => {
    if (item === 2) throw new Error("failed");
    return item * 2;
  },
);

// [2, null, 6]
```

**A failed item is indistinguishable from a successful item that returned `null` in the result array.**

If that distinction matters, return an explicit tagged result from your callback or use another application-level collection strategy.

For batch action objects, the `end` mapper receives:

```ts
type BatchSummary<R> = {
  ok: number;
  total: number;
  results: (R | null)[];
};
```

For example:

```ts
const results = await api.batch(
  {
    start: () => "process records",
    end: ({ ok, total }) => ({ ok, total }),
  },
  records,
  async (record) => processRecord(record),
);
```

The summary's `ok` count distinguishes successful items internally, including successful `null` results. The returned array does not preserve that distinction.

### wrap(action, fn)

`.wrap()` creates a measured function while preserving its arguments and `this` binding.

```ts
const wrapped = api.wrap("calculate total", async function (
  this: { multiplier: number },
  value: number,
) {
  return value * this.multiplier;
});

const calculator = {
  multiplier: 3,
  calculate: wrapped,
};

const result = await calculator.calculate(10); // 30
```

The asynchronous wrapper returns a promise for ordinary functions.

Generator and async-generator functions stay lazy: the wrapper returns an iterator, the step starts on the first `next()` and ends when the iterator finishes, throws or is returned early, so it measures consuming the sequence rather than creating it. Steps run while iterating nest under it.

```ts
const rows = api.wrap("read rows", async function* () {
  yield* source();
});

for await (const row of rows()) handle(row);
```

For synchronous functions, use `.sync.wrap()`:

```ts
const add = api.sync.wrap("add", (a: number, b: number) => {
  return a + b;
});

const result = add(2, 3); // 5
```

Wrappers preserve normal method arguments and `this`. They are not constructor wrappers and do not copy custom properties attached to the original function.

### timed(action, fn)

Use `.timed()` when code needs the duration as data rather than only in logs.

```ts
const { result, duration } = await api.timed(
  "compute",
  async () => 42,
);
```

The return type is:

```ts
type TimedResult<T> = {
  result: T;
  duration: number;
};
```

The synchronous equivalent is:

```ts
const timing = api.sync.timed("compute", () => 42);
```

The reported duration is the same duration used by the measurement's success or error event.

Timing begins after the start mapper and start logger, and ends before the terminal mapper and logger. It measures the callback rather than the logger itself.

Parent durations include child work and child instrumentation.

### note(action)

Use `.note()` for an annotation that has no measured callback.

```ts
api.note("application ready");
api.sync.note("configuration loaded");
```

Both return `void`.

Annotations create structured `annotation` events, rather than timing a callback.

Calling the main measurement function without a callback also creates an annotation but returns `null` (or `Promise<null>` for the asynchronous API).

### root(action, fn)

`.root()` explicitly starts an independent local trace.

```ts
await api.root("request", async () => {
  return await api("load data", loadData);
});
```

The asynchronous and synchronous root methods mirror their respective ordinary measurement methods:

```ts
await api.root("request", async () => 42);

const value = api.sync.root("startup", () => 42);
```

Use roots for independent incoming work. Nested operations normally do not need additional roots.

### bindContext()

`.bindContext()` captures the current parent and returns a bound `MeasureFn`.

```ts
const bound = api.bindContext();
```

It is especially important in browser code, where you must capture the intended parent before an asynchronous boundary.

In Node.js and Bun, ordinary nested asynchronous calls generally retain context automatically.

### resetCounter()

`.resetCounter()` resets the display root counter for that instance.

```ts
api.resetCounter();
```

It does not reset active child counters or `traceId` values.

Trace identifiers remain unique within the loaded runtime even when display root IDs are reset.

## Log levels and output length

### Scope levels

Three verbosity levels are supported:

| Level | Built-in console output |
| --- | --- |
| `info` | Normal start, annotation, success, and error output. Default. |
| `errors` | Failures and slow successful operations. Suppresses starts and annotations. |
| `silent` | No built-in console output for the scope. |

Configure a scope when creating it:

```ts
const rpc = createMeasure("server:rpc-gate", {
  level: "errors",
  slowThreshold: 1000,
  maxValueLength: 300,
});
```

At `errors` level, the logger still prints successful operations when their duration exceeds `slowThreshold` or their action `budget`.

The default slow threshold is 1000 milliseconds. Slow success lines include their operation labels, so the output remains useful without corresponding start lines.

Scope levels filter only built-in console output. Custom logger middleware still receives all events, and calling `next()` respects the applicable scope level.

This makes `level: "silent"` different from global `configure({ silent: true })`.

### MEASURE_LEVEL

Set scope levels through an environment variable:

```sh
MEASURE_LEVEL="server:rpc-gate=errors,*=info"
```

Exact scope names take precedence over the wildcard fallback.

Precedence for selecting a scope level is:

1. Explicit scope options passed to `createMeasure()`.
2. Matching `MEASURE_LEVEL` environment rules.
3. Global `configure({ level })`.

Environment rules are read when the module loads.

When a scope appears multiple times in the environment rules, the last rule wins. Malformed rules throw.

### maxValueLength

`maxValueLength` is the canonical setting for limiting printed values.

```ts
configure({
  maxValueLength: 300,
});
```

The default is 300 characters, including the final truncation marker `…`.

Set `0` to disable truncation:

```ts
configure({
  maxValueLength: 0,
});
```

You can set a different limit for an individual scope:

```ts
const api = createMeasure("api", {
  maxValueLength: 200,
});
```

Or override it for one action:

```ts
await api(
  {
    start: () => "large diagnostic",
    maxValueLength: 0,
  },
  async () => largeValue,
);
```

The precedence is action, then scope, then global configuration.

The cap applies to printed start and annotation values and terminal values. It does not truncate returned application results or structured middleware payloads.

Full diagnostic stacks and causes are exempt from this value cap.

The limit bounds rendered string length, not object traversal or memory allocation. Prefer summarization or a small `end` mapper when handling very large results.

The legacy `maxResultLength` name remains supported. When both names are provided at the same configuration tier, `maxResultLength` wins. Setting global `maxValueLength` clears a previously configured global alias.

## Silent operation

There are two different forms of silence.

### Scope-level silence

```ts
const quiet = createMeasure("cache", {
  level: "silent",
});
```

The built-in console output is suppressed for that scope, but custom logger middleware still receives its events.

The measurement continues to execute and enforce its normal operation semantics.

### Global silent mode

```ts
configure({ silent: true });
```

Global silent mode disables observation, including middleware delivery and observation mappers.

Callbacks, deadlines, recovery, and measurement nesting still operate.

A span started while global silent mode is active stays unobserved even if configuration changes before it finishes.

You can also set the initial global silent flag through:

```sh
MEASURE_SILENT=1
```

The value `true` is also accepted.

There is no separate `.silent()` method in the public `MeasureFn` API. Use scope levels or `configure({ silent: true })`.

## Custom logging

Use `configure()` to change global behavior or install a logger middleware.

```ts
import { configure } from "measure-fn";

configure({
  logger(event, next) {
    if (event.label.startsWith("health:")) {
      return;
    }

    // Inspect or forward the structured event here.
    next();
  },

  onLoggerError(error, event) {
    // Report observer failures through an independent diagnostic path.
  },
});
```

The logger signature is:

```ts
type MeasureLogger = (
  event: MeasureLogEvent,
  next: () => void,
) => void;
```

Calling `next()` includes the built-in console output.

Omitting `next()` suppresses or replaces the built-in output for that event.

`next()` is idempotent.

A logger can forward structured events to another sink, implement filtering, or replace the console formatter entirely.

Logger exceptions, console failures, and rejected logger promises are contained so they cannot replace the measured operation's result or original error.

`onLoggerError` receives observer failures and is also protected against failures of its own.

Asynchronous loggers are best effort and are not awaited. There is no built-in telemetry flush lifecycle. Call `next()` synchronously if console ordering matters.

### MeasureLogEvent

Every event contains these shared fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"start" \| "success" \| "error" \| "annotation"` | Event kind. |
| `id` | `string` | Scoped display identifier, such as `api:a-a`. |
| `rawId` | `string` | Hierarchy path, such as `a-a`. |
| `scope` | `string \| undefined` | Scope that owns the operation. |
| `depth` | `number` | Hierarchy depth. |
| `label` | `string` | Operation label. |
| `traceId` | `string` | Unique local root identifier within the loaded runtime. |
| `parentId` | `string \| undefined` | Direct parent's scoped display ID. |
| `data` | `unknown` | Normalized event payload. |

The `data` field always corresponds to the event-specific payload:

| Event type | Payload fields | Additional fields |
| --- | --- | --- |
| `start` | `data === value` | `value` |
| `annotation` | `data === value` | `value` |
| `success` | `data === result` | `result`, `duration`, optional `budget`, optional `maxResultLength` |
| `error` | `data === error` | `error`, `duration`, optional `budget`, optional `maxResultLength` |

`duration` is measured in milliseconds.

`maxResultLength` remains the compatibility field name in terminal events even though `maxValueLength` is the canonical configuration name.

The type discriminator allows narrowing:

```ts
configure({
  logger(event, next) {
    if (event.type === "success") {
      const duration = event.duration;
      const result = event.result;

      // Custom success handling.
    }

    if (event.type === "error") {
      const error = event.error;

      // Custom failure handling.
    }

    next();
  },
});
```

Treat event payloads as read-only.

When summarization is disabled, event payloads may contain original object references. Console redaction does not sanitize those raw references before they reach custom middleware.

`traceId` is local to the loaded runtime. It does not identify the same request across processes or sessions. Add application-level request, process, session, or correlation identifiers when combining telemetry from multiple runtimes.

## Global configuration

Call `configure()` during application initialization, before concurrent measurements begin.

```ts
import { configure } from "measure-fn";

configure({
  level: "info",
  slowThreshold: 1000,
  silent: false,

  logger: null,
  onLoggerError: null,

  colors: "auto",
  timestamps: false,
  errorDetails: false,

  maxValueLength: 300,
  summarize: false,
  stripScopePrefix: false,

  sensitiveKeyPattern: null,
  maxSummaryDepth: 4,
  maxSummaryStringLength: 160,
  summaryArraySample: 2,
  summaryObjectKeys: 24,
});
```

Configuration is shared by instances from the same loaded package.

The public `ConfigureOpts` type supports:

| Option | Type | Purpose |
| --- | --- | --- |
| `level` | `"info" \| "errors" \| "silent"` | Default console verbosity. |
| `slowThreshold` | `number` | Slow-success threshold in milliseconds. |
| `silent` | `boolean` | Disable observation globally. |
| `logger` | `MeasureLogger \| null` | Install or clear log middleware. |
| `onLoggerError` | `((error, event) => void) \| null` | Receive contained observer failures. |
| `colors` | `boolean \| "auto"` | Control ANSI scope coloring. |
| `timestamps` | `boolean \| "iso"` | Control timestamp prefixes. |
| `errorDetails` | `boolean` | Print detailed error diagnostics. |
| `maxValueLength` | `number` | Canonical printed value cap. |
| `maxResultLength` | `number` | Compatibility alias for the value cap. |
| `summarize` | `boolean` | Enable automatic result summarization. |
| `stripScopePrefix` | `boolean` | Remove duplicated scope prefixes from labels. |
| `sensitiveKeyPattern` | `RegExp \| string \| null` | Configure sensitive-key redaction. |
| `maxSummaryDepth` | `number` | Maximum recursive summary depth. |
| `maxSummaryStringLength` | `number` | Maximum string length within summaries. |
| `summaryArraySample` | `number` | Number of array items included in samples. |
| `summaryObjectKeys` | `number` | Maximum number of object keys included in summaries. |

Scope creation supports only `level`, `slowThreshold`, `maxValueLength`, and its compatibility alias `maxResultLength`.

Individual actions support their own `maxValueLength`, `maxResultLength`, `summarize`, and `stripScopePrefix` overrides, in addition to the operation-specific fields.

Invalid numeric configuration values and invalid regex strings throw before any part of a configuration update takes effect.

### Compact span IDs

To keep IDs short in deep or long-running traces, use `configure({ compactIds: true })` globally or `createMeasure("api", { compactIds: true })` for one scope. This emits per-trace IDs such as `#a`, `#b`, rather than growing ancestor paths; scope settings override the global setting, and the default `false` keeps the original format. `id` still includes the scope when set, `parentId` still references the exact parent `id`, and `traceId` still identifies the root. Compact IDs restart per trace, so correlate using `(traceId, id)`; the `#` prefix tells them apart from path IDs even when modes are mixed.

### Colors and timestamps

By default, `colors: "auto"` uses terminal detection and respects `NO_COLOR`, `FORCE_COLOR=0`, and `FORCE_COLOR`.

When colors are enabled, only the bracketed scope token is colored:

```text
[api] a-a ✓ 1.42ms → {"ok":true}
```

The label, path, arrows, status markers, duration, result, error, and budget warning remain plain text.

Each encountered scope receives a stable color for the lifetime of the loaded runtime. Different scopes receive different colors while unused entries remain in the palette.

Unscoped measurements remain uncolored.

Timestamp options are:

```ts
configure({ timestamps: false }); // No timestamps.
configure({ timestamps: true });  // Compact local-time timestamps.
configure({ timestamps: "iso" }); // UTC ISO timestamps.
```

The initial timestamp flag can also come from `MEASURE_TIMESTAMPS=1` or `MEASURE_TIMESTAMPS=true`.

## Safe output, summaries, and error details

### Serialization

The built-in formatting is designed to avoid introducing new application failures while inspecting values.

It supports cycles, repeated references, `bigint`, maps, sets, errors, dates, and common platform objects.

Only ancestor cycles become `[Circular]`; repeated references are not automatically treated as cycles.

Plain-object accessors are represented without invoking their getters. User-defined `toJSON` methods are not called.

Invalid dates and unreadable objects produce stable placeholders rather than causing normal formatting to replace the application outcome.

### Summarization

Enable automatic summaries when full results are too large or expensive to display:

```ts
configure({
  summarize: true,
  maxSummaryDepth: 4,
  maxSummaryStringLength: 160,
  summaryArraySample: 2,
  summaryObjectKeys: 24,
});
```

You can override summarization for a particular action:

```ts
await api(
  {
    start: () => "load records",
    summarize: true,
  },
  loadRecords,
);
```

Summarization and display truncation are separate controls.

A string-length cap is not a general object-traversal budget. Use small projections and bounded summaries when measuring large objects.

### Sensitive data

The default sensitive-key pattern covers common credential names, including passwords, tokens, authorization fields, cookies, and private keys.

Redaction applies to object keys and string map keys.

Every string the built-in logger prints or serializes (labels, values, URL objects, error messages, stacks and causes) also has URL credentials removed: userinfo (`https://user:pass@host`) and credential-looking query parameters (`key`, `token`, `api_key`, `secret`, `password`, …) become `[REDACTED]`. Add your own pattern for application-specific secrets:

```ts
configure({ sensitiveStringPattern: /sk_live_[A-Za-z0-9]+/g });
```

This is not a general secret scanner. A secret in free text that matches neither rule, or in an arbitrarily named field, may remain visible. Remove or sanitize it at the application boundary before logging.

Custom middleware may receive raw payload references. Do not assume that built-in console redaction has already sanitized middleware data.

If a credential appears in shared logs, rotate it.

### Detailed errors

Detailed error output is opt-in:

```ts
configure({
  errorDetails: true,
});
```

Or use:

```sh
MEASURE_ERROR_DETAILS=1
```

When enabled, the formatter can include stack traces and redacted error causes.

It remembers the original thrown object through a `WeakSet`, including when summarization is enabled.

A particular error object's stack and cause are printed once at its first visible failure. Enclosing failures still receive compact error lines.

Distinct errors with identical messages are treated independently.

Primitive thrown values cannot be tracked by a `WeakSet` and may print at each failure.

Detailed stacks and causes are not truncated by `maxValueLength`.

## Error handling and retry safety

Measurement is an observation boundary. It is not a replacement for application-level failure policy.

A measured callback should return the same result or throw the same error as the unmeasured callback, except where explicit recovery or a configured deadline changes the outcome.

The application must decide whether a failure should be retried, deferred, recovered, reconciled, or treated as fatal.

Common cases:

| Failure | Recommended application policy |
| --- | --- |
| Repeatable read fails with a classified transient infrastructure error | Retry within bounded attempts and elapsed time, then defer if fresh data remains unavailable. |
| Read returns missing, invalid, or stale data | Preserve the validation failure or explicitly defer. |
| Write loses its response | Treat the outcome as unknown and reconcile durable state before retrying. |
| Configuration, authorization, or an invariant is invalid | Disable the affected operation or terminate deliberately with a useful diagnostic. |
| Caller requests cancellation or shutdown | Stop scheduling, abort cooperative I/O, settle owned work, and clean up. |
| Logging or diagnostics fail | Contain the observer failure without replacing the application result or error. |

### Writes require special care

A network error does not prove that a write failed.

The remote system may already have committed it.

Repeating a payment, order submission, transaction, or multi-step workflow can duplicate a completed side effect.

For operations with uncertain outcomes, keep enough durable state to reconcile before repeating work.

```ts
const pending = await journal.prepare({
  operationId,
  target,
});

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

On restart, load pending operations and reconcile them before enabling new writes.

In-memory flags and process supervisors cannot replace durable recovery state.

Even when using `.retry()`, idempotency, durable reconciliation, and operation-specific error classification remain the application's responsibility.

### Handle failures at the owning application boundary

A recurring worker should distinguish completed work from a deferred cycle or a paused write state.

```ts
while (!signal.aborted) {
  try {
    await worker.root("cycle", async () => {
      await runCycle(signal);
    });
  } catch (error) {
    const outcome = classifyCycleFailure(error);

    if (outcome === "fatal") throw error;
    if (outcome === "pause-writes") writesEnabled = false;
  }

  await sleep(nextDelay());
}
```

A top-level catch allows deliberate reporting and cleanup, but it cannot resume a loop that has already exited.

Every started promise must be awaited or have a rejection handler whose own failures are contained.

Global `uncaughtException` and `unhandledRejection` handlers should be treated as last-resort diagnostics, not permission to continue mutating state after an unexpected failure.

`measure-fn` intentionally does not own transaction reconciliation, background export, process supervision, or application shutdown policy.

## Development

The repository's primary commands are:

```sh
npm ci
npm run check
npm run test:bun
npm pack
```

`package-lock.json` is the canonical development lockfile.

`npm run check`:

- Typechecks source and examples.
- Builds both runtime entries.
- Runs Node.js and browser behavior suites.
- Validates an installed tarball in an isolated consumer.

`npm run test:bun` retains Bun compatibility coverage.

### Real-browser tests

An optional Playwright suite runs on Node.js 20+:

```sh
npm install --no-save --ignore-scripts --package-lock=false playwright@1.62.1
npx --no-install playwright install chromium --only-shell
npm run test:browser:runtime
```

On Linux, Playwright may require its `--with-deps` installation option.

`MEASURE_BROWSER_EXECUTABLE` selects an existing Chromium binary.

`MEASURE_BROWSER_REPORT` can save the JSON result.

Browser testing tools are development-only and are not shipped as runtime dependencies.

### Examples

Runnable examples are available in:

- `examples/basic.ts`
- `examples/browser.ts`
- `examples/custom-logger.ts`
- `examples/production-orchestrator.ts`

They follow the one-scope-definition-per-file convention.

The repository keeps two Markdown documents: `README.md` for the public contract and `SKILL.md` for implementation guidance. Update those rather than creating additional migration, recovery, or example Markdown documents.

## License

MIT.

## Legacy aliases

The following aliases remain available for backward compatibility:

| Legacy name | Canonical API |
| --- | --- |
| `api.measure` | `api` |
| `api.measureSync` | `api.sync` |
| `maxResultLength` | `maxValueLength` |

For example:

```ts
const api = createMeasure("api");

await api.measure("load", async () => 42);
api.measureSync("compute", () => 42);
```

These work, but new code should prefer `api()` and `api.sync()`.

Use `maxValueLength` for new configurations. Both cap names remain supported, with the legacy name taking precedence when both are supplied at the same tier. The structured terminal event field retains the name `maxResultLength` for compatibility.
