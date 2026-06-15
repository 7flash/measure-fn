import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { configure, createMeasure } from "./index.ts";

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = spyOn(console, "log").mockImplementation((...args: any[]) => {
    logs.push(args.map(String).join(" "));
  });

  const errorSpy = spyOn(console, "error").mockImplementation((...args: any[]) => {
    errors.push(args.map(String).join(" "));
  });

  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

beforeEach(() => {
  configure({
    silent: false,
    logger: null,
    maxResultLength: 200,
  });
});

describe("clean default logger", () => {
  test("prints compact start and success lines", async () => {
    const app = createMeasure("app");
    app.resetCounter();

    const out = captureConsole();

    await app.measure.root("GET /api/state req_1", async () => {
      await app.measure("API: /api/state", async () => ({ status: 200 }));
    });

    out.restore();

    expect(out.logs[0]).toBe("[app:a] → GET /api/state req_1");
    expect(out.logs[1]).toBe("[app:a-a] → API: /api/state");
    expect(out.logs[2]).toMatch(/^\[app:a-a\] ✓ .* → \{"status":200\}$/);
    expect(out.logs[3]).toMatch(/^\[app:a\] ✓ /);
    expect(out.logs.join("\n")).not.toContain("···");
  });

  test("prints compact error lines", async () => {
    const app = createMeasure("app");
    app.resetCounter();

    const out = captureConsole();

    await expect(
      app.measure.root("fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    out.restore();

    expect(out.logs[0]).toBe("[app:a] → fail");
    expect(out.logs[1]).toMatch(/^\[app:a\] ✗ .* \(boom\)$/);
    expect(out.logs[1]).not.toContain("···");
  });

  test("prints compact budget warning", async () => {
    const app = createMeasure("app");
    app.resetCounter();

    const out = captureConsole();

    await app.measure.root(
      {
        start: () => "slow",
        budget: 1,
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 1;
      },
    );

    out.restore();

    expect(out.logs[1]).toContain("⚠ over budget 1.00ms");
    expect(out.logs[1]).not.toContain("OVER BUDGET");
  });
});
