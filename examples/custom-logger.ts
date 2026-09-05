import { configure, createMeasure } from "../index.ts";

configure({
  colors: "auto",
  logger(event, next) {
    // Filter by label without recreating the built-in logger.
    if (event.label.startsWith("health:")) return;

    // `data` is the normalized payload for every event type.
    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "internal" in event.data
    ) {
      return;
    }

    // Keep measure-fn's built-in output.
    next();

    // Add any side effect you want after the normal log.
    if (event.type === "error") {
      // sendToTelemetry({ label: event.label, data: event.data });
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
