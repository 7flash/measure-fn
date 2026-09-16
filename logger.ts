import { logger, onLoggerError, options, silent } from "./config.js";
import { formatDuration } from "./format.js";
import { errorMessage, errorStack, ownValue, stringifyForLog } from "./serialization.js";
import type { MeasureLogEvent, MeasureScopeOptions } from "./types.js";

const ANSI_RESET = "\x1b[0m";
const SCOPE_COLORS = [36, 35, 34, 33, 32, 31, 96, 95, 94, 93, 92, 91] as const;

const assignedScopeColors = new Map<string, number>();
const assignedColorScopes = new Map<number, string>();

const shouldUseColors = (): boolean => {
  if (options.colors === true) return true;
  if (options.colors === false) return false;

  if (typeof process === "undefined") return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR !== undefined) return true;

  return process.stdout?.isTTY === true;
};

const color = (code: number, value: string): string => {
  if (!shouldUseColors()) return value;
  return `\x1b[${code}m${value}${ANSI_RESET}`;
};

const stableHash = (value: string): number => {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const scopeColor = (scope: string): number => {
  const assigned = assignedScopeColors.get(scope);
  if (assigned !== undefined) return assigned;

  const start = stableHash(scope) % SCOPE_COLORS.length;
  for (let offset = 0; offset < SCOPE_COLORS.length; offset++) {
    const code = SCOPE_COLORS[(start + offset) % SCOPE_COLORS.length]!;
    if (assignedColorScopes.has(code)) continue;
    assignedScopeColors.set(scope, code);
    assignedColorScopes.set(code, scope);
    return code;
  }

  const code = SCOPE_COLORS[start]!;
  assignedScopeColors.set(scope, code);
  return code;
};

const formatLogId = (event: MeasureLogEvent): string => {
  if (!event.scope) return `[${event.rawId}]`;
  return `${color(scopeColor(event.scope), `[${event.scope}]`)} ${event.rawId}`;
};

const localTimestamp = (date: Date): string => {
  const two = (value: number) => String(value).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${milliseconds}`;
};

const timestampPrefix = (): string => {
  if (!options.timestamps) return "";
  const now = new Date();
  return `[${options.timestamps === "iso" ? now.toISOString() : localTimestamp(now)}] `;
};

export type ConsolePolicy = MeasureScopeOptions & { originalError?: unknown };
const printedErrors = new WeakSet<object>();
const truncate = (text: string, cap: number) =>
  cap > 0 && text.length > cap ? text.slice(0, cap - 1) + "…" : text;

function defaultLogger(event: MeasureLogEvent, policy: ConsolePolicy): void {
  const level = policy.level ?? options.level;
  if (level === "silent") return;
  const slow = event.type === "success" &&
    (event.duration > (policy.slowThreshold ?? options.slowThreshold) ||
      (event.budget !== undefined && event.duration > event.budget));
  if (level === "errors" && event.type !== "error" && !slow) return;
  const cap = policy.maxValueLength ?? options.maxResultLength ?? options.maxValueLength;
  const id = `${timestampPrefix()}${formatLogId(event)}`;
  if (event.type === "start" || event.type === "annotation") {
    console.log(`${id} ${event.type === "start" ? "→" : "="} ${truncate(event.label, cap)}`);
    return;
  }
  const budget =
    event.budget !== undefined && event.duration > event.budget
      ? ` ⚠ over budget ${formatDuration(event.budget)}`
      : "";
  const duration = formatDuration(event.duration);
  if (event.type === "success") {
    const result = stringifyForLog(event.result, cap);
    console.log(`${id} ✓ ${level === "errors" ? `${truncate(event.label, cap)} ` : ""}${duration}${result ? ` → ${result}` : ""}${budget}`);
    return;
  }
  console.log(`${id} ✗ ${duration} (${errorMessage(event.error)})${budget}`);
  if (!options.errorDetails) return;
  const original = policy.originalError ?? event.error;
  if ((typeof original === "object" && original !== null) || typeof original === "function") {
    if (printedErrors.has(original)) return;
    printedErrors.add(original);
  }
  const detail =
    original instanceof Error
      ? (errorStack(original) ?? errorMessage(original))
      : stringifyForLog(event.error, cap);
  if (detail) console.error(`${id} ${detail}`);
  if (typeof original === "object" && original !== null) {
    const cause = ownValue(original, "cause");
    if (cause !== undefined) console.error(`${id} Cause: ${stringifyForLog(cause, 0)}`);
  }
}

export function consumeThenable(
  value: unknown,
  failed: (error: unknown) => void,
): boolean {
  try {
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as { then?: unknown }).then === "function"
    ) {
      void Promise.resolve(value).catch(failed);
      return true;
    }
  } catch (error) {
    failed(error);
    return true;
  }
  return false;
}

let reporting = false;
function reportFailure(error: unknown, event: MeasureLogEvent): void {
  if (!onLoggerError || reporting) return;
  reporting = true;
  try {
    consumeThenable(onLoggerError(error, event), () => {});
  } catch {
  } finally {
    reporting = false;
  }
}

let emitting = false;
export function emit(event: MeasureLogEvent, policy: ConsolePolicy = {}): void {
  if (silent || emitting || reporting) return;
  emitting = true;
  let delegated = false;
  const next = () => {
    if (delegated) return;
    delegated = true;
    try {
      defaultLogger(event, policy);
    } catch (error) {
      reportFailure(error, event);
    }
  };
  try {
    if (logger)
      consumeThenable(logger(event, next), (error) =>
        reportFailure(error, event),
      );
    else next();
  } catch (error) {
    reportFailure(error, event);
  } finally {
    emitting = false;
  }
}