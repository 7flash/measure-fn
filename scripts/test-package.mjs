import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";
import { createMeasure } from "../dist/index.js";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with npm run test:package after building.");
const temp = await mkdtemp(join(process.env.MEASURE_TEST_TMP_ROOT ?? tmpdir(), "measure-fn-package-"));
const m = createMeasure("package");

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, npm_config_cache: join(temp, "cache"), npm_config_offline: "true", npm_config_update_notifier: "false" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Command failed: ${result.status}`);
}

try {
  await m.root("validate installable package", async () => {
    m.sync("pack", () => run([npmCli, "pack", "--pack-destination", temp], project));
    const archive = join(temp, (await readdir(temp)).find((name) => name.endsWith(".tgz")));
    const consumer = join(temp, "consumer");
    await mkdir(consumer);
    await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "measure-fn-consumer-check", private: true, type: "module" }));
    m.sync("install archive", () => run([npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", archive], consumer));
    m.sync("Node import", () => run(["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { createMeasure, configure } from 'measure-fn';
      const events = []; configure({logger:event=>events.push(event)});
      const m = createMeasure('consumer');
      assert.equal(await m.root('parent', async()=>{await Promise.resolve();return m('child',()=>42)}),42);
      assert.equal(events[1].parentId,events[0].id);
    `], consumer));
    await writeFile(join(consumer, "check.ts"), `
      import { createMeasure, type MeasureLogEvent } from 'measure-fn';
      import { createMeasure as createBrowser } from 'measure-fn/browser';
      const result: Promise<number> = createMeasure('server')('work',()=>42);
      const browser: Promise<number> = createBrowser('browser')('work',()=>42);
      const read = (event: MeasureLogEvent): string => event.traceId;
      void [result,browser,read];
    `);
    await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [], noEmit: true, strict: true,
    }, include: ["check.ts"] }));
    m.sync("declarations without Node ambient types", () => run([require.resolve("typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")], consumer));
    const bundled = await m({ start: () => "extension browser bundle", end: (result) => ({ files: result.outputFiles.length, bytes: result.outputFiles.reduce((sum, file) => sum + file.contents.byteLength, 0) }) }, () => build({
      stdin: { contents: 'import {createMeasure,configure} from "measure-fn"; configure({silent:true}); globalThis.result = createMeasure("extension")("work",()=>42);', resolveDir: consumer },
      platform: "browser", format: "iife", bundle: true, write: false, target: "chrome110",
    }));
    assert.doesNotMatch(bundled.outputFiles[0].text, /(?:node:)?async_hooks/);
    const context = vm.createContext({ performance, setTimeout, clearTimeout });
    vm.runInContext(bundled.outputFiles[0].text, context);
    assert.equal(await context.result, 42);
    return { installed: true, nodeImport: true, declarations: true, browserBundle: true };
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
