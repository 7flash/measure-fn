<p align="center">
  <img src="banner.png" alt="measure-fn" width="100%" />
</p>

<p align="center">
  <b>Scoped timing, structured result logging, and automatic nested traces for TypeScript functions.</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/measure-fn"><img src="https://img.shields.io/npm/v/measure-fn.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/measure-fn"><img src="https://img.shields.io/npm/dm/measure-fn.svg" alt="npm downloads"></a>
  <a href="https://github.com/7flash/measure-fn/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
</p>

`measure-fn` wraps function calls with timing logs, scoped trace IDs, nested spans, budgets, retries, batches, and explicit error recovery.

```ts
import { createMeasure } from 'measure-fn';

const app = createMeasure('app');

const users = await app.measure('Fetch users', () => fetchUsers());
```

```txt
[app:a] ... Fetch users
[app:a] ··········· 86.24ms → [{"id":1},{"id":2}]
```

## Installation

```sh
npm install measure-fn
# or
bun add measure-fn
pnpm add measure-fn
yarn add measure-fn
```

## Core model

Create a scoped instance and use it everywhere inside that scope:

```ts
import { createMeasure } from 'measure-fn';

const api = createMeasure('api');

await api.measure('GET /users req_abc123', async () => {
  const users = await api.measure('SELECT users', () => db.users.findMany());
  const body = await api.measure('Serialize response', () => JSON.stringify(users));

  return new Response(body, { status: 200 });
});
```

```txt
[api:a] ... GET /users req_abc123
[api:a-a] ... SELECT users
[api:a-a] ··········· 30.43ms → [{"id":1},{"id":2}]
[api:a-b] ... Serialize response
[api:a-b] ··········· 0.10ms → "[{\"id\":1},{\"id\":2}]"
[api:a] ··········· 31.02ms → {}
```

Nested IDs are automatic. No child `m` function is injected into your callback. Just call the same scoped instance again.

## Defaults

Every measured call:

- logs a start line
- logs duration on success
- prints the returned value by default
- throws the original error by default
- supports explicit recovery with `catch`
- assigns IDs like `[app:a]`, `[app:a-a]`, `[app:a-b]`

Errors do **not** return `null` by default. This is intentional.

## Start and end mappers

Use a string for simple labels:

```ts
await app.measure('DB query', () => db.query());
```

Use `start()` and `end(result)` for concise structured output:

```ts
const response = await api.measure(
  {
    start: () => `GET /users ${requestId}`,
    end: (res: Response) => ({ status: res.status }),
  },
  () => handleRequest(),
);
```

`end(result)` only changes what is printed. The original result is returned unchanged.

## Error handling

By default, errors are logged and re-thrown:

```ts
await app.measure('Fetch user', () => fetchUser(1));
```

Recover explicitly with `catch(error)`:

```ts
const user = await app.measure(
  {
    start: () => 'Fetch user',
    catch: () => ({ id: 0, name: 'Guest' }),
  },
  () => fetchUser(1),
);
```

For request handlers:

```ts
const response = await api.measure(
  {
    start: () => `GET /users ${requestId}`,
    end: (res: Response) => ({ status: res.status }),
    catch: (error) =>
      new Response(
        error instanceof Error ? error.message : String(error),
        { status: 500 },
      ),
  },
  () => handleRequest(),
);
```

| Pattern | On error | Return type |
|---|---|---|
| `measure(action, fn)` | throws original error | `T` |
| `measure({ catch }, fn)` | returns `catch(error)` | `T` |
| `measureSync(action, fn)` | throws original error | `T` |
| `measureSync({ catch }, fn)` | returns `catch(error)` | `T` |

## Timeouts and budgets

```ts
await app.measure(
  {
    start: () => 'Slow API',
    timeout: 5000,
    budget: 100,
  },
  () => fetchSlowApi(),
);
```

- `timeout` rejects if the function takes longer than N ms.
- `budget` only warns when duration is over N ms.

Recover from timeout explicitly:

```ts
const result = await app.measure(
  {
    start: () => 'Slow API',
    timeout: 5000,
    catch: () => null,
  },
  () => fetchSlowApi(),
);
```

## Result truncation

```ts
import { configure } from 'measure-fn';

configure({ maxResultLength: 200 });
```

Per-call override:

```ts
await app.measure(
  {
    start: () => 'Large result',
    maxResultLength: 80,
  },
  () => loadLargeObject(),
);
```

Use `0` for unlimited output.

## Sync API

```ts
const config = app.measureSync('Parse config', () => JSON.parse(raw));
```

Nested sync spans work the same way:

```ts
app.measureSync('Build report', () => {
  const raw = app.measureSync('Parse CSV', () => 'a,b\n1,2');
  const rows = app.measureSync('Split rows', () => raw.split('\n'));
  return { rows };
});
```

## Annotations

```ts
await app.measure('Server ready');
app.measure.note('Cache warmed');

app.measureSync('Config loaded');
app.measureSync.note('CLI ready');
```

```txt
[app:a] = Server ready
```

## Helpers

### `measure.wrap(action, fn)`

```ts
const getUser = app.measure.wrap('Get user', fetchUser);

await getUser(1);
await getUser(2);
```

### `measure.retry(action, opts, fn)`

```ts
const result = await app.measure.retry(
  'Flaky API',
  { attempts: 3, delay: 1000, backoff: 2 },
  () => fetchFlakyApi(),
);
```

If all attempts fail, the last error is thrown unless the top-level action has `catch`.

### `measure.batch(action, items, fn, opts?)`

```ts
const results = await app.measure.batch(
  'Fetch users',
  userIds,
  (id) => fetchUser(id),
  { every: 100 },
);
```

Item errors are recorded as `null` and the batch continues.

### `measure.timed(action, fn)`

```ts
const { result, duration } = await app.measure.timed('Fetch', () => fetchUsers());
const sync = app.measureSync.timed('Parse', () => JSON.parse(raw));
```

## Configuration

```ts
import { configure } from 'measure-fn';

configure({
  silent: false,
  maxResultLength: 200,
  dotEndLabel: true,
  dotChar: '·',
  logger: null,
});
```

Environment:

```sh
MEASURE_SILENT=1
```

## Custom logger

```ts
configure({
  logger(event) {
    telemetry.track(event);
  },
});
```

The logger receives structured `MeasureLogEvent` objects for `start`, `success`, `error`, and `annotation`.

## Runtime support

`measure-fn` uses `node:async_hooks` for async-local nesting. It works in Node.js and Bun.

## License

MIT
