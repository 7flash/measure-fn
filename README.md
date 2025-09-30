# Measure Utility

A lightweight, stateless, zero-dependency TypeScript utility for measuring the performance of nested asynchronous operations with detailed, hierarchical logging.
## Features

- **Performance Timing**: Measures the duration of async functions.
- **Hierarchical Logging**: Creates clear, indented logs for nested operations.
- **Readable IDs**: Assigns sequential, alphabetic IDs to operations (e.g., `[a]`, `[a-a]`, `[a-b]`) for easy tracking.
- **Stateless**: Each top-level call is a completely isolated session, ensuring predictable behavior.
- **Graceful Error Handling**: Catches and logs errors within a measured block without crashing the parent process, including support for logging error causes.
- **Tracing and Monitoring**: Each operation is uniquely identified by its hierarchical ID, enabling detailed tracing of execution flows through annotated logs. This structure supports integration with monitoring tools, such as triggering notifications on errors linked to specific IDs, for building robust, observable programs.

## Error Handling

The `measure` utility is designed to be **non-disruptive**. It **catches errors** that occur within the function it's measuring instead of letting them propagate. 🛑

When an error is caught:

1. An error completion message is logged to the console (e.g., `< [a-b] ✗ 20.51ms (Network timed out!)`).
2. The full error, its stack trace, and any cause details are logged to `console.error` with the operation's unique ID for easy tracing and debugging.
3. The `measure` function returns `null`.

This design allows your application to continue running, enabling you to gracefully handle failures by checking for a `null` return value, as shown in the main example below. The unique IDs facilitate monitoring, such as scanning logs for specific error IDs to trigger alerts or notifications.

Errors can include a `cause` property (supported in modern JavaScript environments) for additional context, which is automatically included in the `console.error` logs for better debugging.

## Installation

```sh
bun add @ments/utils
```

## Usage

The function wraps an asynchronous operation, taking a function to execute and an action label as arguments. For nesting, use the `measure` instance provided to the callback.

The following example demonstrates a multi-step process that includes a failing operation to show how errors are handled without interrupting the entire flow.

```typescript
import { measure } from '@ments/utils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function processData() {
  await measure(async (measure) => {
    
    await sleep(50);

    // 1. A successful nested operation
    await measure(async () => {
      await sleep(100);
    }, 'Step 1: Fetch resource');

    // 2. A nested operation designed to fail, with cause for context
    const result = await measure(async () => {
      await sleep(20);
      throw new Error('Network timed out!', { cause: { userId: 999 } });
    }, 'Step 2: Risky operation');
    
    // Gracefully handle the failure and continue
    if (result === null) {
      console.log('--> Step 2 failed, but we can continue processing.');
    }

    // 3. Another nested operation that has its own sub-steps
    await measure(async (measure) => {
      await sleep(75);
      await measure(async () => {
        await sleep(120);
      }, { label: 'Step 3.1: Analyze data', source: 'cache' });
    }, 'Step 3: Process resource');

  }, 'Complete full data processing');
}

processData();
```

## Output Structure

The utility produces structured console logs to track the start, completion, and any errors in operations, with each tied to a unique hierarchical ID for tracing execution flow:

- **Start Log**: `> [id] Label (optional metadata)` – Indicates the beginning of an operation.
- **Success Completion Log**: `< [id] ✓ duration.ms` – Indicates successful completion with the measured duration.
- **Error Completion Log**: `< [id] ✗ duration.ms (error message)` – Indicates an error occurred, including the duration and message.
- **Error Details**: Logged separately via `console.error` with the ID, stack trace, and cause (if available) for in-depth debugging and monitoring (e.g., triggering notifications based on ID-matched errors).

Durations are in milliseconds, rounded to two decimal places. Logs are indented based on nesting level for readability. All times are measured using `performance.now()` for high precision. This annotated logging enables writing beautiful, structured programs where execution flows can be easily traced, analyzed, and monitored.

## Example Output

The code in the usage example will produce output similar to the following in the console (actual durations may vary slightly):

```
> [a] Complete full data processing
> [a-a] Step 1: Fetch resource
< [a-a] ✓ 101.32ms
> [a-b] Step 2: Risky operation
< [a-b] ✗ 20.51ms (Network timed out!)
[a-b] Error: Network timed out!
    at ... (stack trace)
[a-b] Cause: { userId: 999 }
--> Step 2 failed, but we can continue processing.
> [a-c] Step 3: Process resource
> [a-c-a] Step 3.1: Analyze data (source="cache")
< [a-c-a] ✓ 120.87ms
< [a-c] ✓ 197.45ms
< [a] ✓ 421.91ms
```
