export function isLoopbackRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

export function isLocalRuntimeEnvironment(environment: Pick<Env, "APP_ENV">): boolean {
  return environment.APP_ENV === "local";
}

export function isLocalRuntimeRequest(
  request: Request,
  environment: Pick<Env, "APP_ENV">,
): boolean {
  return isLocalRuntimeEnvironment(environment) && isLoopbackRequest(request);
}
