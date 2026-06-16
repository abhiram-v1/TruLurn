// Shared timeout-aware fetch for every AI provider network call.
//
// Why this exists: none of the provider clients set a request timeout, so a hung
// upstream connection (OpenAI/Gemini stall, network black-hole) would block the
// request or generation job indefinitely. Critically, the router's provider
// fallback only triggers on a *thrown* error — a hang never throws, so failover
// was silently unreachable. Converting a stall into a timeout error restores
// fallback and bounds worst-case latency.
//
// The internal timeout controller is composed with any caller-supplied signal so
// user cancellation still propagates. When *our* timeout fires (and the external
// signal did NOT), we throw a labelled Error rather than a bare AbortError so the
// failure is legible in logs and retrieval traces.

const DEFAULT_AI_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 120_000)

export type AIFetchOptions = {
  /** Overrides AI_REQUEST_TIMEOUT_MS for this call (e.g. longer for web search). */
  timeoutMs?: number
  /** Caller cancellation signal (user abort, route teardown). Composed with the timeout. */
  signal?: AbortSignal
}

export async function aiFetch(
  url: string,
  init: RequestInit,
  options: AIFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS
  const external = options.signal
  const controller = new AbortController()

  const forwardAbort = () => controller.abort((external as AbortSignal & { reason?: unknown })?.reason)
  if (external) {
    if (external.aborted) controller.abort((external as AbortSignal & { reason?: unknown }).reason)
    else external.addEventListener('abort', forwardAbort, { once: true })
  }

  const timer = setTimeout(() => {
    controller.abort(new DOMException(`AI request timed out after ${timeoutMs}ms`, 'TimeoutError'))
  }, timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    // Our timeout fired and it was not a caller-initiated cancellation: surface a
    // clear, fallback-eligible error instead of an opaque AbortError.
    if (controller.signal.aborted && !external?.aborted) {
      throw new Error(`AI request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', forwardAbort)
  }
}
