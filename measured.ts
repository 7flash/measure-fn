import { createMeasure } from "measure-fn";

export type MeasuredTask<T> = () => T | Promise<T>;
export type RecoveryPolicy = (error: unknown) => boolean;

type MeasureScope = ReturnType<typeof createMeasure>;

export type MeasuredScope = Readonly<{
  required<T>(label: string, task: MeasuredTask<T>): Promise<T>;
  optional<T>(
    label: string,
    task: MeasuredTask<T>,
    fallback: T,
    shouldRecover: RecoveryPolicy,
  ): Promise<T>;
  bindContext(): MeasuredScope;
}>;

function required<T>(
  scope: MeasureScope,
  label: string,
  task: MeasuredTask<T>,
): Promise<T> {
  return scope(label, task);
}

function optional<T>(
  scope: MeasureScope,
  label: string,
  task: MeasuredTask<T>,
  fallback: T,
  shouldRecover: RecoveryPolicy,
): Promise<T> {
  return scope<T>(
    {
      start: () => label,
      catch: (error: unknown) => {
        if (shouldRecover(error) !== true) throw error;
        return fallback;
      },
    },
    task,
  );
}

function createFacade(scope: MeasureScope): MeasuredScope {
  return Object.freeze({
    required: <T>(label: string, task: MeasuredTask<T>) =>
      required(scope, label, task),
    optional: <T>(
      label: string,
      task: MeasuredTask<T>,
      fallback: T,
      shouldRecover: RecoveryPolicy,
    ) => optional(scope, label, task, fallback, shouldRecover),
    bindContext: () => createFacade(scope.bindContext()),
  });
}

export function measured(scopeName: string): MeasuredScope {
  return createFacade(createMeasure(scopeName));
}
