import type { PrivateAccessStatus } from "./auth-session";

export const defaultPrivateDestination = "/app";

export type LoginFailureReason = "access-denied" | "session-expired" | "verification-failed";

export type PrivateAccessFailureStatus = Exclude<PrivateAccessStatus, "checking" | "verified">;

const navigationBase = "https://navigation.example.test";

function parseLoginFailureReason(value: string | null): LoginFailureReason | null {
  switch (value) {
    case "access-denied":
    case "session-expired":
    case "verification-failed":
      return value;
    default:
      return null;
  }
}

export function normalizePrivateDestination(value: string | null): string {
  if (value === null) {
    return defaultPrivateDestination;
  }

  try {
    const destination = new URL(value, navigationBase);
    if (
      destination.origin !== navigationBase ||
      (destination.pathname !== "/app" && !destination.pathname.startsWith("/app/"))
    ) {
      return defaultPrivateDestination;
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return defaultPrivateDestination;
  }
}

export function buildLoginRedirect(
  status: PrivateAccessFailureStatus,
  destination: string,
): string {
  const reason =
    status === "denied"
      ? "access-denied"
      : status === "signed-out"
        ? "session-expired"
        : "verification-failed";
  const query = new URLSearchParams({
    next: normalizePrivateDestination(destination),
    reason,
  });

  return `/login?${query.toString()}`;
}

export function readLoginNavigation(search: string): {
  destination: string;
  reason: LoginFailureReason | null;
} {
  const query = new URLSearchParams(search);

  return {
    destination: normalizePrivateDestination(query.get("next")),
    reason: parseLoginFailureReason(query.get("reason")),
  };
}
