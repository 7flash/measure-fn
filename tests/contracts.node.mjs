import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  configure, createMeasure, measure, measureSync, safeStringify,
  summarizeForMeasure, formatDuration, silent,
} from "../dist/index.js";

let events;
const originalLog = console.log;
const originalError = console.error;
const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const starts = () => events.filter((event) => event.type === "start");
const terminal = () => events.filter((event) => event.type === "success" || event.type === "error");

beforeEach(() => {
  events = [];
  configure({
    silent: false, logger: (event) => events.push(event), onLoggerError: null,
    colors: false, timestamps: false, summarize: false, stripScopePrefix: false,
    maxResultLength: 0, maxSummaryDepth: 4, maxSummaryStringLength: 160,
    summaryArraySample: 2, summaryObjectKeys: 24,
    sensitiveKeyPattern: /secret|private|mnemonic|seed|keypair|password|authorization|cookie|token|apikey|api_key/i,
  });
});
afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  if (originalForceColor === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = originalForceColor;
});

test("callbacks preserve results, aliases, and original errors", async () => {
  const m = createMeasure("api");
  const object = { value: 42 };
  assert.equal(await m("async", () => object), object);
  assert.equal(m.sync("sync", () => object), object);
  assert.equal(m.measure, m);
  assert.equal(m.measureSync, m.sync);
  const error = new Error("original");
  await assert.rejects(m("failure", () => { throw error; }), (e) => e === error);
  assert.throws(() => m.sync("failure", () => { throw error; }), (e) => e === error);
});

test("annotations return null and have normalized payload aliases", async () => {
  const m = createMeasure("notes");
  assert.equal(await m("ready"), null);
  assert.equal(m.sync("ready"), null);
  m.note({ start: () => ({ phase: 1 }) });
  m.sync.note("checkpoint");
  assert.equal(events.length, 4);
  assert.ok(events.every((e) => e.type === "annotation" && e.data === e.value));
});

test("event data aliases mapped results and errors without changing returned values", async () => {
  const result = { count: 2, internal: true };
  assert.equal(await measure({ start: () => null, end: (r) => ({ count: r.count }) }, () => result), result);
  assert.equal(events[0].data, null);
  assert.equal(events[0].data, events[0].value);
  assert.equal(events[1].data, events[1].result);
  assert.deepEqual(events[1].result, { count: 2 });
  await assert.rejects(measure("failure", () => { throw new Error("boom"); }));
  assert.equal(events.at(-1).error, events.at(-1).data);
});

test("start, success, and error logger failures cannot replace business outcomes", async () => {
  const diagnostics = [];
  configure({ logger: () => { throw new Error("logger"); }, onLoggerError: (error, event) => diagnostics.push([error.message, event.type]) });
  assert.equal(await measure("work", () => 42), 42);
  const failure = { original: true };
  await assert.rejects(measure("work", () => { throw failure; }), (e) => e === failure);
  assert.equal(measureSync("work", () => 7), 7);
  assert.deepEqual(diagnostics.map((d) => d[1]), ["start", "success", "start", "error", "start", "success"]);
});

test("async logger and diagnostic rejections are observed without unhandled rejections", async () => {
  let failures = 0;
  configure({
    logger: async () => { throw new Error("async logger"); },
    onLoggerError: async () => { failures++; throw new Error("diagnostic"); },
  });
  assert.equal(await measure("work", () => 1), 1);
  await sleep(0);
  assert.equal(failures, 2);
});

test("broken console output and reentrant loggers do not stop work", async () => {
  console.log = () => { throw new Error("output closed"); };
  console.error = console.log;
  configure({ logger: null });
  assert.equal(await measure("work", () => 1), 1);
  let calls = 0;
  configure({ logger: () => { calls++; measureSync("logger internals", () => 2); } });
  assert.equal(measureSync("work", () => 3), 3);
  assert.equal(calls, 2);
});

test("middleware delegates at most once and can filter labels and data", () => {
  const lines = [];
  console.log = (line) => lines.push(line);
  configure({ logger: (event, next) => {
    if (event.label === "hidden" || event.data?.internal) return;
    next(); next();
  } });
  measureSync("hidden", () => 1);
  measureSync("visible", () => ({ internal: true }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /→ visible$/);
});

test("silent measurements preserve work, recovery, and hierarchy while skipping mappers", async () => {
  let mapped = 0;
  configure({ silent: true });
  const action = { start: () => { mapped++; }, end: () => { mapped++; }, catch: () => 9 };
  assert.equal(await measure(action, () => 2), 2);
  assert.equal(await measure(action, () => { throw 1; }), 9);
  assert.equal(measureSync(action, () => 3), 3);
  assert.equal(mapped, 0);
  assert.equal(events.length, 0);
});

test("mapper failures produce diagnostics and preserve the business result", async () => {
  const action = { start: () => { throw new Error("label"); }, end: () => { throw new Error("result"); } };
  assert.equal(await measure(action, () => 42), 42);
  assert.match(events[0].label, /startMapperError/);
  assert.deepEqual(events[1].result, { resultMapperError: "result" });
});

test("rejected async mappers are consumed and identified", async () => {
  assert.equal(await measure({ start: async () => { throw 1; }, end: async () => { throw 2; } }, () => 42), 42);
  await sleep(0);
  assert.match(events[0].label, /synchronously/);
  assert.match(events[1].result.resultMapperError, /synchronously/);
});

test("automatic cross-scope nesting continues after await", async () => {
  const api = createMeasure("api"); const db = createMeasure("db");
  await api.root("request", async () => {
    await sleep(0);
    await db("query", async () => { await sleep(0); db.sync("decode", () => 1); });
  });
  assert.deepEqual(starts().map((e) => e.id), ["api:a", "db:a-a", "db:a-a-a"]);
  assert.equal(new Set(events.map((e) => e.traceId)).size, 1);
  assert.deepEqual(starts().map((e) => e.parentId), [undefined, "api:a", "db:a-a"]);
});

test("overlapping roots and parallel children stay in their own trace", async () => {
  const api = createMeasure("api"); const db = createMeasure("db");
  await Promise.all(["A", "B"].map((label) => api.root(label, async () => {
    await sleep(label === "A" ? 4 : 0);
    await Promise.all([db(`${label}1`, async () => { await sleep(2); }), db(`${label}2`, () => 2)]);
  })));
  for (const label of ["A", "B"]) {
    const root = starts().find((e) => e.label === label);
    const children = starts().filter((e) => e.label.startsWith(label) && e !== root);
    assert.deepEqual(children.map((e) => e.rawId), [`${root.rawId}-a`, `${root.rawId}-b`]);
    assert.ok(children.every((e) => e.traceId === root.traceId && e.parentId === root.id));
  }
});

test("detached roots restore their outer context", async () => {
  const m = createMeasure("app");
  await m.root("outer", async () => {
    await m.root("detached", () => 1);
    await m("child", () => 2);
  });
  assert.deepEqual(starts().map((e) => e.id), ["app:a", "app:b", "app:a-a"]);
  assert.notEqual(starts()[0].traceId, starts()[1].traceId);
  assert.equal(starts()[0].traceId, starts()[2].traceId);
});

test("display counter resets and independent scopes cannot collide in trace IDs", async () => {
  const a = createMeasure("a"); const b = createMeasure("b");
  await a("one", () => 1); await b("two", () => 2); a.resetCounter(); await a("three", () => 3);
  assert.deepEqual(starts().map((e) => e.id), ["a:a", "b:a", "a:a"]);
  assert.equal(new Set(starts().map((e) => e.traceId)).size, 3);
});

test("bound context preserves its captured parent under another active root", async () => {
  const m = createMeasure("api"); let bound;
  await m.root("first", () => { bound = m.bindContext(); });
  await m.root("second", async () => { await bound("child", () => 1); });
  assert.equal(starts()[2].parentId, starts()[0].id);
  assert.equal(starts()[2].traceId, starts()[0].traceId);
});

test("binding outside any span retains a root context", async () => {
  const m = createMeasure("api"); const root = m.bindContext();
  await m("outer", () => root("independent", () => 1));
  assert.equal(starts()[1].parentId, undefined);
  assert.notEqual(starts()[1].traceId, starts()[0].traceId);
});

test("sync nesting and alphabet rollover remain compatible", () => {
  const m = createMeasure("s");
  m.sync.root("parent", () => { for (let i = 0; i < 27; i++) m.sync("leaf", () => i); });
  assert.equal(starts().at(-1).rawId, "a-aa");
  assert.ok(starts().slice(1).every((e) => e.parentId === "s:a"));
});

test("sync recovery, async recovery, and recovery errors are explicit", async () => {
  assert.equal(measureSync({ catch: () => 3 }, () => { throw 1; }), 3);
  assert.equal(await measure({ catch: async () => 4 }, () => { throw 1; }), 4);
  const recoveryError = new Error("recovery");
  await assert.rejects(measure({ catch: () => { throw recoveryError; } }, () => { throw 1; }), (e) => e === recoveryError);
});

test("sync APIs reject asynchronous callbacks and recovery without orphaned rejection", async () => {
  assert.throws(() => measureSync("bad", async () => { throw 1; }), /callback must return synchronously/);
  assert.throws(() => measureSync({ catch: async () => { throw 2; } }, () => { throw 1; }), /catch\(\) must return synchronously/);
  await sleep(0);
});

test("timeouts settle once, permit recovery, and do not cancel the callback", async () => {
  let completed = false;
  assert.equal(await measure({ timeout: 2, catch: () => "fallback" }, async () => { await sleep(15); completed = true; return "late"; }), "fallback");
  await sleep(25);
  assert.equal(completed, true);
  assert.deepEqual(terminal().map((e) => e.type), ["error"]);
});

test("fast success and rejection release long timeout timers", () => {
  const source = `import {configure,measure} from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
    configure({silent:true});
    await measure({timeout:60000},()=>42);
    try { await measure({timeout:60000},()=>{throw 1}); } catch {}
    try { await measure({timeout:60000},async()=>{throw 2}); } catch {}`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], { timeout: 3000, encoding: "utf8" });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});

test("timed duration matches its event and excludes start/end observer work", async () => {
  let fakeTime = 100;
  const old = globalThis.performance;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => fakeTime } });
  try {
    configure({ logger: (e) => { events.push(e); fakeTime += 100; } });
    const action = { start: () => { fakeTime += 50; return "work"; }, end: (r) => { fakeTime += 70; return r; } };
    const sync = measureSync.timed(action, () => { fakeTime += 5; return 42; });
    const async = await measure.timed(action, () => { fakeTime += 7; return 43; });
    assert.equal(sync.duration, 5); assert.equal(async.duration, 7);
    assert.deepEqual(terminal().map((e) => e.duration), [5, 7]);
  } finally { Object.defineProperty(globalThis, "performance", { configurable: true, value: old }); }
});

test("wrap preserves this and arguments for sync and async methods", async () => {
  const object = { factor: 7 };
  object.sync = measureSync.wrap("multiply", function (n) { return this.factor * n; });
  object.async = measure.wrap("multiply", async function (n) { return this.factor * n; });
  assert.equal(object.sync(6), 42); assert.equal(await object.async(6), 42);
});

test("retry uses exact attempts and only recovers after exhaustion", async () => {
  let attempts = 0; let recovered = 0;
  const error = new Error("retry");
  const result = await measure.retry({ start: () => "request", catch: (e) => { assert.equal(e, error); recovered++; return 5; } }, { attempts: 3, delay: 0 }, () => { attempts++; throw error; });
  assert.equal(result, 5); assert.equal(attempts, 3); assert.equal(recovered, 1);
  assert.equal(terminal().length, 3);
  assert.equal(starts().at(-1).label, "request [3/3]");
});

test("retry returns an early success and preserves the final thrown value", async () => {
  let n = 0;
  assert.equal(await measure.retry("retry", { attempts: 3, delay: 0 }, () => { if (++n < 2) throw 1; return 42; }), 42);
  assert.equal(n, 2);
  const original = { failed: true };
  await assert.rejects(measure.retry("retry", { attempts: 2, delay: 0 }, () => { throw original; }), (e) => e === original);
});

test("batch preserves order, continues after failures, and counts fulfilled null as success", async () => {
  let summary;
  const result = await measure.batch({ end: (s) => { summary = s; return s; } }, [1, 2, 3, 4], (n) => { if (n === 2) throw 1; return n === 3 ? null : n; }, { every: 1 });
  assert.deepEqual(result, [1, null, null, 4]);
  assert.equal(summary.ok, 3); assert.equal(summary.total, 4);
  assert.match(events.find((e) => e.type === "annotation" && e.label.startsWith("3/4")).label, /2 ok/);
});

test("empty batches succeed and action objects use a useful default summary", async () => {
  assert.deepEqual(await measure.batch({ start: () => "empty" }, [], () => 1), []);
  assert.equal(terminal()[0].result, "0/0 ok");
});

test("invalid numeric settings fail before side effects and configuration is atomic", async () => {
  let called = 0; const fn = () => { called++; return 1; };
  for (const attempts of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(measure.retry("bad", { attempts }, fn), RangeError);
  for (const every of [0, -1, 1.5, Infinity]) await assert.rejects(measure.batch("bad", [1], fn, { every }), RangeError);
  for (const timeout of [-1, NaN, Infinity, 2 ** 31]) await assert.rejects(measure({ timeout }, fn), RangeError);
  assert.throws(() => measureSync({ timeout: 1 }, fn), /does not support timeout/);
  assert.throws(() => configure({ silent: true, maxSummaryDepth: NaN }), RangeError);
  assert.throws(() => configure({ silent: true, sensitiveKeyPattern: "[" }), SyntaxError);
  assert.equal(silent, false); assert.equal(called, 0);
});

test("safe serialization covers primitives, dates, Errors, maps, sets, and invalid dates", () => {
  assert.equal(safeStringify(undefined), ""); assert.equal(safeStringify(null), "null");
  assert.equal(safeStringify(10n), "10n"); assert.equal(safeStringify("hi"), '"hi"');
  assert.equal(safeStringify(NaN), "NaN"); assert.equal(safeStringify(Infinity), "Infinity");
  assert.deepEqual(JSON.parse(safeStringify({ value: Infinity })), { value: "Infinity" });
  assert.equal(safeStringify(new Date(NaN)), '"Invalid Date"');
  assert.match(safeStringify(new Error("boom")), /boom/);
  assert.match(safeStringify(new Map([["x", 1]])), /entries/);
  assert.match(safeStringify(new Set([1, 2])), /values/);
});

test("only true ancestor cycles are marked circular", () => {
  const shared = { n: 1 };
  assert.deepEqual(JSON.parse(safeStringify({ a: shared, b: shared })), { a: shared, b: shared });
  const array = []; array.push(array);
  const map = new Map(); map.set("self", map);
  const set = new Set(); set.add(set);
  const error = new Error("cycle"); error.cause = error;
  for (const value of [array, map, set, error]) {
    assert.match(safeStringify(value), /Circular/);
    assert.match(JSON.stringify(summarizeForMeasure(value)), /Circular/);
  }
});

test("getters and toJSON cannot run while formatting or expose redacted properties", () => {
  let calls = 0;
  const object = { get payload() { calls++; throw 1; }, get token() { calls++; return "leak"; }, toJSON() { calls++; return "leak"; } };
  const text = safeStringify(object);
  assert.equal(calls, 0); assert.doesNotMatch(text, /leak/); assert.match(text, /Accessor/);
});

test("hostile objects and proxies cannot replace a measured result", async () => {
  const proxy = new Proxy({}, { ownKeys() { throw new Error("hostile"); }, get() { throw 1; } });
  assert.equal(safeStringify(proxy), '"[Unserializable]"');
  const object = Object.create(null); object.self = object;
  assert.match(safeStringify(object), /Circular/);
  configure({ summarize: true });
  const result = { get unreadable() { throw 1; }, date: new Date(NaN) };
  assert.equal(await measure("work", () => result), result);
});

test("redaction patterns are stateless, caller-owned regexes are not mutated, and maps redact", () => {
  const pattern = /token/g; pattern.lastIndex = 3;
  configure({ sensitiveKeyPattern: pattern });
  assert.deepEqual(JSON.parse(safeStringify({ token: "one", tokens: "two" })), { token: "[omitted]", tokens: "[omitted]" });
  assert.equal(pattern.lastIndex, 3);
  assert.doesNotMatch(safeStringify(new Map([["token", "secret-value"]])), /secret-value/);
});

test("prototype-shaped keys remain ordinary data", () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
  const summary = summarizeForMeasure(input);
  assert.equal(Object.getPrototypeOf(summary), Object.prototype);
  assert.equal(Object.hasOwn(summary, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});

test("caps include ellipsis and summary sampling respects its limits", () => {
  for (const limit of [1, 2, 5, 20]) for (const value of ["x".repeat(100), { long: "x".repeat(100) }, 123456789n]) assert.ok(safeStringify(value, limit).length <= limit);
  assert.equal(safeStringify("x".repeat(100), 0).length, 102);
  configure({ summaryArraySample: 1 });
  assert.equal(summarizeForMeasure(new Map([[1, 1], [2, 2]])).sample.length, 1);
  configure({ summaryArraySample: 0 });
  assert.deepEqual(summarizeForMeasure(new Set([1, 2])).sample, []);
});

test("per-action summary override applies equally to events and built-in output", () => {
  const lines = [];
  console.log = (line) => lines.push(line);
  configure({ summarize: true, maxSummaryStringLength: 5, logger: (event, next) => { events.push(event); next(); } });
  measureSync({ start: () => "raw", summarize: false }, () => ({ value: "abcdefghijk" }));
  assert.equal(terminal()[0].result.value, "abcdefghijk");
  assert.match(lines[1], /abcdefghijk/);
  measureSync("summary", () => ({ value: "abcdefghijk" }));
  assert.equal(terminal()[1].result.value, "abcd…");
});

test("summarized errors keep a readable compact message and redact detailed causes", () => {
  const lines = []; const details = [];
  console.log = (line) => lines.push(line); console.error = (...args) => details.push(args.join(" "));
  configure({ summarize: true, logger: null });
  assert.throws(() => measureSync("failure", () => { throw new Error("boom", { cause: { token: "sensitive-value" } }); }));
  assert.match(lines[1], /\(boom\)/); assert.doesNotMatch(details.join("\n"), /sensitive-value/);
});

test("detailed raw Error causes also use redacted formatting", () => {
  const details = [];
  console.log = () => {}; console.error = (...args) => details.push(args.join(" "));
  configure({ logger: null });
  assert.throws(() => measureSync("failure", () => { throw new Error("boom", { cause: { token: "sensitive-value" } }); }));
  assert.match(details[0], /boom/); assert.doesNotMatch(details.join("\n"), /sensitive-value/);
});

test("timestamps, compact markers, scope-prefix stripping, and budget warnings work", () => {
  const lines = []; console.log = (line) => lines.push(line);
  configure({ logger: null, timestamps: true, stripScopePrefix: true });
  createMeasure("api").sync({ start: () => "api:work", budget: 0 }, () => 42);
  assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2}T.*Z\] \[api:a\] → work$/);
  assert.match(lines[1], /✓ .* → 42.*over budget/);
});

test("colors are deterministic and auto mode respects NO_COLOR and FORCE_COLOR", () => {
  const lines = []; console.log = (line) => lines.push(line);
  const m = createMeasure("api"); configure({ logger: null, colors: true });
  m.sync("first", () => 1); m.sync("second", () => 2);
  assert.equal(lines[0].match(/^\x1b\[\d+m/)[0], lines[2].match(/^\x1b\[\d+m/)[0]);
  process.env.NO_COLOR = "1"; process.env.FORCE_COLOR = "1"; configure({ colors: "auto" });
  m.sync("plain", () => 3); assert.doesNotMatch(lines[4], /\x1b\[/);
  delete process.env.NO_COLOR; process.env.FORCE_COLOR = "0";
  m.sync("plain", () => 4); assert.doesNotMatch(lines[6], /\x1b\[/);
});

test("duration formatting carries rounded seconds into the next minute", () => {
  assert.equal(formatDuration(0.5), "0.50ms"); assert.equal(formatDuration(1500), "1.5s");
  assert.equal(formatDuration(90000), "1m 30s"); assert.equal(formatDuration(119999), "2m 0s");
  assert.throws(() => formatDuration(NaN), RangeError);
});
