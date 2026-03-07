import { measure, measureSync, configure, createMeasure, safeStringify, type MeasureFn } from "./index.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchUser(userId: number) {
  await sleep(50 + Math.random() * 50);
  if (userId === 999) throw new Error('User not found', { cause: { userId } });
  return { id: userId, name: `User ${userId}` };
}

async function flakyApi() {
  await sleep(30);
  if (Math.random() < 0.6) throw new Error('Service unavailable');
  return { status: 'ok' };
}

async function main() {
  configure({ timestamps: true });

  // ─── Sync leaf: single line + auto-printed result ──────────────
  measureSync('Load config', () => ({ env: 'prod', port: 3000 }));

  // ─── Annotation ────────────────────────────────────────────────
  measureSync('App ready');

  // ─── Sync with children ────────────────────────────────────────
  measureSync('Build report', (m) => {
    const raw = m('Parse CSV', () => 'col1,col2\nval1,val2');
    const rows = m('Split rows', () => raw?.split('\n') ?? []);
    return { rows, count: rows?.length ?? 0 };
  });

  // ─── Circular ref (safe stringify) ─────────────────────────────
  measureSync('Circular ref', () => {
    const obj: any = { name: 'root' };
    obj.self = obj;
    return obj;
  });

  // ─── Parallel async (interleaved) ──────────────────────────────
  await measure('Parallel Fetch', async (m) => {
    await Promise.all([
      m({ label: 'Fetch User', userId: 1 }, () => fetchUser(1)),
      m({ label: 'Fetch User', userId: 2 }, () => fetchUser(2)),
      m({ label: 'Fetch User', userId: 3 }, () => fetchUser(3)),
    ]);
  });

  // ─── Budget: warn when operation exceeds time limit ────────────
  await measure({ label: 'DB query', budget: 30 }, async () => {
    await sleep(80); // intentionally slow
    return { rows: 42 };
  });

  // ─── Retry with backoff ────────────────────────────────────────
  await measure.retry('Flaky API', { attempts: 3, delay: 100, backoff: 2 }, flakyApi);

  // ─── Assert: throws if null ────────────────────────────────────
  const user = await measure.assert('Assert user', () => fetchUser(1));
  console.log(`Asserted: ${user.name}`);

  // ─── Wrap: decorator pattern ───────────────────────────────────
  const getUser = measure.wrap('Get user', fetchUser);
  await getUser(1);
  await getUser(2);

  // ─── Batch: process array with progress ────────────────────────
  const userIds = Array.from({ length: 20 }, (_, i) => i + 1);
  await measure.batch('Fetch all users', userIds, async (id) => {
    return await fetchUser(id);
  }, { every: 5 });

  // ─── Scoped instances ──────────────────────────────────────────
  const api = createMeasure('api');
  const db = createMeasure('db');

  await api.measure('GET /users', async () => {
    return await db.measure('SELECT users', async () => {
      await sleep(30);
      return [{ id: 1 }, { id: 2 }];
    });
  });

  // ─── safeStringify utility ─────────────────────────────────────
  const circular: any = { a: 1 };
  circular.self = circular;
  console.log(`safeStringify: ${safeStringify(circular)}`);

  // ─── Smart duration formatting (simulated long op) ─────────────
  await measure('Quick op', async () => {
    await sleep(5);
    return 'fast';
  });

  await measure('Slow op', async () => {
    await sleep(1200);
    return 'slow';
  });
}

// ─── Bun.serve patterns ──────────────────────────────────────────────
// measure() returns T | null — on error it returns null instead of throwing.
// Use the onError 3rd argument to provide a fallback Response.

async function bunServeExample() {
  console.log('\n─── Bun.serve Patterns ─────────────────────────────');

  // ✅ Pattern 1: onError — graceful 500 fallback with error details
  const server1 = Bun.serve({
    port: 0,
    fetch: (req) => measure(
      { label: `${req.method} ${new URL(req.url).pathname}` },
      async () => {
        const url = new URL(req.url);
        if (url.pathname === '/fail') throw new Error('Route error');
        return new Response(`ok: ${url.pathname}`);
      },
      (error) => new Response(`Error: ${(error as Error).message}`, { status: 500 })
    ) as any,
  });

  // ✅ Pattern 2: measure.assert — throws on error (sugar for onError + throw)
  const server2 = Bun.serve({
    port: 0,
    fetch: (req) => measure.assert('Handle request', async () => {
      const url = new URL(req.url);
      if (url.pathname === '/fail') throw new Error('Route error');
      return new Response(`ok: ${url.pathname}`);
    }),
  });

  // Test Pattern 1: onError returns fallback Response
  const r1ok = await fetch(`http://localhost:${server1.port}/hello`);
  console.log(`  onError pattern (ok): ${r1ok.status} ${await r1ok.text()}`);

  const r1fail = await fetch(`http://localhost:${server1.port}/fail`);
  console.log(`  onError pattern (fail): ${r1fail.status} ${await r1fail.text()}`);

  // Test Pattern 2: assert
  const r2ok = await fetch(`http://localhost:${server2.port}/hello`);
  console.log(`  assert pattern (ok): ${r2ok.status} ${await r2ok.text()}`);

  try {
    await fetch(`http://localhost:${server2.port}/fail`);
  } catch {
    console.log(`  assert pattern (fail): server rejected (expected)`);
  }

  server1.stop();
  server2.stop();
}

main()
  .then(() => console.log('\n✅ Done.'))
  .then(() => bunServeExample())
  .then(() => console.log('\n✅ Bun.serve example done.'));
