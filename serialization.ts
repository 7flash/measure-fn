import { integer, isSensitiveKey, options } from "./config.js";

const UNREADABLE = "[Unserializable]";
const ACCESSOR = "[Accessor]";

/** Inspect own data only: observing a result must not invoke its getters. */
export function ownValue(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value
      : descriptor
        ? ACCESSOR
        : undefined;
  } catch {
    return UNREADABLE;
  }
}

/** Native Error.stack is a lazy accessor on some engines; preserve that diagnostic. */
export function errorStack(error: Error): unknown {
  try {
    return error.stack;
  } catch {
    return undefined;
  }
}

function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  // A payload's __proto__ must remain data, never change the snapshot prototype.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function shorten(text: string, max: number): string {
  return max > 0 && text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function snapshot(
  value: unknown,
  summary: boolean,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  try {
    if (value == null) return value;
    switch (typeof value) {
      case "bigint":
        return summary ? value.toString() : `${value}n`;
      case "number":
        return Number.isFinite(value) ? value : String(value);
      case "boolean":
        return value;
      case "string":
        return summary ? shorten(value, options.maxSummaryStringLength) : value;
      case "symbol":
        return String(value);
      case "function":
        return `[Function: ${ownValue(value, "name") || "anonymous"}]`;
    }
    const object = value as object;
    if (ancestors.has(object)) return "[Circular]";
    if (summary && depth >= options.maxSummaryDepth)
      return { type: "object", truncated: "max-depth" };
    ancestors.add(object);
    try {
      const visit = (child: unknown) =>
        snapshot(child, summary, depth + 1, ancestors);
      if (typeof Response !== "undefined" && value instanceof Response) {
        return { status: value.status, ok: value.ok };
      }
      if (value instanceof Date) {
        return Number.isNaN(Date.prototype.getTime.call(value))
          ? "Invalid Date"
          : Date.prototype.toISOString.call(value);
      }
      if (typeof URL !== "undefined" && value instanceof URL)
        return URL.prototype.toString.call(value);
      if (value instanceof Map) {
        const sample: unknown[] = [];
        const limit = summary ? options.summaryArraySample : Infinity;
        // Do not materialize the whole collection just to take a small sample.
        if (limit > 0)
          for (const [key, item] of Map.prototype.entries.call(value)) {
            sample.push([
              visit(key),
              typeof key === "string" && isSensitiveKey(key)
                ? "[omitted]"
                : visit(item),
            ]);
            if (sample.length >= limit) break;
          }
        return summary
          ? { type: "map", size: value.size, sample }
          : { type: "map", entries: sample };
      }
      if (value instanceof Set) {
        const sample: unknown[] = [];
        const limit = summary ? options.summaryArraySample : Infinity;
        if (limit > 0)
          for (const item of Set.prototype.values.call(value)) {
            sample.push(visit(item));
            if (sample.length >= limit) break;
          }
        return summary
          ? { type: "set", size: value.size, sample }
          : { type: "set", values: sample };
      }
      if (Array.isArray(value)) {
        if (summary && depth >= 2)
          return { type: "array", length: value.length };
        const count =
          summary && value.length > 8
            ? Math.min(value.length, options.summaryArraySample)
            : value.length;
        const items: unknown[] = [];
        for (let i = 0; i < count; i++)
          items.push(visit(ownValue(value, String(i))));
        return summary && value.length > 8
          ? { type: "array", length: value.length, sample: items }
          : items;
      }
      if (summary && ArrayBuffer.isView(value)) {
        return { type: "buffer-view", byteLength: value.byteLength };
      }
      const out: Record<string, unknown> = {};
      if (value instanceof Error) {
        // Built-in names usually live on the prototype; avoid arbitrary getters.
        let proto: object | null = value;
        let name: unknown;
        while (proto && name === undefined) {
          name = ownValue(proto, "name");
          proto = Object.getPrototypeOf(proto);
        }
        for (const key of [
          "name",
          "message",
          ...(summary ? [] : ["stack"]),
          "cause",
        ]) {
          const item = isSensitiveKey(key)
            ? "[omitted]"
            : key === "name"
              ? (name ?? "Error")
              : key === "stack"
                ? errorStack(value)
                : ownValue(value, key);
          if (item !== undefined)
            put(out, key, isSensitiveKey(key) ? "[omitted]" : visit(item));
        }
      }
      const keys = Object.keys(object);
      const limit = summary ? options.summaryObjectKeys : keys.length;
      for (const key of keys.slice(0, limit)) {
        // Redact before reading even a data property.
        put(
          out,
          key,
          isSensitiveKey(key) ? "[omitted]" : visit(ownValue(object, key)),
        );
      }
      if (keys.length > limit) put(out, "omittedKeys", keys.length - limit);
      return out;
    } finally {
      ancestors.delete(object);
    }
  } catch {
    return UNREADABLE;
  }
}

export function summarizeForMeasure(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  return snapshot(value, true, depth, seen);
}

/** Internal formatter: its input has already received action-level summarization. */
export function stringifyForLog(
  value: unknown,
  limit = options.maxResultLength ?? options.maxValueLength,
): string {
  const cap = integer("maxResultLength", limit);
  if (value === undefined) return "";
  try {
    const input = snapshot(value, false, 0, new WeakSet());
    const text =
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint" ||
      typeof value === "function" ||
      typeof value === "symbol"
        ? String(input)
        : (JSON.stringify(input) ?? "");
    return shorten(text, cap);
  } catch {
    return shorten(UNREADABLE, cap);
  }
}

/** Display serialization; truncated output is not necessarily valid JSON. */
export function safeStringify(value: unknown, limit?: number): string {
  return stringifyForLog(
    options.summarize ? summarizeForMeasure(value) : value,
    limit,
  );
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = ownValue(error, "message");
    if (typeof message === "string") return message;
  }
  return stringifyForLog(error, 0) || "Unknown error";
}