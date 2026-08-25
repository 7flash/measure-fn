# Changelog

## 5.1.0

- Added middleware-style custom logging: `logger(event, next)`.
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

### Source hygiene

- Fixed `examples/basic.ts` to import `../index.ts` and removed stale unsupported `userId` action metadata.
- Updated the nested benchmark snippet to the current automatic-nesting API.
- Fixed the production orchestrator example's worker-start return type.
- Fixed the `example` package script to point at `examples/basic.ts`.
