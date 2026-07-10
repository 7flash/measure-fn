# measure-fn examples

## production-orchestrator.ts

A production-style example modeled after Solard's worker orchestration code.

It demonstrates:

- `const m = createMeasure("solard:process")`
- `await m.root("boot", async () => ...)`
- `await m("start_all_workers", async () => ...)`
- nested worker spans like `worker:server` → `start`
- independent recurring roots like `health_check_tick`
- sync checkpoints with `m.sync("runtime", () => ...)`
- returning small useful summaries instead of logging manually

Run from a package/app that has the updated `measure-fn` available:

```bash
bun run examples/production-orchestrator.ts
```
