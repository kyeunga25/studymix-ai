export async function loadLoginRoute() {
  const module = await import("./LoginPage");
  return { default: module.LoginPage };
}

export async function loadPrivateRoute() {
  const module = await import("./DeferredRoutes");
  return { default: module.PrivateApp };
}

export async function loadLegalRoute() {
  const module = await import("./PublicLegalRoute");
  return { default: module.PublicLegalExperience };
}

export async function loadJobExperience() {
  const module = await import("./job-experience");
  return { default: module.JobExperience };
}

export function preloadLoginRoute(): void {
  void loadLoginRoute().catch(() => undefined);
}

export function preloadPrivateRoute(): void {
  void loadPrivateRoute().catch(() => undefined);
}

export function preloadLegalRoute(): void {
  void loadLegalRoute().catch(() => undefined);
}
