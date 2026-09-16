import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createMeasure } from "../dist/index.js";

// Playwright is an optional development tool; no browser dependency is shipped.
const { chromium } = await import(process.env.MEASURE_PLAYWRIGHT_MODULE ?? "playwright");
const project = fileURLToPath(new URL("../", import.meta.url));
const m = createMeasure("browser-validation");
const assets = new Map();
const reports = [];
let browser, server;

async function withinDeadline(operation, ms = 15_000) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Browser contract suite timed out")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  await m.root({ start: () => "real browser contracts", end: (result) => ({
    browser: result.browser, suites: result.suites, passed: result.passed,
  }) }, async () => {
    const fixtures = [
      { mode: "iife", source: 'export { runBrowserContracts } from "./tests/browser.runtime.mjs";' },
      { mode: "esm", source: 'export { runBrowserContracts } from "./tests/browser.runtime.mjs";' },
      { mode: "worker", source: 'import { runBrowserContracts } from "./tests/browser.runtime.mjs"; runBrowserContracts().then(result => postMessage(result)).catch(error => postMessage({ failed: 1, error: String(error) }));' },
    ];
    for (const { mode, source } of fixtures) {
      const built = await build({ stdin: { contents: source, resolveDir: project },
        bundle: true, platform: "browser", format: mode === "iife" ? "iife" : "esm",
        globalName: mode === "iife" ? "MeasureBrowserTests" : undefined,
        target: "chrome110", write: false, metafile: true });
      assert.ok(Object.keys(built.metafile.inputs).some((name) => name.endsWith("dist/browser.js")));
      assert.doesNotMatch(built.outputFiles[0].text, /(?:node:)?async_hooks/);
      assets.set(`/bundle-${mode}.js`, built.outputFiles[0].text);
    }
    assets.set("/driver-iife.js", 'globalThis.measureCheckResult = MeasureBrowserTests.runBrowserContracts();');
    assets.set("/driver-esm.js", 'import {runBrowserContracts} from "/bundle-esm.js"; globalThis.measureCheckResult = runBrowserContracts();');
    assets.set("/driver-worker.js", 'globalThis.measureCheckResult = new Promise((resolve, reject) => { const worker = new Worker("/bundle-worker.js", {type:"module"}); worker.onmessage = event => { resolve(event.data); worker.terminate(); }; worker.onerror = event => { reject(new Error(event.message)); worker.terminate(); }; });');

    server = createServer((request, response) => {
      const path = new URL(request.url, "http://localhost").pathname;
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; worker-src 'self'; object-src 'none'");
      if (assets.has(path)) {
        response.setHeader("Content-Type", "text/javascript"); response.end(assets.get(path)); return;
      }
      if (["/iife", "/esm", "/worker"].includes(path)) {
        const mode = path.slice(1);
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><title>measure-fn browser contracts</title>${mode === "iife" ? '<script src="/bundle-iife.js"></script>' : ""}<script type="${mode === "iife" ? "text/javascript" : "module"}" src="/driver-${mode}.js"></script>`);
        return;
      }
      response.writeHead(404); response.end();
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const launch = { headless: true };
    if (process.env.MEASURE_BROWSER_EXECUTABLE) launch.executablePath = process.env.MEASURE_BROWSER_EXECUTABLE;
    if (process.env.MEASURE_BROWSER_ARGS) launch.args = JSON.parse(process.env.MEASURE_BROWSER_ARGS);
    browser = await chromium.launch(launch);
    // One context also supports container builds of Chromium using a single process.
    const context = await browser.newContext();
    for (const mode of ["iife", "esm", "worker"]) {
      await m({ start: () => mode, end: (report) => ({ passed: report.passed, failed: report.failed }) }, async () => {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.text().includes("Content Security Policy")) errors.push(message.text()); });
        try {
          await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
          await page.waitForFunction(() => globalThis.measureCheckResult !== undefined);
          const report = await withinDeadline(() => page.evaluate(() => globalThis.measureCheckResult));
          reports.push({ mode, ...report, pageErrors: errors });
          assert.equal(report.failed, 0, JSON.stringify(report));
          assert.deepEqual(errors, []);
          return report;
        } finally { await page.close(); }
      });
    }
    const result = { browser: browser.version(), suites: reports.length,
      passed: reports.reduce((sum, report) => sum + report.passed, 0), reports };
    if (process.env.MEASURE_BROWSER_REPORT) await writeFile(process.env.MEASURE_BROWSER_REPORT, JSON.stringify(result, null, 2) + "\n");
    return result;
  });
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
