# measure-fn

Zero-runtime-dependency function performance measurement with hierarchical logging for Bun and Node.js.

```ts
import { createMeasure } from "measure-fn";

const m = createMeasure("api");

const users = await m("GET /users", async () => {
  return [{ id: 1 }, { id: 2 }];
});
```

Typical output:

```text
[api:a] → GET /users
[api:a] ✓ 1.42ms → [{"id":1},{"id":2}]
```

## Package/runtime support

Published packages expose compiled ESM from `dist/index.js` plus declarations from `dist/index.d.ts`. The TypeScript source remains included for debugging/reference, but consumers do not execute TypeScript from `node_modules`.

```ts
import { measure, measureSync, createMeasure, configure } from "measure-fn";
```

The build is intentionally dependency-free at runtime. TypeScript and Bun types are development-only dependencies.

## Custom logging middleware

`configure({ logger })` is middleware-style. The logger receives the structured event plus `next()`.

Call `next()` to keep measure-fn's built-in output and add your own behavior:

```ts
import { configure } from "measure-fn";

configure({
  logger(event, next) {
    next();

    // Add telemetry, persistence, filtering, counters, etc.
    telemetry.track(event);
  },
});
```

`next()` is idempotent for each event, so calling it more than once does not duplicate the built-in log.

Omit `next()` to replace built-in logging completely:

```ts
configure({
  logger(event) {
    myLogger.write(event);
  },
});
```

Existing one-argument loggers remain valid.

### Conditional delegation

```ts
configure({
  logger(event, next) {
    if (event.type !== "start") next();

    if (event.type === "error") {
      reportError(event.error);
    }
  },
});
```

The structured event type is exported as `MeasureLogEvent`; the middleware type is exported as `MeasureLogger`.

### Filter by label and normalized data

Every logger event exposes `event.label` plus a normalized `event.data` field, so filtering does not need an event-type switch:

```ts
configure({
  logger(event, next) {
    // Suppress noisy health checks.
    if (event.label.startsWith("health:")) return;

    // Suppress a specific payload regardless of event type.
    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "status" in event.data &&
      event.data.status === "ignored"
    ) {
      return;
    }

    next();
  },
});
```

`data` aliases the event-specific payload:

- `start`: `data === value`
- `success`: `data === result`
- `error`: `data === error`
- `annotation`: `data === value`

The original `value`, `result`, and `error` fields remain available for discriminated-union type narrowing. For success and error events, `data` is the same mapped/summarized payload that the logger receives in `result` or `error`.

### Route selected events while keeping default output

```ts
configure({
  logger(event, next) {
    next();

    if (event.label.startsWith("db:") && event.type === "error") {
      telemetry.capture(event.label, event.data);
    }
  },
});
```

## Colors

The built-in logger supports deterministic ANSI colors:

```ts
configure({ colors: "auto" }); // default
configure({ colors: true });   // always emit ANSI color
configure({ colors: false });  // plain text
```

With colors enabled:

- a scoped instance gets a stable ID color derived from its scope;
- an unscoped measurement gets a stable ID color derived from its label;
- labels get their own stable color;
- success, error, annotation, and over-budget markers use semantic colors.

`"auto"` respects terminal detection as well as `NO_COLOR` and `FORCE_COLOR`.

## Scoped measurements

```ts
import { createMeasure } from "measure-fn";

const api = createMeasure("api");
const db = createMeasure("db");

await api("GET /users", async () => {
  const rows = await db("SELECT users", async () => {
    return [{ id: 1 }, { id: 2 }];
  });

  return { status: 200, rows };
});
```

Nested measurements automatically share the active span hierarchy.

## Sync measurements

```ts
import { measureSync } from "measure-fn";

const config = measureSync("Load config", () => ({ env: "prod" }));
```

Annotations do not need a callback:

```ts
measureSync("Application ready");
```

## Action objects

Use an action object when you need result mapping, recovery, budgets, timeouts, or per-measure formatting options:

```ts
const result = await m(
  {
    start: () => "DB query",
    end: (rows) => ({ count: rows.length }),
    budget: 50,
    timeout: 2_000,
  },
  queryDatabase,
);
```

Supported action options include:

- `start`
- `end`
- `catch`
- `budget`
- `timeout`
- `maxResultLength`
- `summarize`
- `stripScopePrefix`

## Other helpers

The async measure instance also provides:

```ts
m.root(...)
m.sync(...)
m.note(...)
m.timed(...)
m.retry(...)
m.wrap(...)
m.batch(...)
```

The package exports `safeStringify`, `summarizeForMeasure`, and `formatDuration` as utilities.

## Error output

The built-in logger intentionally emits two error views:

1. a compact timing/failure line through `console.log`;
2. detailed stack/cause information through `console.error`.

A custom logger can suppress that behavior by not calling `next()`.

## Configuration

```ts
configure({
  silent: false,
  colors: "auto",
  logger: null,
  maxResultLength: 0,
  summarize: false,
  stripScopePrefix: false,
});
```

See `examples/basic.ts`, `examples/custom-logger.ts`, and `examples/production-orchestrator.ts` for complete usage patterns.

## License

MIT
