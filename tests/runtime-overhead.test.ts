import { describe, expect, it, mock } from "bun:test";
import type { ContextStorage, Span } from "../context.js";
import { createMeasureRuntime } from "../runtime.js";

function makeStorage(): ContextStorage<Span> {
  return {
    getStore: () => undefined,
    run: (_span, fn) => fn(),
  };
}

describe("filtered measurement work", () => {
  it("skips start mapping and annotation mapping in a silent scope", async () => {
    const start = mock(() => "expensive label");
    const runtime = createMeasureRuntime(makeStorage());
    const measure = runtime.createMeasure("quiet", { level: "silent" });
    const action = { start, summarize: true };

    await measure(action, async () => 42);
    measure.note(action);

    expect(start).not.toHaveBeenCalled();
  });

});
