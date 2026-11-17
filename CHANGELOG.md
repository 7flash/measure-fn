# Changelog

## Unreleased (6.0.0 proposed: wrap() on generators now returns an iterator)

- Fixed `.retry()` ignoring `retryIf` in 5.3.1, which meant failed operations were always retried and could repeat writes even when the caller intended to stop.
- Added support for `retryIf(error, attempt)` after each failed attempt except the last, stopping retries when it returns `false` and throwing a `TypeError` if it returns a non-boolean value.
- Kept the existing retry behavior when `retryIf` is omitted.
- Fixed action `error()` mappers never being applied in 5.3.1.
- Action `error()` mappers now control the logged failure value while the caller still receives the original error.
- Throwing or asynchronous error mappers are reported as `errorMapperError`, consistent with `end()` mapper failures.
- Changed `wrap()` on generator and async-generator functions to return an iterator instead of a Promise.
- Wrapped generators now start their span on the first `next()` and finish when iteration completes, throws, or returns early, measuring consumption rather than iterator creation.
- Nested operations during generator consumption now appear under the generator's span.
- Fixed synchronous callbacks and `end()` / `error()` mappers invoking `then()` on non-Promise thenables when checking for asynchronous results.
- Fixed logging freezing on a huge sparse array (length 1e9) and fully walking large Maps, Sets and typed arrays: at most 1000 items of one value are read, and typed arrays and Buffers print as `{ type, byteLength }`.
- Durations no longer print as `1000.00ms` or `60.0s` at unit boundaries, and an hour or more prints as `2h 6m`.
- Fixed error output exceeding `maxValueLength`; error messages, details, and causes now respect the configured limit.
- Logged strings (labels, values, URLs, error messages, stacks, causes) now have URL credentials (userinfo and key/token/secret-style query parameters) replaced with `[REDACTED]`; `configure({ sensitiveStringPattern })` adds your own pattern.
- Added optional compact span IDs with `configure({ compactIds: true })` or `createMeasure(scope, { compactIds: true })`.
- Compact IDs use short per-trace values such as `#a` and `#b` instead of growing with the full ancestor path, while preserving exact `parentId` and `traceId` values.
- Compact IDs are disabled by default, so existing span IDs and log output remain unchanged.
- Rewrote the README with installation instructions, a quick-start example, Node.js and Bun guidance, browser context-binding guidance, and an updated API reference covering retries, batch results, generators, logging, and configuration.

## 5.2.0

- Added normalized `event.data` to every `MeasureLogEvent` variant for logger filtering and routing.
- `start` and `annotation` expose the same payload through both `data` and `value`.
- `success` exposes the same mapped/summarized payload through both `data` and `result`.
- `error` exposes the same payload through both `data` and `error`.
- Existing event-specific fields remain unchanged for backwards compatibility and discriminated-union narrowing.
- Expanded README and custom logger examples with label filtering, data filtering, suppression, and telemetry routing.
- Added regression tests for normalized data aliases and label/data filtering.

## 5.1.0

- Added middleware-style custom logging: `logger(event, next)`.
- Added regression tests for logger delegation, idempotent `next()`, replacement logging, colors, scope color stability, and error output.
- Added README documentation for middleware logging and color configuration.
- Calling `next()` preserves the built-in logger; omitting it fully replaces built-in output.
- `next()` is idempotent for each event, so duplicate calls do not duplicate the default log.
- Added deterministic ANSI colors:
  - scoped IDs are colored consistently by scope;
  - unscoped IDs are colored consistently by label;
  - labels receive their own deterministic color;
  - success, error, annotation, and budget markers use semantic colors.
- Added `configure({ colors: true | false | "auto" })`.
- `"auto"` is the default and respects `NO_COLOR`, `FORCE_COLOR=0`, `FORCE_COLOR`, and TTY detection.
- Existing one-argument custom loggers remain compatible and still replace the default logger unless they call `next()`.
- Kept the existing error behavior: a compact failure line is followed by detailed `console.error` output.
- Added a compiled publish target (`dist/index.js` + `dist/index.d.ts`) so installed packages work in Node.js without relying on TypeScript execution inside `node_modules`.
- Added explicit package `exports`, a controlled `files` allowlist, `sideEffects: false`, and a prepack build.
- Moved TypeScript to development-only dependency metadata; consumers have no runtime dependency on TypeScript.

### Source hygiene

- Fixed `examples/basic.ts` to import `../index.ts` and removed stale unsupported `userId` action metadata.
- Updated the nested benchmark snippet to the current automatic-nesting API.
- Fixed the production orchestrator example's worker-start return type.
- Fixed the `example` package script to point at `examples/basic.ts`.
