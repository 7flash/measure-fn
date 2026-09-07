import { StackContextStorage, type Span } from "./context.js";
import { createMeasureRuntime } from "./runtime.js";
import type { MeasureFn, MeasureSyncFn, MeasureInstance } from "./types.js";
export * from "./public.js";

const runtime = createMeasureRuntime(new StackContextStorage<Span>());
export const measure: MeasureFn = runtime.measure;
export const measureSync: MeasureSyncFn = runtime.measureSync;
export const createMeasure: (scope?: string) => MeasureInstance =
  runtime.createMeasure;
