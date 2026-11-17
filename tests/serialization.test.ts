import { describe, expect, test } from "bun:test";
import {
  safeStringify,
  stringifyForLog,
  summarizeForMeasure,
} from "../serialization.js";

describe("hostile value serialization", () => {
  test("does not invoke throwing getters", () => {
    let called = false;
    const value = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        called = true;
        throw new Error("getter ran");
      },
    });
    expect(() => safeStringify(value)).not.toThrow();
    expect(called).toBe(false);
    // The getter is not run; the key is printed with a placeholder.
    expect(safeStringify(value)).toContain("secret");
  });

  test("contains throwing Proxy traps", () => {
    const value = new Proxy({}, {
      ownKeys() {
        throw new Error("ownKeys");
      },
      getOwnPropertyDescriptor() {
        throw new Error("descriptor");
      },
    });
    expect(() => safeStringify(value)).not.toThrow();
    expect(safeStringify(value)).toContain("Unserializable");
  });

  test("does not call toJSON, including a self-returning toJSON", () => {
    let calls = 0;
    const value = {
      toJSON() {
        calls++;
        return this;
      },
    };
    expect(safeStringify(value)).toContain("[Function: toJSON]");
    expect(calls).toBe(0);
    const throwing = {
      toJSON() {
        throw new Error("toJSON ran");
      },
    };
    expect(() => safeStringify(throwing)).not.toThrow();
  });

  test("handles BigInt, Symbols, and symbol-keyed properties", () => {
    const key = Symbol("hidden");
    const value = { amount: 12n, [key]: "not enumerable by string key" };
    expect(safeStringify(value)).toContain('"12n"');
    expect(safeStringify(value)).not.toContain("not enumerable");
    expect(safeStringify(Symbol("value"))).toBe("Symbol(value)");
  });

  test("bounds sparse and huge arrays", () => {
    const value: unknown[] = [];
    value.length = 1_000_000_000;
    expect(safeStringify(value).length).toBeLessThan(20_000);
    expect(safeStringify(value)).toContain('"length":1000000000');
    expect(summarizeForMeasure(value)).toBeDefined();
  });

  test("bounds Map and Set samples", () => {
    const map = new Map(Array.from({ length: 20_000 }, (_, i) => [i, i]));
    const set = new Set(Array.from({ length: 20_000 }, (_, i) => i));
    expect(safeStringify(map).length).toBeLessThan(100_000);
    expect(safeStringify(set).length).toBeLessThan(100_000);
    expect(safeStringify(map)).toContain('"size":20000');
    expect(safeStringify(set)).toContain('"size":20000');
  });

  test("summarizes typed arrays and Buffers without enumerating elements", () => {
    const typed = new Uint8Array(1_000_000);
    expect(safeStringify(typed)).toContain('"byteLength":1000000');
    if (typeof Buffer !== "undefined") {
      expect(safeStringify(Buffer.alloc(1_000_000))).toContain(
        '"byteLength":1000000',
      );
    }
  });

  test("handles cyclic Error causes", () => {
    const error = new Error("outer");
    const cause = new Error("inner");
    Object.defineProperty(error, "cause", { value: cause, enumerable: true });
    Object.defineProperty(cause, "cause", { value: error, enumerable: true });
    expect(() => safeStringify(error)).not.toThrow();
    expect(safeStringify(error, 0)).toContain("[Circular]");
  });

  test("bounds very deep nesting", () => {
    const root: Record<string, unknown> = {};
    let current = root;
    for (let i = 0; i < 20_000; i++) {
      const next: Record<string, unknown> = {};
      current.next = next;
      current = next;
    }
    expect(() => safeStringify(root)).not.toThrow();
    expect(safeStringify(root).length).toBeLessThan(100_000);
  });

  test("truncates lone and paired surrogates safely", () => {
    const paired = "a".repeat(8) + "\ud83d\ude00";
    expect(() => stringifyForLog(paired, 10)).not.toThrow();
    expect(stringifyForLog(paired, 10).length).toBeLessThanOrEqual(12);
    const lone = "a".repeat(8) + "\ud800";
    const result = stringifyForLog(lone, 10);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test("bounds work on large inputs", () => {
    const value = Array.from({ length: 100_000 }, (_, i) => ({ i }));
    const start = performance.now();
    const result = safeStringify(value);
    expect(result.length).toBeLessThan(100_000);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});
