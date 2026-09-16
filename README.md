# measure-fn

`measure-fn` is a zero-runtime-dependency wrapper for measuring named operations, building a local hierarchy, and emitting compact structured log events without changing the application result or error.

The package is intentionally small. It measures work; it does not own application retries, transaction reconciliation, cancellation, background export, or process supervision. Those policies stay at the boundary that understands the operation.

```ts
import { createMeasure } from "measure-fn";

const api = createMeasure("api");

const users = await api.root("GET /users", async () => {
  return await api("load users", async () => [{ id: 1 }, { id: 2 }]);
});
```

With colors disabled, the built-in logger has this shape:

```text
[api] a → GET /users
[api] a-a → load users
[api] a-a ✓ 1.42ms → [{"id":1},{"id":2}]
[api] a ✓ 1.85ms → [{"id":1},{"id":2}]
```

When colors are enabled, only the `[api]` scope token is colored. Labels, paths, arrows, status markers, durations, results, errors, and budget warnings remain plain text. Each encountered scope receives a stable color for the lifetime of the loaded runtime, and distinct colors are assigned while the scope palette has unused entries.

## First principles

Measurement is an observation boundary. A measured callback should return the same value and throw the same application error it would have produced without measurement unless the caller explicitly chooses recovery. Logger failures must not replace application outcomes, formatting must avoid executing arbitrary application getters or `toJSON`, and timing should measure the callback rather than the logger itself.

A scope is an ownership label, not a substitute for the call hierarchy. The scope tells you which subsystem owns an operation; `rawId`, `traceId`, and `parentId` describe where that operation belongs in a local trace. This is why the console gives color to the scope only and leaves everything else neutral.

The recommended source structure is one scope definition per file. A file may use imported scopes from other modules, but it should not define unrelated `createMeasure()` instances beside each other. This makes the scope name a stable property of a module instead of an ad hoc property of whichever function happened to log something.

## Structure code around one scope per file

A simple module can own its scope directly:

```ts
import { createMeasure } from "measure-fn";

const users = createMeasure("users");

export async function loadUser(id: string) {
  return await users("load user", async () => {
    return { id };
  });
}
```

When work crosses subsystems, put each scope in the file that owns that subsystem and compose normal functions. Do not define both scopes in the orchestration file. For example, `db.ts` can own the database scope:

```ts
import { createMeasure } from "measure-fn";

const db = createMeasure("db");

export async function queryUsers() {
  return await db("SELECT users", async () => [{ id: 1 }]);
}
```

Then `users.ts` can own the users scope and call the database module normally:

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

In Node.js and Bun, scoped instances from the same loaded package share asynchronous context, so `db` automatically becomes a child of the active `users` span. If several files intentionally share one scope, define that scope once in a small owner module and import it; do not call `createMeasure("same-name")` in every file.

Use `.root()` for independent entry points such as requests, messages, jobs, CLI commands, and recurring ticks. Use ordinary measured calls beneath the root. Keep trivial expressions inside their containing measurement instead of wrapping every line.

## Runtime and browser builds

Published packages contain compiled ESM and TypeScript declarations. Node.js 18+ and Bun can import the package directly. There is no CommonJS build; use ESM or dynamic `import()` from CommonJS.

Browser bundlers, including esbuild with `platform: "browser"`, select `dist/browser.js` through the package export conditions. You can also select the browser entry explicitly:

```ts
import { createMeasure } from "measure-fn/browser";
```

Keep browser bundles targeted at the browser. Do not import `dist/index.js` directly and do not mark `node:async_hooks` external to work around bundling, because that would leave a Node-only import in browser code.

Node and Bun use shared `AsyncLocalStorage`, so ordinary nested calls retain their parent across `await`. Browser code cannot safely infer asynchronous parentage with a global synchronous stack. Capture a binding while the parent is active and use that binding after the first asynchronous boundary:

```ts
import { createMeasure } from "measure-fn/browser";

const extension = createMeasure("extension");

await extension.root("message", async () => {
  const step = extension.bindContext();
  await Promise.resolve();
  const state = await step("read state", async () => ({ enabled: true }));
  return await step("apply state", () => state);
});
```

Capture a fresh binding for each browser request, event, or message. A binding captured outside an active span creates roots. A helper using another unbound scope after `await` must receive a binding or capture its own while the parent is active.

## Results, action objects, and recovery

`measure(action, fn)` returns a promise for the callback result. `measureSync(action, fn)` returns the original synchronous result. By default both log and rethrow the original application error.

Action objects allow observation and explicit recovery:

```ts
const response = await api.root(
  {
    start: () => "GET /users",
    end: (response: Response) => ({ status: response.status }),
    error: (error) => ({ message: safeErrorMessage(error) }),
    catch: () => new Response("Internal Server Error", { status: 500 }),
    budget: 50,
    timeout: 2_000,
  },
  async () => new Response("ok"),
);
```

`start`, `end`, and `error` are synchronous observation mappers. `end` changes the logged success payload without changing the returned value. `error` changes only the logged error payload; the original error still goes to `catch` or is rethrown unchanged. This makes it possible to keep raw errors for control flow while emitting a small sanitized diagnostic such as `{ code, message, stage }`. A throwing or asynchronous mapper produces an observer diagnostic instead of replacing the application result or failure. Keep mappers pure because silent mode skips them.

`catch` is explicit recovery. Use it only when the returned value is a valid result for the caller. A recovered operation still emits an error event for the failed callback and then returns the recovery value; it does not emit a second success event. If recovery throws, that recovery error propagates.

Synchronous callbacks and synchronous recovery must remain synchronous. Promise-like results are rejected by the sync runtime and disallowed by the sync types. Synchronous actions do not accept `timeout`, because a timer cannot interrupt blocking JavaScript.

Calls without a callback are annotations and return `null`; `.note(action)` emits an annotation and returns `void`.

```ts
api.sync("load config", () => ({ env: "production" }));
api.note("application ready");
await api("checkpoint");
```

## Error handling by operation semantics

Do not make a single `continue-on-error` rule responsible for every failure. The owner of the operation should decide whether the correct outcome is retry, defer, recover, pause writes, or terminate deliberately.

| Failure | Default policy |
| --- | --- |
| Repeatable read fails with a classified transient infrastructure error | Retry within a bounded attempt and elapsed-time budget, then defer the unit of work if fresh data is still unavailable. |
| Read returns missing, invalid, or stale data | Preserve the validation failure or explicitly defer. Do not invent a usable zero, empty object, or stale fallback unless the caller explicitly accepts it. |
| Write or multi-step operation loses its response | Treat the outcome as unknown, stop dependent writes, and reconcile durable state before another attempt. |
| Configuration, authorization, or invariant is invalid | Disable the affected operation or terminate deliberately with a useful diagnostic. Blind retry is not recovery. |
| Caller requests cancellation or shutdown | Stop scheduling, abort cooperative I/O, settle owned work, and clean up. Do not classify shutdown as a transient fault. |
| Logger or diagnostic sink fails | Contain the observer failure and optionally report it through `onLoggerError`; never replace the application result or error. |

### Retry only work that is safe to repeat

`.retry()` is deliberately generic. It retries the callback after failures that pass an optional `retryIf(error, attempt)` predicate; it does not classify errors, add jitter, honor `Retry-After`, cancel the previous attempt, or know whether the operation is idempotent. Use it only when repeating the whole callback is safe.

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

Returning `false` from `retryIf` stops further attempts; an action `catch` still runs only as final explicit recovery.

For a transport where authentication errors, malformed requests, and transient network failures require different policies, keep retry ownership in the application layer that can classify them. Avoid stacking independent retry loops in the transport, SDK, and application, because attempt counts multiply and total delay becomes difficult to reason about.

A rejected `fetch()` has no HTTP response. If a read retry policy is based on HTTP status alone, it will miss connection resets and other failures that reject before headers arrive. The retry boundary for a repeatable read should cover connection, response consumption, and decoding, with a single overall deadline and cooperative cancellation where available.

### Do not automatically retry uncertain writes

A network error during a write means the client does not know the outcome. The remote system may already have committed the operation. Retrying the whole workflow can repeat a completed side effect.

A write owner should record enough state to reconcile before resuming:

```ts
const pending = await journal.prepare({ operationId, target });

try {
  const receipt = await payments("submit payment", async () => {
    return await client.submit(pending);
  });
  await journal.confirm(operationId, receipt);
  return receipt;
} catch (error) {
  await journal.markUnknown(operationId, error);
  throw error;
}
```

On restart, load pending operations and reconcile them before enabling new writes. In-memory flags and process supervisors cannot replace durable recovery state.

### Own failure at the outer application boundary

A recurring process should distinguish a deferred cycle from a completed cycle and from a paused write state. Every started promise must either be awaited or have a rejection handler whose own failure is contained. A top-level catch gives controlled reporting and cleanup, but it cannot resume a loop that has already exited.

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

Global `uncaughtException` and `unhandledRejection` handlers are last-resort diagnostics, not authorization to continue mutating state after an unexpected failure.

### Timeouts are deadlines for waiting, not cancellation

A measurement timeout rejects when its timer fires and clears its timer when the measurement settles. It cannot stop blocking JavaScript, cancel a callback that is already running, or undo a submitted write. Pass an `AbortSignal` into cooperative I/O when cancellation matters. A timed-out callback may still finish later, so combining timeouts with retries can overlap attempts if the underlying operation does not stop.

## Custom logging

The logger receives a discriminated `MeasureLogEvent` and an idempotent `next()` callback. Calling `next()` includes the built-in output. Omitting it suppresses or replaces the built-in output for that event.

```ts
import { configure } from "measure-fn";

configure({
  logger(event, next) {
    if (event.label.startsWith("health:")) return;
    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "internal" in event.data &&
      event.data.internal === true
    ) return;
    next();
  },
  onLoggerError(error, event) {
    void reportDiagnostic({ error, event });
  },
});
```

Logger exceptions, console failures, and rejected logger promises are contained. `onLoggerError` is also contained. Asynchronous loggers are best effort and are not awaited; the package does not provide a telemetry flush lifecycle. Keep `next()` synchronous when output order matters.

Every event contains `id`, `rawId`, `scope`, `depth`, `label`, `traceId`, `parentId`, and `data`. `id` remains the scoped internal display identifier such as `api:a-a`; `rawId` is the hierarchy path such as `a-a`. The console intentionally renders that as `[api] a-a`. `traceId` identifies one local root within a loaded runtime and `parentId` identifies the direct parent. Add process, session, request, or other application identifiers when correlating separate runtimes.

| Event | Normalized payload | Additional fields |
| --- | --- | --- |
| `start` | `data === value` | Start projection value. |
| `annotation` | `data === value` | Annotation value. |
| `success` | `data === result` | `duration`, `budget`, and `maxResultLength`. |
| `error` | `data === error` | `duration`, `budget`, and `maxResultLength`. |

Treat structured payloads as read-only. When summarization is disabled, logger events can contain original object references. Console redaction does not sanitize raw payloads sent to another sink.

`colors: "auto"` is the default. It respects `NO_COLOR`, `FORCE_COLOR=0`, `FORCE_COLOR`, and terminal detection. Only the bracketed scope token is colored. Unscoped measurements remain uncolored. `timestamps: true` prepends a plain ISO timestamp.

## Timing and helpers

Durations start after the start mapper and start logger, and stop before the terminal mapper and logger. `.timed()` reports the same duration used by the corresponding success or error event. Parent timings include child work and child instrumentation.

```ts
const { result, duration } = await api.timed("fetch", async () => 42);
const syncTiming = api.sync.timed("compute", () => 42);
```

A budget is a warning only. Timeout and retry delays must fit the platform timer range from `0` through `2,147,483,647` milliseconds.

`.wrap()` preserves `this` and arguments for ordinary sync and async methods. It is not a constructor wrapper and does not copy custom function properties.

`.batch()` processes a readonly array sequentially, preserves result order, and continues after item failures. A failed item contributes `null`; a successful `null` also appears as `null`, although success accounting remains correct. The action's end mapper receives `{ ok, total, results }` and item callbacks may be synchronous or asynchronous.

```ts
const results = await api.batch(
  "process items",
  [1, 2, 3],
  async (item) => item * 2,
  { every: 1 },
);
```

Each instance's `.resetCounter()` resets its display root counter. It does not reset trace IDs or active child counters. The `.measure` and `.measureSync` aliases remain available on scoped instances.

## Configuration and serialization

Configuration is shared by instances from the loaded package. Set it during application initialization. Invalid numeric values and invalid regex strings throw before any part of a configuration update takes effect.

```ts
configure({
  silent: false,
  logger: null,
  onLoggerError: null,
  colors: "auto",
  timestamps: false,
  maxResultLength: 0,
  summarize: false,
  stripScopePrefix: false,
  maxSummaryDepth: 4,
  maxSummaryStringLength: 160,
  summaryArraySample: 2,
  summaryObjectKeys: 24,
});
```

`MEASURE_SILENT=1` and `MEASURE_TIMESTAMPS=1` set their initial flags; `true` is also accepted. Silent spans still execute callbacks, deadlines, recovery, and nesting but skip observation mappers and event delivery. A span started while silent remains unobserved if configuration changes during its execution.

Actions can override `summarize`, `maxResultLength`, and `stripScopePrefix`. `maxResultLength: 0` means unlimited display output. It is a string-output limit, not a traversal or allocation budget; large values should be summarized or projected through a small `end` result.

`safeStringify()` and `summarizeForMeasure()` support cycles, repeated references, bigint, maps, sets, errors, dates, and common platform objects. Only ancestor cycles become `[Circular]`. Plain-object accessors are represented without invoking the getter, and user-defined `toJSON` methods are not invoked. Invalid dates and unreadable objects produce stable placeholders.

The sensitive-key pattern covers common credential names such as passwords, tokens, authorization, cookies, and private keys. It is applied to object keys and string map keys. This is key-based redaction, not a secret scanner. Credentials embedded in free text, labels, URLs, stack strings, or arbitrarily named fields must be removed by the application before logging. If a credential has already appeared in shared logs, rotate it.

## Compatibility and current guarantees

The current package keeps Node asynchronous context in the Node entry and browser-safe context in the browser entry. Logger failures are isolated from application outcomes. Settled measurements clear owned deadline timers. `.timed()` and emitted durations use the same interval. Events expose local `traceId` and direct `parentId`. Sync APIs reject promise-like results and do not accept timeouts. Serialization avoids ordinary getters and custom `toJSON`, distinguishes repeated references from ancestor cycles, and applies stateless key-redaction checks.

Normal callback results, default original-error propagation, explicit `catch` recovery, normalized `data` aliases, middleware delegation, method aliases, scoped event IDs, and zero runtime dependencies remain part of the contract. Browser automatic context remains synchronous; use `.bindContext()` when parentage must survive `await`.

The repository intentionally keeps only two Markdown documents: this `README.md` for the public contract and `SKILL.md` for implementation guidance. Update one of these instead of creating a new Markdown note, migration file, example README, or recovery document.

## Development

```sh
npm ci
npm run check
npm run test:bun
npm pack
```

`package-lock.json` is the canonical development lockfile. `npm run check` typechecks source and examples, builds both runtime entries, runs the Node and browser behavior suites, and validates an installed tarball in an isolated consumer. `test:bun` retains Bun compatibility coverage.

The optional real-browser suite uses Playwright on Node 20+:

```sh
npm install --no-save --ignore-scripts --package-lock=false playwright@1.62.1
npx --no-install playwright install chromium --only-shell
npm run test:browser:runtime
```

On Linux, Playwright may require its `--with-deps` installation option. `MEASURE_BROWSER_EXECUTABLE` can select an existing Chromium binary and `MEASURE_BROWSER_REPORT` can save the JSON result. Browser tooling remains development-only and is not shipped as a runtime dependency.

See `examples/basic.ts`, `examples/browser.ts`, `examples/custom-logger.ts`, and `examples/production-orchestrator.ts` for runnable patterns. The examples follow the one-scope-definition-per-file convention.

## License

MIT.

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