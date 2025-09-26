export type measurecontext = {
  requestid?: string;
  level?: number;
  idchain?: string[];
};

export async function measure<t>(
  fn: (measure: typeof measure) => promise<t>,
  action: string | object,
  context: measurecontext = {}
): promise<t> {
  const start = performance.now();
  const currentid = math.random().tostring(36).substring(2, 8);
  const parentidchain = (context.idchain || []).map(id => `[${id}]`).join('');
  const fullidchain = [...(context.idchain || []), currentid].map(id => `[${id}]`).join('');

  try {
    const actionlabel = typeof action === 'object' && action !== null && 'label' in action 
      ? string(action.label) 
      : typeof action === 'object' 
        ? string(action) 
        : action;
    
    if (parentidchain) {
      console.log(`> ${parentidchain} ${actionlabel} (${currentid})`);
    } else {
      console.log(`> ${actionlabel} (${currentid})`);
    }
    
    if (typeof action === 'object' && action !== null) {
      delete action.label;
      if (object.keys(action).length > 0) {
        console.log(json.stringify(action, null, 2));
      }
    }

    const result = await fn((nestedfn, nestedaction) =>
      measure(nestedfn, nestedaction, {
        ...context,
        idchain: [...(context.idchain || []), currentid],
        level: (context.level || 0) + 1,
      })
    );

    const duration = performance.now() - start;
    console.log(`< ${fullidchain} ✓ ${duration.tofixed(2)}ms`);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    // console.log('=========================== error ===========================');
    console.log(`< ${fullidchain} ✗ failed ${duration.tofixed(2)}ms`);
    if (error instanceof error) {
      console.error(`${fullidchain}`, error.stack ?? error.message);
    } else {
      console.error(`${fullidchain}`, error);
    }
    // console.log('=============================================================');
    // throw error;
    return null;
  }
}

export const noop = () => {};
