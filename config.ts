import type { ConfigureOpts, MeasureLogger, MeasureLogEvent } from "./types.js";

const env = typeof process === "undefined" ? undefined : process.env;
export const DEFAULT_SENSITIVE_KEY =
  /secret|private|mnemonic|seed|keypair|password|authorization|cookie|token|apikey|api_key/i;
export const MAX_TIMER_MS = 2_147_483_647;

export const options = {
  timestamps:
    env?.MEASURE_TIMESTAMPS === "1" || env?.MEASURE_TIMESTAMPS === "true",
  colors: "auto" as boolean | "auto",
  summarize: false,
  stripScopePrefix: false,
  maxResultLength: 0,
  maxSummaryDepth: 4,
  maxSummaryStringLength: 160,
  summaryArraySample: 2,
  summaryObjectKeys: 24,
  sensitiveKeyPattern: DEFAULT_SENSITIVE_KEY as RegExp | null,
};

export let silent =
  env?.MEASURE_SILENT === "1" || env?.MEASURE_SILENT === "true";
export let logger: MeasureLogger | null = null;
export let onLoggerError:
  ((error: unknown, event: MeasureLogEvent) => void) | null = null;

export function finiteNumber(
  name: string,
  value: number,
  min = 0,
  max = Number.MAX_VALUE,
): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(
      `${name} must be a finite number between ${min} and ${max}`,
    );
  }
  return value;
}

export function integer(name: string, value: number, min = 0): number {
  finiteNumber(name, value, min, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(value))
    throw new RangeError(`${name} must be an integer`);
  return value;
}

/** Validate the entire update before changing any global state. */
export function configure(opts: ConfigureOpts): void {
  const next = { ...options };
  for (const key of [
    "maxResultLength",
    "maxSummaryDepth",
    "maxSummaryStringLength",
    "summaryArraySample",
    "summaryObjectKeys",
  ] as const) {
    if (opts[key] !== undefined) next[key] = integer(key, opts[key]);
  }
  for (const key of ["timestamps", "summarize", "stripScopePrefix"] as const) {
    if (opts[key] !== undefined) {
      if (typeof opts[key] !== "boolean")
        throw new TypeError(`${key} must be a boolean`);
      next[key] = opts[key];
    }
  }
  if (opts.silent !== undefined && typeof opts.silent !== "boolean") {
    throw new TypeError("silent must be a boolean");
  }
  if (opts.colors !== undefined) {
    if (typeof opts.colors !== "boolean" && opts.colors !== "auto")
      throw new TypeError("colors must be true, false, or auto");
    next.colors = opts.colors;
  }
  for (const key of ["logger", "onLoggerError"] as const) {
    if (opts[key] != null && typeof opts[key] !== "function")
      throw new TypeError(`${key} must be a function or null`);
  }
  if (opts.sensitiveKeyPattern !== undefined) {
    const pattern = opts.sensitiveKeyPattern;
    if (pattern === null) next.sensitiveKeyPattern = null;
    else if (typeof pattern === "string")
      next.sensitiveKeyPattern = new RegExp(pattern, "i");
    else if (pattern instanceof RegExp)
      next.sensitiveKeyPattern = new RegExp(pattern.source, pattern.flags);
    else
      throw new TypeError(
        "sensitiveKeyPattern must be a RegExp, string, or null",
      );
  }
  Object.assign(options, next);
  if (opts.silent !== undefined) silent = opts.silent;
  if (opts.logger !== undefined) logger = opts.logger;
  if (opts.onLoggerError !== undefined) onLoggerError = opts.onLoggerError;
}

export function isSensitiveKey(key: string): boolean {
  const pattern = options.sensitiveKeyPattern;
  if (!pattern) return false;
  pattern.lastIndex = 0;
  try {
    return pattern.test(key);
  } finally {
    pattern.lastIndex = 0;
  }
}
