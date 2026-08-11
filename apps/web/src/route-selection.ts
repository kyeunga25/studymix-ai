import type { LegalDocumentId } from "@studymix/contracts";

export type AppRoute =
  | { kind: "landing" }
  | { kind: "legal"; documentId: LegalDocumentId }
  | { kind: "login" }
  | { kind: "private" };

const legalPathToDocumentId: Readonly<Record<string, LegalDocumentId>> = {
  "/legal/acceptable-use": "acceptable-use",
  "/legal/ai-output-notice": "ai-output-notice",
  "/legal/privacy": "privacy-notice",
  "/legal/terms": "terms-of-use",
};

export function resolveAppRoute(path: string): AppRoute {
  if (path === "/" || path === "/index.html") {
    return { kind: "landing" };
  }
  if (path === "/login") {
    return { kind: "login" };
  }

  const documentId = legalPathToDocumentId[path];
  if (documentId !== undefined) {
    return { documentId, kind: "legal" };
  }
  if (path === "/app" || path.startsWith("/app/")) {
    return { kind: "private" };
  }
  return { kind: "landing" };
}
