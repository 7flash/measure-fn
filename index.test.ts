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
    expect(out.logs[0]).toBe("[app:a] → Fetch");
    expect(out.logs[1]).toMatch(/\[app:a\] ✓ .* → "ok"/);
  });

  test("annotation without fn", async () => {
    const out = captureConsole();
    await app.measure("Ready");
    out.restore();

    expect(out.logs).toEqual(["[app:a] = Ready"]);
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
    expect(out.logs[0]).toBe("[app:a] → Parent");
    expect(out.logs[1]).toBe("[app:a-a] → Child A");
    expect(out.logs[3]).toBe("[app:a-b] → Child B");
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
    expect(out.logs).toContain("[app:a-a] → A");
    expect(out.logs).toContain("[app:a-b] → B");
    expect(out.logs).toContain("[app:a-c] → C");
  });
});

describe("measureSync", () => {
  test("runs and returns result", () => {
    const out = captureConsole();
    const result = app.measureSync("Compute", () => 42);
    out.restore();

    expect(result).toBe(42);
    expect(out.logs[0]).toBe("[app:a] → Compute");
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
    expect(out.logs[1]).toBe("[app:a-a] → Child A");
    expect(out.logs[3]).toBe("[app:a-b] → Child B");
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

    expect(out.logs[0]).toBe("[a:a] → one");
    expect(out.logs[2]).toBe("[b:a] → two");
    expect(out.logs[4]).toBe("[a:b] → three");
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
    expect(out.logs[0]).toBe("[app:a] → Double");
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
