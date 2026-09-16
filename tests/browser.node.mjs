import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = fileURLToPath(new URL("../", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bundle(specifier = "measure-fn", extra = {}) {
  return await build({
    stdin: { contents: `export * from ${JSON.stringify(specifier)};`, resolveDir: project },
    bundle: true, platform: "browser", format: "iife", globalName: "MeasureFn",
    target: "chrome110", write: false, metafile: true, ...extra,
  });
}

async function browserRuntime() {
  const output = await bundle();
  const logs = [];
  const context = vm.createContext({
    console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    performance, setTimeout, clearTimeout, URL, Response,
  });
  vm.runInContext(output.outputFiles[0].text, context);
  const api = context.MeasureFn;
  const events = [];
  api.configure({ colors: false, logger: (event) => events.push(event) });
  return { api, events, logs };
}

test("normal package import bundles for extension IIFE and ESM without Node builtins", async () => {
  for (const format of ["iife", "esm"]) {
    const output = await bundle("measure-fn", { format });
    assert.doesNotMatch(output.outputFiles[0].text, /node:async_hooks/);
    assert.ok(Object.keys(output.metafile.inputs).some((name) => name.endsWith("dist/browser.js")));
    assert.ok(Object.values(output.metafile.outputs).every((file) => file.imports.length === 0));
  }
});

test("explicit browser subpath has the same browser-safe exports", async () => {
  const output = await bundle("measure-fn/browser");
  assert.doesNotMatch(output.outputFiles[0].text, /node:async_hooks/);
  const { api } = await browserRuntime();
  assert.equal(typeof api.createMeasure, "function");
  assert.equal(typeof api.configure, "function");
});

test("browser build also resolves require-style imports and neutral fallback", async () => {
  const required = await build({ stdin: { contents: 'globalThis.m = require("measure-fn").createMeasure("extension");', resolveDir: project }, bundle: true, platform: "browser", write: false });
  assert.doesNotMatch(required.outputFiles[0].text, /node:async_hooks/);
  const neutral = await bundle("measure-fn", { platform: "neutral" });
  assert.ok(Object.keys(neutral.metafile.inputs).some((name) => name.endsWith("dist/browser.js")));
});

test("Node builds retain AsyncLocalStorage through the node export condition", async () => {
  const output = await bundle("measure-fn", { platform: "node", format: "esm" });
  assert.ok(Object.keys(output.metafile.inputs).some((name) => name.endsWith("dist/index.js")));
  assert.ok(Object.values(output.metafile.outputs).some((file) => file.imports.some((entry) => entry.external && /^(node:)?async_hooks$/.test(entry.path))));
});

test("bundled runtime runs without process, require, or Node globals", async () => {
  const { api, events, logs } = await browserRuntime();
  assert.equal(await api.measure("work", () => 42), 42);
  assert.equal(events.length, 2);
  api.configure({ logger: null, colors: "auto", timestamps: true });
  assert.equal(api.measureSync("sync", () => 7), 7);
  assert.match(logs[0][0], /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[.*\] → sync$/);
});

test("browser automatic nesting works synchronously without leaking across await", async () => {
  const { api, events } = await browserRuntime();
  const m = api.createMeasure("ui");
  await m.root("render", async () => {
    m.sync("before await", () => 1);
    await sleep(0);
    m.sync("after await", () => 2);
  });
  const starts = events.filter((e) => e.type === "start");
  assert.deepEqual(starts.map((e) => e.id), ["ui:a", "ui:a-a", "ui:b"]);
  assert.equal(starts[2].parentId, undefined);
});

test("captured browser context keeps overlapping roots and child scopes isolated", async () => {
  const { api, events } = await browserRuntime();
  const ui = api.createMeasure("ui"); const db = api.createMeasure("db");
  await Promise.all(["A", "B"].map((label) => ui.root(label, async () => {
    const child = db.bindContext();
    await sleep(label === "A" ? 3 : 0);
    await child(`${label}-child`, () => 1);
  })));
  const starts = events.filter((e) => e.type === "start");
  for (const label of ["A", "B"]) {
    const root = starts.find((e) => e.label === label);
    const child = starts.find((e) => e.label === `${label}-child`);
    assert.equal(child.parentId, root.id); assert.equal(child.traceId, root.traceId);
  }
});

test("browser timeout keeps immediate children inside their root", async () => {
  const { api, events } = await browserRuntime();
  const m = api.createMeasure("ui");
  await m.root({ start: () => "parent", timeout: 100 }, async () => {
    await m("child", () => 1);
  });
  const starts = events.filter((e) => e.type === "start");
  assert.deepEqual(starts.map((e) => e.id), ["ui:a", "ui:a-a"]);
});

test("browser retries and batch progress preserve parent context after await", async () => {
  const { api, events } = await browserRuntime();
  const m = api.createMeasure("ui");
  await m.root("root", async () => {
    const child = m.bindContext();
    let attempt = 0;
    await child.retry("retry", { attempts: 2, delay: 1 }, () => { if (++attempt === 1) throw 1; return 2; });
    await child.batch("batch", [1, 2, 3], (n) => n, { every: 1 });
  });
  const starts = events.filter((e) => e.type === "start");
  assert.deepEqual(starts.map((e) => e.id), ["ui:a", "ui:a-a", "ui:a-b", "ui:a-c"]);
  assert.ok(events.filter((e) => e.type === "annotation").every((e) => e.parentId === "ui:a-c"));
});

test("browser context unwinds after callback failure and detached root", async () => {
  const { api, events } = await browserRuntime();
  const m = api.createMeasure("ui");
  await assert.rejects(m.root("failed", () => { throw new Error("fail"); }));
  m.sync.root("outer", () => { m.sync.root("detached", () => 1); m.sync("child", () => 2); });
  assert.deepEqual(events.filter((e) => e.type === "start").map((e) => e.id), ["ui:a", "ui:b", "ui:c", "ui:b-a"]);
});


test("browser scopes support errors verbosity, value caps and original-error deduplication", async () => {
  const { api, events, logs } = await browserRuntime();
  api.configure({ logger: (event,next) => { events.push(event); next(); }, errorDetails:true, summarize:true });
  const m = api.createMeasure("rpc", {level:"errors", slowThreshold:0, maxValueLength:10});
  await m("slow browser",()=>"x".repeat(100));
  assert.equal(logs.length,1); assert.match(logs[0][0], /✓ slow brow…/);
  const quiet = api.createMeasure("quiet", {level:"silent"});
  await quiet("hidden",()=>1); assert.equal(logs.length,1);
  const e = {message:"boom",cause:{reason:"bad"}};
  await assert.rejects(m("outer",()=>m("inner",()=>{throw e;})),value=>value===e);
  assert.equal(logs.filter(args=>args[0].includes("✗")).length,2);
  assert.equal(logs.filter(args=>args[0].includes("Cause:")).length,1);
  assert.equal(events.at(-1).type,"error");
});