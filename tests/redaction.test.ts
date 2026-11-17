
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { configure } from "../config.js";
import { emit } from "../logger.js";
import { safeStringify } from "../serialization.js";

describe("logged secret redaction", () => {
  afterEach(() => {
    configure({
      sensitiveStringPattern: null,
      errorDetails: false,
      logger: null,
      onLoggerError: null,
      level: "info",
      silent: false,
      colors: false,
      timestamps: false,
    });
  });

  test("redacts URL credentials in strings, URL objects, and nested values", () => {
    const url =
      "https://alice:password123@provider.test/v1?key=query-secret&token=token-secret&mode=fast";
    const output = safeStringify({
      label: `calling ${url}`,
      endpoint: new URL(url),
      headers: {
        Authorization: "Bearer authorization-secret",
        Cookie: "session=cookie-secret",
      },
      ordinary: "https://user:pass@example.test/?api_key=api-secret",
    }, 0); // no length cap: another test file may set a small global one

    for (const secret of [
      "alice", "password123", "query-secret", "token-secret",
      "authorization-secret", "cookie-secret", "api-secret",
    ]) expect(output).not.toContain(secret);

    expect(output).toContain("mode=fast");
    expect(output).toContain("[omitted]");
  });

  test("applies an application-specific pattern throughout serialized output", () => {
    configure({ sensitiveStringPattern: /sk_live_[A-Za-z0-9]+/ });
    const output = safeStringify({
      first: "prefix sk_live_abc123 suffix",
      second: "again sk_live_xyz789",
    });

    expect(output).not.toContain("sk_live_");
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  test("redacts labels, messages, stacks, and causes in console output", () => {
    configure({ errorDetails: true });
    const secretUrl =
      "https://alice:password123@provider.test/?key=stack-secret";
    const error = new Error(`request failed: ${secretUrl}`);
    Object.defineProperty(error, "stack", {
      value: `Error: request failed\n at ${secretUrl}`,
      configurable: true,
    });
    Object.defineProperty(error, "cause", {
      value: { endpoint: secretUrl, token: "cause-secret" },
      enumerable: true,
    });

    const log = spyOn(console, "log").mockImplementation(() => {});
    const detail = spyOn(console, "error").mockImplementation(() => {});
    try {
      emit({
        type: "error",
        id: "trace",
        rawId: "root",
        scope: "provider",
        traceId: "trace",
        parentId: undefined,
        depth: 0,
        label: `request ${secretUrl}`,
        duration: 1,
        data: undefined,
        error,
      });

      const output = [...log.mock.calls, ...detail.mock.calls].flat().join(" ");
      for (const secret of [
        "alice", "password123", "stack-secret", "cause-secret",
      ]) expect(output).not.toContain(secret);
      expect(output).toContain("[REDACTED]");
      expect(output).toContain("request");
    } finally {
      log.mockRestore();
      detail.mockRestore();
    }
  });
});
