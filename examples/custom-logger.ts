import { configure, createMeasure } from "../index.ts";

configure({
  colors: "auto",
  logger(event, next) {
    // Keep measure-fn's built-in output.
    next();

    // Add any side effect you want without recreating the default formatting.
    if (event.type === "error") {
      // sendToTelemetry(event);
    }
  },
});

const api = createMeasure("api");
const db = createMeasure("db");

await api("GET /users", async () => {
  await db("SELECT users", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { rows: 2 };
  });

  return { status: 200 };
});
