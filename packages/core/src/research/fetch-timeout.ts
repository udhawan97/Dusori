function combinedSignal(
  input: string | URL | Request,
  init: RequestInit | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal {
  const requestSignal =
    init?.signal ??
    (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  if (!requestSignal || requestSignal === timeoutSignal) return timeoutSignal;
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal;
}

/**
 * Bounds provider work and aborts any fetch it started. Rejecting a race without aborting left the
 * network request alive after Dusori had already reported a timeout.
 */
export async function withAbortingFetchTimeout<T>(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  timeoutMessage: string,
  work: (scopedFetch: typeof fetch) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const scopedFetch = ((input: string | URL | Request, init?: RequestInit) =>
    fetchImpl(input, {
      ...init,
      signal: combinedSignal(input, init, controller.signal),
    })) as typeof fetch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(scopedFetch),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
