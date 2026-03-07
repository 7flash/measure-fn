import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { measure, measureSync, resetCounter, configure, createMeasure, safeStringify, formatDuration, type MeasureEvent } from "./index.ts";

function captureConsole() {
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: any[]) => {
        logs.push(args.map(String).join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((...args: any[]) => {
        errors.push(args.map(String).join(" "));
    });
    return {
        logs, errors,
        restore: () => { logSpy.mockRestore(); errorSpy.mockRestore(); },
    };
}

// ─── measure (async) ─────────────────────────────────────────────────

describe("measure (async)", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false, maxResultLength: 200 });
    });

    test("runs and returns result", async () => {
        const out = captureConsole();
        const result = await measure("op", async () => 42);
        out.restore();
        expect(result).toBe(42);
    });

    test("logs start ... and success with result", async () => {
        const out = captureConsole();
        await measure("fetch", async () => "ok");
        out.restore();
        expect(out.logs[0]).toBe("[a] ... fetch");
        expect(out.logs[1]).toMatch(/\[a\] ····· .* → "ok"/);
    });

    test("no arrow for undefined", async () => {
        const out = captureConsole();
        await measure("void", async () => { });
        out.restore();
        expect(out.logs[1]).not.toContain("→");
    });

    test("error returns null and logs ✗", async () => {
        const out = captureConsole();
        const result = await measure("fail", async () => { throw new Error("boom"); });
        out.restore();
        expect(result).toBeNull();
        expect(out.logs[1]).toContain("✗");
        expect(out.logs[1]).toContain("boom");
    });

    test("error cause logged", async () => {
        const out = captureConsole();
        await measure("err", async () => { throw new Error("x", { cause: "y" }); });
        out.restore();
        expect(out.errors.some(e => e.includes("Cause:"))).toBe(true);
    });

    test("annotation uses =", async () => {
        const out = captureConsole();
        await measure("note");
        out.restore();
        expect(out.logs[0]).toBe("[a] = note");
    });

    test("object label extracts meta", async () => {
        const out = captureConsole();
        await measure({ label: "Fetch", userId: 5 }, async () => "ok");
        out.restore();
        expect(out.logs[0]).toBe("[a] ... Fetch (userId=5)");
    });

    test("nested hierarchical IDs", async () => {
        const out = captureConsole();
        await measure("root", async (m) => {
            await m("child A", async () => 1);
            await m("child B", async () => 2);
        });
        out.restore();
        expect(out.logs[0]).toBe("[a] ... root");
        expect(out.logs[1]).toBe("[a-a] ... child A");
        expect(out.logs[3]).toBe("[a-b] ... child B");
    });

    test("child error doesn't crash parent", async () => {
        const out = captureConsole();
        const result = await measure("parent", async (m) => {
            const bad = await m("fail", async () => { throw new Error("x"); });
            expect(bad).toBeNull();
            return "ok";
        });
        out.restore();
        expect(result).toBe("ok");
    });

    test("no ANSI or indentation", async () => {
        const out = captureConsole();
        await measure("root", async (m) => { await m("child", async () => 1); });
        out.restore();
        for (const line of out.logs) {
            expect(line).not.toContain('\x1b[');
            expect(line).toMatch(/^\[/);
        }
    });
});

// ─── measureSync ─────────────────────────────────────────────────────

describe("measureSync", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false, maxResultLength: 200 });
    });

    test("leaf = single line with result", () => {
        const out = captureConsole();
        measureSync("compute", () => 100);
        out.restore();
        expect(out.logs.length).toBe(1);
        expect(out.logs[0]).toMatch(/\[a\] ······· .* → 100/);
    });

    test("with children = start + end", () => {
        const out = captureConsole();
        measureSync("parent", (m) => { m("child", () => 10); return 20; });
        out.restore();
        expect(out.logs[0]).toBe("[a] ... parent");
        expect(out.logs[1]).toMatch(/\[a-a\] ····· .* → 10/);
        expect(out.logs[2]).toMatch(/\[a\] ······ .* → 20/);
    });

    test("error returns null", () => {
        const out = captureConsole();
        const r = measureSync("fail", () => { throw new Error("x"); });
        out.restore();
        expect(r).toBeNull();
        expect(out.logs[0]).toContain("✗");
    });

    test("annotation uses =", () => {
        const out = captureConsole();
        measureSync("note");
        out.restore();
        expect(out.logs[0]).toBe("[a] = note");
    });
});

// ─── Smart duration formatting ───────────────────────────────────────

describe("formatDuration", () => {
    test("milliseconds", () => {
        expect(formatDuration(0.5)).toBe("0.50ms");
        expect(formatDuration(123.45)).toBe("123.45ms");
        expect(formatDuration(999)).toBe("999.00ms");
    });

    test("seconds", () => {
        expect(formatDuration(1000)).toBe("1.0s");
        expect(formatDuration(1500)).toBe("1.5s");
        expect(formatDuration(59999)).toBe("60.0s");
    });

    test("minutes", () => {
        expect(formatDuration(60000)).toBe("1m 0s");
        expect(formatDuration(90000)).toBe("1m 30s");
        expect(formatDuration(125000)).toBe("2m 5s");
    });
});

// ─── Safe stringify ──────────────────────────────────────────────────

describe("safeStringify", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false, maxResultLength: 200 });
    });

    test("circular handled", () => {
        const out = captureConsole();
        measureSync("c", () => { const o: any = {}; o.s = o; return o; });
        out.restore();
        expect(out.logs[0]).toContain("[Circular]");
    });

    test("long truncated", () => {
        const out = captureConsole();
        measureSync("l", () => ({ d: "x".repeat(200) }));
        out.restore();
        expect(out.logs[0]).toContain("…");
    });

    test("primitives", () => {
        const out = captureConsole();
        measureSync("a", () => null);
        measureSync("b", () => true);
        measureSync("c", () => 42);
        measureSync("d", () => "hi");
        out.restore();
        expect(out.logs[0]).toContain("→ null");
        expect(out.logs[1]).toContain("→ true");
        expect(out.logs[2]).toContain("→ 42");
        expect(out.logs[3]).toContain('→ "hi"');
    });

    test("exported safeStringify works standalone", () => {
        expect(safeStringify(42)).toBe("42");
        expect(safeStringify(null)).toBe("null");
        expect(safeStringify(undefined)).toBe("");
        const circ: any = { a: 1 };
        circ.self = circ;
        expect(safeStringify(circ)).toContain("[Circular]");
    });
});

// ─── Timestamps ──────────────────────────────────────────────────────

describe("timestamps", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("off by default", async () => {
        const out = captureConsole();
        await measure("op", async () => 1);
        out.restore();
        expect(out.logs[0]).toStartWith("[a]");
    });

    test("prepended when enabled", async () => {
        configure({ timestamps: true });
        const out = captureConsole();
        await measure("op", async () => 1);
        out.restore();
        expect(out.logs[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[a\]/);
    });
});

// ─── Configurable truncation ─────────────────────────────────────────

describe("configurable truncation", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false, maxResultLength: 200 });
    });

    test("shorter truncation", () => {
        configure({ maxResultLength: 20 });
        const out = captureConsole();
        measureSync("s", () => ({ key: "a-somewhat-long-value" }));
        out.restore();
        expect(out.logs[0]).toContain("…");
    });

    test("longer truncation shows full", () => {
        configure({ maxResultLength: 500 });
        const out = captureConsole();
        measureSync("f", () => ({ d: "x".repeat(100) }));
        out.restore();
        expect(out.logs[0]).not.toContain("…");
    });

    test("per-label maxResultLength overrides global", () => {
        configure({ maxResultLength: 500 });
        const out = captureConsole();
        measureSync({ label: "op", maxResultLength: 15 }, () => ({ d: "x".repeat(50) }));
        out.restore();
        expect(out.logs[0]).toContain("…");
    });

    test("per-label maxResultLength inherits to children", () => {
        const out = captureConsole();
        measureSync({ label: "parent", maxResultLength: 15 }, (m) => {
            m("child", () => ({ d: "x".repeat(50) }));
            return 1;
        });
        out.restore();
        const childLine = out.logs[1]; // [a-a] line
        expect(childLine).toContain("…");
    });

    test("child can override inherited maxResultLength", () => {
        const out = captureConsole();
        measureSync({ label: "parent", maxResultLength: 15 }, (m) => {
            m({ label: "child", maxResultLength: 500 }, () => ({ d: "x".repeat(50) }));
            return 1;
        });
        out.restore();
        const childLine = out.logs[1]; // child line
        expect(childLine).not.toContain("…");
    });

    test("maxResultLength: 0 means unlimited", () => {
        const out = captureConsole();
        measureSync({ label: "op", maxResultLength: 0 }, () => ({ d: "x".repeat(500) }));
        out.restore();
        expect(out.logs[0]).not.toContain("…");
        expect(out.logs[0]).toContain("x".repeat(500));
    });

    test("maxResultLength not shown in meta", () => {
        const out = captureConsole();
        measureSync({ label: "op", maxResultLength: 50 }, (m) => { return 1; });
        out.restore();
        expect(out.logs[0]).toBe("[a] ... op");
        expect(out.logs[0]).not.toContain("maxResultLength");
    });
});

// ─── Budget ──────────────────────────────────────────────────────────

describe("budget", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("no warning when under budget", async () => {
        const out = captureConsole();
        await measure({ label: "fast", budget: 500 }, async () => { return 1; });
        out.restore();
        expect(out.logs[1]).not.toContain("OVER BUDGET");
    });

    test("warning when over budget", async () => {
        const out = captureConsole();
        await measure({ label: "slow", budget: 5 }, async () => {
            await new Promise(r => setTimeout(r, 20));
            return 1;
        });
        out.restore();
        expect(out.logs[1]).toContain("⚠ OVER BUDGET");
        expect(out.logs[1]).toContain("5.00ms");
    });

    test("budget not shown in meta", async () => {
        const out = captureConsole();
        await measure({ label: "op", budget: 100 }, async () => 1);
        out.restore();
        expect(out.logs[0]).toBe("[a] ... op");
        expect(out.logs[0]).not.toContain("budget");
    });

    test("sync budget passed through to event", () => {
        const events: MeasureEvent[] = [];
        configure({ logger: (e) => events.push(e) });
        measureSync({ label: "budgeted", budget: 50 }, () => 1);
        const success = events.find(e => e.type === 'success')!;
        expect(success.budget).toBe(50);
    });
});

// ─── Scoped instances ────────────────────────────────────────────────

describe("createMeasure (scoped)", () => {
    beforeEach(() => {
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("prefixed IDs", async () => {
        const api = createMeasure("api");
        api.resetCounter();
        const out = captureConsole();
        await api.measure("fetch", async () => "ok");
        out.restore();
        expect(out.logs[0]).toBe("[api:a] ... fetch");
    });

    test("separate counters", async () => {
        const a = createMeasure("a");
        const b = createMeasure("b");
        a.resetCounter(); b.resetCounter();
        const out = captureConsole();
        await a.measure("x", async () => 1);
        await b.measure("y", async () => 2);
        await a.measure("z", async () => 3);
        out.restore();
        expect(out.logs[0]).toBe("[a:a] ... x");
        expect(out.logs[2]).toBe("[b:a] ... y");
        expect(out.logs[4]).toBe("[a:b] ... z");
    });

    test("scoped maxResultLength truncates results", () => {
        const s = createMeasure("s", { maxResultLength: 15 });
        s.resetCounter();
        const out = captureConsole();
        s.measureSync("op", () => ({ data: "x".repeat(50) }));
        out.restore();
        expect(out.logs[0]).toContain("…");
    });

    test("scoped maxResultLength inherits to children", () => {
        const s = createMeasure("s", { maxResultLength: 15 });
        s.resetCounter();
        const out = captureConsole();
        s.measureSync("parent", (m) => {
            m("child", () => ({ data: "x".repeat(50) }));
            return 1;
        });
        out.restore();
        const childLine = out.logs[1];
        expect(childLine).toContain("…");
    });

    test("per-label maxResultLength overrides scoped", () => {
        const s = createMeasure("s", { maxResultLength: 15 });
        s.resetCounter();
        const out = captureConsole();
        s.measureSync({ label: "op", maxResultLength: 500 }, () => ({ data: "x".repeat(50) }));
        out.restore();
        expect(out.logs[0]).not.toContain("…");
    });

    test("scoped maxResultLength works with async measure", async () => {
        const s = createMeasure("s", { maxResultLength: 15 });
        s.resetCounter();
        const out = captureConsole();
        await s.measure("op", async () => ({ data: "x".repeat(50) }));
        out.restore();
        expect(out.logs[1]).toContain("…");
    });
});

// ─── measure.retry ───────────────────────────────────────────────────

describe("measure.retry", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("succeeds first try", async () => {
        const out = captureConsole();
        const r = await measure.retry("op", { attempts: 3, delay: 10 }, async () => 42);
        out.restore();
        expect(r).toBe(42);
        expect(out.logs[1]).not.toContain("✗");
        expect(out.logs[0]).toContain("[1/3]");
    });

    test("retries then succeeds", async () => {
        let n = 0;
        const out = captureConsole();
        const r = await measure.retry("flaky", { attempts: 3, delay: 10 }, async () => {
            if (++n < 3) throw new Error("fail");
            return "ok";
        });
        out.restore();
        expect(r).toBe("ok");
        expect(out.logs.filter(l => l.includes("✗")).length).toBe(2);
        expect(out.logs.filter(l => !l.includes("✗") && !l.includes("...")).length).toBe(1);
    });

    test("all attempts exhausted returns null", async () => {
        const out = captureConsole();
        const r = await measure.retry("fail", { attempts: 2, delay: 10 }, async () => { throw new Error("x"); });
        out.restore();
        expect(r).toBeNull();
    });
});

// ─── measure.assert ──────────────────────────────────────────────────

describe("measure.assert", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("returns on success", async () => {
        const out = captureConsole();
        const r = await measure.assert("op", async () => 42);
        out.restore();
        expect(r).toBe(42);
    });

    test("throws on error with original cause", async () => {
        const out = captureConsole();
        const original = new Error("connection refused");
        try {
            await measure.assert("fail", async () => { throw original; });
            expect(true).toBe(false);
        } catch (e: any) {
            expect(e.message).toContain("fail");
            expect(e.cause).toBe(original);
        }
        out.restore();
    });

    test("sync assert", () => {
        const out = captureConsole();
        expect(measureSync.assert("op", () => 42)).toBe(42);
        out.restore();
    });

    test("sync assert throws with original cause", () => {
        const out = captureConsole();
        const original = new Error("parse error");
        try {
            measureSync.assert("fail", () => { throw original; });
            expect(true).toBe(false);
        } catch (e: any) {
            expect(e.message).toContain("fail");
            expect(e.cause).toBe(original);
        }
        out.restore();
    });
});

// ─── onError (3rd argument) ──────────────────────────────────────────

describe("onError (3rd argument)", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("returns fallback from onError on failure", async () => {
        const out = captureConsole();
        const result = await measure('Fetch user', async () => {
            throw new Error('not found');
        }, () => 'fallback');
        out.restore();
        expect(result).toBe('fallback' as any);
    });

    test("returns normal result on success (onError ignored)", async () => {
        const out = captureConsole();
        const result = await measure('Fetch user', async () => 42, () => -1);
        out.restore();
        expect(result).toBe(42);
    });

    test("error object is passed to onError handler", async () => {
        const out = captureConsole();
        const original = new Error('network timeout');
        let captured: unknown = null;
        await measure('Fetch', async () => { throw original; }, (err) => {
            captured = err;
            return null;
        });
        out.restore();
        expect(captured).toBe(original);
    });

    test("onError rethrow returns null (caught by safety net)", async () => {
        const out = captureConsole();
        const result = await measure('Op', async () => { throw new Error('critical'); }, (e) => { throw e; });
        out.restore();
        expect(result).toBeNull();
    });

    test("onError can inspect error type and recover", async () => {
        const out = captureConsole();
        const result = await measure('Fetch', async () => {
            throw new TypeError('invalid');
        }, (error) => {
            if (error instanceof TypeError) return 'recovered';
            throw error;
        });
        out.restore();
        expect(result).toBe('recovered' as any);
    });

    test("still logs error even when onError handles it", async () => {
        const events: any[] = [];
        configure({ logger: (e) => events.push(e) });
        await measure('Op', async () => { throw new Error('x'); }, () => 'fallback');
        configure({ logger: null });
        const errorEvent = events.find(e => e.type === 'error');
        expect(errorEvent).toBeTruthy();
        expect(errorEvent.label).toBe('Op');
    });

    test("Bun.serve pattern with onError fallback", async () => {
        const out = captureConsole();
        const result = await measure(
            { label: 'Handle request' },
            async () => {
                throw new Error('route error');
                return new Response('ok');
            },
            (error) => new Response(`Error: ${(error as Error).message}`, { status: 500 })
        );
        out.restore();
        expect(result).toBeInstanceOf(Response);
        expect(result!.status).toBe(500);
        expect(await result!.text()).toContain('route error');
    });

    test("if onError itself throws, returns null instead of crashing", async () => {
        const out = captureConsole();
        const result = await measure('Primary DB', async () => {
            throw new Error('primary failed');
        }, (error) => {
            // fallback DB call also fails
            throw new Error('backup DB also failed');
        });
        out.restore();
        expect(result).toBeNull();
        // should log both errors
        expect(out.errors.some(l => l.includes('primary failed'))).toBe(true);
        expect(out.errors.some(l => l.includes('backup DB also failed'))).toBe(true);
    });
});

// ─── timeout ─────────────────────────────────────────────────────────

describe("timeout", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("aborts and returns null if function exceeds timeout", async () => {
        const out = captureConsole();
        const result = await measure(
            { label: 'Slow op', timeout: 50 },
            async () => {
                await new Promise(r => setTimeout(r, 200));
                return 'done';
            }
        );
        out.restore();
        expect(result).toBeNull();
        expect(out.errors.some(l => l.includes('Timeout'))).toBe(true);
    });

    test("succeeds if function completes within timeout", async () => {
        const out = captureConsole();
        const result = await measure(
            { label: 'Fast op', timeout: 200 },
            async () => {
                await new Promise(r => setTimeout(r, 10));
                return 'done';
            }
        );
        out.restore();
        expect(result).toBe('done');
    });

    test("timeout with onError returns fallback", async () => {
        const out = captureConsole();
        const result = await measure(
            { label: 'Slow op', timeout: 50 },
            async () => {
                await new Promise(r => setTimeout(r, 200));
                return 'done';
            },
            (error) => 'timed-out'
        );
        out.restore();
        expect(result).toBe('timed-out');
    });
});
// ─── measure.wrap ────────────────────────────────────────────────────

describe("measure.wrap", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("wraps async function", async () => {
        const fn = async (x: number) => x * 2;
        const wrapped = measure.wrap("double", fn);
        const out = captureConsole();
        const r = await wrapped(21);
        out.restore();
        expect(r).toBe(42);
        expect(out.logs[0]).toBe("[a] ... double");
        expect(out.logs[1]).not.toContain("✗");
    });

    test("multiple calls get sequential IDs", async () => {
        const fn = async (x: number) => x;
        const wrapped = measure.wrap("op", fn);
        const out = captureConsole();
        await wrapped(1);
        await wrapped(2);
        out.restore();
        expect(out.logs[0]).toStartWith("[a]");
        expect(out.logs[2]).toStartWith("[b]");
    });

    test("sync wrap", () => {
        const fn = (x: number) => x * 3;
        const wrapped = measureSync.wrap("triple", fn);
        const out = captureConsole();
        const r = wrapped(7);
        out.restore();
        expect(r).toBe(21);
        expect(out.logs[0]).toContain("······");
    });
});

// ─── measure.batch ───────────────────────────────────────────────────

describe("measure.batch", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("processes all items", async () => {
        const out = captureConsole();
        const results = await measure.batch("process", [1, 2, 3], async (n) => n * 2);
        out.restore();
        expect(results).toEqual([2, 4, 6]);
        expect(out.logs[0]).toContain("3 items");
        expect(out.logs.at(-1)).toContain("3/3 ok");
    });

    test("handles errors in items", async () => {
        const out = captureConsole();
        const results = await measure.batch("process", [1, 2, 3], async (n) => {
            if (n === 2) throw new Error("bad");
            return n;
        });
        out.restore();
        expect(results).toEqual([1, null, 3]);
        expect(out.logs.at(-1)).toContain("2/3 ok");
    });

    test("logs progress annotations", async () => {
        const out = captureConsole();
        await measure.batch("items", Array.from({ length: 10 }, (_, i) => i), async (n) => n, { every: 3 });
        out.restore();
        const annotations = out.logs.filter(l => l.includes("="));
        expect(annotations.length).toBeGreaterThan(0);
        expect(annotations[0]).toContain("3/10");
    });
});

// ─── Silent mode ─────────────────────────────────────────────────────

describe("silent mode", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("no output", async () => {
        configure({ silent: true });
        const out = captureConsole();
        expect(await measure("op", async () => 42)).toBe(42);
        out.restore();
        expect(out.logs.length).toBe(0);
    });
});

// ─── Custom logger ───────────────────────────────────────────────────

describe("custom logger", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("receives events with result", async () => {
        const events: MeasureEvent[] = [];
        configure({ logger: (e) => events.push(e) });
        await measure("op", async () => 42);
        expect(events[1]).toMatchObject({ type: 'success', result: 42 });
    });

    test("receives budget in events", async () => {
        const events: MeasureEvent[] = [];
        configure({ logger: (e) => events.push(e) });
        await measure({ label: "op", budget: 100 }, async () => 1);
        expect(events[1]!.budget).toBe(100);
    });
});

// ─── measure.timed ───────────────────────────────────────────────────

describe("timed variants", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("async timed", async () => {
        const out = captureConsole();
        const { result, duration } = await measure.timed("op", async () => 42);
        out.restore();
        expect(result).toBe(42);
        expect(duration).toBeGreaterThanOrEqual(0);
    });

    test("sync timed", () => {
        const out = captureConsole();
        const { result, duration } = measureSync.timed("op", () => 100);
        out.restore();
        expect(result).toBe(100);
        expect(duration).toBeGreaterThanOrEqual(0);
    });
});

// ─── ID generation ───────────────────────────────────────────────────

describe("ID generation", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("wraps past z", async () => {
        const out = captureConsole();
        for (let i = 0; i < 28; i++) await measure(`op-${i}`, async () => null);
        out.restore();
        expect(out.logs[0]).toStartWith("[a]");
        expect(out.logs[50]).toStartWith("[z]");
        expect(out.logs[52]).toStartWith("[aa]");
    });
});

// ─── Bun.serve patterns ─────────────────────────────────────────────

describe("Bun.serve pattern", () => {
    beforeEach(() => {
        resetCounter();
        configure({ silent: false, logger: null, timestamps: false });
    });

    test("measure returns null on error — breaks fetch handler", async () => {
        const out = captureConsole();
        const result = await measure("handle", async () => {
            throw new Error("route error");
            return new Response("ok");
        });
        out.restore();
        expect(result).toBeNull(); // Bun.serve would crash with null
    });

    test("measure.assert returns Response on success", async () => {
        const out = captureConsole();
        const result = await measure.assert("handle", async () => {
            return new Response("ok");
        });
        out.restore();
        expect(result).toBeInstanceOf(Response);
        expect(await result.text()).toBe("ok");
    });

    test("measure.assert throws on error with cause — Bun.serve can catch it", async () => {
        const out = captureConsole();
        const original = new Error("route error");
        try {
            await measure.assert("handle", async () => {
                throw original;
                return new Response("ok");
            });
            expect(true).toBe(false); // should not reach
        } catch (e: any) {
            expect(e.message).toContain("handle");
            expect(e.cause).toBe(original);
        }
        out.restore();
    });

    test("nullish coalescing fallback pattern", async () => {
        const out = captureConsole();
        const result = (await measure("handle", async () => {
            throw new Error("route error");
            return new Response("ok");
        })) ?? new Response("Internal Server Error", { status: 500 });
        out.restore();
        expect(result).toBeInstanceOf(Response);
        expect(result.status).toBe(500);
        expect(await result.text()).toBe("Internal Server Error");
    });
});
