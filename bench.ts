import { configure, createMeasure, measure, measureSync } from "./index.ts";

const iterations = Number(process.env.MEASURE_BENCH_ITERATIONS ?? 100_000);
if (!Number.isSafeInteger(iterations) || iterations < 1)
  throw new RangeError("MEASURE_BENCH_ITERATIONS must be a positive integer");
const trials = 5;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const noop = () => {};
const asyncNoop = async () => {};

// The clock harness stays uninstrumented so it does not alter the baseline.
const timeSync = (fn: () => void, count: number) => {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn();
  return (performance.now() - start) / count;
};
const timeAsync = async (fn: () => Promise<void>, count: number) => {
  const start = performance.now();
  for (let i = 0; i < count; i++) await fn();
  return (performance.now() - start) / count;
};

configure({ silent: true });
const syncSamples: number[] = [];
const asyncSamples: number[] = [];
const nestedSamples: number[] = [];
const syncBaseline: number[] = [];
const asyncBaseline: number[] = [];

// Warm up the same code paths that are timed.
for (let i = 0; i < 2_000; i++) {
  measureSync("warmup", noop);
  await measure("warmup", asyncNoop);
}
for (let trial = 0; trial < trials; trial++) {
  syncBaseline.push(timeSync(noop, iterations));
  syncSamples.push(timeSync(() => measureSync("sync", noop), iterations));
  asyncBaseline.push(await timeAsync(asyncNoop, iterations));
  asyncSamples.push(
    await timeAsync(() => measure("async", asyncNoop), iterations),
  );
  nestedSamples.push(
    timeSync(
      () => {
        measureSync("root", () => {
          measureSync("child", () => {
            measureSync("leaf", noop);
          });
        });
      },
      Math.max(1, Math.floor(iterations / 10)),
    ),
  );
}

configure({ silent: false });
createMeasure("bench").sync("median measurements", () => ({
  iterations,
  trials,
  syncMsPerCall: median(syncSamples),
  asyncMsPerCall: median(asyncSamples),
  syncOverheadMs: median(syncSamples) - median(syncBaseline),
  asyncOverheadMs: median(asyncSamples) - median(asyncBaseline),
  nestedMsPerTree: median(nestedSamples),
  note: "Async overhead uses an awaited async baseline. Results are local estimates, not performance guarantees.",
}));
