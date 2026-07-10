# Solard measure-fn update

This zip contains three drop-in files:

- `measure-fn/index.ts` — updated package implementation:
  - `createMeasure("scope")` now returns a callable measure function.
  - Supports `await m("label", async () => ...)`.
  - Supports `await m.root("label", async () => ...)`.
  - Supports `m.sync("label", () => ...)`.
  - Keeps old compatibility aliases: `m.measure(...)` and `m.measureSync(...)`.
  - Uses `AsyncLocalStorage` from `node:async_hooks` so async nesting survives `await` in Bun/Node.
  - Adds built-in summarization/redaction and duplicated scope-prefix stripping.

- `src/solard/measure.ts` — intentionally tiny Solard wrapper:
  - configures `measure-fn` once.
  - creates scoped measures only.
  - no large local wrapper implementation.

- `main.ts` — rewritten orchestrator using:
  - `import { processMeasure as m } from "./src/solard/measure.js";`
  - short local labels like `boot`, `start_all_workers`, `worker:<name>`, `clean_stale`, `start`.

## Install/copy

Copy `measure-fn/index.ts` into your local `measure-fn` package source.
Copy `src/solard/measure.ts` over your Solard measure wrapper.
Copy or merge `main.ts` into your project root.

## Expected usage

```ts
import { processMeasure as m } from "./src/solard/measure.js";

m.sync("bgrun_db", () => ({ dbPath: bgrun.dbPath }));

await m.root("boot", async () => {
  await m("start_all_workers", async () => {
    // nested calls stay under this span across await
  });
});
```
