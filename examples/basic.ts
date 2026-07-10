import {
  measure,
  measureSync,
  configure,
  createMeasure,
  safeStringify,
} from "./index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchUser(userId: number) {
  await sleep(50 + Math.random() * 50);

  if (userId === 999) {
    throw new Error("User not found", { cause: { userId } });
  }

  return { id: userId, name: `User ${userId}` };
}

async function flakyApi() {
  await sleep(30);

  if (Math.random() < 0.6) {
    throw new Error("Service unavailable");
  }

  return { status: "ok" };
}

async function main() {
  configure({ timestamps: true });

  // ─── Sync leaf: default prints returned value ───────────────────────
  measureSync("Load config", () => ({ env: "prod", port: 3000 }));

  // ─── Annotation ─────────────────────────────────────────────────────
  measureSync("App ready");

  // ─── Sync with children: no injected m, nesting is automatic ─────────
  measureSync("Build report", () => {
    const raw = measureSync("Parse CSV", () => "col1,col2\nval1,val2");

    const rows = measureSync("Split rows", () => raw.split("\n"));

    return { rows, count: rows.length };
  });

  // ─── Circular ref: safe stringify still works ───────────────────────
  measureSync("Circular ref", () => {
    const obj: any = { name: "root" };
    obj.self = obj;
    return obj;
  });

  // ─── Parallel async: children share the parent span automatically ────
  await measure("Parallel Fetch", async () => {
    await Promise.all([
      measure(
        {
          start: () => "Fetch User",
          end: (user) => user,
          userId: 1,
        },
        () => fetchUser(1),
      ),

      measure(
        {
          start: () => "Fetch User",
          end: (user) => user,
          userId: 2,
        },
        () => fetchUser(2),
      ),

      measure(
        {
          start: () => "Fetch User",
          end: (user) => user,
          userId: 3,
        },
        () => fetchUser(3),
      ),
    ]);
  });

  // ─── Result mapping: print only the useful part of the result ────────
  await measure(
    {
      start: () => "DB query",
      end: (result) => ({ rows: result.rows }),
      budget: 30,
    },
    async () => {
      await sleep(80);
      return {
        rows: 42,
        internal: {
          connection: "primary",
          debug: "not printed",
        },
      };
    },
  );

  // ─── Retry with backoff ──────────────────────────────────────────────
  await measure.retry(
    {
      start: () => "Flaky API",
      end: (result) => result,
    },
    { attempts: 3, delay: 100, backoff: 2 },
    flakyApi,
  );

  // ─── Default behavior: errors throw, no assert needed ────────────────
  try {
    await measure("Missing user", () => fetchUser(999));
  } catch (error) {
    console.log(
      `Caught expected error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // ─── Wrap: decorator pattern ────────────────────────────────────────
  const getUser = measure.wrap(
    {
      start: () => "Get user",
      end: (user) => ({ id: user.id, name: user.name }),
    },
    fetchUser,
  );

  await getUser(1);
  await getUser(2);

  // ─── Batch: process array with progress ─────────────────────────────
  const userIds = Array.from({ length: 20 }, (_, i) => i + 1);

  await measure.batch(
    {
      start: () => "Fetch all users",
      end: (summary) => summary,
    },
    userIds,
    async (id) => fetchUser(id),
    { every: 5 },
  );

  // ─── Scoped request waterfall ───────────────────────────────────────
  //
  // Important concept:
  // Use the same scoped instance inside the request if you want:
  //
  //   [api:a]   ... GET /users req_abc
  //   [api:a-a] ... SELECT users
  //   [api:a-b] ... Serialize response
  //   [api:a]   ... 31ms → {"status":200}
  //
  // The id is now a step path, not a global unique id.
  // The unique request id lives in the start label.
  const api = createMeasure("api");

  const requestId = "req_" + Math.random().toString(36).slice(2, 8);

  await api.measure(
    {
      start: () => `GET /users ${requestId}`,

      // Print only what we care about from Response.
      end: (res: Response) => ({
        status: res.status,
      }),

      catch: (error) => {
        return new Response(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500 },
        );
      },
    },
    async () => {
      const users = await api.measure(
        {
          start: () => "SELECT users",
          end: (rows) => rows,
        },
        async () => {
          await sleep(30);
          return [{ id: 1 }, { id: 2 }];
        },
      );

      const body = await api.measure(
        {
          start: () => "Serialize response",
          end: (text) => ({ bytes: text.length }),
        },
        () => JSON.stringify(users),
      );

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  );

  // ─── safeStringify utility ──────────────────────────────────────────
  const circular: any = { a: 1 };
  circular.self = circular;

  console.log(`safeStringify: ${safeStringify(circular)}`);

  // ─── Smart duration formatting ─────────────────────────────────────
  await measure("Quick op", async () => {
    await sleep(5);
    return "fast";
  });

  await measure("Slow op", async () => {
    await sleep(1200);
    return "slow";
  });
}

// ─── Bun.serve patterns ──────────────────────────────────────────────
//
// New behavior:
// - measure() returns T
// - measure() throws by default
// - action.catch(error) is the explicit fallback path

async function bunServeExample() {
  console.log("\n─── Bun.serve Patterns ─────────────────────────────");

  const api = createMeasure("api");

  // ✅ Pattern 1: catch — graceful 500 fallback
  const server1 = Bun.serve({
    port: 0,

    fetch: (req) => {
      const url = new URL(req.url);
      const requestId = "req_" + Math.random().toString(36).slice(2, 8);

      return api.measure(
        {
          start: () => `${req.method} ${url.pathname} ${requestId}`,

          end: (res: Response) => ({
            status: res.status,
          }),

          catch: (error) => {
            return new Response(
              `Error: ${error instanceof Error ? error.message : String(error)}`,
              { status: 500 },
            );
          },
        },
        async () => {
          if (url.pathname === "/fail") {
            throw new Error("Route error");
          }

          return new Response(`ok: ${url.pathname}`);
        },
      );
    },
  });

  // ✅ Pattern 2: no catch — errors throw
  const server2 = Bun.serve({
    port: 0,

    fetch: (req) => {
      const url = new URL(req.url);
      const requestId = "req_" + Math.random().toString(36).slice(2, 8);

      return api.measure(
        {
          start: () => `${req.method} ${url.pathname} ${requestId}`,

          end: (res: Response) => ({
            status: res.status,
          }),
        },
        async () => {
          if (url.pathname === "/fail") {
            throw new Error("Route error");
          }

          return new Response(`ok: ${url.pathname}`);
        },
      );
    },
  });

  const r1ok = await fetch(`http://localhost:${server1.port}/hello`);
  console.log(`  catch pattern (ok): ${r1ok.status} ${await r1ok.text()}`);

  const r1fail = await fetch(`http://localhost:${server1.port}/fail`);
  console.log(
    `  catch pattern (fail): ${r1fail.status} ${await r1fail.text()}`,
  );

  const r2ok = await fetch(`http://localhost:${server2.port}/hello`);
  console.log(`  throw pattern (ok): ${r2ok.status} ${await r2ok.text()}`);

  try {
    await fetch(`http://localhost:${server2.port}/fail`);
  } catch {
    console.log("  throw pattern (fail): server rejected (expected)");
  }

  server1.stop();
  server2.stop();
}

main()
  .then(() => console.log("\n✅ Done."))
  .then(() => bunServeExample())
  .then(() => console.log("\n✅ Bun.serve example done."));
