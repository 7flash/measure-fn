import { AsyncLocalStorage } from "node:async_hooks";
import type { Span } from "./context.js";
import { createMeasureRuntime } from "./runtime.js";
import type { MeasureFn, MeasureSyncFn, MeasureInstance, MeasureScopeOptions } from "./types.js";
export * from "./public.js";

const runtime = createMeasureRuntime(new AsyncLocalStorage<Span>());
export const measure: MeasureFn = runtime.measure;
export const measureSync: MeasureSyncFn = runtime.measureSync;
export const createMeasure: (scope?: string, options?: MeasureScopeOptions) => MeasureInstance =
  runtime.createMeasure;