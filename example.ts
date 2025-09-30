import { measure } from "./index.ts";

// ============ EXAMPLE USAGE (CLEANED) ============

// Helper functions (same as before)
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

// The comprehensive example workflow
async function comprehensiveWorkflow() {
  await measure(async (m) => {
    // 1. Fetch a user
    const user1 = await m(
      () => fetchUser(1),
      { label: 'Fetch User', userId: 1 }
    );
    if (!user1) return; // Stop if fetch failed

    // 2. Fetch another user that is expected to fail
    await m(
      () => fetchUser(999),
      { label: 'Fetch Invalid User', userId: 999 }
    );

    // 3. Fetch multiple users in parallel
    await m(async (m2) => {
      const userPromises = [2, 3, 4].map(id =>
        m2(() => fetchUser(id), { label: 'Fetch User', userId: id })
      );
      await Promise.all(userPromises);
    }, 'Fetch Multiple Users in Parallel');

    // 4. Fetch posts and their comments sequentially
    await m(async (m2) => {
      const posts = await m2(() => fetchPosts(user1.id), { label: 'Fetch Posts', userId: user1.id });
      if (!posts) return;

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
