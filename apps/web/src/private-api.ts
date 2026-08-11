import {
  privateApiRequestHeaderName,
  privateApiRequestHeaderValue,
} from "@studymix/contracts/private-api";
import type { PrivateAccessFailureStatus } from "./auth-navigation";
import { withWebJsonRequestTimeout } from "./request-timeout";

export const privateAccessFailureEventName = "studymix:private-access-failure";

type PrivateApiPath = `/api/${string}`;

function announcePrivateAccessFailure(status: PrivateAccessFailureStatus): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(privateAccessFailureEventName, {
      detail: status,
    }),
  );
}

export function readPrivateAccessFailureEvent(event: Event): PrivateAccessFailureStatus | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  return event.detail === "signed-out" || event.detail === "denied" ? event.detail : null;
}

export async function fetchPrivateApi(
  path: PrivateApiPath,
  init: RequestInit = {},
  request: typeof fetch = fetch,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  headers.set(privateApiRequestHeaderName, privateApiRequestHeaderValue);

  const response = await request(path, {
    ...init,
    credentials: "same-origin",
    headers,
    signal: withWebJsonRequestTimeout(init.signal),
  });

  if (response.status === 401) {
    announcePrivateAccessFailure("signed-out");
  } else if (response.status === 403) {
    announcePrivateAccessFailure("denied");
  }

  return response;
}
