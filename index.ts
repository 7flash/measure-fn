const toAlpha = (num: number): string => {
  let result = '';
  let n = num;
  do {
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
};

// Shared helpers
const buildActionLabel = (actionInternal: string | object): string => {
  return typeof actionInternal === 'object' && actionInternal !== null && 'label' in actionInternal
    ? String(actionInternal.label)
    : String(actionInternal);
};

const buildLogMessage = (
  prefix: string,
  actionLabel: string,
  actionInternal: string | object,
  fullIdChainStr: string
): string => {
  let logMessage = `${prefix} ${fullIdChainStr} ${actionLabel}`;
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
  return logMessage;
};

const logStart = (fullIdChainStr: string, actionInternal: string | object) => {
  const actionLabel = buildActionLabel(actionInternal);
  const logMessage = buildLogMessage('>', actionLabel, actionInternal, fullIdChainStr);
  console.log(logMessage);
};

const logNested = (fullIdChainStr: string, actionInternalNested: string | object) => {
  if (!actionInternalNested) return;
  const actionLabelNested = buildActionLabel(actionInternalNested);
  const logMessageNested = buildLogMessage('=', actionLabelNested, actionInternalNested, fullIdChainStr);
  console.log(logMessageNested);
};

const logSuccess = (fullIdChainStr: string, duration: number) => {
  console.log(`< ${fullIdChainStr} ✓ ${duration.toFixed(2)}ms`);
};

const logError = (fullIdChainStr: string, duration: number, error: unknown) => {
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
};

const createNestedResolver = (
  isAsync: boolean,
  fullIdChain: string[],
  childCounterRef: { value: number },
  resolver: <U>(fn: any, action: any, chain: (string | number)[]) => Promise<U | null> | (U | null)
) => {
  return (...args: any[]) => {
    if (typeof args[0] === 'function') {
      const nestedFn = args[0];
      const nestedAction = args[1] || 'noop';
      const childParentChain = [...fullIdChain, childCounterRef.value++];
      return resolver(nestedFn, nestedAction, childParentChain);
    } else {
      logNested(`[${fullIdChain.join('-')}]`, args[0]);
      return isAsync ? Promise.resolve(null) : null;
    }
  };
};

let globalRootCounter = 0;

export const measure = async <T = null>(
  arg1: ((measure: typeof measure) => Promise<T>) | string | object,
  action?: string | object
): Promise<T | null> => {
  const _measureInternal = async <U>(
    fnInternal: (measure: (fn: any, action: any) => Promise<U | null>) => Promise<U>,
    actionInternal: string | object,
    parentIdChain: (string | number)[]
  ): Promise<U | null> => {
    const start = performance.now();
    const childCounterRef = { value: 0 };

    const currentId = toAlpha(parentIdChain.pop() ?? 0);
    const fullIdChain = [...parentIdChain, currentId];
    const fullIdChainStr = `[${fullIdChain.join('-')}]`;

    logStart(fullIdChainStr, actionInternal);

    const measureForNextLevel = createNestedResolver(true, fullIdChain, childCounterRef, _measureInternal);

    try {
      const result = await fnInternal(measureForNextLevel);
      const duration = performance.now() - start;
      logSuccess(fullIdChainStr, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logError(fullIdChainStr, duration, error);
      return null;
    }
  };

  if (typeof arg1 === 'function') {
    return _measureInternal(arg1 as any, action || 'noop', [globalRootCounter++]) as Promise<T | null>;
  } else {
    const currentId = toAlpha(globalRootCounter++);
    const fullIdChainStr = `[${currentId}]`;
    logStart(fullIdChainStr, arg1);
    return Promise.resolve(null);
  }
};

export const measureSync = <T = null>(
  arg1: ((measure: typeof measureSync) => T) | string | object,
  action?: string | object
): T | null => {
  const _measureInternalSync = <U>(
    fnInternal: (measure: (fn: any, action: any) => U | null) => U,
    actionInternal: string | object,
    parentIdChain: (string | number)[]
  ): U | null => {
    const start = performance.now();
    const childCounterRef = { value: 0 };

    const currentId = toAlpha(parentIdChain.pop() ?? 0);
    const fullIdChain = [...parentIdChain, currentId];
    const fullIdChainStr = `[${fullIdChain.join('-')}]`;

    logStart(fullIdChainStr, actionInternal);

    const measureForNextLevel = createNestedResolver(false, fullIdChain, childCounterRef, _measureInternalSync);

    try {
      const result = fnInternal(measureForNextLevel);
      const duration = performance.now() - start;
      logSuccess(fullIdChainStr, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      logError(fullIdChainStr, duration, error);
      return null;
    }
  };

  if (typeof arg1 === 'function') {
    return _measureInternalSync(arg1 as any, action || 'noop', [globalRootCounter++]) as T | null;
  } else {
    const currentId = toAlpha(globalRootCounter++);
    const fullIdChainStr = `[${currentId}]`;
    logStart(fullIdChainStr, arg1);
    return null;
  }
};
