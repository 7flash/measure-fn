import { finiteNumber } from "./config.js";

/**
 * 0.50ms, 123.45ms, 1.5s, 1m 30s, 2h 5m. A value that would round up to the
 * next unit's boundary moves to that unit (999.996 ms is "1.0s", not
 * "1000.00ms"; 59.96 s is "1m 0s", not "60.0s"). Negative or non-finite
 * values throw a RangeError.
 */
export function formatDuration(ms: number): string {
  finiteNumber("duration", ms);
  if (Math.round(ms * 100) / 100 < 1000) return `${ms.toFixed(2)}ms`;
  if (Math.round(ms / 100) / 10 < 60) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function toAlpha(num: number): string {
  let result = "";
  do {
    result = String.fromCharCode(97 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);
  return result;
}
