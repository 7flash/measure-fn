# measure-fn root/shared context patch

This patch finalizes the tracing model:

- `measure.root(action, fn)` starts a new top-level trace tree.
- `measure(action, fn)` joins the current trace tree when one exists.
- All `createMeasure("scope")` instances share the same active span context.
- Scope prefixes identify the subsystem; path suffixes identify where the log belongs in the trace.
- Browser imports are safe: there is no top-level `node:async_hooks` import.

Example:

```ts
const http = createMeasure("http");
const engine = createMeasure("engine");

await http.measure.root("GET /api/state req_1", async () => {
  await http.measure("API: /api/state", async () => {
    await engine.measure("snapshot player=1", snapshot);
  });
});
```

Output:

```txt
[http:a] ... GET /api/state req_1
[http:a-a] ... API: /api/state
[engine:a-a-a] ... snapshot player=1
```

Use `root()` for frontend entry points too:

```ts
setInterval(() => {
  client.measure.root("poll", async () => {
    await client.measure("GET /api/state", fetchState);
  });
}, 1000);
```

This prevents browser fallback context from treating repeated top-level poll calls as children of previous polls.
