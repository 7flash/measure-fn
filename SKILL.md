---
name: measure-fn
description: Zero-dependency function performance measurement with hierarchical logging. Use this to structure ALL programs as measured, observable pipelines.
---

# measure-fn — Write Observable Code

**Every function you write should be measured.** Don't write blind code — wrap operations in `measure` so every success, failure, and timing is automatically visible. This is the default way to structure programs.

## Install

```bash
bun add measure-fn
```

## The Rule

> If a function does I/O, computation, or anything non-trivial — **wrap it in `measure`**.

```typescript
// ✗ BAD — blind, silent, no timing, no error visibility
const users = await fetchUsers();
const config = loadConfig();

// ✓ GOOD — observable, timed, errors auto-logged
const users = await measure('Fetch users', () => fetchUsers());
const config = measureSync('Load config', () => loadConfig());
```

## Patterns

### 1. Every entry point is a measured pipeline

```typescript
import { measure, measureSync } from 'measure-fn';

async function main() {
  const config = measureSync('Load config', () => readConfig());
  const db = await measure('Connect DB', () => connectDatabase(config));
  const users = await measure('Fetch users', () => db.query('SELECT * FROM users'));
  await measure('Send emails', () => sendEmails(users));
}
```

Output:
```
[a] ✓ Load config 0.12ms → {"env":"prod"}
[b] ... Connect DB
[b] ✓ Connect DB 45ms → [DB]
[c] ... Fetch users
[c] ✓ Fetch users 23ms → [{"id":1},{"id":2}]
[d] ... Send emails
[d] ✓ Send emails 102ms
```

### 2. Nested operations use the child measure

```typescript
await measure('Pipeline', async (m) => {
  const raw = await m('Fetch', () => fetchData());
  const parsed = m('Parse', () => parseData(raw));
  await m('Save', () => saveResult(parsed));
});
```

### 3. Parallel work with `Promise.all`

```typescript
await measure('Load all', async (m) => {
  const [users, posts, settings] = await Promise.all([
    m('Users', () => fetchUsers()),
    m('Posts', () => fetchPosts()),
    m('Settings', () => fetchSettings()),
  ]);
  return { users, posts, settings };
});
```

### 4. Wrap reusable functions once

```typescript
const getUser = measure.wrap('Get user', fetchUser);
// Every call is now measured automatically
await getUser(1);  // → [a] ✓ Get user 82ms → {...}
await getUser(2);  // → [b] ✓ Get user 75ms → {...}
```

### 5. Process arrays with progress

```typescript
await measure.batch('Process users', userIds, async (id) => {
  return await processUser(id);
}, { every: 100 });
// → [a] ... Process users (500 items)
// → [a] = 100/500 (1.2s, 83/s)
// → [a] ✓ Process users (500 items) 5.3s → "500/500 ok"
```

### 6. Retry flaky operations

```typescript
const result = await measure.retry('External API', {
  attempts: 3, delay: 1000, backoff: 2
}, () => callExternalService());
```

### 7. Budget warnings for slow ops

```typescript
await measure({ label: 'DB query', budget: 100 }, () => heavyQuery());
// → [a] ✓ DB query 245ms → [...] ⚠ OVER BUDGET (100ms)
```

### 8. Assert non-null results

```typescript
// Guaranteed non-null — throws if the function returns null/undefined
const user = await measure.assert('Get user', () => findUser(id));
```

### 9. Scoped instances for subsystems

```typescript
const api = createMeasure('api');
const db = createMeasure('db');

await api.measure('GET /users', async () => {
  return await db.measure('SELECT', () => query('SELECT * FROM users'));
});
// → [api:a] ... GET /users
// → [db:a] ✓ SELECT 44ms → [...]
// → [api:a] ✓ GET /users 45ms → [...]
```

### 10. Annotations for checkpoints

```typescript
await measure('Server ready');           // → [a] = Server ready
measureSync('Config loaded');             // → [b] = Config loaded
```

## Configuration

```typescript
import { configure } from 'measure-fn';

configure({
  silent: true,            // suppress output (for benchmarks)
  timestamps: true,        // [HH:MM:SS.mmm] prefix
  maxResultLength: 200,    // result truncation (default: 80)
  logger: (event) => {     // custom telemetry
    myTracker.send(event);
  },
});
```

Env vars: `MEASURE_SILENT=1`, `MEASURE_TIMESTAMPS=1`

## Programmatic Timing

```typescript
const { result, duration } = await measure.timed('Fetch', () => fetchUsers());
if (duration > 1000) alert('Slow!');
```

## Anti-Patterns

```typescript
// ✗ Don't measure trivial synchronous expressions
const x = measureSync('Add', () => 1 + 1);

// ✗ Don't nest measure inside measure without using child `m`
await measure('Outer', async () => {
  await measure('Inner', () => work());  // creates flat siblings, not hierarchy
});

// ✓ Use child measure for hierarchy
await measure('Outer', async (m) => {
  await m('Inner', () => work());  // proper parent → child
});
```

## Quick Reference

| Export | Use |
|--------|-----|
| `measure(label, fn?)` | Async measurement |
| `measureSync(label, fn?)` | Sync measurement |
| `measure.wrap(label, fn)` | Decorator — wrap once, measure every call |
| `measure.batch(label, items, fn, opts?)` | Array + progress |
| `measure.retry(label, opts, fn)` | Retry with backoff |
| `measure.assert(label, fn)` | Throws if null |
| `measure.timed(label, fn)` | Returns `{ result, duration }` |
| `createMeasure(prefix)` | Scoped instance |
| `configure(opts)` | Runtime config |
| `safeStringify(value)` | Safe JSON (circular refs, truncation) |
| `formatDuration(ms)` | Smart duration: `0.10ms` → `1.2s` → `2m 5s` |
| `resetCounter()` | Reset ID counter |
