export const WEB_JSON_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export function isWebRequestInterruption(error: unknown): error is DOMException {
  return (
    error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function withWebJsonRequestTimeout(signal?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(WEB_JSON_REQUEST_TIMEOUT_MILLISECONDS);
  return signal === undefined || signal === null
    ? timeoutSignal
    : AbortSignal.any([signal, timeoutSignal]);
}
