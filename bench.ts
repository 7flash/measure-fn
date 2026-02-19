
import { measure, measureSync, configure } from "./index.ts";

const ITERATIONS = 100_000;

function noop() { }

async function run() {
    console.log(`Running benchmark with ${ITERATIONS.toLocaleString()} iterations...`);
    configure({ silent: true }); // Disable logging to measure pure overhead

    // Baseline
    const startBase = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        noop();
    }
    const timeBase = performance.now() - startBase;
    const perOpBase = timeBase / ITERATIONS;
    console.log(`Baseline (noop): ${(timeBase).toFixed(2)}ms total, ${perOpBase.toFixed(6)}ms/op`);

    // measureSync overhead
    const startSync = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        measureSync('test', noop);
    }
    const timeSync = performance.now() - startSync;
    const overheadSync = (timeSync - timeBase) / ITERATIONS;
    console.log(`measureSync:     ${(timeSync).toFixed(2)}ms total, ${overheadSync.toFixed(6)}ms overhead/op`);

    // measure (async) overhead
    const startAsync = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await measure('test', async () => { });
    }
    const timeAsync = performance.now() - startAsync;
    const overheadAsync = (timeAsync - timeBase) / ITERATIONS;
    console.log(`measure (async): ${(timeAsync).toFixed(2)}ms total, ${overheadAsync.toFixed(6)}ms overhead/op`);

    // Nested overhead (depth 3)
    const startNested = performance.now();
    for (let i = 0; i < ITERATIONS / 10; i++) { // reduce iterations
        measureSync('root', (m) => {
            m('child', (m2) => {
                m2('leaf', noop);
            });
        });
    }
    const timeNested = performance.now() - startNested;
    // 3 measurements per iteration
    const perOpNested = timeNested / (ITERATIONS / 10);
    console.log(`Nested (depth 3): ${(timeNested).toFixed(2)}ms total, ${perOpNested.toFixed(6)}ms per tree (3 ops)`);
}

run();
