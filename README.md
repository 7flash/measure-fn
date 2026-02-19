# measure-fn

![CI](https://github.com/7flash/measure-fn/actions/workflows/ci.yml/badge.svg)

**Stop writing blind code.** Every function you write either succeeds or fails, takes some amount of time, and lives inside a larger flow. `measure-fn` makes all of that visible — automatically, hierarchically.

```
[18:50:04.893] [a] ✓ Load config 0.09ms → {"env":"prod","port":3000}
[18:50:04.894] [b] = App ready
[18:50:04.895] [e] ... Parallel Fetch
[18:50:04.895] [e-a] ... Fetch User (userId=1)
[18:50:04.895] [e-b] ... Fetch User (userId=2)
[18:50:04.950] [e-b] ✓ Fetch User 55.58ms → {"id":2,"name":"User 2"}
[18:50:04.981] [e-a] ✓ Fetch User 85.93ms → {"id":1,"name":"User 1"}
[18:50:04.981] [e] ✓ Parallel Fetch 86.08ms
[18:50:05.072] [f] ✓ DB query 91.12ms → {"rows":42} ⚠ OVER BUDGET (30.00ms)
[18:50:05.775] [m] ... Fetch all users (20 items)
[18:50:06.179] [m] = 5/20 (0.4s, 12/s)
[18:50:07.450] [m] ✓ Fetch all users (20 items) 1.7s → "20/20 ok"
[18:50:07.450] [api:a] ... GET /users
[18:50:07.450] [db:a] ... SELECT users
[18:50:07.493] [db:a] ✓ SELECT users 43.07ms → [{"id":1},{"id":2}]
[18:50:07.493] [api:a] ✓ GET /users 43.32ms → [{"id":1},{"id":2}]
[18:50:08.721] [o] ✓ Slow op 1.2s → "slow"
```

No setup. No dashboards. Just wrap your functions.

## Install

```sh
bun add measure-fn
```

## Quick Start

```typescript
import { measure, measureSync } from 'measure-fn';

// Sync leaf — single line with auto-printed result
const config = measureSync('Parse config', () => JSON.parse(str));
// → [a] ✓ Parse config 0.20ms → {"port":3000}

// Async — start + end
const data = await measure('Fetch data', async () => {
  return await fetch(url).then(r => r.json());
});
// → [b] ... Fetch data
// → [b] ✓ Fetch data 245.12ms → [{"id":1}]
```

## Output Format

| Pattern | When | Example |
|---------|------|---------|
| `[id] ... label` | Async start / sync with children | `[a] ... Pipeline` |
| `[id] ✓ label Nms → value` | Success | `[a] ✓ Fetch 102ms → {"id":1}` |
| `[id] ✗ label Nms (err)` | Error | `[a] ✗ Fetch 2ms (timeout)` |
| `[id] = label` | Annotation | `[a] = checkpoint` |

**No indentation, no colors.** IDs encode hierarchy. Return values auto-print. Circular refs → `[Circular]`, long values truncated.

**Smart duration**: `0.10ms` → `1.2s` → `2m 5s`

## API

### `measure(label, fn?)` — async

```typescript
// Simple
const user = await measure('Fetch user', () => fetchUser(1));

// Nested + parallel
await measure('Pipeline', async (m) => {
  await Promise.all([
    m({ label: 'Fetch', userId: 1 }, () => fetchUser(1)),
    m({ label: 'Fetch', userId: 2 }, () => fetchUser(2)),
  ]);
});

// Annotation
await measure('checkpoint');
```

### `measureSync(label, fn?)` — synchronous

```typescript
// Leaf — single line
const hash = measureSync('Hash', () => computeHash(data));

// With children — start + end
measureSync('Report', (m) => {
  const data = m('Parse', () => parse(raw));
  return m('Summarize', () => summarize(data));
});
```

### `measure.wrap(label, fn)` — decorator

Wrap a function once, every call is measured:

```typescript
const getUser = measure.wrap('Get user', fetchUser);
await getUser(1); // → [a] ... Get user → [a] ✓ Get user 82ms → {...}
await getUser(2); // → [b] ... Get user → [b] ✓ Get user 75ms → {...}
```

### `measure.batch(label, items, fn, opts?)` — array processing with progress

```typescript
const results = await measure.batch('Process users', userIds, async (id) => {
  return await processUser(id);
}, { every: 100 }); // log progress every 100 items
```
Output:
```
[a] ... Process users (500 items)
[a] = 100/500 (1.2s, 83/s)
[a] = 200/500 (2.1s, 95/s)
[a] ✓ Process users (500 items) 5.3s → "500/500 ok"
```

### `measure.retry(label, opts, fn)` — retry with backoff

```typescript
const result = await measure.retry('Flaky API', {
  attempts: 3, delay: 1000, backoff: 2
}, () => fetchFlakyApi());
```
```
[a] ... Flaky API [1/3]
[a] ✗ Flaky API [1/3] 102ms (timeout)
[b] ... Flaky API [2/3]
[b] ✓ Flaky API [2/3] 89ms → {"status":"ok"}
```

### `measure.assert(label, fn)` — throw if null

```typescript
const user = await measure.assert('Get user', () => fetchUser(1));
// guaranteed non-null, or throws
```

### Budget — warn on slow operations

```typescript
await measure({ label: 'DB query', budget: 100 }, async () => {
  return await db.query('SELECT * FROM users');
});
// → [a] ✓ DB query 245ms → [...] ⚠ OVER BUDGET (100ms)
```

### `createMeasure(prefix)` — scoped instances

```typescript
const api = createMeasure('api');
const db = createMeasure('db');

await api.measure('GET /users', async () => {
  return await db.measure('SELECT', () => query('...'));
});
// → [api:a] ... GET /users
// → [db:a] ✓ SELECT 44ms → [...]
// → [api:a] ✓ GET /users 45ms → [...]
```

### `configure(opts)` — runtime config

```typescript
configure({
  silent: true,            // suppress all output
  timestamps: true,        // prepend [HH:MM:SS.mmm]
  maxResultLength: 200,    // truncate results (default: 80)
  logger: (event) => {     // custom event handler
    myTelemetry.track(event);
  }
});
```

Env: `MEASURE_SILENT=1`, `MEASURE_TIMESTAMPS=1`

### `measure.timed(label, fn?)` — programmatic timing

```typescript
const { result, duration } = await measure.timed('Fetch', () => fetchUsers());
```

### Utilities

```typescript
import { safeStringify, formatDuration, resetCounter } from 'measure-fn';

safeStringify({ circular: self }); // handles circular refs, truncates
formatDuration(91234);              // "1m 31s"
resetCounter();                     // reset ID counter for tests
```

## Error Handling

**measure never throws** (except `.assert()`). On error: logs `✗`, returns `null`, prints stack to stderr.

## Types

```typescript
export type MeasureEvent = {
  type: 'start' | 'success' | 'error' | 'annotation';
  id: string; label: string; depth: number;
  duration?: number; result?: unknown; error?: unknown;
  meta?: Record<string, unknown>; budget?: number;
};
export type TimedResult<T> = { result: T | null; duration: number };
export type RetryOpts = { attempts?: number; delay?: number; backoff?: number };
export type BatchOpts = { every?: number };
```

## Zero Dependencies

Works in Bun, Node, Deno. Uses only `performance.now()` and `console`.

## License

MIT
