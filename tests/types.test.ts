import {
  createMeasure,
  type MeasureAction,
  type MeasureLogEvent,
} from "../index.js";

// Compile-only API contracts. This function is intentionally never executed.
function checkTypes() {
  const m = createMeasure("types");
  const number: number = m.sync("sync", () => 42);
  const promise: Promise<number> = m("async", async () => 42);
  const recovered: number = m.sync({ catch: () => 7 }, () => 42);
  const rows: Promise<(number | null)[]> = m.batch(
    "rows",
    [1, 2] as const,
    (n) => n,
  );
  const retried: Promise<number> = m.retry("retry", { delay: 0 }, () => 42);
  const object = {
    value: 1,
    method: m.wrap("method", function (this: { value: number }, n: number) {
      return this.value + n;
    }),
  };
  const wrapped: Promise<number> = object.method(2);
  const asyncAction: MeasureAction<number> = { catch: async () => 42 };
  // @ts-expect-error Synchronous measurements cannot return promises.
  m.sync("async callback", async () => 42);
  // @ts-expect-error Synchronous recovery cannot return a promise.
  m.sync({ catch: async () => 42 }, () => 1);
  // @ts-expect-error General async action objects are not sync action objects.
  m.sync(asyncAction, () => 1);
  // @ts-expect-error A synchronous callback cannot be interrupted by a timeout.
  m.sync({ timeout: 10 }, () => 1);
  // @ts-expect-error Sync wrappers also reject asynchronous callbacks.
  m.sync.wrap("async method", async () => 1);
  const narrowed = (event: MeasureLogEvent) => {
    const trace: string = event.traceId;
    const parent: string | undefined = event.parentId;
    if (event.type === "error") return [trace, parent, event.error, event.data];
    if (event.type === "success")
      return [event.duration, event.result, event.data];
    return [event.value, event.data];
  };
  return [number, promise, recovered, rows, retried, wrapped, narrowed];
}

void checkTypes;
