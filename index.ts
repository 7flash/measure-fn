function toAlpha(num: number): string {
  let result = '';
  let n = num;
  do {
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

export async function measure<T = null>(
  arg1: ((measure: typeof measure) => Promise<T>) | string | object,
  action?: string | object
): Promise<T | null> {
  const _measureInternal = async <U>(
    fnInternal: (measure: (fn: any, action: any) => Promise<U | null>) => Promise<U>,
    actionInternal: string | object,
    parentIdChain: (string | number)[]
  ): Promise<U | null> => {
    const start = performance.now();
    let childCounter = 0;

    const currentId = toAlpha(parentIdChain.pop() ?? 0);
    const fullIdChain = [...parentIdChain, currentId];
    const fullIdChainStr = `[${fullIdChain.join('-')}]`;

    try {
      const actionLabel =
        typeof actionInternal === 'object' && actionInternal !== null && 'label' in actionInternal
          ? String(actionInternal.label)
          : String(actionInternal);

      let logMessage = `> ${fullIdChainStr} ${actionLabel}`;

      if (typeof actionInternal === 'object' && actionInternal !== null) {
        const details = { ...actionInternal };
        if ('label' in details) delete details.label;
        if (Object.keys(details).length > 0) {
          const params = Object.entries(details)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(' ');
          logMessage += ` (${params})`;
        }
      }

      console.log(logMessage);

      const measureForNextLevel = (...args: any[]) => {
        if (typeof args[0] === 'function') {
          const nestedFn = args[0];
          const nestedAction = args[1] || 'noop';
          const childParentChain = [...fullIdChain, childCounter++];
          return _measureInternal(nestedFn, nestedAction, childParentChain);
        } else {
          const actionInternalNested = args[0];
          if (!actionInternalNested) return Promise.resolve(null);
          const actionLabelNested =
            typeof actionInternalNested === 'object' && actionInternalNested !== null && 'label' in actionInternalNested
              ? String(actionInternalNested.label)
              : String(actionInternalNested);

          let logMessageNested = `= ${fullIdChainStr} ${actionLabelNested}`;

          if (typeof actionInternalNested === 'object' && actionInternalNested !== null) {
            const details = { ...actionInternalNested };
            if ('label' in details) delete details.label;
            if (Object.keys(details).length > 0) {
              const params = Object.entries(details)
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join(' ');
              logMessageNested += ` (${params})`;
            }
          }

          console.log(logMessageNested);
          return Promise.resolve(null);
        }
      };

      const result = await fnInternal(measureForNextLevel);

      const duration = performance.now() - start;
      console.log(`< ${fullIdChainStr} ✓ ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`< ${fullIdChainStr} ✗ ${duration.toFixed(2)}ms (${errorMsg})`);
      if (error instanceof Error) {
        console.error(`${fullIdChainStr}`, error.stack ?? error.message);
        if (error.cause) {
          console.error(`${fullIdChainStr} Cause:`, error.cause);
        }
      } else {
        console.error(`${fullIdChainStr}`, error);
      }
      return null;
    }
  };

  if (typeof arg1 === 'function') {
    return _measureInternal(arg1 as any, action || 'noop', []) as Promise<T | null>;
  } else {
    const dummyFn = async (_measureForNextLevel: any): Promise<null> => null;
    return _measureInternal(dummyFn, arg1, []) as Promise<T | null>;
  }
}
