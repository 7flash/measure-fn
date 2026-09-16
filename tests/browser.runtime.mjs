import { configure, createMeasure, safeStringify } from "measure-fn";

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function rejectedWith(operation, expected) {
  try { await operation(); } catch (error) {
    assert(error === expected, "The original callback error must be preserved");
    return;
  }
  throw new Error("Expected the operation to reject");
}

/** Runs inside the browser or worker; contains no Node imports or test shims. */
export async function runBrowserContracts() {
  const checks = [];
  const unhandled = [];
  const onUnhandled = (event) => unhandled.push(String(event.reason));
  globalThis.addEventListener("unhandledrejection", onUnhandled);

  async function check(name, run) {
    const events = [];
    configure({ silent: false, colors: false, timestamps: false, errorDetails: false, summarize: false,
      logger: (event) => events.push(event), onLoggerError: null });
    try {
      await run(createMeasure("browser-check"), events);
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, error: String(error?.stack ?? error) });
    }
  }

  try {
    await check("native browser globals, results, and timing", async (m, events) => {
      assert(typeof globalThis.process === "undefined" && typeof globalThis.require === "undefined", "Node globals must be absent");
      const result = { ok: true };
      assert(m.sync("sync", () => result) === result, "Sync result identity");
      const timed = await m.timed("async", async () => { await sleep(); return result; });
      assert(timed.result === result, "Async result identity");
      assert(Number.isFinite(timed.duration) && timed.duration >= 0, "Finite native timing");
      assert(events.at(-1).duration === timed.duration, "Reported and returned duration agree");
    });

    await check("synchronous nesting and the explicit await boundary", async (m, events) => {
      await m.root("parent", async () => {
        m.sync("before", () => 1);
        await Promise.resolve();
        m.sync("after", () => 2);
      });
      const starts = events.filter((event) => event.type === "start");
      assert(starts[1].parentId === starts[0].id, "Immediate child has its parent");
      assert(starts[2].parentId === undefined, "Unbound work after await has no ambient parent");
      assert(starts[2].traceId !== starts[0].traceId, "Unbound work starts a new trace");
    });

    await check("overlapping roots and explicitly bound grandchildren", async (m, events) => {
      const db = createMeasure("browser-db");
      await Promise.all(["A", "B", "C"].map((label, index) => m.root(label, async () => {
        const child = db.bindContext();
        await sleep(3 - index);
        await child(label + " child", async () => {
          const grandchild = m.bindContext();
          await Promise.resolve();
          await grandchild(label + " grandchild", () => 42);
        });
      })));
      const start = (label) => events.find((event) => event.type === "start" && event.label === label);
      for (const label of ["A", "B", "C"]) {
        const parent = start(label), child = start(label + " child"), grandchild = start(label + " grandchild");
        assert(child.parentId === parent.id && grandchild.parentId === child.id, "Correct direct parents");
        assert(child.traceId === parent.traceId && grandchild.traceId === parent.traceId, "One trace per root");
      }
      assert(new Set(["A", "B", "C"].map((label) => start(label).traceId)).size === 3, "Roots remain isolated");
    });

    await check("a binding retains its parent under another active root", async (m, events) => {
      let bound;
      await m.root("original", () => { bound = m.bindContext(); });
      await m.root("other", () => bound("captured child", () => 1));
      const starts = events.filter((event) => event.type === "start");
      assert(starts[2].parentId === starts[0].id, "The captured parent takes precedence");
    });

    await check("callback failure propagates unchanged through nested spans", async (m, events) => {
      const error = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
      await rejectedWith(() => m.root("cycle", async () => {
        const read = m.bindContext();
        await sleep();
        return read("read candle", () => { throw error; });
      }), error);
      const failures = events.filter((event) => event.type === "error");
      assert(failures.length === 2 && failures.every((event) => event.error === error), "Both spans observe the same failure");
    });

    await check("a handled read failure does not stop the next cycle", async (m) => {
      const failure = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
      const outcomes = [];
      for (let cycle = 0; cycle < 2; cycle++) {
        try {
          outcomes.push(await m.root("read-only cycle", async () => {
            await sleep();
            if (cycle === 0) throw failure;
            return "fresh data";
          }));
        } catch (error) {
          // This fixture is explicitly read-only. A transaction needs reconciliation.
          if (error !== failure) throw error;
          outcomes.push("deferred");
        }
      }
      assert(outcomes.join(",") === "deferred,fresh data", "The outer boundary owns recovery");
    });

    await check("throwing loggers cannot alter successful or failed work", async (m) => {
      configure({ logger: () => { throw new Error("Broken log sink"); } });
      assert(await m("success", () => 42) === 42, "Logger does not block the callback");
      const original = new Error("Application failure");
      await rejectedWith(() => m("failure", () => { throw original; }), original);
    });

    await check("rejected logger and diagnostic promises are contained", async (m) => {
      let diagnostics = 0;
      configure({
        logger: async () => { throw new Error("Async log sink"); },
        onLoggerError: async () => { diagnostics++; throw new Error("Async diagnostic sink"); },
      });
      assert(await m("success", () => 42) === 42, "Rejected logging preserves the result");
      await sleep();
      assert(diagnostics === 2, "Start and terminal logging failures were reported");
    });

    await check("summarized errors display their message", async (m) => {
      const output = [];
      const originalLog = console.log, originalError = console.error;
      console.log = (...args) => output.push(args.map(String).join(" "));
      console.error = (...args) => output.push(args.map(String).join(" "));
      try {
        configure({ logger: null, summarize: true });
        const error = { name: "Error", message: "Connection reset", code: "ECONNRESET" };
        await rejectedWith(() => m("read", () => { throw error; }), error);
        assert(output.some((line) => line.includes("(Connection reset)")), "Readable error header");
        assert(output.every((line) => !line.includes("[object Object]")), "No implicit object stringification");
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    });

    await check("explicit retry recovery runs once after exhaustion", async (m) => {
      let attempts = 0, recovered = 0;
      const error = new Error("Read unavailable");
      const result = await m.retry({ start: () => "read", catch: (caught) => {
        assert(caught === error, "Recovery sees the original failure"); recovered++; return "deferred";
      } }, { attempts: 3, delay: 1 }, () => { attempts++; throw error; });
      assert(attempts === 3 && recovered === 1 && result === "deferred", "Bounded attempts and one recovery");
    });

    await check("timeouts reject without pretending to cancel the callback", async (m) => {
      let release, finished = false, failure;
      const gate = new Promise((resolve) => { release = resolve; });
      try {
        await m({ start: () => "deadline", timeout: 5 }, async () => { await gate; finished = true; });
      } catch (error) { failure = error; }
      finally { release(); }
      assert(failure instanceof Error && failure.message.startsWith("Timeout"), "The deadline rejects");
      await sleep();
      assert(finished, "The callback can finish after the measurement deadline");
    });

    await check("native collections, errors, and shared objects serialize safely", async () => {
      const shared = { amount: 7n };
      const value = { first: shared, second: shared, map: new Map([["token", "secret"]]), error: new Error("Read failed") };
      const encoded = safeStringify(value);
      assert(!encoded.includes("[Circular]") && !encoded.includes("secret"), "Shared values survive and credential keys redact");
      assert(encoded.includes("Read failed"), "Native error message survives serialization");
    });

    // Let the browser dispatch any unhandled rejection events from failed hooks.
    await sleep(20);
    checks.push({ name: "no unhandled promise rejections", passed: unhandled.length === 0, errors: unhandled });
    return { environment: typeof document === "undefined" ? "worker" : "page",
      userAgent: navigator.userAgent, passed: checks.filter((check) => check.passed).length,
      failed: checks.filter((check) => !check.passed).length, checks };
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
    configure({ silent: true, logger: null, onLoggerError: null });
  }
}
