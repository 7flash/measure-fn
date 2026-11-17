import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import {
  configure,
  createMeasure,
  safeStringify,
  formatDuration,
  type MeasureLogEvent,
} from "./index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = spyOn(console, "log").mockImplementation((...args: any[]) => {
    logs.push(args.map(String).join(" "));
  });

  const errorSpy = spyOn(console, "error").mockImplementation(
    (...args: any[]) => {
      errors.push(args.map(String).join(" "));
    },
  );

  return {
    logs,
    errors,
    restore() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

let app: ReturnType<typeof createMeasure>;

beforeEach(() => {
  configure({
    silent: false,
    logger: null,
    maxResultLength: 200,
    colors: false,
    timestamps: false,
    summarize: false,
  });

  app = createMeasure("app");
  app.resetCounter();
});

describe("formatDuration", () => {
  test("formats milliseconds, seconds, and minutes", () => {
    expect(formatDuration(0.5)).toBe("0.50ms");
    expect(formatDuration(123.45)).toBe("123.45ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
  });
});

describe("safeStringify", () => {
  test("handles primitives", () => {
    expect(safeStringify(undefined)).toBe("");
    expect(safeStringify(null)).toBe("null");
    expect(safeStringify(true)).toBe("true");
    expect(safeStringify(42)).toBe("42");
    expect(safeStringify("hi")).toBe('"hi"');
    expect(safeStringify(10n)).toBe("10n");
  });

  test("handles circular objects", () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    expect(safeStringify(circular)).toContain("[Circular]");
  });

  test("truncates long output", () => {
    expect(safeStringify({ data: "x".repeat(100) }, 20)).toContain("…");
    expect(safeStringify({ data: "x".repeat(100) }, 0)).not.toContain("…");
  });
});

describe("measure", () => {
  test("runs and returns result", async () => {
    const out = captureConsole();
    const result = await app.measure("Fetch", async () => "ok");
    out.restore();

    expect(result).toBe("ok");
    expect(out.logs[0]).toBe("[app] a → Fetch");
    expect(out.logs[1]).toMatch(/\[app\] a ✓ .* → "ok"/);
  });

  test("annotation without fn", async () => {
    const out = captureConsole();
    await app.measure("Ready");
    out.restore();

    expect(out.logs).toEqual(["[app] a = Ready"]);
  });

  test("throws by default on error", async () => {
    const out = captureConsole();
    const original = new Error("boom");

    await expect(
      app.measure("Fail", async () => {
        throw original;
      }),
    ).rejects.toBe(original);

    out.restore();
    expect(out.logs[1]).toContain("✗");
    expect(out.logs[1]).toContain("boom");
  });

  test("catch recovers explicitly", async () => {
    const out = captureConsole();

    const result = await app.measure(
      {
        start: () => "Fetch user",
        catch: () => ({ id: 0, name: "Guest" }),
      },
      async () => {
        throw new Error("not found");
      },
    );

    out.restore();
    expect(result).toEqual({ id: 0, name: "Guest" });
    expect(out.logs[1]).toContain("✗");
  });

  test("end maps printed result only", async () => {
    const out = captureConsole();

    const result = await app.measure(
      {
        start: () => "HTTP",
        end: (res: Response) => ({ status: res.status }),
      },
      async () => new Response("ok", { status: 201 }),
    );

    out.restore();
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(201);
    expect(out.logs[1]).toContain('→ {"status":201}');
  });

  test("automatic async nesting with same scoped instance", async () => {
    const out = captureConsole();

    await app.measure("Parent", async () => {
      await app.measure("Child A", async () => 1);
      await app.measure("Child B", async () => 2);
    });

    out.restore();
    expect(out.logs[0]).toBe("[app] a → Parent");
    expect(out.logs[1]).toBe("[app] a-a → Child A");
    expect(out.logs[3]).toBe("[app] a-b → Child B");
  });

  test("parallel children share parent span", async () => {
    const out = captureConsole();

    await app.measure("Parallel", async () => {
      await Promise.all([
        app.measure("A", async () => {
          await sleep(5);
          return 1;
        }),
        app.measure("B", async () => 2),
        app.measure("C", async () => 3),
      ]);
    });

    out.restore();
    expect(out.logs).toContain("[app] a-a → A");
    expect(out.logs).toContain("[app] a-b → B");
    expect(out.logs).toContain("[app] a-c → C");
  });
});

describe("measureSync", () => {
  test("runs and returns result", () => {
    const out = captureConsole();
    const result = app.measureSync("Compute", () => 42);
    out.restore();

    expect(result).toBe(42);
    expect(out.logs[0]).toBe("[app] a → Compute");
    expect(out.logs[1]).toContain("→ 42");
  });

  test("throws by default", () => {
    const out = captureConsole();

    expect(() => {
      app.measureSync("Fail", () => {
        throw new Error("x");
      });
    }).toThrow("x");

    out.restore();
    expect(out.logs[1]).toContain("✗");
  });

  test("sync catch recovers", () => {
    const out = captureConsole();

    const result = app.measureSync(
      {
        start: () => "Parse",
        catch: () => 123,
      },
      () => {
        throw new Error("bad");
      },
    );

    out.restore();
    expect(result).toBe(123);
  });

  test("sync catch must be sync", () => {
    const out = captureConsole();

    expect(() => {
      app.measureSync(
        {
          start: () => "Parse",
          catch: () => Promise.resolve(1) as any,
        },
        () => {
          throw new Error("bad");
        },
      );
    }).toThrow("measureSync catch() must return synchronously");

    out.restore();
  });

  test("automatic sync nesting", () => {
    const out = captureConsole();

    app.measureSync("Parent", () => {
      app.measureSync("Child A", () => 1);
      app.measureSync("Child B", () => 2);
    });

    out.restore();
    expect(out.logs[1]).toBe("[app] a-a → Child A");
    expect(out.logs[3]).toBe("[app] a-b → Child B");
  });
});

describe("scopes", () => {
  test("separate scopes have separate counters", async () => {
    const a = createMeasure("a");
    const b = createMeasure("b");
    a.resetCounter();
    b.resetCounter();

    const out = captureConsole();
    await a.measure("one", async () => 1);
    await b.measure("two", async () => 2);
    await a.measure("three", async () => 3);
    out.restore();

    expect(out.logs[0]).toBe("[a] a → one");
    expect(out.logs[2]).toBe("[b] a → two");
    expect(out.logs[4]).toBe("[a] b → three");
  });
});

describe("timeouts and budgets", () => {
  test("timeout throws unless caught", async () => {
    const out = captureConsole();

    await expect(
      app.measure(
        {
          start: () => "Slow",
          timeout: 10,
        },
        async () => {
          await sleep(50);
          return "done";
        },
      ),
    ).rejects.toThrow("Timeout");

    out.restore();
    expect(out.logs[1]).toContain("Timeout");
  });

  test("timeout can be recovered", async () => {
    const out = captureConsole();

    const result = await app.measure(
      {
        start: () => "Slow",
        timeout: 10,
        catch: () => "fallback",
      },
      async () => {
        await sleep(50);
        return "done";
      },
    );

    out.restore();
    expect(result).toBe("fallback");
  });

  test("budget warning prints", async () => {
    const out = captureConsole();

    await app.measure(
      {
        start: () => "Slow",
        budget: 1,
      },
      async () => {
        await sleep(5);
        return 1;
      },
    );

    out.restore();
    expect(out.logs[1]).toContain("⚠ over budget");
  });
});

describe("helpers", () => {
  test("wrap measures async function calls", async () => {
    const wrapped = app.measure.wrap("Double", async (n: number) => n * 2);
    const out = captureConsole();
    const result = await wrapped(21);
    out.restore();

    expect(result).toBe(42);
    expect(out.logs[0]).toBe("[app] a → Double");
  });

  test("retry retries then succeeds", async () => {
    let count = 0;
    const out = captureConsole();

    const result = await app.measure.retry(
      "Flaky",
      { attempts: 3, delay: 1 },
      async () => {
        if (++count < 3) throw new Error("fail");
        return "ok";
      },
    );

    out.restore();
    expect(result).toBe("ok");
    expect(out.logs.filter((line) => line.includes("✗")).length).toBe(2);
  });

  test("retry stops when retryIf returns false", async () => {
    let count = 0;
    const seen: [string, number][] = [];
    const out = captureConsole();

    const failure = app.measure.retry(
      "Write",
      {
        attempts: 5,
        delay: 1,
        retryIf: (error, attempt) => {
          seen.push([(error as Error).message, attempt]);
          return (error as Error).message === "busy";
        },
      },
      async () => {
        count++;
        throw new Error(count === 1 ? "busy" : "conflict");
      },
    );

    await expect(failure).rejects.toThrow("conflict");
    out.restore();
    expect(count).toBe(2);
    expect(seen).toEqual([["busy", 1], ["conflict", 2]]);
  });

  test("retry does not ask retryIf after the last attempt", async () => {
    let asked = 0;
    const out = captureConsole();
    const failure = app.measure.retry(
      "Read",
      { attempts: 2, delay: 1, retryIf: () => (++asked, true) },
      async () => {
        throw new Error("down");
      },
    );
    await expect(failure).rejects.toThrow("down");
    out.restore();
    expect(asked).toBe(1);
  });

  test("batch continues after item errors", async () => {
    const out = captureConsole();

    const results = await app.measure.batch("Process", [1, 2, 3], async (n) => {
      if (n === 2) throw new Error("bad");
      return n;
    });

    out.restore();
    expect(results).toEqual([1, null, 3]);
    expect(out.logs.at(-1)).toContain("2/3 ok");
  });

  test("timed returns result and duration", async () => {
    const out = captureConsole();
    const { result, duration } = await app.measure.timed(
      "Timed",
      async () => 42,
    );
    out.restore();

    expect(result).toBe(42);
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

describe("custom logger", () => {
  test("receives structured events", async () => {
    const events: MeasureLogEvent[] = [];
    configure({ logger: (event) => events.push(event) });

    await app.measure("Op", async () => 42);

    expect(events[0]).toMatchObject({
      type: "start",
      id: "app:a",
      label: "Op",
    });
    expect(events[1]).toMatchObject({
      type: "success",
      id: "app:a",
      result: 42,
    });
  });

  test("silent suppresses logger", async () => {
    const events: MeasureLogEvent[] = [];
    configure({ silent: true, logger: (event) => events.push(event) });

    await app.measure("Op", async () => 42);

    expect(events).toEqual([]);
  });
});

import { test as regressionTest, expect as regressionExpect } from "bun:test";
import {
  configure as regressionConfigure,
  logger as regressionLogger,
  options as regressionOptions,
  silent as regressionSilent,
} from "./config.js";
import { measure as regressionMeasure, measureSync as regressionSync } from "./index.js";
async function withRegressionEvents(
  check: (events: MeasureLogEvent[]) => void | Promise<void>,
) {
  const previous = {
    logger: regressionLogger,
    silent: regressionSilent,
    level: regressionOptions.level,
    colors: regressionOptions.colors,
    timestamps: regressionOptions.timestamps,
    errorDetails: regressionOptions.errorDetails,
  };
  const events: MeasureLogEvent[] = [];
  regressionConfigure({
    logger: (event) => { events.push(event); },
    silent: false, level: "info", colors: false, timestamps: false,
    errorDetails: false,
  });
  try {
    await check(events);
  } finally {
    regressionConfigure(previous);
  }
}

regressionTest("wrap keeps a generator lazy and measures its final value", async () => {
  await withRegressionEvents((events) => {
    const wrapped = regressionMeasure.wrap(
      { start: () => "generator-consume", end: (result: string) => result },
      function* (this: { base: number }, extra: number): Generator<number, string, void> {
        regressionSync("generator-child", () => true);
        yield this.base + extra;
        yield extra;
        return "finished";
      },
    );
    const iterator: Generator<number, string, void> = wrapped.call({ base: 2 }, 3);
    regressionExpect(events).toHaveLength(0);
    regressionExpect(iterator[Symbol.iterator]()).toBe(iterator);
    regressionExpect(iterator.next()).toEqual({ value: 5, done: false });
    const parent = events.find((e) => e.type === "start" && e.label === "generator-consume");
    const child = events.find((e) => e.type === "start" && e.label === "generator-child");
    regressionExpect(child?.parentId).toBe(parent!.id);
    regressionExpect(events.filter((e) => e.type === "success" && e.label === "generator-consume")).toHaveLength(0);
    regressionExpect(iterator.next()).toEqual({ value: 3, done: false });
    regressionExpect(iterator.next()).toEqual({ value: "finished", done: true });
    regressionExpect(events.find((e) => e.type === "success" && e.label === "generator-consume"))
      .toMatchObject({ result: "finished" });
  });
});

regressionTest("wrap completes only when a generator's return/finally finishes", async () => {
  await withRegressionEvents((events) => {
    const wrapped = regressionMeasure.wrap("generator-return", function* (): Generator<number, string, void> {
      try { yield 1; } finally { yield 2; }
      return "normal";
    });
    const unstarted = wrapped();
    regressionExpect(unstarted.return("unstarted")).toEqual({ value: "unstarted", done: true });
    regressionExpect(unstarted.next() as unknown).toEqual({ value: undefined, done: true });
    regressionExpect(events).toHaveLength(0);
    const iterator = wrapped();
    regressionExpect(iterator.next()).toEqual({ value: 1, done: false });
    regressionExpect(iterator.return("stopped")).toEqual({ value: 2, done: false });
    regressionExpect(events.filter((e) => e.type === "success")).toHaveLength(0);
    regressionExpect(iterator.next()).toEqual({ value: "stopped", done: true });
    regressionExpect(events.filter((e) => e.type === "success"))
      .toHaveLength(1);
  });
});

regressionTest("wrap preserves async-generator errors and return semantics", async () => {
  await withRegressionEvents(async (events) => {
    const failure = new Error("iteration failed");
    const wrapped = regressionMeasure.wrap(
      { start: () => "async-generator", error: () => "mapped failure" },
      async function* (value: number): AsyncGenerator<number, string, void> {
        yield value;
        await Promise.resolve();
        throw failure;
      },
    );
    const iterator: AsyncGenerator<number, string, void> = wrapped(7);
    regressionExpect(events).toHaveLength(0);
    regressionExpect(iterator[Symbol.asyncIterator]()).toBe(iterator);
    regressionExpect(await iterator.next()).toEqual({ value: 7, done: false });
    await regressionExpect(iterator.next()).rejects.toBe(failure);
    regressionExpect(events.find((e) => e.type === "error" && e.label === "async-generator"))
      .toMatchObject({ error: "mapped failure" });
    const early = wrapped(8);
    regressionExpect(await early.next()).toEqual({ value: 8, done: false });
    regressionExpect(await early.return("stopped")).toEqual({ value: "stopped", done: true });
    regressionExpect(events.filter((e) => e.type === "success" && e.label === "async-generator"))
      .toHaveLength(1);
  });
});

regressionTest("wrap logs a thrown iterator error without replacing it", async () => {
  await withRegressionEvents((events) => {
    const failure = new Error("injected");
    const iterator = regressionMeasure.wrap("generator-throw", function* () {
      yield 1;
      yield 2;
    })();
    iterator.next();
    let thrown: unknown;
    try { iterator.throw(failure); } catch (error) { thrown = error; }
    regressionExpect(thrown).toBe(failure);
    regressionExpect(events.find((e) => e.type === "error" && e.label === "generator-throw"))
      .toMatchObject({ error: failure });
  });
});

regressionTest("non-Promise thenables are detected without executing then()", async () => {
  await withRegressionEvents(async (events) => {
    let calls = 0;
    const fake = { then() { calls++; } };
    regressionExpect(() => regressionSync("sync-thenable", () => fake as unknown as number))
      .toThrow("measureSync callback must return synchronously");
    regressionExpect(regressionSync({ start: () => "end-thenable", end: () => fake }, () => 42))
      .toBe(42);
    const failure = new Error("original");
    let thrown: unknown;
    try {
      regressionSync({ start: () => "error-thenable", error: () => fake }, () => { throw failure; });
    } catch (error) { thrown = error; }
    regressionExpect(thrown).toBe(failure);
    const native = Promise.resolve(1);
    Object.defineProperty(native, "then", { value: () => { calls++; } });
    regressionExpect(() => regressionSync("native-promise", () => native as unknown as number))
      .toThrow("measureSync callback must return synchronously");
    await new Promise((resolve) => setTimeout(resolve, 0));
    regressionExpect(calls).toBe(0);
    regressionExpect(events.find((e) => e.type === "success" && e.label === "end-thenable"))
      .toMatchObject({ result: { resultMapperError: "end() must return synchronously" } });
    regressionExpect(events.find((e) => e.type === "error" && e.label === "error-thenable"))
      .toMatchObject({ error: { errorMapperError: "error() must return synchronously" } });
  });
});

regressionTest("error message, details and cause respect maxValueLength", async () => {
  await withRegressionEvents((events) => {
    const logs: string[] = [];
    const details: string[] = [];
    const log = console.log;
    const error = console.error;
    regressionConfigure({
      logger: (event, next) => { events.push(event); next(); },
      errorDetails: true, colors: false, timestamps: false,
    });
    console.log = (...args) => { logs.push(args.join(" ")); };
    console.error = (...args) => { details.push(args.join(" ")); };
    try {
      const failure = Object.assign(new Error("abcdefghijklmnopqrstuvwxyz"), {
        cause: "cause-abcdefghijklmnopqrstuvwxyz",
      });
      let thrown: unknown;
      try {
        regressionSync({ start: () => "capped-error", maxValueLength: 10 }, () => { throw failure; });
      } catch (caught) { thrown = caught; }
      regressionExpect(thrown).toBe(failure);
      const line = logs.find((entry) => entry.includes(" ✗ "));
      regressionExpect(line).toContain("(abcdefghi…)");
      regressionExpect(line).not.toContain("abcdefghijklmnopqrstuvwxyz");
      regressionExpect(details).toHaveLength(2);
      for (const detail of details) {
        const match = detail.match(/^\[[^\]]+\] (?:Cause: )?(.*)$/);
        regressionExpect(match).not.toBeNull();
        regressionExpect(match![1]!.length).toBeLessThanOrEqual(10);
      }
    } finally {
      console.log = log;
      console.error = error;
    }
  });
});
describe("compactIds", () => {
  test("keeps path IDs by default", () => {
    const events: MeasureLogEvent[] = [];
    configure({ compactIds: false, logger: (event) => events.push(event) });
    const legacy = createMeasure("legacy");
    legacy.sync("outer", () => legacy.sync("inner", () => 1));
    expect(events.filter((event) => event.type === "start").map((event) => event.id))
      .toEqual(["legacy:a", "legacy:a-a"]);
  });

  test("bounds deep IDs and preserves exact event and parent correlation", () => {
    const events: MeasureLogEvent[] = [];
    configure({ compactIds: false, logger: (event) => events.push(event) });
    const compact = createMeasure("deep", { compactIds: true });
    const descend = (depth: number): void => {
      if (depth === 80) return;
      compact.sync(`level ${depth}`, () => descend(depth + 1));
    };
    descend(0);

    const starts = events.filter((event) => event.type === "start");
    expect(starts).toHaveLength(80);
    expect(new Set(starts.map((event) => event.id)).size).toBe(80);
    starts.forEach((event, index) => {
      expect(event.rawId).toMatch(/^#[a-z]+$/);
      expect(event.rawId.length).toBeLessThan(8);
      expect(event.depth).toBe(index);
      expect(event.parentId ?? null).toBe(index ? starts[index - 1]!.id : null);
      expect(event.traceId).toBe(starts[0]!.traceId);
      expect(events.filter((other) => other.type === "success" && other.id === event.id))
        .toHaveLength(1);
    });
  });

  test("shares a per-trace sequence across scopes, overrides, and parallel calls", async () => {
    const events: MeasureLogEvent[] = [];
    const scoped = createMeasure("scoped", { compactIds: true });
    const inherited = createMeasure("global");
    const legacy = createMeasure("old", { compactIds: false });
    configure({ compactIds: true, logger: (event) => events.push(event) });
    try {
      await scoped.root("root", async () => {
        await Promise.all([
          inherited("async child", async () => {
            legacy.sync("legacy child", () => scoped.sync.note("mark"));
          }),
          scoped("peer", async () => 2),
        ]);
      });
      scoped.sync.root("new root", () => 3);

      const starts = events.filter((event) => event.type === "start");
      const [root, child, old, peer, second] = starts;
      const mark = events.find((event) => event.type === "annotation" && event.label === "mark")!;
      expect(starts.map((event) => event.rawId))
        .toEqual(["#a", "#b", "#b-a", "#d", "#a"]);
      expect(mark.rawId).toBe("#c");
      expect(child!.parentId).toBe(root!.id);
      expect(old!.parentId).toBe(child!.id);
      expect(mark.parentId).toBe(old!.id);
      expect(peer!.parentId).toBe(root!.id);
      for (const event of [child!, old!, peer!, mark]) {
        expect(event.traceId).toBe(root!.traceId);
      }
      expect(second!.parentId).toBeUndefined();
      expect(second!.traceId).not.toBe(root!.traceId);
    } finally {
      configure({ compactIds: false, logger: null });
    }
  });

  test("retains the trace through bound contexts, retries, and generators", async () => {
    const events: MeasureLogEvent[] = [];
    configure({ compactIds: false, logger: (event) => events.push(event) });
    const compact = createMeasure("helpers", { compactIds: true });
    let bound: ReturnType<typeof compact.bindContext> | undefined;
    let attempts = 0;
    await compact("outer", async () => {
      bound = compact.bindContext();
      await compact.retry("attempt", { attempts: 2, delay: 0 }, async () => {
        if (++attempts === 1) throw new Error("retry");
        return 42;
      });
      const iterate = compact.wrap("generator", function* () {
        compact.sync.note("inside generator");
        yield 1;
        return 2;
      });
      const iterator = iterate();
      expect(iterator.next()).toEqual({ value: 1, done: false });
      expect(iterator.next()).toEqual({ value: 2, done: true });
    });
    await bound!("after completion", async () => 7);

    const starts = events.filter((event) => event.type === "start");
    const outer = starts.find((event) => event.label === "outer")!;
    const attemptsStarted = starts.filter((event) => event.label.startsWith("attempt"));
    const generator = starts.find((event) => event.label === "generator")!;
    const later = starts.find((event) => event.label === "after completion")!;
    const note = events.find((event) => event.type === "annotation")!;
    expect(attemptsStarted).toHaveLength(2);
    for (const event of [...attemptsStarted, generator, later]) {
      expect(event.parentId).toBe(outer.id);
      expect(event.traceId).toBe(outer.traceId);
    }
    expect(note.parentId).toBe(generator.id);
    expect(events.find((event) => event.type === "error" && event.id === attemptsStarted[0]!.id)?.traceId)
      .toBe(outer.traceId);
    expect(new Set(events.map((event) => event.id)).size).toBe(6);
    expect(Math.max(...events.map((event) => event.rawId.length))).toBeLessThan(8);
  });

  test("rejects non-boolean global and scope options", () => {
    expect(() => configure({ compactIds: "yes" as unknown as boolean }))
      .toThrow("compactIds must be a boolean");
    expect(() => createMeasure("bad", { compactIds: 1 as unknown as boolean }))
      .toThrow("compactIds must be a boolean");
  });
});

test("formatDuration rounds across unit boundaries and adds hours", () => {
  expect(formatDuration(999.996)).toBe("1.0s");
  expect(formatDuration(999.99)).toBe("999.99ms");
  expect(formatDuration(59_960)).toBe("1m 0s");
  expect(formatDuration(59_940)).toBe("59.9s");
  expect(formatDuration(3_600_000)).toBe("1h 0m");
  expect(formatDuration(7_530_000)).toBe("2h 6m");
  expect(() => formatDuration(-0.01)).toThrow(RangeError);
});

test("retry stops waiting and attempting when its signal aborts", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const out = captureConsole();
  const started = Date.now();
  const failure = app.measure.retry(
    "Slow retry",
    { attempts: 5, delay: 10_000, signal: controller.signal },
    async () => {
      attempts++;
      throw new Error("down");
    },
  );
  setTimeout(() => controller.abort(new Error("shutting down")), 20);
  await expect(failure).rejects.toThrow("shutting down");
  out.restore();
  expect(attempts).toBe(1);
  expect(Date.now() - started).toBeLessThan(2000);
});

test("retry with an already aborted signal does not run", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let ran = false;
  await expect(
    app.measure.retry("Never", { signal: controller.signal }, async () => {
      ran = true;
    }),
  ).rejects.toThrow("cancelled");
  expect(ran).toBe(false);
});
