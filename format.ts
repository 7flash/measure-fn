import { finiteNumber } from "./config.js";

export function formatDuration(ms: number): string {
  finiteNumber("duration", ms);
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function toAlpha(num: number): string {
  let result = "";
  do {
    result = String.fromCharCode(97 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);
  return result;
}
