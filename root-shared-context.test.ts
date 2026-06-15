import { describe, test, expect, beforeEach } from "bun:test";
import {
  configure,
  createMeasure,
  type MeasureLogEvent,
} from "./index.ts";

let events: MeasureLogEvent[];

beforeEach(() => {
  events = [];
  configure({
    silent: false,
    logger: (event) => events.push(event),
    maxResultLength: 200,
  });
});

describe("shared cross-scope trace context", () => {
  test("child scope inherits active parent path", async () => {
    const http = createMeasure("http");
    const engine = createMeasure("engine");

    http.resetCounter();
    engine.resetCounter();

    await http.measure.root("GET /api/state req_1", async () => {
      await http.measure("API: /api/state", async () => {
        await engine.measure("snapshot player=1", async () => ({ ok: true }));
      });
    });

    const starts = events.filter((event) => event.type === "start");

    expect(starts.map((event) => event.id)).toEqual([
      "http:a",
      "http:a-a",
      "engine:a-a-a",
    ]);
  });

  test("separate root calls stay separate even inside an active span", async () => {
    const client = createMeasure("client");
    client.resetCounter();

    await client.measure.root("poll A", async () => {
      await client.measure("GET A", async () => ({ ok: true }));

      await client.measure.root("poll B", async () => {
        await client.measure("GET B", async () => ({ ok: true }));
      });

      await client.measure("apply A", async () => ({ ok: true }));
    });

    const starts = events.filter((event) => event.type === "start");

    expect(starts.map((event) => event.id)).toEqual([
      "client:a",
      "client:a-a",
      "client:b",
      "client:b-a",
      "client:a-b",
    ]);
  });

  test("sync scopes share the same path", () => {
    const http = createMeasure("http");
    const db = createMeasure("db");

    http.resetCounter();
    db.resetCounter();

    http.measureSync.root("GET /users req_1", () => {
      http.measureSync("handler", () => {
        db.measureSync("SELECT users", () => [{ id: 1 }]);
      });
    });

    const starts = events.filter((event) => event.type === "start");

    expect(starts.map((event) => event.id)).toEqual([
      "http:a",
      "http:a-a",
      "db:a-a-a",
    ]);
  });
});
