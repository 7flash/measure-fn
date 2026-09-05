import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { configure, createMeasure, measureSync } from "../index.ts";

const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;

afterEach(() => {
  configure({
    silent: false,
    logger: null,
    colors: "auto",
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

    // First measurement is fully suppressed by label. The second start is kept,
    // while its success event is suppressed by normalized data.
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("→ keep-start");

    log.mockRestore();
  });
});

describe("colors", () => {
  test("colors: true emits ANSI escapes", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({ colors: true, logger: null });
    measureSync("colored", () => 1);

    expect(String(log.mock.calls[0]?.[0])).toContain("\x1b[");
    expect(String(log.mock.calls[1]?.[0])).toContain("\x1b[");
    log.mockRestore();
  });

  test("colors: false emits plain text", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    configure({ colors: false, logger: null });
    measureSync("plain", () => 1);

    expect(String(log.mock.calls[0]?.[0])).not.toContain("\x1b[");
    expect(String(log.mock.calls[1]?.[0])).not.toContain("\x1b[");
    log.mockRestore();
  });

  test("the same scope keeps the same ID color", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const scoped = createMeasure("api");

    configure({ colors: true, logger: null });
    scoped.sync("first", () => 1);
    scoped.sync("second", () => 2);

    const first = String(log.mock.calls[0]?.[0]);
    const second = String(log.mock.calls[2]?.[0]);
    const colorPrefix = (value: string) => value.match(/^\x1b\[\d+m/)?.[0];

    expect(colorPrefix(first)).toBeDefined();
    expect(colorPrefix(first)).toBe(colorPrefix(second));
    log.mockRestore();
  });

  test("NO_COLOR disables colors in auto mode", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    configure({ colors: "auto", logger: null });
    measureSync("plain", () => 1);

    expect(String(log.mock.calls[0]?.[0])).not.toContain("\x1b[");
    log.mockRestore();
  });
});

describe("errors", () => {
  test("built-in logger keeps compact and detailed error output", () => {
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
    expect(error).toHaveBeenCalledTimes(1);

    log.mockRestore();
    error.mockRestore();
  });
});
