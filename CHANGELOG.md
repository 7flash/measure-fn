# Changelog

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
