import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isWebRequestInterruption,
  WEB_JSON_REQUEST_TIMEOUT_MILLISECONDS,
  withWebJsonRequestTimeout,
} from "./request-timeout";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("web JSON request timeout", () => {
  it("recognizes caller aborts and request timeouts without classifying other failures", () => {
    expect(isWebRequestInterruption(new DOMException("Stopped.", "AbortError"))).toBe(true);
    expect(isWebRequestInterruption(new DOMException("Late.", "TimeoutError"))).toBe(true);
    expect(isWebRequestInterruption(new TypeError("Network failure."))).toBe(false);
  });

  it("uses the fixed deadline and preserves its TimeoutError reason", () => {
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    const signal = withWebJsonRequestTimeout();
    const timeoutError = new DOMException("Synthetic request timeout.", "TimeoutError");

    timeoutController.abort(timeoutError);

    expect(timeout).toHaveBeenCalledExactlyOnceWith(WEB_JSON_REQUEST_TIMEOUT_MILLISECONDS);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(timeoutError);
  });

  it("preserves a caller AbortError when it wins the combined signal", () => {
    const callerController = new AbortController();
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    const signal = withWebJsonRequestTimeout(callerController.signal);
    const abortError = new DOMException("Synthetic navigation.", "AbortError");

    callerController.abort(abortError);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(abortError);
    expect(timeoutController.signal.aborted).toBe(false);
  });
});
