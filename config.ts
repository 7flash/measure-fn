import type { ConfigureOpts, MeasureLogger, MeasureLogEvent, MeasureLevel, MeasureScopeOptions } from "./types.js";

const env = typeof process === "undefined" ? undefined : process.env;
export const DEFAULT_SENSITIVE_KEY =
  /secret|private|mnemonic|seed|keypair|password|authorization|cookie|token|apikey|api_key/i;
export const MAX_TIMER_MS = 2_147_483_647;

export const options = {
  timestamps:
    env?.MEASURE_TIMESTAMPS === "iso"
      ? ("iso" as const)
      : env?.MEASURE_TIMESTAMPS === "1" || env?.MEASURE_TIMESTAMPS === "true",
  errorDetails:
    env?.MEASURE_ERROR_DETAILS === "1" || env?.MEASURE_ERROR_DETAILS === "true",
  colors: "auto" as boolean | "auto",
  summarize: false,
  stripScopePrefix: false,
  maxResultLength: undefined as number | undefined,
  maxValueLength: 300,
  level: "info" as MeasureLevel,
  slowThreshold: 1000,
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

export function validateScopeOptions(opts: MeasureScopeOptions): MeasureScopeOptions {
  if (opts.level !== undefined && !["info", "errors", "silent"].includes(opts.level))
    throw new TypeError("level must be info, errors, or silent");
  if (opts.slowThreshold !== undefined) finiteNumber("slowThreshold", opts.slowThreshold);
  for (const key of ["maxValueLength", "maxResultLength"] as const)
    if (opts[key] !== undefined) integer(key, opts[key]);
  return { ...opts };
}

/** Exact scope rules win over the wildcard regardless of order. Invalid rules fail early. */
const levelRules = new Map<string, MeasureLevel>();
if (env?.MEASURE_LEVEL) {
  for (const entry of env.MEASURE_LEVEL.split(",")) {
    const parts = entry.split("=").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0])
      throw new TypeError("MEASURE_LEVEL must contain scope=level rules");
    const level = parts[1] as MeasureLevel;
    validateScopeOptions({ level });
    levelRules.set(parts[0]!, level);
  }
}
export const scopeLevel = (scope?: string): MeasureLevel =>
  (scope === undefined ? undefined : levelRules.get(scope)) ?? levelRules.get("*") ?? options.level;

/** Validate the entire update before changing any global state. */
export function configure(opts: ConfigureOpts): void {
  validateScopeOptions(opts);
  const next = { ...options };
  if (opts.level !== undefined) next.level = opts.level;
  if (opts.slowThreshold !== undefined) next.slowThreshold = opts.slowThreshold;
  if (opts.maxValueLength !== undefined) {
    next.maxValueLength = opts.maxValueLength;
    next.maxResultLength = undefined;
  }
  for (const key of [
    "maxResultLength",
    "maxValueLength",
    "maxSummaryDepth",
    "maxSummaryStringLength",
    "summaryArraySample",
    "summaryObjectKeys",
  ] as const) {
    if (opts[key] !== undefined) next[key] = integer(key, opts[key]);
  }
  for (const key of [
    "summarize",
    "stripScopePrefix",
    "errorDetails",
  ] as const) {
    if (opts[key] !== undefined) {
      if (typeof opts[key] !== "boolean")
        throw new TypeError(`${key} must be a boolean`);
      next[key] = opts[key];
    }
  }
  if (opts.timestamps !== undefined) {
    if (typeof opts.timestamps !== "boolean" && opts.timestamps !== "iso")
      throw new TypeError("timestamps must be true, false, or iso");
    next.timestamps = opts.timestamps;
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