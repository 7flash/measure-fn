import { configure, createMeasure } from "../browser.ts";

configure({ colors: false });
const extension = createMeasure("extension");

async function handleMessage(messageId: string) {
  return await extension.root(`message:${messageId}`, async () => {
    const step = extension.bindContext();
    await Promise.resolve();
    const state = await step("read cached state", async () => ({
      enabled: true,
    }));
    return await step("apply state", () => ({ messageId, ...state }));
  });
}

await Promise.all([handleMessage("A"), handleMessage("B")]);
