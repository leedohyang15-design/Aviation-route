// Outbound HTTP with a deadline.
//
// Node's fetch has no default timeout: if a host accepts the connection and
// then never answers, the promise simply never settles. That is not a
// theoretical risk for this exhibit — the enrichment calls (adsbdb for the
// route, hexdb for the aircraft type) go to small community services, and a
// single hung request was enough to stop the hub answering a selection at all.
// The window's card would sit empty with nothing in the log after
// `[hub] select …`, because the await never returned.
//
// Every outbound call the exhibit makes goes through here.

/** Thrown when the deadline passes, so callers can tell it from a real error. */
class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export async function fetchWithTimeout(
  url: string,
  ms: number,
  init: RequestInit = {}
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    // An abort surfaces as a DOMException named AbortError; translate it so the
    // caller doesn't have to know that, and so logs say what actually happened.
    if ((err as Error)?.name === 'AbortError') throw new TimeoutError(ms)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Run a promise with a deadline, falling back to `onTimeout` instead of hanging. */
export async function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms)
  })
  try {
    return await Promise.race([work, guard])
  } finally {
    clearTimeout(timer)
  }
}
