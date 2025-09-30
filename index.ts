function toAlpha(num: number): string {
  let result = '';
  let n = num;
  do {
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

export async function measure<T>(
  fn: (measure: typeof measure) => Promise<T>,
  action: string | object
): Promise<T | null> {
  const _measureInternal = async <U>(
    fnInternal: (measure: (fn: any, action: any) => Promise<U | null>) => Promise<U>,
    actionInternal: string | object,
    parentIdChain: string[]
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
        delete (details as { label?: string }).label;
        if (Object.keys(details).length > 0) {
          const params = Object.entries(details)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(' ');
          logMessage += ` (${params})`;
        }
      }

      console.log(logMessage);

      const measureForNextLevel = (nestedFn: any, nestedAction: any) => {
        const childParentChain = [...fullIdChain, childCounter++];
        return _measureInternal(nestedFn, nestedAction, childParentChain);
      };

      const result = await fnInternal(measureForNextLevel);

      const duration = performance.now() - start;
      console.log(`< ${fullIdChainStr} ✓ ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.log(`< ${fullIdChainStr} ✗ ${duration.toFixed(2)}ms (${error.message})`);
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

  return _measureInternal(fn, action, []);
}
