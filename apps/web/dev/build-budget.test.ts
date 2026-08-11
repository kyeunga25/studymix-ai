import { describe, expect, it } from "vitest";
import {
  collectBuildMeasurements,
  evaluateBuildBudget,
  type BuildArtifact,
  validatePublicBuildArtifacts,
  validatePublicCss,
  validatePublicIndexHtml,
} from "./build-budget";

const syntheticIndexHtml = `<!doctype html>
<html>
  <head>
    <script type="module" src="/assets/index-synthetic.js"></script>
    <link rel="stylesheet" href="/assets/index-synthetic.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

function syntheticArtifacts(): BuildArtifact[] {
  return [
    {
      fileName: "index.html",
      source: syntheticIndexHtml,
      type: "asset",
    },
    {
      code: "e".repeat(1_000),
      facadeModuleId: "/synthetic/project/src/main.tsx",
      fileName: "assets/index-synthetic.js",
      isEntry: true,
      type: "chunk",
    },
    {
      code: "l".repeat(500),
      facadeModuleId: "/synthetic/project/src/LoginPage.tsx",
      fileName: "assets/LoginPage-synthetic.js",
      isEntry: false,
      type: "chunk",
    },
    {
      code: "d".repeat(500),
      facadeModuleId: "/synthetic/project/src/DeferredRoutes.tsx",
      fileName: "assets/DeferredRoutes-synthetic.js",
      isEntry: false,
      type: "chunk",
    },
    {
      code: "p".repeat(500),
      facadeModuleId: "/synthetic/project/src/PublicLegalRoute.tsx",
      fileName: "assets/PublicLegalRoute-synthetic.js",
      isEntry: false,
      type: "chunk",
    },
    {
      code: "j".repeat(500),
      facadeModuleId: "/synthetic/project/src/job-experience.tsx",
      fileName: "assets/job-experience-synthetic.js",
      isEntry: false,
      type: "chunk",
    },
    {
      fileName: "assets/index-synthetic.css",
      source: "i".repeat(500),
      type: "asset",
    },
    {
      fileName: "assets/styles-synthetic.css",
      source: "s".repeat(500),
      type: "asset",
    },
    {
      fileName: "assets/study-room-bg-synthetic.webp",
      source: new Uint8Array([1, 2, 3, 4]),
      type: "asset",
    },
  ];
}

describe("web build budget", () => {
  it("accepts a complete production bundle below every limit", () => {
    const collection = collectBuildMeasurements(syntheticArtifacts());

    expect(validatePublicBuildArtifacts(syntheticArtifacts())).toEqual([]);
    expect(collection.errors).toEqual([]);
    expect(evaluateBuildBudget(collection.measurements)).toEqual([]);
    expect(collection.measurements.get("all-js")?.rawBytes).toBe(3_000);
    expect(collection.measurements.get("all-css")?.rawBytes).toBe(1_000);
  });

  it("fails closed when a required route chunk is absent", () => {
    const artifacts = syntheticArtifacts().filter(
      (artifact) =>
        artifact.type !== "chunk" || !artifact.fileName.startsWith("assets/DeferredRoutes-"),
    );
    const collection = collectBuildMeasurements(artifacts);

    expect(evaluateBuildBudget(collection.measurements)).toContain(
      "Missing required private-app-js build artifact.",
    );
  });

  it("fails closed when the private job experience chunk is absent", () => {
    const artifacts = syntheticArtifacts().filter(
      (artifact) =>
        artifact.type !== "chunk" || !artifact.fileName.startsWith("assets/job-experience-"),
    );
    const collection = collectBuildMeasurements(artifacts);

    expect(evaluateBuildBudget(collection.measurements)).toContain(
      "Missing required job-experience-js build artifact.",
    );
  });

  it("reports duplicate entry artifacts without revealing module paths", () => {
    const artifacts = syntheticArtifacts();
    artifacts.push({
      code: "duplicate",
      facadeModuleId: "/synthetic/private/location/other-entry.tsx",
      fileName: "assets/second-entry-synthetic.js",
      isEntry: true,
      type: "chunk",
    });

    const collection = collectBuildMeasurements(artifacts);

    expect(collection.errors).toEqual([
      "Expected one entry-js artifact, but found another: assets/second-entry-synthetic.js.",
    ]);
    expect(collection.errors.join(" ")).not.toContain("/synthetic/private/location");
  });

  it("rejects an oversized anonymous entry chunk", () => {
    const artifacts = syntheticArtifacts();
    const entry = artifacts.find((artifact) => artifact.type === "chunk" && artifact.isEntry);
    if (entry?.type !== "chunk") {
      throw new Error("Synthetic entry fixture is missing.");
    }
    entry.code = "x".repeat(300_001);

    const collection = collectBuildMeasurements(artifacts);

    expect(evaluateBuildBudget(collection.measurements)).toContain(
      "entry-js raw size 300001 exceeds 300000 bytes.",
    );
  });

  it("rejects unreviewed public output without exposing its filename", () => {
    const artifacts = syntheticArtifacts();
    artifacts.push({
      fileName: "assets/synthetic-private-recording.mp3",
      source: new Uint8Array([1, 2, 3, 4]),
      type: "asset",
    });

    const errors = validatePublicBuildArtifacts(artifacts);

    expect(errors).toContain("Unexpected public build artifact #10 (.mp3).");
    expect(errors.join(" ")).not.toContain("synthetic-private-recording");
  });

  it("rejects an additional unreviewed WebP", () => {
    const artifacts = syntheticArtifacts();
    artifacts.push({
      fileName: "assets/extra-image-abcdefgh.webp",
      source: new Uint8Array([1, 2, 3, 4]),
      type: "asset",
    });

    expect(validatePublicBuildArtifacts(artifacts)).toContain(
      "Unexpected public build artifact #10 (.webp).",
    );
  });

  it("requires exactly one public HTML entry", () => {
    const artifacts = syntheticArtifacts().filter((artifact) => artifact.fileName !== "index.html");

    expect(validatePublicBuildArtifacts(artifacts)).toContain(
      "Expected one public index.html artifact, but found 0.",
    );
  });

  it("rejects inline scripts, styles, and event handlers", () => {
    const unsafeHtml = syntheticIndexHtml.replace(
      "</body>",
      '<style>body{display:none}</style><button style="display:none" onclick="run()">x</button><script>run()</script></body>',
    );

    const errors = validatePublicIndexHtml(unsafeHtml);

    expect(errors).toContain("Public index.html contains inline style markup.");
    expect(errors).toContain("Public index.html contains an inline event handler.");
    expect(errors).toContain("Public index.html must contain exactly one external module script.");
    expect(errors.join(" ")).not.toContain("display:none");
    expect(errors.join(" ")).not.toContain("onclick");
  });

  it("rejects external or unhashed entry asset URLs without echoing them", () => {
    const unsafeHtml = syntheticIndexHtml
      .replace("/assets/index-synthetic.js", "https://outside.example/app.js")
      .replace("/assets/index-synthetic.css", "/styles/app.css");

    const errors = validatePublicIndexHtml(unsafeHtml);

    expect(errors).toContain(
      "Public index.html module script is not an empty fingerprinted self asset.",
    );
    expect(errors).toContain("Public index.html stylesheet is not a fingerprinted self asset.");
    expect(errors).toContain("Public index.html references an unapproved asset URL.");
    expect(errors.join(" ")).not.toContain("outside.example");
  });

  it("requires valid UTF-8 and one application root", () => {
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    const missingRoot = syntheticIndexHtml.replace('<div id="root"></div>', "");

    expect(validatePublicIndexHtml(invalidUtf8)).toEqual(["Public index.html is not valid UTF-8."]);
    expect(validatePublicIndexHtml(missingRoot)).toContain(
      "Public index.html must contain exactly one application root.",
    );
  });

  it("accepts the reviewed fingerprinted CSS background", () => {
    const css = 'body{background-image:url("/assets/study-room-bg-abcdefgh.webp")}';

    expect(validatePublicCss(css)).toEqual([]);
    expect(validatePublicCss(new TextEncoder().encode(css))).toEqual([]);
  });

  it.each([
    ["data URI", "data:image/svg+xml;base64,AAAA"],
    ["external URL", "https://outside.example/background.webp"],
    ["unhashed URL", "/assets/study-room-bg.webp"],
  ] as const)("rejects an unapproved CSS %s without echoing it", (_case, url) => {
    const errors = validatePublicCss(`body{background-image:url("${url}")}`);

    expect(errors).toContain("Public CSS references an unapproved asset URL.");
    expect(errors.join(" ")).not.toContain(url);
  });

  it("rejects CSS imports and source map references", () => {
    const errors = validatePublicCss(
      '@import "theme.css";body{color:#111}/*# sourceMappingURL=styles.css.map */',
    );

    expect(errors).toContain("Public CSS contains an import rule.");
    expect(errors).toContain("Public CSS contains an embedded source map reference.");
  });

  it("rejects malformed UTF-8 CSS", () => {
    expect(validatePublicCss(new Uint8Array([0xc3, 0x28]))).toEqual([
      "Public CSS is not valid UTF-8.",
    ]);
  });
});
