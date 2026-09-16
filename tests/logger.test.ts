import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { configure, createMeasure, measureSync } from "../index.ts";

const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;

afterEach(() => {
  configure({
    silent: false,
    logger: null,
    colors: "auto",
    timestamps: false,
    errorDetails: false,
    summarize: false,
    onLoggerError: null,
  });

  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;

  if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = originalForceColor;
});

describe("logger middleware", () => {
  test("next() preserves the built-in logger", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const seen: string[] = [];

    configure({
      colors: false,
      logger(event, next) {
        seen.push(event.type);
        next();
      },
    });

    measureSync("work", () => 42);

    expect(seen).toEqual(["start", "success"]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]?.[0])).toContain("→ work");
    expect(String(log.mock.calls[1]?.[0])).toContain("✓");

    log.mockRestore();
  });

  test("next() is idempotent per event", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({
      colors: false,
      logger(_event, next) {
        next();
        next();
      },
    });

    measureSync("work", () => 42);

    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  test("omitting next() fully replaces built-in output", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const seen: string[] = [];

    configure({
      logger(event) {
        seen.push(event.type);
      },
    });

    measureSync("work", () => 42);

    expect(seen).toEqual(["start", "success"]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test("conditional delegation can suppress selected event types", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({
      colors: false,
      logger(event, next) {
        if (event.type !== "start") next();
      },
    });

    measureSync("work", () => 42);

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("✓");
    log.mockRestore();
  });
});

describe("normalized logger data", () => {
  test("data aliases the event-specific payload", () => {
    const events: any[] = [];

    configure({
      logger(event) {
        events.push(event);
      },
    });

    measureSync(
      { start: () => ({ phase: "start" }), end: (result) => result },
      () => ({ status: "ok" }),
    );
    measureSync.note({ start: () => ({ note: true }) });

    try {
      measureSync("explode", () => {
        throw new Error("boom");
      });
    } catch {}

    const start = events.find(
      (event) => event.type === "start" && event.label.includes("phase"),
    );
    const success = events.find((event) => event.type === "success");
    const annotation = events.find((event) => event.type === "annotation");
    const error = events.find((event) => event.type === "error");

    expect(start.data).toBe(start.value);
    expect(success.data).toBe(success.result);
    expect(annotation.data).toBe(annotation.value);
    expect(error.data).toBe(error.error);
  });

  test("label and data can filter default logging without event-specific payload access", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({
      colors: false,
      logger(event, next) {
        if (event.label === "ignore-me") return;

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

    measureSync("ignore-me", () => 1);
    measureSync("keep-start", () => ({ status: "ignored" }));

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("→ keep-start");

    log.mockRestore();
  });
});

describe("colors", () => {
  const ansi = /\x1b\[[0-9;]+m/g;
  const stripAnsi = (value: string) => value.replace(ansi, "");
  const leadingColor = (value: string) => value.match(/^\x1b\[(\d+)m/)?.[1];

  test("colors only the scoped prefix", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const scoped = createMeasure("api");

    configure({ colors: true, logger: null });
    scoped.sync("colored", () => 1);

    const start = String(log.mock.calls[0]?.[0]);
    const success = String(log.mock.calls[1]?.[0]);

    expect(start.match(ansi)).toHaveLength(2);
    expect(success.match(ansi)).toHaveLength(2);
    expect(stripAnsi(start)).toBe("[api] a → colored");
    expect(stripAnsi(success)).toMatch(/^\[api\] a ✓ /);
    log.mockRestore();
  });

  test("unscoped output stays plain even when colors are enabled", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({ colors: true, logger: null });
    measureSync("plain", () => 1);

    expect(String(log.mock.calls[0]?.[0])).not.toContain("\x1b[");
    expect(String(log.mock.calls[1]?.[0])).not.toContain("\x1b[");
    log.mockRestore();
  });

  test("colors: false emits plain text", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const scoped = createMeasure("api");

    configure({ colors: false, logger: null });
    scoped.sync("plain", () => 1);

    expect(String(log.mock.calls[0]?.[0])).not.toContain("\x1b[");
    expect(String(log.mock.calls[1]?.[0])).not.toContain("\x1b[");
    expect(String(log.mock.calls[0]?.[0])).toBe("[api] a → plain");
    log.mockRestore();
  });

  test("the same scope keeps the same color", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const scoped = createMeasure("stable-scope");

    configure({ colors: true, logger: null });
    scoped.sync("first", () => 1);
    scoped.sync("second", () => 2);

    const first = String(log.mock.calls[0]?.[0]);
    const second = String(log.mock.calls[2]?.[0]);

    expect(leadingColor(first)).toBeDefined();
    const secondColor = leadingColor(second);
    expect(secondColor).toBeDefined();
    expect(leadingColor(first)).toBe(secondColor!);
    log.mockRestore();
  });

  test("different scopes receive different colors while colors remain available", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const api = createMeasure("scope-one");
    const db = createMeasure("scope-two");

    configure({ colors: true, logger: null });
    api.sync("first", () => 1);
    db.sync("second", () => 2);

    const first = String(log.mock.calls[0]?.[0]);
    const second = String(log.mock.calls[2]?.[0]);

    expect(leadingColor(first)).toBeDefined();
    expect(leadingColor(second)).toBeDefined();
    expect(leadingColor(first)).not.toBe(leadingColor(second));
    log.mockRestore();
  });

  test("NO_COLOR disables colors in auto mode", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const scoped = createMeasure("api");

    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    configure({ colors: "auto", logger: null });
    scoped.sync("plain", () => 1);

    expect(String(log.mock.calls[0]?.[0])).not.toContain("\x1b[");
    log.mockRestore();
  });
});
describe("errors", () => {
  test("built-in logger keeps failures on one line by default", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});

    configure({ colors: false, logger: null });

    expect(() =>
      measureSync("explode", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[1]?.[0])).toContain("✗");
    expect(String(log.mock.calls[1]?.[0])).toContain("boom");
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
  });

  test("errorDetails opts into the second diagnostic line", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});

    configure({ colors: false, logger: null, errorDetails: true });

    expect(() =>
      measureSync("explode", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("Error: boom");

    log.mockRestore();
    error.mockRestore();
  });
});

describe("timestamps", () => {
  test("timestamps: true uses compact local time", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({ colors: false, logger: null, timestamps: true });
    measureSync("work", () => 1);

    expect(String(log.mock.calls[0]?.[0])).toMatch(
      /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[a\] → work$/,
    );
    log.mockRestore();
  });

  test('timestamps: "iso" keeps absolute UTC time available', () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({ colors: false, logger: null, timestamps: "iso" });
    measureSync("work", () => 1);

    expect(String(log.mock.calls[0]?.[0])).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T.*Z\] \[a\] → work$/,
    );
    log.mockRestore();
  });
});