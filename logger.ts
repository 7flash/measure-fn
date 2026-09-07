import {
  logger,
  onLoggerError,
  options,
  silent,
  isSensitiveKey,
} from "./config.js";
import { formatDuration } from "./format.js";
import {
  errorMessage,
  errorStack,
  ownValue,
  stringifyForLog,
} from "./serialization.js";
import type { MeasureLogEvent } from "./types.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = 90;
const ANSI_GREEN = 32;
const ANSI_RED = 31;
const ANSI_YELLOW = 33;
const ANSI_CYAN = 36;

const IDENTITY_COLORS = [36, 35, 34, 33, 32, 96, 95, 94, 93, 92] as const;

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

const identityColor = (key: string): number => {
  return IDENTITY_COLORS[stableHash(key) % IDENTITY_COLORS.length]!;
};

const formatLogId = (event: MeasureLogEvent): string => {
  const id = `[${event.id}]`;
  const key = event.scope ? `scope:${event.scope}` : `label:${event.label}`;
  return color(identityColor(key), id);
};

const formatLogLabel = (event: MeasureLogEvent): string => {
  return color(identityColor(`label:${event.label}`), event.label);
};

function defaultLogger(event: MeasureLogEvent): void {
  const id = `${options.timestamps ? `[${new Date().toISOString()}] ` : ""}${formatLogId(event)}`;
  if (event.type === "start" || event.type === "annotation") {
    console.log(
      `${id} ${event.type === "start" ? color(ANSI_DIM, "→") : color(ANSI_CYAN, "=")} ${formatLogLabel(event)}`,
    );
    return;
  }
  const budget =
    event.budget !== undefined && event.duration > event.budget
      ? color(ANSI_YELLOW, ` ⚠ over budget ${formatDuration(event.budget)}`)
      : "";
  const duration = color(ANSI_DIM, formatDuration(event.duration));
  if (event.type === "success") {
    const result = stringifyForLog(event.result, event.maxResultLength);
    console.log(
      `${id} ${color(ANSI_GREEN, "✓")} ${duration}${result ? ` → ${result}` : ""}${budget}`,
    );
    return;
  }
  console.log(
    `${id} ${color(ANSI_RED, "✗")} ${duration} (${errorMessage(event.error)})${budget}`,
  );
  if (event.error instanceof Error) {
    const stack = isSensitiveKey("stack") ? undefined : errorStack(event.error);
    console.error(
      id,
      isSensitiveKey("stack")
        ? "[omitted]"
        : typeof stack === "string"
          ? stack
          : errorMessage(event.error),
    );
    const cause = ownValue(event.error, "cause");
    if (cause !== undefined)
      console.error(
        `${id} Cause:`,
        isSensitiveKey("cause")
          ? "[omitted]"
          : stringifyForLog(cause, event.maxResultLength),
      );
  } else {
    console.error(id, stringifyForLog(event.error, event.maxResultLength));
  }
}

/** Observe rejected logger promises without adding them to application latency. */
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
    // Diagnostics must not recursively fail or replace the application error.
  } finally {
    reporting = false;
  }
}

let emitting = false;
export function emit(event: MeasureLogEvent): void {
  if (silent || emitting || reporting) return;
  emitting = true;
  let delegated = false;
  const next = () => {
    if (delegated) return;
    delegated = true;
    try {
      defaultLogger(event);
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
