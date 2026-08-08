import type { PrivateAccessFailureStatus } from "./auth-navigation";

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
  headers.set("X-Requested-With", "XMLHttpRequest");

  const response = await request(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (response.status === 401) {
    announcePrivateAccessFailure("signed-out");
  } else if (response.status === 403) {
    announcePrivateAccessFailure("denied");
  }

  return response;
}
