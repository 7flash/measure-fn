import { createMeasure, safeStringify } from "../index.ts";

const app = createMeasure("app");
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

try {
  await app.root("example", async () => {
    const config = app.sync("load config", () => ({ env: "demo", port: 3000 }));
    app.note("application ready");

    const users = await app("load users", async () => {
      return await Promise.all(
        [1, 2, 3].map((id) =>
          app(
            { start: () => `user:${id}`, end: (user) => ({ id: user.id }) },
            async () => {
              await pause(5);
              return { id, name: `User ${id}` };
            },
          ),
        ),
      );
    });

    let attempt = 0;
    await app.retry(
      {
        start: () => "temporary read",
        error: (error) => ({
          message: error instanceof Error ? error.message : String(error),
        }),
      },
      {
        attempts: 3,
        delay: 5,
        backoff: 2,
        retryIf: (error) =>
          error instanceof Error && error.message === "Temporary failure",
      },
      () => {
        if (++attempt < 3) throw new Error("Temporary failure");
        return { attempt, ready: true };
      },
    );

    const results = await app.batch(
      "process users",
      users,
      (user) => user.id * 2,
      { every: 1 },
    );
    const receiver = {
      factor: 7,
      multiply: app.wrap(
        "multiply",
        function (this: { factor: number }, n: number) {
          return this.factor * n;
        },
      ),
    };
    const value = await receiver.multiply(6);

    const response = await app.root(
      {
        start: () => "GET /missing",
        end: (res: Response) => ({ status: res.status }),
        error: (error) => ({
          message: error instanceof Error ? error.message : String(error),
        }),
        catch: () => new Response("Not found", { status: 404 }),
      },
      async () => {
        throw new Error("Expected missing resource");
      },
    );

    const circular: { token: string; self?: unknown } = {
      token: "demo-secret",
    };
    circular.self = circular;
    app.sync("redacted serialization", () => safeStringify(circular));
    return { config, results, value, recoveredStatus: response.status };
  });
} catch {
  process.exitCode = 1;
}
