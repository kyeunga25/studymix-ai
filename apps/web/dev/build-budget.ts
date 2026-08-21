import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

const buildBudgetRoles = [
  "entry-js",
  "all-js",
  "login-js",
  "public-legal-js",
  "private-app-js",
  "access-readiness-js",
  "job-history-js",
  "job-experience-js",
  "entry-css",
  "all-css",
  "background-webp",
] as const;

export type BuildBudgetRole = (typeof buildBudgetRoles)[number];

export interface BuildSizeMeasurement {
  gzipBytes: number;
  rawBytes: number;
}

export interface BuildBudgetLimit {
  gzipBytes: number;
  rawBytes: number;
}

export type BuildBudgetLimits = Readonly<Record<BuildBudgetRole, BuildBudgetLimit>>;

export const webBuildBudgetLimits: BuildBudgetLimits = {
  "entry-js": { gzipBytes: 95_000, rawBytes: 300_000 },
  "all-js": { gzipBytes: 137_000, rawBytes: 420_000 },
  "login-js": { gzipBytes: 6_000, rawBytes: 15_000 },
  "public-legal-js": { gzipBytes: 17_000, rawBytes: 40_000 },
  "private-app-js": { gzipBytes: 20_000, rawBytes: 60_000 },
  "access-readiness-js": { gzipBytes: 4_000, rawBytes: 12_000 },
  "job-history-js": { gzipBytes: 4_000, rawBytes: 12_000 },
  "job-experience-js": { gzipBytes: 8_000, rawBytes: 24_000 },
  "entry-css": { gzipBytes: 5_000, rawBytes: 20_000 },
  "all-css": { gzipBytes: 15_000, rawBytes: 55_000 },
  "background-webp": { gzipBytes: 105_000, rawBytes: 110_000 },
};

export type BuildArtifact =
  | {
      code: string;
      facadeModuleId: string | null;
      fileName: string;
      isEntry: boolean;
      type: "chunk";
    }
  | {
      fileName: string;
      source: string | Uint8Array;
      type: "asset";
    };

export interface BuildMeasurementCollection {
  errors: readonly string[];
  measurements: ReadonlyMap<BuildBudgetRole, BuildSizeMeasurement>;
}

const fingerprintedJavaScriptPattern =
  /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8,}\.js$/u;
const fingerprintedCssPattern = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8,}\.css$/u;
const reviewedBackgroundPattern = /^assets\/study-room-bg-[A-Za-z0-9_-]{8,}\.webp$/u;

function safeArtifactType(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/u.exec(fileName);
  return match?.[1] === undefined ? "unknown type" : `.${match[1].toLowerCase()}`;
}

function decodeBuildText(source: string | Uint8Array): string | null {
  if (typeof source === "string") {
    return source;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    return null;
  }
}

function readQuotedAttribute(attributes: string, name: string): string | null {
  for (const match of attributes.matchAll(/\b([A-Za-z][A-Za-z0-9:-]*)\s*=\s*(["'])(.*?)\2/gu)) {
    if (match[1]?.toLowerCase() === name) {
      return match[3] ?? null;
    }
  }
  return null;
}

function isFingerprintedIndexJavaScript(url: string): boolean {
  return url.startsWith("/") && fingerprintedJavaScriptPattern.test(url.slice(1));
}

function isFingerprintedIndexCss(url: string): boolean {
  return url.startsWith("/") && fingerprintedCssPattern.test(url.slice(1));
}

export function validatePublicIndexHtml(source: string | Uint8Array): readonly string[] {
  const html = decodeBuildText(source);
  if (html === null) {
    return ["Public index.html is not valid UTF-8."];
  }

  const errors: string[] = [];
  if (/<style\b/iu.test(html) || /\sstyle\s*=/iu.test(html)) {
    errors.push("Public index.html contains inline style markup.");
  }
  if (/\son[A-Za-z][A-Za-z0-9_-]*\s*=/u.test(html)) {
    errors.push("Public index.html contains an inline event handler.");
  }

  const scriptOpenCount = [...html.matchAll(/<script\b/giu)].length;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)];
  if (scriptOpenCount !== 1 || scripts.length !== 1) {
    errors.push("Public index.html must contain exactly one external module script.");
  } else {
    const attributes = scripts[0]?.[1] ?? "";
    const body = scripts[0]?.[2] ?? "";
    const sourceUrl = readQuotedAttribute(attributes, "src");
    const type = readQuotedAttribute(attributes, "type");
    if (
      type?.toLowerCase() !== "module" ||
      sourceUrl === null ||
      !isFingerprintedIndexJavaScript(sourceUrl) ||
      body.trim().length > 0
    ) {
      errors.push("Public index.html module script is not an empty fingerprinted self asset.");
    }
  }

  const stylesheetLinks = [...html.matchAll(/<link\b([^>]*)>/giu)].filter((match) =>
    (readQuotedAttribute(match[1] ?? "", "rel") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .includes("stylesheet"),
  );
  if (stylesheetLinks.length !== 1) {
    errors.push("Public index.html must contain exactly one external stylesheet.");
  } else {
    const stylesheetUrl = readQuotedAttribute(stylesheetLinks[0]?.[1] ?? "", "href");
    if (stylesheetUrl === null || !isFingerprintedIndexCss(stylesheetUrl)) {
      errors.push("Public index.html stylesheet is not a fingerprinted self asset.");
    }
  }

  const rootCount = [...html.matchAll(/<div\b[^>]*\sid\s*=\s*(["'])root\1[^>]*>/giu)].length;
  if (rootCount !== 1) {
    errors.push("Public index.html must contain exactly one application root.");
  }

  for (const match of html.matchAll(/\s(?:src|href)\s*=\s*(["'])(.*?)\1/giu)) {
    const url = match[2] ?? "";
    if (!isFingerprintedIndexJavaScript(url) && !isFingerprintedIndexCss(url)) {
      errors.push("Public index.html references an unapproved asset URL.");
      break;
    }
  }

  return errors;
}

function isReviewedCssAssetUrl(url: string): boolean {
  return url.startsWith("/") && reviewedBackgroundPattern.test(url.slice(1));
}

export function validatePublicCss(source: string | Uint8Array): readonly string[] {
  const css = decodeBuildText(source);
  if (css === null) {
    return ["Public CSS is not valid UTF-8."];
  }

  const errors: string[] = [];
  if (/@import\b/iu.test(css)) {
    errors.push("Public CSS contains an import rule.");
  }
  if (/sourceMappingURL/iu.test(css)) {
    errors.push("Public CSS contains an embedded source map reference.");
  }

  const urlOpenCount = [...css.matchAll(/url\s*\(/giu)].length;
  const urlReferences = [...css.matchAll(/url\(\s*(?:(["'])([^"']*)\1|([^)]*))\s*\)/giu)];
  if (urlOpenCount !== urlReferences.length) {
    errors.push("Public CSS contains an unparseable URL reference.");
  } else {
    for (const reference of urlReferences) {
      const url = (reference[2] ?? reference[3] ?? "").trim();
      if (!isReviewedCssAssetUrl(url)) {
        errors.push("Public CSS references an unapproved asset URL.");
        break;
      }
    }
  }

  return errors;
}

export function validatePublicBuildArtifacts(
  artifacts: readonly BuildArtifact[],
): readonly string[] {
  const errors: string[] = [];
  let indexCount = 0;

  artifacts.forEach((artifact, index) => {
    if (artifact.type === "asset" && artifact.fileName === "index.html") {
      indexCount += 1;
      errors.push(...validatePublicIndexHtml(artifact.source));
      return;
    }
    if (artifact.type === "chunk" && fingerprintedJavaScriptPattern.test(artifact.fileName)) {
      return;
    }
    if (artifact.type === "asset" && fingerprintedCssPattern.test(artifact.fileName)) {
      errors.push(...validatePublicCss(artifact.source));
      return;
    }
    if (artifact.type === "asset" && reviewedBackgroundPattern.test(artifact.fileName)) {
      return;
    }

    errors.push(
      `Unexpected public build artifact #${index + 1} (${safeArtifactType(artifact.fileName)}).`,
    );
  });

  if (indexCount !== 1) {
    errors.push(`Expected one public index.html artifact, but found ${indexCount}.`);
  }

  return errors;
}

function measureSource(source: string | Uint8Array): BuildSizeMeasurement {
  return {
    gzipBytes: gzipSync(source).byteLength,
    rawBytes: Buffer.byteLength(source),
  };
}

function addMeasurements(
  first: BuildSizeMeasurement,
  second: BuildSizeMeasurement,
): BuildSizeMeasurement {
  return {
    gzipBytes: first.gzipBytes + second.gzipBytes,
    rawBytes: first.rawBytes + second.rawBytes,
  };
}

function fileBaseName(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf("/") + 1);
}

function routeRole(facadeModuleId: string | null): BuildBudgetRole | null {
  const normalizedId = facadeModuleId?.replaceAll("\\", "/");

  if (normalizedId?.endsWith("/src/LoginPage.tsx") === true) {
    return "login-js";
  }
  if (normalizedId?.endsWith("/src/PublicLegalRoute.tsx") === true) {
    return "public-legal-js";
  }
  if (normalizedId?.endsWith("/src/DeferredRoutes.tsx") === true) {
    return "private-app-js";
  }
  if (normalizedId?.endsWith("/src/access-readiness.tsx") === true) {
    return "access-readiness-js";
  }
  if (normalizedId?.endsWith("/src/recent-job-history.tsx") === true) {
    return "job-history-js";
  }
  if (normalizedId?.endsWith("/src/job-experience.tsx") === true) {
    return "job-experience-js";
  }

  return null;
}

export function collectBuildMeasurements(
  artifacts: readonly BuildArtifact[],
): BuildMeasurementCollection {
  const measurements = new Map<BuildBudgetRole, BuildSizeMeasurement>();
  const errors: string[] = [];
  let allCss = { gzipBytes: 0, rawBytes: 0 };
  let allJavaScript = { gzipBytes: 0, rawBytes: 0 };

  const recordSingle = (
    role: BuildBudgetRole,
    measurement: BuildSizeMeasurement,
    fileName: string,
  ) => {
    if (measurements.has(role)) {
      errors.push(`Expected one ${role} artifact, but found another: ${fileName}.`);
      return;
    }
    measurements.set(role, measurement);
  };

  for (const artifact of artifacts) {
    if (artifact.type === "chunk") {
      const measurement = measureSource(artifact.code);
      allJavaScript = addMeasurements(allJavaScript, measurement);

      if (artifact.isEntry) {
        recordSingle("entry-js", measurement, artifact.fileName);
      }

      const role = routeRole(artifact.facadeModuleId);
      if (role !== null) {
        recordSingle(role, measurement, artifact.fileName);
      }
      continue;
    }

    const baseName = fileBaseName(artifact.fileName);
    const measurement = measureSource(artifact.source);

    if (artifact.fileName.endsWith(".css")) {
      allCss = addMeasurements(allCss, measurement);
      if (/^index(?:-[^.]+)?\.css$/u.test(baseName)) {
        recordSingle("entry-css", measurement, artifact.fileName);
      }
    }

    if (/^study-room-bg(?:-[^.]+)?\.webp$/u.test(baseName)) {
      recordSingle("background-webp", measurement, artifact.fileName);
    }
  }

  measurements.set("all-js", allJavaScript);
  measurements.set("all-css", allCss);

  return { errors, measurements };
}

function isValidByteCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function evaluateBuildBudget(
  measurements: ReadonlyMap<BuildBudgetRole, BuildSizeMeasurement>,
  limits: BuildBudgetLimits = webBuildBudgetLimits,
): readonly string[] {
  const errors: string[] = [];

  for (const role of buildBudgetRoles) {
    const measurement = measurements.get(role);
    if (measurement === undefined) {
      errors.push(`Missing required ${role} build artifact.`);
      continue;
    }
    if (!isValidByteCount(measurement.rawBytes) || !isValidByteCount(measurement.gzipBytes)) {
      errors.push(`Invalid byte count for ${role}.`);
      continue;
    }

    const limit = limits[role];
    if (measurement.rawBytes > limit.rawBytes) {
      errors.push(`${role} raw size ${measurement.rawBytes} exceeds ${limit.rawBytes} bytes.`);
    }
    if (measurement.gzipBytes > limit.gzipBytes) {
      errors.push(`${role} gzip size ${measurement.gzipBytes} exceeds ${limit.gzipBytes} bytes.`);
    }
  }

  return errors;
}

export function studymixBuildBudgetPlugin(): Plugin {
  return {
    apply: "build",
    enforce: "post",
    name: "studymix-build-budget",
    generateBundle(_options, bundle) {
      const artifacts: BuildArtifact[] = Object.values(bundle).map((output) =>
        output.type === "chunk"
          ? {
              code: output.code,
              facadeModuleId: output.facadeModuleId,
              fileName: output.fileName,
              isEntry: output.isEntry,
              type: "chunk",
            }
          : {
              fileName: output.fileName,
              source: output.source,
              type: "asset",
            },
      );
      const collection = collectBuildMeasurements(artifacts);
      const errors = [
        ...validatePublicBuildArtifacts(artifacts),
        ...collection.errors,
        ...evaluateBuildBudget(collection.measurements),
      ];

      if (errors.length > 0) {
        this.error(`StudyMix web build budget failed:\n${errors.join("\n")}`);
      }
    },
  };
}
