import { createMeasure } from "../index";

/**
 * Production-style measure-fn example.
 *
 * This mirrors the Solard orchestrator shape without depending on bgrun,
 * databases, or Solard internals. Copy this style into app code:
 *
 *   const m = createMeasure("app:process");
 *   await m.root("boot", async () => { ... });
 *   await m("worker:name", async () => { ... });
 *   m.sync("checkpoint", () => ({ ... }));
 */

const m = createMeasure("solard:process");

type WorkerName = "server" | "stream";

type WorkerState = {
  name: WorkerName;
  pid: number | null;
  alive: boolean;
  stale: boolean;
  error?: string | null;
};

const workers: WorkerName[] = ["server", "stream"];

type StartWorkerResult = {
  status: "already_ready" | "ready";
  name: WorkerName;
  pid: number | null;
  alive?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getWorkerState(name: WorkerName): Promise<WorkerState> {
  await sleep(25);

  return {
    name,
    pid: Math.floor(10_000 + Math.random() * 80_000),
    alive: true,
    stale: false,
    error: null,
  };
}

async function startWorker(name: WorkerName): Promise<StartWorkerResult> {
  return await m(`worker:${name}`, async () => {
    const before = await getWorkerState(name);

    if (before.alive && !before.stale) {
      return {
        status: "already_ready",
        name,
        pid: before.pid,
      };
    }

    await m("start", async () => {
      await sleep(100);
      return { name, action: "spawned" };
    });

    const after = await getWorkerState(name);

    return {
      status: "ready",
      name,
      pid: after.pid,
      alive: after.alive,
    };
  });
}

async function startAllWorkers(): Promise<void> {
  await m("start_all_workers", async () => {
    const started: WorkerName[] = [];

    for (const name of workers) {
      await startWorker(name);
      started.push(name);
    }

    return {
      count: started.length,
      workers: started,
    };
  });
}

async function healthCheckTick(): Promise<void> {
  await m.root("health_check_tick", async () => {
    const status = await Promise.all(
      workers.map(async (name) => {
        return await m(`check:${name}`, async () => {
          const state = await getWorkerState(name);

          if (!state.alive || state.stale || state.error) {
            m.sync(`alert:${name}`, () => ({
              alive: state.alive,
              stale: state.stale,
              error: state.error ?? null,
            }));
          }

          return state;
        });
      }),
    );

    return {
      targetCount: workers.length,
      activeCount: status.filter((worker) => worker.alive && !worker.stale)
        .length,
      status,
    };
  });
}

async function main(): Promise<void> {
  m.sync("runtime", () => ({
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV ?? "development",
  }));

  await m.root(
    {
      start: () => "boot",
      end: () => "orchestrator running",
      budget: 5_000,
    },
    async () => {
      await startAllWorkers();

      for (let i = 0; i < 2; i++) {
        await healthCheckTick();
        await sleep(250);
      }
    },
  );
}

try {
  await main();
} catch (error) {
  m.sync("fatal", () => error);
  process.exitCode = 1;
} finally {
  m.sync("complete", () => ({ exitCode: process.exitCode ?? 0 }));
}
