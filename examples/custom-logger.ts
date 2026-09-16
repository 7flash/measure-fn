import { configure, createMeasure } from "../index.ts";

configure({
  colors: "auto",
  logger(event, next) {
    if (event.label.startsWith("health:")) return;

    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "internal" in event.data
    ) {
      return;
    }

    next();
  },
});

const api = createMeasure("api");

await api("GET /users", async () => {
  await api("SELECT users", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { rows: 2 };
  });

  return { status: 200 };
});
