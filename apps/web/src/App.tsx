import { Component, lazy, Suspense, type ReactNode } from "react";
import { LandingPage } from "./LandingPage";
import { loadLegalRoute, loadLoginRoute, loadPrivateRoute } from "./route-loaders";
import { resolveAppRoute } from "./route-selection";

const LoginRoute = lazy(loadLoginRoute);
const PrivateRoute = lazy(loadPrivateRoute);
const LegalRoute = lazy(loadLegalRoute);

export function App() {
  const route = resolveAppRoute(window.location.pathname);

  if (route.kind === "landing") {
    return <LandingPage />;
  }

  return (
    <DeferredRouteBoundary>
      <Suspense fallback={<RouteLoading />}>
        {route.kind === "login" ? <LoginRoute /> : null}
        {route.kind === "private" ? <PrivateRoute /> : null}
        {route.kind === "legal" ? <LegalRoute documentId={route.documentId} /> : null}
      </Suspense>
    </DeferredRouteBoundary>
  );
}

class DeferredRouteBoundary extends Component<{ children: ReactNode }, { loadFailed: boolean }> {
  override state = { loadFailed: false };

  static getDerivedStateFromError() {
    return { loadFailed: true };
  }

  override render() {
    return this.state.loadFailed ? <RouteLoadFailure /> : this.props.children;
  }
}

function RouteLoading() {
  return (
    <main className="route-loading" role="status" aria-live="polite">
      <strong>正在載入頁面……</strong>
      <span>Loading page…</span>
    </main>
  );
}

function RouteLoadFailure() {
  return (
    <main className="route-loading is-error" role="alert">
      <strong>未能安全載入頁面</strong>
      <span>We could not safely load this page.</span>
      <button type="button" onClick={() => window.location.reload()}>
        重新載入 / Reload
      </button>
      <a href="/">返回產品介紹 / Back to overview</a>
    </main>
  );
}
