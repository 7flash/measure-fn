import { configure, createMeasure } from "../browser.ts";

configure({ colors: false });
const extension = createMeasure("extension");
const storage = createMeasure("storage");

// Each browser message is an independent root. Capture before awaiting.
async function handleMessage(messageId: string) {
  return await extension.root(`message:${messageId}`, async () => {
    const step = extension.bindContext();
    const read = storage.bindContext();
    await Promise.resolve();
    const state = await read("read cached state", async () => ({
      enabled: true,
    }));
    return await step("apply state", () => ({ messageId, ...state }));
  });
}

// Overlapping messages keep separate trees without a process-global pending span.
await Promise.all([handleMessage("A"), handleMessage("B")]);
