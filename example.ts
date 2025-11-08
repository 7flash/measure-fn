import { measure, measureSync } from "./index.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchUser(userId: number) {
  await sleep(100);
  if (userId === 999) throw new Error('User not found', { cause: { userId } });
  return { id: userId, name: `User ${userId}` };
}

async function fetchPosts(userId: number) {
  await sleep(150);
  return [{ id: 1, title: 'First Post', userId }];
}
async function fetchComments(postId: number) {
  await sleep(80);
  return [{ id: 1, text: 'Great post!', postId }];
}
function syncFetch() {
  do {
  } while (Math.random() < 0.99999999);
  return 42;
}

async function comprehensiveWorkflow() {
  const syncValue = measureSync(syncFetch, 'get sync value');
  measureSync(syncValue);
  
  await measure(async (m) => {
    const syncValue = await m(syncFetch, 'get sync value');
    await m({ label: 'noop measure object', values: [syncValue] });
    
    const user1 = await m(
      () => fetchUser(1),
      { label: 'Fetch User', userId: 1 }
    );

    // @note measure never throws, only returns null in case of exception
    await m(
      () => fetchUser(999),
      { label: 'Fetch Invalid User', userId: 999 }
    );

    await m(async (m2) => {
      const userPromises = [2, 3, 4].map(id =>
        m2(() => fetchUser(id), { label: 'Fetch User', userId: id })
      );
      await Promise.all(userPromises);
    }, 'Fetch Multiple Users in Parallel');

    await m(async (m2) => {
      const posts = await m2(() => fetchPosts(user1.id), { label: 'Fetch Posts', userId: user1.id });

      for (const post of posts) {
        await m2(() => fetchComments(post.id), { label: 'Fetch Comments', postId: post.id });
      }
    }, 'Enrich Posts with Comments');
  }, 'Comprehensive Workflow Example');
}

// To run it:
comprehensiveWorkflow().then(() => {
  console.log('\n✅ Workflow complete.');
});
