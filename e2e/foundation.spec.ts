import { expect, test, type Page, type Route } from "@playwright/test";
import { activePrivateJobSessionKey } from "../apps/web/src/private-job-session";

const fixtureUploadId = "upl_11111111111111111111111111111111";
const browserMockUploadId = "upl_00000000000000000000000000000001";
const fixtureJobId = "job_22222222222222222222222222222222";
const otherHistoryJobId = "job_66666666666666666666666666666666";
const fixtureOutputIds = [
  "out_33333333333333333333333333333333",
  "out_44444444444444444444444444444444",
] as const;
const fixtureCreatedAt = "2026-07-26T00:00:00.000Z";
const fixtureExpiresAt = "2026-08-02T00:00:00.000Z";
const fixtureSigningTime = new Date();
fixtureSigningTime.setMilliseconds(0);
const fixtureSigningDate = fixtureSigningTime.toISOString().replace(/[:-]|\.\d{3}/g, "");
const fixtureSignedExpiresAt = new Date(fixtureSigningTime.getTime() + 3_600 * 1_000).toISOString();
const fixtureConfirmedUploadExpiresAt = new Date(
  fixtureSigningTime.getTime() + 24 * 60 * 60 * 1_000,
).toISOString();
const fixtureUploadObjectKey = `owners/own_${"1".repeat(32)}/uploads/${fixtureUploadId}/source`;
const fixtureUploadUrl = `https://${"0".repeat(32)}.r2.cloudflarestorage.com/synthetic-private-audio/${fixtureUploadObjectKey}?${new URLSearchParams(
  {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `SYNTHETIC_ACCESS_KEY/${fixtureSigningDate.slice(0, 8)}/auto/s3/aws4_request`,
    "X-Amz-Date": fixtureSigningDate,
    "X-Amz-Expires": "3600",
    "X-Amz-Signature": "a".repeat(64),
    "X-Amz-SignedHeaders": "content-length;content-type;host;if-none-match",
  },
).toString()}`;

function fixtureOutputUrl(outputId: string): string {
  const objectKey = `owners/own_${"1".repeat(32)}/outputs/${outputId}/candidate`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `SYNTHETIC_ACCESS_KEY/${fixtureSigningDate.slice(0, 8)}/auto/s3/aws4_request`,
    "X-Amz-Date": fixtureSigningDate,
    "X-Amz-Expires": "3600",
    "X-Amz-Signature": "b".repeat(64),
    "X-Amz-SignedHeaders": "host",
  });
  return `https://${"0".repeat(32)}.r2.cloudflarestorage.com/synthetic-private-audio/${objectKey}?${query.toString()}`;
}

function fixtureWave(): Buffer {
  const sampleCount = 8;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(sampleCount * 2, 40);
  return bytes;
}

function fixtureJob(status: "completed" | "created") {
  return {
    candidateCount: 2,
    completedAt: status === "completed" ? "2026-07-26T00:01:00.000Z" : null,
    createdAt: fixtureCreatedAt,
    errorCode: null,
    expiresAt: fixtureExpiresAt,
    jobId: fixtureJobId,
    outputs: fixtureOutputIds.map((outputId, candidateIndex) => ({
      candidateIndex,
      contentType: status === "completed" ? "audio/wav" : null,
      createdAt: fixtureCreatedAt,
      durationSeconds: status === "completed" ? 2 : null,
      expiresAt: fixtureExpiresAt,
      outputId,
      sizeBytes: status === "completed" ? 32_044 : null,
      status: status === "completed" ? "ready" : "pending",
    })),
    preset: { id: "soft-piano", version: 1 },
    retryPermitted: false,
    status,
    updatedAt: status === "completed" ? "2026-07-26T00:01:00.000Z" : fixtureCreatedAt,
    uploadId: fixtureUploadId,
  };
}

function fixtureJobSummary(status: "completed" | "created" = "completed") {
  const job = fixtureJob(status);
  return {
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    jobId: job.jobId,
    preset: job.preset,
    status: job.status,
    updatedAt: job.updatedAt,
  };
}

function successEnvelope(data: unknown) {
  return {
    data,
    error: null,
    requestId: "req_55555555555555555555555555555555",
  };
}

async function fulfillEmptyRecentJobsRead(route: Route): Promise<boolean> {
  if (route.request().method() !== "GET") {
    return false;
  }
  expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
  await route.fulfill({
    body: JSON.stringify(successEnvelope({ jobs: [] })),
    contentType: "application/json",
    status: 200,
  });
  return true;
}

function readUploadIdempotencyKey(route: Route): string {
  const body: unknown = route.request().postDataJSON();
  if (
    typeof body !== "object" ||
    body === null ||
    !("idempotencyKey" in body) ||
    typeof body.idempotencyKey !== "string"
  ) {
    throw new Error("Expected an upload idempotency key.");
  }
  return body.idempotencyKey;
}

function readJobIdempotencyKey(route: Route): string {
  const body: unknown = route.request().postDataJSON();
  if (
    typeof body !== "object" ||
    body === null ||
    !("idempotencyKey" in body) ||
    typeof body.idempotencyKey !== "string"
  ) {
    throw new Error("Expected a job idempotency key.");
  }
  return body.idempotencyKey;
}

function isLocalAiScenario(
  value: unknown,
): value is "success" | "terminal-failure" | "timeout-recovery" {
  return value === "success" || value === "terminal-failure" || value === "timeout-recovery";
}

function parseLocalSyntheticRequest(value: string | null): {
  fixture: "deterministic-tone-v1";
  idempotencyKey: string;
  scenario: "success" | "terminal-failure" | "timeout-recovery";
} {
  const parsed: unknown = JSON.parse(value ?? "null");
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("fixture" in parsed) ||
    parsed.fixture !== "deterministic-tone-v1" ||
    !("idempotencyKey" in parsed) ||
    typeof parsed.idempotencyKey !== "string" ||
    !("scenario" in parsed) ||
    !isLocalAiScenario(parsed.scenario)
  ) {
    throw new TypeError("The intercepted local source request is invalid.");
  }
  return {
    fixture: parsed.fixture,
    idempotencyKey: parsed.idempotencyKey,
    scenario: parsed.scenario,
  };
}

async function openPrivateAppInEnglish(page: Page, path = "/app") {
  await page.goto(path);
  await page.getByRole("button", { name: "EN" }).click();
}

async function setDocumentVisibility(page: Page, visibilityState: "hidden" | "visible") {
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibilityState);
}

async function prepareAuthorizedMix(page: Page, path = "/app") {
  await openPrivateAppInEnglish(page, path);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  await expect(page.locator(".file-structure-status")).toContainText(
    "Playable WAV metadata detected on this device",
  );
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
}

function privateRealSessionData() {
  return {
    authorization: {
      accountStatus: "active",
      aiJobApprovalMode: "manual",
      membershipStatus: "active",
      paymentStatus: "disabled",
      permissions: [
        "workspace:read",
        "workspace:manage",
        "jobs:create",
        "jobs:read",
        "credits:read",
        "approvals:manage",
      ],
      realProviderStatus: "approved",
      role: "owner",
      workspaceStatus: "active",
    },
    capabilities: {
      creditAccounting: true,
      localAiHarness: false,
      mockGeneration: false,
      privateAudioUpload: true,
      realGeneration: true,
      retentionCleanup: true,
    },
    kind: "development",
  };
}

async function routePrivateRealSession(page: Page) {
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(successEnvelope(privateRealSessionData())),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/credits", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          availableCredits: 20,
          plan: "private-beta",
          reservedCredits: 0,
          settledCredits: 0,
          status: "active",
          updatedAt: "2026-08-02T00:00:00.000Z",
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function routeLocalAiSession(page: Page) {
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          authorization: {
            accountStatus: "active",
            aiJobApprovalMode: "manual",
            membershipStatus: "active",
            paymentStatus: "disabled",
            permissions: [
              "workspace:read",
              "workspace:manage",
              "jobs:create",
              "jobs:read",
              "credits:read",
              "approvals:manage",
            ],
            realProviderStatus: "disabled",
            role: "owner",
            workspaceStatus: "active",
          },
          capabilities: {
            creditAccounting: false,
            localAiHarness: true,
            mockGeneration: true,
            privateAudioUpload: true,
            realGeneration: false,
            retentionCleanup: false,
          },
          kind: "development",
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function expectPrivateUploadInstructionRejected(
  page: Page,
  instruction: { expiresAt: string; uploadUrl: string },
) {
  await routePrivateRealSession(page);
  let cleanupSeen = false;
  let directUploadSeen = false;

  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          allowedContentTypes: ["audio/wav"],
          expiresAt: instruction.expiresAt,
          idempotencyKey: readUploadIdempotencyKey(route),
          maxUploadBytes: 524_288_000,
          objectKey: fixtureUploadObjectKey,
          requiredHeaders: { "Content-Type": "audio/wav", "If-None-Match": "*" },
          uploadId: fixtureUploadId,
          uploadMethod: "PUT",
          uploadUrl: instruction.uploadUrl,
        }),
      ),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route(`https://${"0".repeat(32)}.r2.cloudflarestorage.com/**`, async (route) => {
    directUploadSeen = true;
    await route.fulfill({ status: 200 });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}`, async (route) => {
    cleanupSeen = true;
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ status: "deleted", uploadId: fixtureUploadId })),
      contentType: "application/json",
      status: 200,
    });
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Securely upload audio" }).click();

  await expect(
    page.getByText("The private upload could not be confirmed. Check the file and try again."),
  ).toBeVisible();
  expect(directUploadSeen).toBe(false);
  expect(cleanupSeen).toBe(true);
}

async function expectReadableText(page: Page) {
  const undersizedText = await page.locator("body *").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const hasDirectText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0,
      );
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0;
      const fontSize = Number(style.fontSize.replace("px", ""));
      if (!visible || !hasDirectText || !Number.isFinite(fontSize) || fontSize >= 13) {
        return [];
      }

      return [
        {
          fontSize,
          tag: element.tagName,
          text: (element.textContent ?? "").trim().slice(0, 80),
        },
      ];
    }),
  );

  expect(undersizedText).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function expectCssRenderedWaveform(page: Page, selector: string) {
  const bars = page.locator(selector);
  expect(await bars.count()).toBeGreaterThan(0);
  const invalidBarCount = await bars.evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const height = Number(getComputedStyle(element).height.replace("px", ""));
        return element.hasAttribute("style") || !Number.isFinite(height) || height <= 0;
      }).length,
  );
  expect(invalidBarCount).toBe(0);
}

test("renders a public product overview without exposing the private app", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "把你的錄音，變成更適合專注的 Study Mix" }),
  ).toBeVisible();
  await expect(page.getByText("目前為封閉測試，尚未開放註冊及真實生成。")).toBeVisible();
  await expect(page.getByRole("link", { name: "受邀測試者登入" }).first()).toHaveAttribute(
    "href",
    "/login",
  );
  await expect(
    page.getByRole("navigation", { name: "法律文件" }).getByRole("link", {
      name: "使用條款",
    }),
  ).toHaveAttribute("href", "/legal/terms");
  const publicStylePreview = page.locator(".landing-style-options");
  await expect(publicStylePreview.getByText("木結他輕奏", { exact: true })).toBeVisible();
  await expect(publicStylePreview.getByText("慢拍舒緩電音", { exact: true })).toBeVisible();
  await expect(publicStylePreview.getByText("喫茶爵士輕拍", { exact: true })).toBeVisible();
  await expect(publicStylePreview.locator('[data-preset="kissa-jazzhop"]')).toHaveClass(
    /is-selected/,
  );
  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toHaveCount(0);
});

test("provides a dedicated beta sign-in page with future registration space", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "返回你的私人 StudyMix 工作區" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "登入", selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /建立帳戶/ })).toBeDisabled();
  await expect(page.getByText("公開註冊尚未開放", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "使用 Cloudflare 帳戶登入" })).toHaveAttribute(
    "href",
    "/app",
  );
  await expect(
    page.getByText("StudyMix 不會要求 API key 或 StudyMix 密碼。", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "法律文件" }).getByRole("link", {
      name: "AI 及輸出聲明",
    }),
  ).toHaveAttribute("href", "/legal/ai-output-notice");
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);

  await page.getByRole("link", { name: "使用 Cloudflare 帳戶登入" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toBeVisible();
});

test("offers a safe retry when a deferred route chunk fails to load", async ({ page }) => {
  let failNextLoginChunk = true;
  await page.route("**/src/LoginPage.tsx", async (route) => {
    if (failNextLoginChunk) {
      failNextLoginChunk = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/login");

  const loadFailure = page.getByRole("alert");
  await expect(loadFailure).toContainText("未能安全載入頁面");
  await expect(loadFailure).toContainText("We could not safely load this page.");
  await loadFailure.getByRole("button", { name: "重新載入 / Reload" }).click();
  await expect(page.getByRole("heading", { name: "返回你的私人 StudyMix 工作區" })).toBeVisible();
});

test("preloads deferred routes from user intent without entering the workspace", async ({
  page,
}) => {
  let legalChunkRequested = false;
  let loginChunkRequested = false;
  let privateChunkRequested = false;
  let sessionRequestCount = 0;

  await page.route("**/src/LoginPage.tsx", async (route) => {
    loginChunkRequested = true;
    await route.continue();
  });
  await page.route("**/src/PublicLegalRoute.tsx", async (route) => {
    legalChunkRequested = true;
    await route.continue();
  });
  await page.route("**/src/DeferredRoutes.tsx", async (route) => {
    privateChunkRequested = true;
    await route.continue();
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/session") {
      sessionRequestCount += 1;
    }
  });

  await page.goto("/");
  expect(loginChunkRequested).toBe(false);
  expect(legalChunkRequested).toBe(false);
  await page.getByRole("link", { name: "受邀測試者登入" }).first().hover();
  await expect.poll(() => loginChunkRequested).toBe(true);
  await page
    .getByRole("navigation", { name: "法律文件" })
    .getByRole("link", { name: "使用條款" })
    .hover();
  await expect.poll(() => legalChunkRequested).toBe(true);
  await expect(page).toHaveURL("/");

  await page.goto("/login");
  expect(privateChunkRequested).toBe(false);
  await page.getByRole("link", { name: "使用 Cloudflare 帳戶登入" }).focus();
  await expect.poll(() => privateChunkRequested).toBe(true);

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toHaveCount(0);
  expect(sessionRequestCount).toBe(0);
});

test("keeps public, login, workspace, and legal text readable on desktop", async ({ page }) => {
  for (const path of ["/", "/login", "/app", "/legal/privacy"] as const) {
    await page.goto(path);
    await expectReadableText(page);
    await expectNoHorizontalOverflow(page);
  }
});

test("keeps core pages readable and aligned on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/", "/login", "/app", "/legal/privacy"] as const) {
    await page.goto(path);
    await expectReadableText(page);
    await expectNoHorizontalOverflow(page);
  }

  for (const [path, selector] of [
    ["/", ".landing-style-options > div"],
    ["/app", ".preset-option"],
  ] as const) {
    await page.goto(path);
    await page.mouse.move(0, 0);
    const cards = page.locator(selector);
    await expect(cards).toHaveCount(6);
    const cardPositions = await cards.evaluateAll((elements) =>
      elements.map((card) => {
        const bounds = card.getBoundingClientRect();
        return { left: Math.round(bounds.left), top: Math.round(bounds.top) };
      }),
    );

    expect(cardPositions).toHaveLength(6);
    expect(new Set(cardPositions.map(({ left }) => left)).size).toBe(2);
    expect(new Set(cardPositions.map(({ top }) => top)).size).toBe(3);
  }
});

test("renders every core route without inline style attributes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body [style]")).toHaveCount(0);
  await expectCssRenderedWaveform(page, ".landing-waveform i, .landing-beta-wave i");

  for (const path of ["/login", "/legal/privacy"] as const) {
    await page.goto(path);
    await expect(page.locator("body [style]")).toHaveCount(0);
  }

  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  await expect(page.locator("body [style]")).toHaveCount(0);
  await expectCssRenderedWaveform(page, ".file-preview .waveform i");
});

test("rejects invalid audio selections before enabling generation", async ({ page }) => {
  let uploadRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/uploads" && request.method() === "POST") {
      uploadRequestCount += 1;
    }
  });

  await page.goto("/app");
  const input = page.locator('input[type="file"]');
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], "first.wav", { type: "audio/wav" }));
    transfer.items.add(new File([new Uint8Array([2])], "second.wav", { type: "audio/wav" }));
    return transfer;
  });
  await page.locator(".drop-zone").dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();

  await expect(page.getByRole("alert")).toContainText("每次只可選擇一個音訊檔案。");
  await expect(page.locator(".file-preview")).toHaveCount(0);
  expect(await input.getAttribute("multiple")).toBeNull();
  expect(await input.getAttribute("accept")).not.toContain("audio/*");

  await input.setInputFiles({
    buffer: Buffer.from("not audio"),
    mimeType: "text/plain",
    name: "notes.txt",
  });

  await expect(page.getByRole("alert")).toContainText(
    "請選擇 MP3、WAV、M4A、AAC 或 OGG 音訊檔案。",
  );
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".file-preview")).toHaveCount(0);

  await input.setInputFiles({ buffer: Buffer.alloc(0), mimeType: "audio/wav", name: "empty.wav" });
  await expect(page.getByRole("alert")).toContainText(
    "所選音訊檔案是空白的，請選擇含有音訊資料的檔案。",
  );

  await input.setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".file-preview")).toContainText("authorized-recording.wav");
  await expect(page.locator(".file-structure-status")).toContainText(
    "已在此裝置讀取可播放的 WAV 音訊元資料",
  );
  await expect(page.locator("#file-selection-status")).toContainText(
    "已在此裝置讀取可播放的 WAV 音訊元資料（少於 1 秒）。請確認相關權利並接受現行法律文件",
  );

  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await expect(page.getByRole("button", { name: "生成 2 個候選版本" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".file-structure-status.is-valid")).toBeVisible();
  expect(uploadRequestCount).toBe(0);
});

test("rejects renamed non-audio content before private upload creation", async ({ page }) => {
  await routePrivateRealSession(page);
  let legalAcceptanceRequestCount = 0;
  let uploadRequestCount = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/legal/acceptances" && request.method() === "POST") {
      legalAcceptanceRequestCount += 1;
    } else if (path === "/api/uploads" && request.method() === "POST") {
      uploadRequestCount += 1;
    }
  });

  await openPrivateAppInEnglish(page);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("synthetic text, not audio"),
    mimeType: "audio/mpeg",
    name: "renamed.mp3",
  });

  await expect(page.getByRole("alert")).toContainText(
    "The selected file is not a recognized MP3, WAV, M4A, AAC, or OGG audio stream.",
  );
  await expect(page.locator('input[type="file"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Securely upload audio" })).toBeDisabled();
  expect(legalAcceptanceRequestCount).toBe(0);
  expect(uploadRequestCount).toBe(0);
});

test("blocks a recognized container when the browser cannot read playback metadata", async ({
  page,
}) => {
  await routePrivateRealSession(page);
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => Number.NaN,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value(this: HTMLMediaElement) {
        if (this.hasAttribute("src")) {
          queueMicrotask(() => this.dispatchEvent(new Event("error")));
        }
      },
    });
  });
  const privateMutationCounts = { job: 0, legal: 0, upload: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/legal/acceptances" && request.method() === "POST") {
      privateMutationCounts.legal += 1;
    } else if (path === "/api/uploads" && request.method() === "POST") {
      privateMutationCounts.upload += 1;
    } else if (path === "/api/jobs" && request.method() === "POST") {
      privateMutationCounts.job += 1;
    }
  });

  await openPrivateAppInEnglish(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "recognized-container.wav",
  });

  await expect(page.getByRole("alert")).toContainText(
    "This browser could not read playable audio metadata from the selected file.",
  );
  await expect(page.getByRole("alert")).toContainText("no upload was started");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".file-structure-status.is-invalid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Securely upload audio" })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(privateMutationCounts).toEqual({ job: 0, legal: 0, upload: 0 });
});

test("does not let a stale local audio check replace a newer invalid selection", async ({
  page,
}) => {
  await routePrivateRealSession(page);
  await page.addInitScript(() => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    let readCount = 0;
    Blob.prototype.arrayBuffer = async function delayedFirstAudioRead(this: Blob) {
      readCount += 1;
      if (readCount === 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      return await originalArrayBuffer.call(this);
    };
  });

  await openPrivateAppInEnglish(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "first-valid.wav",
  });
  await expect(page.locator(".file-structure-status")).toContainText(
    "Checking audio structure and playback metadata on this device",
  );
  await input.setInputFiles({
    buffer: Buffer.from("synthetic text, not audio"),
    mimeType: "audio/mpeg",
    name: "newer-invalid.mp3",
  });

  await expect(page.getByRole("alert")).toContainText(
    "The selected file is not a recognized MP3, WAV, M4A, AAC, or OGG audio stream.",
  );
  await page.waitForTimeout(300);
  await expect(page.locator(".file-preview")).toContainText("newer-invalid.mp3");
  await expect(page.locator(".file-structure-status.is-invalid")).toBeVisible();
  await expect(page.locator(".file-structure-status.is-valid")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Securely upload audio" })).toBeDisabled();
});

test("shows an Access denial on the login interface without accepting an external redirect", async ({
  page,
}) => {
  await page.goto("/login?reason=access-denied&next=https%3A%2F%2Foutside.example%2Fprivate");

  await expect(page.getByRole("alert")).toContainText("未獲批准進入私密 Beta");
  await expect(page.getByRole("link", { name: "登出並改用另一個受邀身份" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
  await expect(page.getByRole("link", { name: "重新檢查目前身份" })).toHaveAttribute(
    "href",
    "/app",
  );
});

test("verifies the invited test session before showing the private app", async ({ page }) => {
  await page.goto("/app");

  const readiness = page.locator(".access-readiness:not(.is-loading)");
  await expect(page.getByRole("heading", { name: "工作區準備狀態" })).toBeVisible();
  await expect(readiness).toContainText("擁有人工作區已啟用");
  await expect(readiness.getByRole("listitem")).toHaveCount(6);
  await expect(readiness.getByRole("listitem").filter({ hasText: "真實 AI" })).toContainText(
    "不可用",
  );
  await expect(readiness.getByRole("listitem").filter({ hasText: "付款" })).toContainText("不可用");
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登出" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
});

test("shows a bilingual read-only workspace readiness dashboard", async ({ page }) => {
  let privateMutationCount = 0;
  await routePrivateRealSession(page);
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (
      pathname.startsWith("/api/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    ) {
      privateMutationCount += 1;
    }
  });

  await page.goto("/app");
  const readiness = page.locator(".access-readiness:not(.is-loading)");
  await expect(page.getByRole("heading", { name: "工作區準備狀態" })).toBeVisible();
  await expect(readiness.getByRole("listitem")).toHaveCount(6);
  await expect(readiness.getByRole("listitem").filter({ hasText: "私人上載" })).toContainText(
    "可用",
  );
  await expect(readiness.getByRole("listitem").filter({ hasText: "真實 AI" })).toContainText(
    "可用",
  );
  await expect(readiness.getByRole("listitem").filter({ hasText: "付款" })).toContainText("不可用");
  await expect(readiness).toContainText("切勿在此輸入 API key 或付款資料");

  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("heading", { name: "Workspace readiness" })).toBeVisible();
  await expect(readiness.getByRole("listitem").filter({ hasText: "Private upload" })).toContainText(
    "Available",
  );
  await expect(readiness.getByRole("listitem").filter({ hasText: "Real AI" })).toContainText(
    "Available",
  );
  await expect(readiness.getByRole("listitem").filter({ hasText: "Payments" })).toContainText(
    "Unavailable",
  );
  await expect(readiness).toContainText("Never enter API keys or payment details here.");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(privateMutationCount).toBe(0);
});

test("recovers private session verification after one transport failure", async ({ page }) => {
  let jobPostCount = 0;
  let sessionRequestCount = 0;
  await routePrivateRealSession(page);
  await page.unroute("**/api/session");
  await page.route("**/api/session", async (route) => {
    sessionRequestCount += 1;
    expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
    if (sessionRequestCount === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      body: JSON.stringify(successEnvelope(privateRealSessionData())),
      contentType: "application/json",
      status: 200,
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });

  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "工作區準備狀態" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app");
  expect(sessionRequestCount).toBe(2);
  expect(jobPostCount).toBe(0);
});

test("shows a private recent-job dashboard and opens only the selected owner-bound job", async ({
  page,
}) => {
  let historyReadCount = 0;
  let selectedJobReadCount = 0;
  let otherJobReadCount = 0;
  let jobPostCount = 0;
  await routePrivateRealSession(page);
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    historyReadCount += 1;
    expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          jobs: [
            fixtureJobSummary("completed"),
            {
              ...fixtureJobSummary("created"),
              jobId: otherHistoryJobId,
              preset: { id: "music-box", version: 1 },
              status: "failed",
            },
          ],
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    selectedJobReadCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 200,
    });
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === `/api/jobs/${otherHistoryJobId}` && request.method() === "GET") {
      otherJobReadCount += 1;
    }
    if (path === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  for (const outputId of fixtureOutputIds) {
    const downloadUrl = fixtureOutputUrl(outputId);
    await page.route(downloadUrl, async (route) => {
      await route.fulfill({ body: fixtureWave(), contentType: "audio/wav", status: 200 });
    });
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl,
            expiresAt: fixtureSignedExpiresAt,
            outputId,
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });
  }

  await openPrivateAppInEnglish(page);
  await expect(page.getByRole("heading", { name: "Recent private mixes" })).toBeVisible();
  await expect(page.locator(".job-history-list")).toContainText("Soft Piano");
  await expect(page.locator(".job-history-list")).toContainText("Music Box");
  await expect(page.locator(".job-history-panel")).not.toContainText(fixtureJobId);
  await expect(page.locator(".job-history-panel")).not.toContainText(otherHistoryJobId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Open private mix" }).first().click();
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  expect(historyReadCount).toBe(1);
  expect(selectedJobReadCount).toBe(1);
  expect(otherJobReadCount).toBe(0);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
  await expectNoHorizontalOverflow(page);
});

test("keeps the private workspace usable when recent-job history is unavailable", async ({
  page,
}) => {
  let historyReadCount = 0;
  let jobPostCount = 0;
  await routePrivateRealSession(page);
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    historyReadCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Synthetic internal history detail must stay hidden.",
          retryable: true,
        },
        requestId: "req_77777777777777777777777777777777",
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });

  await openPrivateAppInEnglish(page);
  await expect(page.getByRole("alert")).toContainText(
    "Recent mixes are unavailable. Your current work is unchanged.",
  );
  await expect(page.locator(".job-history-panel")).not.toContainText(
    "Synthetic internal history detail",
  );
  await expect(
    page.getByRole("heading", { name: "Turn your track into a study mix" }),
  ).toBeVisible();
  expect(historyReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
});

test("restores a remembered private job only after session verification", async ({ page }) => {
  let jobReadCount = 0;
  let jobPostCount = 0;
  let releaseJobRead = () => undefined;
  const jobReadGate = new Promise<void>((resolve) => {
    releaseJobRead = resolve;
  });
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    jobReadCount += 1;
    await jobReadGate;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 200,
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await page.goto("/app");
  await expect.poll(() => jobReadCount).toBe(1);
  try {
    await expect(page.getByText("正在找回你的私人工作……", { exact: true })).toBeVisible();
    await expect(page.locator("form.mix-workspace")).toHaveCount(0);
  } finally {
    releaseJobRead();
  }

  await expect(page.getByRole("heading", { name: "正在製作你的 Study Mix" })).toBeVisible();
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
});

test("restores completed private outputs and deletes the remembered job", async ({ page }) => {
  let jobDeleteCount = 0;
  let jobPostCount = 0;
  let jobReadCount = 0;
  const outputDownloadRequestCounts: Record<string, number> = Object.fromEntries(
    fixtureOutputIds.map((outputId) => [outputId, 0]),
  );
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      jobReadCount += 1;
      await route.fulfill({
        body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    expect(method).toBe("DELETE");
    jobDeleteCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ jobId: fixtureJobId, status: "deleted" })),
      contentType: "application/json",
      status: 200,
    });
  });
  for (const outputId of fixtureOutputIds) {
    const downloadUrl = fixtureOutputUrl(outputId);
    await page.route(downloadUrl, async (route) => {
      await route.fulfill({ body: fixtureWave(), contentType: "audio/wav", status: 200 });
    });
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      expect(route.request().method()).toBe("POST");
      outputDownloadRequestCounts[outputId] += 1;
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl,
            expiresAt: fixtureSignedExpiresAt,
            outputId,
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });
  }
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await openPrivateAppInEnglish(page);

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  await expect(page.getByText("Private audio source", { exact: true })).toBeVisible();
  await expect(page.getByText("authorized-recording.wav", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(2);
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(outputDownloadRequestCounts).toEqual({
    [fixtureOutputIds[0]]: 1,
    [fixtureOutputIds[1]]: 1,
  });

  await page.getByRole("button", { name: "Refresh private playback links" }).click();
  await expect
    .poll(() => outputDownloadRequestCounts)
    .toEqual({ [fixtureOutputIds[0]]: 2, [fixtureOutputIds[1]]: 2 });
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(2);
  expect(jobPostCount).toBe(0);

  await page.getByRole("button", { name: "Delete this private mix" }).click();

  await expect(page.getByRole("heading", { name: "Upload your audio" })).toBeVisible();
  expect(jobDeleteCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("explains expired restored outputs and keeps deletion owner-scoped", async ({ page }) => {
  let jobDeleteCount = 0;
  let jobPostCount = 0;
  let jobReadCount = 0;
  const outputDownloadRequestCounts: Record<string, number> = Object.fromEntries(
    fixtureOutputIds.map((outputId) => [outputId, 0]),
  );
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      jobReadCount += 1;
      await route.fulfill({
        body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    expect(method).toBe("DELETE");
    jobDeleteCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ jobId: fixtureJobId, status: "deleted" })),
      contentType: "application/json",
      status: 200,
    });
  });
  for (const outputId of fixtureOutputIds) {
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      outputDownloadRequestCounts[outputId] += 1;
      await route.fulfill({
        body: JSON.stringify({
          data: null,
          error: {
            code: "OUTPUT_EXPIRED",
            message: "Synthetic server-only output expiry detail.",
            retryable: false,
          },
          requestId: "req_55555555555555555555555555555555",
        }),
        contentType: "application/json",
        status: 410,
      });
    });
  }
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await openPrivateAppInEnglish(page);

  const errorAlert = page.getByRole("alert");
  await expect(errorAlert).toContainText("One or more private playback files have expired");
  await expect(errorAlert).not.toContainText("Synthetic server-only output expiry detail.");
  await expect(errorAlert).not.toContainText("req_55555555555555555555555555555555");
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete this private mix" })).toBeVisible();
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(jobDeleteCount).toBe(0);
  expect(outputDownloadRequestCounts).toEqual({
    [fixtureOutputIds[0]]: 1,
    [fixtureOutputIds[1]]: 1,
  });
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "繁體中文" }).click();
  await expect(page.getByRole("alert")).toContainText("一個或多個私人播放檔案已到期");
  await page.getByRole("button", { name: "刪除這個私人 Mix" }).click();

  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toBeVisible();
  expect(jobDeleteCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("retries output-not-ready instructions without recreating the restored job", async ({
  page,
}) => {
  let jobPostCount = 0;
  let jobReadCount = 0;
  const outputDownloadRequestCounts: Record<string, number> = Object.fromEntries(
    fixtureOutputIds.map((outputId) => [outputId, 0]),
  );
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    jobReadCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 200,
    });
  });
  for (const outputId of fixtureOutputIds) {
    const downloadUrl = fixtureOutputUrl(outputId);
    await page.route(downloadUrl, async (route) => {
      await route.fulfill({ body: fixtureWave(), contentType: "audio/wav", status: 200 });
    });
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      outputDownloadRequestCounts[outputId] += 1;
      if (outputId === fixtureOutputIds[0] && outputDownloadRequestCounts[outputId] === 1) {
        await route.fulfill({
          body: JSON.stringify({
            data: null,
            error: {
              code: "OUTPUT_NOT_READY",
              message: "Synthetic server-only output readiness detail.",
              retryable: true,
            },
            requestId: "req_55555555555555555555555555555555",
          }),
          contentType: "application/json",
          status: 409,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl,
            expiresAt: fixtureSignedExpiresAt,
            outputId,
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });
  }
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await openPrivateAppInEnglish(page);

  const errorAlert = page.getByRole("alert");
  await expect(errorAlert).toContainText("One or more private playback files are not ready yet");
  await expect(errorAlert).not.toContainText("Synthetic server-only output readiness detail.");
  await expect(errorAlert).not.toContainText("req_55555555555555555555555555555555");
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect
    .poll(() => outputDownloadRequestCounts)
    .toEqual({ [fixtureOutputIds[0]]: 1, [fixtureOutputIds[1]]: 1 });
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "繁體中文" }).click();
  await expect(page.getByRole("alert")).toContainText("一個或多個私人播放檔案尚未準備好");
  await page.getByRole("button", { name: "再試一次" }).click();

  await expect(page.getByRole("heading", { name: "你的 Study Mix 已準備好" })).toBeVisible();
  await expect(page.getByRole("link", { name: "下載候選版本" })).toHaveCount(2);
  expect(outputDownloadRequestCounts).toEqual({
    [fixtureOutputIds[0]]: 2,
    [fixtureOutputIds[1]]: 2,
  });
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
});

test("recovers restored private outputs without recreating the job", async ({ page }) => {
  let jobPostCount = 0;
  let jobReadCount = 0;
  let releaseOtherOutputInstruction = () => undefined;
  const otherOutputInstructionGate = new Promise<void>((resolve) => {
    releaseOtherOutputInstruction = resolve;
  });
  const outputDownloadRequestCounts: Record<string, number> = Object.fromEntries(
    fixtureOutputIds.map((outputId) => [outputId, 0]),
  );
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    jobReadCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 200,
    });
  });
  for (const outputId of fixtureOutputIds) {
    const downloadUrl = fixtureOutputUrl(outputId);
    await page.route(downloadUrl, async (route) => {
      await route.fulfill({ body: fixtureWave(), contentType: "audio/wav", status: 200 });
    });
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      expect(route.request().method()).toBe("POST");
      outputDownloadRequestCounts[outputId] += 1;
      if (outputId === fixtureOutputIds[0] && outputDownloadRequestCounts[outputId] <= 2) {
        if (outputDownloadRequestCounts[outputId] === 2) {
          await otherOutputInstructionGate;
        }
        await route.abort("failed");
        return;
      }
      if (outputId === fixtureOutputIds[1]) {
        releaseOtherOutputInstruction();
      }
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl,
            expiresAt: fixtureSignedExpiresAt,
            outputId,
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });
  }
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await openPrivateAppInEnglish(page);

  await expect(page.getByRole("alert")).toContainText(
    "The private job service could not be reached.",
  );
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(0);
  expect(outputDownloadRequestCounts).toEqual({
    [fixtureOutputIds[0]]: 2,
    [fixtureOutputIds[1]]: 1,
  });
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);

  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(2);
  expect(outputDownloadRequestCounts).toEqual({
    [fixtureOutputIds[0]]: 3,
    [fixtureOutputIds[1]]: 2,
  });
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
});

test("warns when the current tab cannot persist a private job reference", async ({ page }) => {
  let jobPostCount = 0;
  const staleJobId = `job_${"9".repeat(32)}`;
  await page.addInitScript(
    ({ currentJobId, storageKey }) => {
      const originalSetItem = Storage.prototype.setItem;
      let ignoreNextRecoveryWrite = true;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (
          this === window.sessionStorage &&
          key === storageKey &&
          value === currentJobId &&
          ignoreNextRecoveryWrite
        ) {
          ignoreNextRecoveryWrite = false;
          return;
        }
        originalSetItem.call(this, key, value);
      };
    },
    { currentJobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );
  await routeLocalAiSession(page);
  await page.route("**/api/local/synthetic-upload", async (route) => {
    const request = parseLocalSyntheticRequest(route.request().postData());
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          request,
          upload: {
            confirmedAt: fixtureCreatedAt,
            createdAt: fixtureCreatedAt,
            declaredContentType: "audio/wav",
            expiresAt: fixtureSignedExpiresAt,
            originalFilename: "studymix-synthetic-tone.wav",
            sizeBytes: 32_044,
            status: "confirmed",
            uploadId: fixtureUploadId,
          },
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobPostCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 200,
    });
  });

  await openPrivateAppInEnglish(page);
  await page.evaluate(({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId), {
    jobId: staleJobId,
    storageKey: activePrivateJobSessionKey,
  });
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Prepare synthetic source" }).click();
  await expect(
    page.getByText("Synthetic source confirmed in local R2.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run local Workflow" }).click();

  await expect(page.getByRole("heading", { name: "Creating your study mix" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "This browser could not save the private job recovery reference.",
  );
  await expect(page.getByRole("button", { name: "Retry saving recovery reference" })).toBeVisible();
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "繁體中文" }).click();
  await expect(page.getByRole("alert")).toContainText("瀏覽器未能保存私人工作的恢復識別資料。");
  await page.getByRole("button", { name: "再試保存恢復識別資料" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已為此分頁保存私人工作的恢復識別資料。" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "EN" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Private job recovery reference saved for this tab." }),
  ).toBeVisible();
  expect(jobPostCount).toBe(1);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
});

test("clears a stale remembered job without creating a replacement", async ({ page }) => {
  let jobPostCount = 0;
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: { code: "NOT_FOUND", message: "Synthetic job is unavailable.", retryable: false },
        requestId: "req_55555555555555555555555555555555",
      }),
      contentType: "application/json",
      status: 404,
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存的私人工作不再可用" }),
  ).toContainText("恢復識別資料已清除");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "EN" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The saved private job is no longer available" }),
  ).toContainText("recovery reference was cleared");
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("retries a browser-rejected stale job reference clear without another API request", async ({
  page,
}) => {
  let jobPostCount = 0;
  let jobReadCount = 0;
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    jobReadCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: { code: "NOT_FOUND", message: "Synthetic job is unavailable.", retryable: false },
        requestId: "req_66666666666666666666666666666666",
      }),
      contentType: "application/json",
      status: 404,
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => {
      const originalRemoveItem = Storage.prototype.removeItem;
      let rejectNextClear = true;
      window.sessionStorage.setItem(storageKey, jobId);
      Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (this === window.sessionStorage && key === storageKey && rejectNextClear) {
          rejectNextClear = false;
          throw new DOMException("Synthetic session storage denial.", "SecurityError");
        }
        originalRemoveItem.call(this, key);
      };
    },
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("瀏覽器未能清除恢復識別資料");
  await expect(page.getByRole("button", { name: "再試清除恢復識別資料" })).toBeVisible();
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "this browser could not clear its recovery reference",
  );
  await page.getByRole("button", { name: "Retry clearing recovery reference" }).click();

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "The saved private job is no longer available" }),
  ).toContainText("recovery reference was cleared");
  expect(jobReadCount).toBe(1);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("retries a remembered job read without creating a new job", async ({ page }) => {
  let jobReadCount = 0;
  let jobPostCount = 0;
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    jobReadCount += 1;
    if (jobReadCount <= 2) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 200,
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => window.sessionStorage.setItem(storageKey, jobId),
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await page.goto("/app");
  await expect(page.getByRole("alert")).toContainText("未能連接私人工作服務");
  await page.getByRole("button", { name: "再試一次" }).click();

  await expect(page.getByRole("heading", { name: "正在製作你的 Study Mix" })).toBeVisible();
  expect(jobReadCount).toBe(3);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
});

test("keeps a failed restored job visible until its start-over reference is cleared", async ({
  page,
}) => {
  let jobPostCount = 0;
  let jobReadCount = 0;
  await routePrivateRealSession(page);
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    jobReadCount += 1;
    await route.abort("failed");
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/jobs" && request.method() === "POST") {
      jobPostCount += 1;
    }
  });
  await page.addInitScript(
    ({ jobId, storageKey }) => {
      const originalRemoveItem = Storage.prototype.removeItem;
      let ignoreNextClear = true;
      window.sessionStorage.setItem(storageKey, jobId);
      Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (this === window.sessionStorage && key === storageKey && ignoreNextClear) {
          ignoreNextClear = false;
          return;
        }
        originalRemoveItem.call(this, key);
      };
    },
    { jobId: fixtureJobId, storageKey: activePrivateJobSessionKey },
  );

  await page.goto("/app");

  await expect(page.getByRole("alert")).toContainText("未能連接私人工作服務");
  expect(jobReadCount).toBe(2);
  await page.getByRole("button", { name: "建立另一個 Mix" }).click();

  await expect(page.getByRole("heading", { name: "未能完成這個 Study Mix" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "瀏覽器未能清除已保存的恢復識別資料" }),
  ).toContainText("目前工作會保留在畫面");
  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toHaveCount(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "EN" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not clear the saved recovery reference" }),
  ).toContainText("this job remains on screen");
  await page
    .getByRole("button", { name: "Retry clearing recovery reference and start another mix" })
    .click();

  await expect(page.getByRole("heading", { name: "Upload your audio" })).toBeVisible();
  expect(jobReadCount).toBe(2);
  expect(jobPostCount).toBe(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("distinguishes private credit loading, success, and unavailable states", async ({ page }) => {
  await routePrivateRealSession(page);
  await page.unroute("**/api/credits");
  let releaseCreditResponse = () => undefined;
  const creditResponseGate = new Promise<void>((resolve) => {
    releaseCreditResponse = resolve;
  });
  await page.route("**/api/credits", async (route) => {
    await creditResponseGate;
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          availableCredits: 20,
          plan: "private-beta",
          reservedCredits: 0,
          settledCredits: 0,
          status: "active",
          updatedAt: "2026-08-02T00:00:00.000Z",
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/app");
  const creditStatus = page.locator(".credit-status");
  try {
    await expect(creditStatus).toHaveAttribute("aria-busy", "true");
    await expect(creditStatus).toContainText("正在讀取額度");
    await page.getByRole("button", { name: "EN" }).click();
    await expect(creditStatus).toContainText("Loading credits");
  } finally {
    releaseCreditResponse();
  }
  await expect(creditStatus).toHaveAttribute("aria-busy", "false");
  await expect(creditStatus).toContainText("20 · 0");

  await page.unroute("**/api/credits");
  let transientCreditRequestCount = 0;
  await page.route("**/api/credits", async (route) => {
    transientCreditRequestCount += 1;
    if (transientCreditRequestCount === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          availableCredits: 19,
          plan: "private-beta",
          reservedCredits: 1,
          settledCredits: 0,
          status: "active",
          updatedAt: "2026-08-02T00:00:00.000Z",
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.reload();

  await expect(creditStatus).toHaveAttribute("aria-busy", "false");
  await expect(creditStatus).toContainText("19 · 1");
  expect(transientCreditRequestCount).toBe(2);

  await page.unroute("**/api/credits");
  let apiErrorRequestCount = 0;
  await page.route("**/api/credits", async (route) => {
    apiErrorRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Unavailable", retryable: true },
        requestId: "req_credit_unavailable",
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.reload();

  await expect(creditStatus).toHaveAttribute("aria-busy", "false");
  await expect(creditStatus).toContainText("額度暫時不可用");
  await page.getByRole("button", { name: "EN" }).click();
  await expect(creditStatus).toContainText("Credits unavailable");
  await expect(creditStatus).not.toContainText("20 · 0");
  expect(apiErrorRequestCount).toBe(1);
});

test("does not expose the private workspace when session verification fails", async ({ page }) => {
  await page.route("**/api/session", async (route) => {
    expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
    await route.fulfill({
      body: "<!doctype html><title>Access session expired</title>",
      contentType: "text/html",
      status: 401,
    });
  });
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("reason")).toBe("session-expired");
  await expect(page.getByRole("alert")).toContainText("需要重新登入");
  await expect(page.getByRole("link", { name: "重新登入並返回工作區" })).toHaveAttribute(
    "href",
    "/app",
  );
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("keeps the workspace locked when an authenticated account lacks beta permission", async ({
  page,
}) => {
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: { code: "FORBIDDEN", message: "This account is not permitted.", retryable: false },
        requestId: "req_0123456789abcdef0123456789abcdef",
      }),
      contentType: "application/json",
      status: 403,
    });
  });
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("reason")).toBe("access-denied");
  await expect(page.getByRole("alert")).toContainText("未獲批准進入私密 Beta");
  await expect(page.getByRole("link", { name: "登出並改用另一個受邀身份" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("returns an expired in-workspace API session to the login interface", async ({ page }) => {
  await page.route("**/api/legal/acceptances", async (route) => {
    expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
    await route.fulfill({
      body: "<!doctype html><title>Access session expired</title>",
      contentType: "text/html",
      status: 401,
    });
  });
  await page.goto("/app");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "生成 2 個候選版本" }).click();

  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("reason")).toBe("session-expired");
  await expect(page.getByRole("alert")).toContainText("需要重新登入");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("requires both rights and current legal documents before generation can be requested", async ({
  page,
}) => {
  await openPrivateAppInEnglish(page);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  await expect(page.locator(".file-structure-status")).toContainText(
    "Playable WAV metadata detected on this device",
  );

  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(0).check();
  await expect(page.getByRole("button", { name: "Generate 2 candidates" })).toBeDisabled();
  await checkboxes.nth(1).check();
  await expect(page.getByRole("button", { name: "Generate 2 candidates" })).toBeEnabled();
});

test("keeps generation blocked for an incomplete legal acceptance success", async ({ page }) => {
  let jobRequestCount = 0;
  await page.route("**/api/legal/acceptances", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          acceptedAt: {
            "acceptable-use": null,
            "ai-output-notice": fixtureCreatedAt,
            "terms-of-use": fixtureCreatedAt,
          },
          current: true,
          requiredDocuments: [
            { documentId: "terms-of-use", version: "2026-08-05" },
            { documentId: "acceptable-use", version: "2026-08-05" },
            { documentId: "ai-output-notice", version: "2026-08-05" },
          ],
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobRequestCount += 1;
    await route.abort();
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  await expect(
    page.getByText(
      "Acceptance was not recorded. Check the legal configuration and try again; generation remains blocked.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toHaveCount(0);
  expect(jobRequestCount).toBe(0);
});

test("selects the expanded study styles and carries jazz-hop into generation", async ({ page }) => {
  await prepareAuthorizedMix(page);

  const styleChoices = page.getByRole("radio", {
    name: /Soft Piano|Music Box|Lo-fi Study|Acoustic Ease|Slowwave|Kissa Jazzhop/,
  });
  await expect(styleChoices).toHaveCount(6);

  await page.getByRole("radio", { name: /Slowwave/ }).check();
  await expect(page.getByRole("radio", { name: /Slowwave/ })).toBeChecked();
  await expect(page.getByText("Slow electronic ambience with a gentle pulse")).toBeVisible();

  await page.getByRole("radio", { name: /Kissa Jazzhop/ }).check();
  await expect(page.getByRole("radio", { name: /Kissa Jazzhop/ })).toBeChecked();
  await expect(page.getByText("Warm jazz chords and mellow café beats")).toBeVisible();
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Kissa Jazzhop", { exact: true })).toBeVisible();
});

test("renders every versioned legal page and discloses the pre-release blockers", async ({
  page,
}) => {
  const documents = [
    ["/legal/terms", "Terms of Use"],
    ["/legal/privacy", "Privacy Notice"],
    ["/legal/acceptable-use", "Acceptable Use Policy"],
    ["/legal/ai-output-notice", "AI and Output Notice"],
  ] as const;

  for (const [path, heading] of documents) {
    await page.goto(path);
    await page.getByRole("button", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText("Document version: 2026-08-05")).toBeVisible();
    await expect(
      page.getByText(/Audio upload and external AI generation are disabled/),
    ).toBeVisible();
  }
});

test("recovers the public legal contact after one transport failure", async ({ page }) => {
  let manifestRequestCount = 0;
  let releaseManifestResponse = () => undefined;
  const manifestResponseGate = new Promise<void>((resolve) => {
    releaseManifestResponse = resolve;
  });
  await page.route("**/legal/documents.json", async (route) => {
    manifestRequestCount += 1;
    if (manifestRequestCount === 1) {
      await route.abort("failed");
      return;
    }
    await manifestResponseGate;
    await route.fallback();
  });

  await page.goto("/legal/privacy");
  try {
    await expect(page.getByText("正在核對已設定的公開聯絡方法……", { exact: true })).toBeVisible();
    await expect(page.getByText("正式聯絡方法暫時不可用", { exact: false })).toHaveCount(0);
  } finally {
    releaseManifestResponse();
  }
  await expect(page.getByRole("link", { name: "privacy@example.test" })).toHaveAttribute(
    "href",
    "mailto:privacy@example.test",
  );
  expect(manifestRequestCount).toBe(2);

  await page.unroute("**/legal/documents.json");
  let apiErrorRequestCount = 0;
  await page.route("**/legal/documents.json", async (route) => {
    apiErrorRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Unavailable", retryable: false },
        requestId: "legal-manifest-unavailable",
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.reload();

  await expect(page.getByText("正式聯絡方法暫時不可用", { exact: false })).toBeVisible();
  expect(apiErrorRequestCount).toBeGreaterThanOrEqual(1);
  expect(apiErrorRequestCount).toBeLessThanOrEqual(2);
});

test("loads the private job experience only when a job becomes active", async ({ page }) => {
  let jobExperienceRequested = false;
  let releaseJobExperience = () => undefined;
  const jobExperienceGate = new Promise<void>((resolve) => {
    releaseJobExperience = resolve;
  });
  await page.route("**/src/job-experience.tsx", async (route) => {
    jobExperienceRequested = true;
    await jobExperienceGate;
    await route.continue();
  });

  await prepareAuthorizedMix(page);
  expect(jobExperienceRequested).toBe(false);

  await page.getByRole("button", { name: "Generate 2 candidates" }).click();
  await expect.poll(() => jobExperienceRequested).toBe(true);
  try {
    await expect(page.getByText("Loading private job…", { exact: true })).toBeVisible();
    await expect(page.locator(".job-page")).toHaveAttribute("aria-busy", "true");
  } finally {
    releaseJobExperience();
  }

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible({
    timeout: 5_000,
  });
});

test("moves from a pending mock HTTP job to two playable result candidates", async ({ page }) => {
  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  const pendingRegion = page.getByRole("region", { name: "Creating your study mix" });
  await expect(
    pendingRegion.getByRole("heading", { name: "Creating your study mix" }),
  ).toBeVisible();
  await expect(pendingRegion.getByRole("status")).toContainText(
    /Request received|Generating candidates/,
  );
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible({
    timeout: 5_000,
  });

  const players = page.locator("audio");
  await expect(players).toHaveCount(2);
  await expect
    .poll(async () =>
      players.evaluateAll((elements) => elements.every((item) => item.readyState >= 1)),
    )
    .toBe(true);
  await page.getByRole("radio", { name: "I prefer this version" }).nth(1).check();
  await expect(page.getByText("Preferred", { exact: true })).toBeVisible();
  await expect(page.getByText(/AI output may not preserve every musical detail/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Refresh private playback links" })).toHaveCount(0);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("rejects a create success for another private upload", async ({ page }) => {
  let jobRequestCount = 0;
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 202,
    });
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "The request or service response was invalid.",
  );
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this private mix" })).toHaveCount(0);
  expect(jobRequestCount).toBe(1);
});

test("pauses private job polling while hidden and resumes until completion", async ({ page }) => {
  let pollCount = 0;
  let clientAbortObserved = false;
  let firstPollReleased = false;
  let releaseFirstPoll = () => undefined;
  const firstPollGate = new Promise<void>((resolve) => {
    releaseFirstPoll = resolve;
  });
  page.on("requestfailed", (request) => {
    if (request.url().endsWith(`/api/jobs/${fixtureJobId}`) && !firstPollReleased) {
      clientAbortObserved = true;
    }
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({ ...fixtureJob("created"), uploadId: browserMockUploadId }),
      ),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    pollCount += 1;
    if (pollCount === 1) {
      await firstPollGate;
      await route.abort("aborted").catch(() => undefined);
      return;
    }
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          ...fixtureJob(pollCount >= 3 ? "completed" : "created"),
          uploadId: browserMockUploadId,
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  await expect(page.getByRole("region", { name: "Creating your study mix" })).toBeVisible();
  await expect.poll(() => pollCount).toBe(1);
  await setDocumentVisibility(page, "hidden");
  await page.waitForTimeout(150);
  const abortedBeforeTestRelease = clientAbortObserved;
  firstPollReleased = true;
  releaseFirstPoll();
  expect(abortedBeforeTestRelease).toBe(true);
  await page.waitForTimeout(1_100);
  expect(pollCount).toBe(1);

  await setDocumentVisibility(page, "visible");

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible({
    timeout: 6_000,
  });
  expect(pollCount).toBeGreaterThanOrEqual(3);
});

test("does not offer terminal deletion after a pending job read failure", async ({ page }) => {
  let jobReadCount = 0;
  let releaseManualRetry = () => undefined;
  const manualRetryGate = new Promise<void>((resolve) => {
    releaseManualRetry = resolve;
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({ ...fixtureJob("created"), uploadId: browserMockUploadId }),
      ),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    jobReadCount += 1;
    if (jobReadCount <= 2) {
      await route.abort("failed");
      return;
    }
    await manualRetryGate;
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({ ...fixtureJob("completed"), uploadId: browserMockUploadId }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The private job service could not be reached.", {
    timeout: 5_000,
  });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this private mix" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start another mix" })).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  try {
    await expect(page.getByRole("heading", { name: "Creating your study mix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete this private mix" })).toHaveCount(0);
  } finally {
    releaseManualRetry();
  }
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  expect(jobReadCount).toBe(3);
});

test("uses the private real-provider API flow and binds deletion to its job", async ({ page }) => {
  const otherJobId = `job_${"f".repeat(32)}`;
  let deletionRequestCount = 0;
  let directUploadSeen = false;
  let jobRequestCount = 0;
  let outputDownloadRequestCount = 0;
  let submittedJob: unknown;
  await routePrivateRealSession(page);
  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          allowedContentTypes: ["audio/wav"],
          expiresAt: fixtureSignedExpiresAt,
          idempotencyKey: readUploadIdempotencyKey(route),
          maxUploadBytes: 524_288_000,
          objectKey: fixtureUploadObjectKey,
          requiredHeaders: { "Content-Type": "audio/wav", "If-None-Match": "*" },
          uploadId: fixtureUploadId,
          uploadMethod: "PUT",
          uploadUrl: fixtureUploadUrl,
        }),
      ),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route(fixtureUploadUrl, async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["content-type"]).toBe("audio/wav");
    expect(route.request().headers()["if-none-match"]).toBe("*");
    directUploadSeen = true;
    await route.fulfill({ status: 200 });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}/confirm`, async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          confirmedAt: fixtureCreatedAt,
          createdAt: fixtureCreatedAt,
          declaredContentType: "audio/wav",
          expiresAt: fixtureConfirmedUploadExpiresAt,
          originalFilename: "authorized-recording.wav",
          sizeBytes: fixtureWave().byteLength,
          status: "confirmed",
          uploadId: fixtureUploadId,
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobRequestCount += 1;
    submittedJob = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    deletionRequestCount += 1;
    expect(route.request().method()).toBe("DELETE");
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ jobId: otherJobId, status: "deleted" })),
      contentType: "application/json",
      status: 200,
    });
  });
  for (const outputId of fixtureOutputIds) {
    const downloadUrl = fixtureOutputUrl(outputId);
    await page.route(downloadUrl, async (route) => {
      await route.fulfill({ body: Buffer.alloc(44), contentType: "audio/wav", status: 200 });
    });
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      outputDownloadRequestCount += 1;
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl,
            expiresAt: fixtureSignedExpiresAt,
            outputId,
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });
  }

  await prepareAuthorizedMix(page);
  await expect(page.getByText("20 · 0")).toBeVisible();
  await page.getByRole("button", { name: "Securely upload audio" }).click();
  await expect(page.getByText("Private upload confirmed.", { exact: false })).toBeVisible();
  expect(directUploadSeen).toBe(true);
  await page.getByRole("button", { name: "Generate 2 private AI candidates" }).click();

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(2);
  expect(outputDownloadRequestCount).toBe(2);
  expect(jobRequestCount).toBe(1);
  await page.getByRole("button", { name: "Refresh private playback links" }).click();
  await expect.poll(() => outputDownloadRequestCount).toBe(4);
  await expect(page.getByRole("link", { name: "Download candidate" })).toHaveCount(2);
  expect(jobRequestCount).toBe(1);
  expect(submittedJob).toMatchObject({
    candidateCount: 2,
    presetId: "soft-piano",
    rightsDeclarationVersion: "v1",
    uploadId: fixtureUploadId,
  });
  expect(JSON.stringify(submittedJob)).not.toContain("fal");
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);

  await page.getByRole("button", { name: "Delete this private mix" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The private mix could not be deleted. Please retry.",
  );
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  expect(deletionRequestCount).toBe(1);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);
});

test("rejects a mismatched upload confirmation before private job creation", async ({ page }) => {
  let cleanupRequestCount = 0;
  let directUploadRequestCount = 0;
  let jobRequestCount = 0;
  await routePrivateRealSession(page);
  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          allowedContentTypes: ["audio/wav"],
          expiresAt: fixtureSignedExpiresAt,
          idempotencyKey: readUploadIdempotencyKey(route),
          maxUploadBytes: 524_288_000,
          objectKey: fixtureUploadObjectKey,
          requiredHeaders: { "Content-Type": "audio/wav", "If-None-Match": "*" },
          uploadId: fixtureUploadId,
          uploadMethod: "PUT",
          uploadUrl: fixtureUploadUrl,
        }),
      ),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route(fixtureUploadUrl, async (route) => {
    directUploadRequestCount += 1;
    await route.fulfill({ status: 200 });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}/confirm`, async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          confirmedAt: fixtureCreatedAt,
          createdAt: fixtureCreatedAt,
          declaredContentType: "audio/wav",
          expiresAt: fixtureConfirmedUploadExpiresAt,
          originalFilename: "authorized-recording.wav",
          sizeBytes: fixtureWave().byteLength,
          status: "confirmed",
          uploadId: `upl_${"f".repeat(32)}`,
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}`, async (route) => {
    cleanupRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ status: "deleted", uploadId: fixtureUploadId })),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobRequestCount += 1;
    await route.fulfill({ status: 500 });
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Securely upload audio" }).click();

  await expect(
    page.getByText("The private upload could not be confirmed. Check the file and try again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Securely upload audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Generate 2 private AI candidates" })).toHaveCount(
    0,
  );
  expect(directUploadRequestCount).toBe(1);
  expect(cleanupRequestCount).toBe(1);
  expect(jobRequestCount).toBe(0);
});

test("loads local private outputs through bounded authenticated fetches and revokes stale or partial blobs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (value: string) => {
      const current = Number(document.documentElement.dataset.revokedLocalOutputCount ?? "0");
      document.documentElement.dataset.revokedLocalOutputCount = (current + 1).toString();
      originalRevoke(value);
    };
  });
  await routeLocalAiSession(page);
  const wave = fixtureWave();
  let localContentRequestCount = 0;

  await page.route("**/api/local/synthetic-upload", async (route) => {
    const request = parseLocalSyntheticRequest(route.request().postData());
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          request,
          upload: {
            confirmedAt: fixtureCreatedAt,
            createdAt: fixtureCreatedAt,
            declaredContentType: "audio/wav",
            expiresAt: fixtureSignedExpiresAt,
            originalFilename: "studymix-synthetic-tone.wav",
            sizeBytes: 32_044,
            status: "confirmed",
            uploadId: fixtureUploadId,
          },
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 202,
    });
  });
  for (const outputId of fixtureOutputIds) {
    const contentPath = `/api/local/outputs/${outputId}/content`;
    await page.route(`**${contentPath}`, async (route) => {
      localContentRequestCount += 1;
      expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
      expect(route.request().resourceType()).toBe("fetch");
      const rejectRefreshedSecondCandidate =
        outputId === fixtureOutputIds[1] && localContentRequestCount > 2;
      if (rejectRefreshedSecondCandidate) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      await route.fulfill({
        body: wave,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Length": wave.byteLength.toString(),
          "Content-Type": rejectRefreshedSecondCandidate ? "text/plain" : "audio/wav",
        },
        status: 200,
      });
    });
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl: contentPath,
            expiresAt: fixtureSignedExpiresAt,
            outputId,
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });
  }

  await openPrivateAppInEnglish(page);
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Prepare synthetic source" }).click();
  await expect(
    page.getByText("Synthetic source confirmed in local R2.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run local Workflow" }).click();

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible();
  await expect.poll(() => localContentRequestCount).toBe(2);
  const sourceUrls = await page
    .locator("audio")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("src")));
  expect(sourceUrls).toHaveLength(2);
  expect(sourceUrls.every((source) => source?.startsWith("blob:") === true)).toBe(true);

  await page.getByRole("button", { name: "Refresh private playback links" }).click();
  await expect.poll(() => localContentRequestCount).toBe(4);
  await expect(page.getByRole("alert")).toContainText(
    "The request or service response was invalid.",
  );
  await expect(page.locator("audio")).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() => Number(document.documentElement.dataset.revokedLocalOutputCount ?? "0")),
    )
    .toBeGreaterThanOrEqual(3);
});

test("presents local job cancellation as a normal terminal state", async ({ page }) => {
  await routeLocalAiSession(page);
  let cancellationRequestCount = 0;
  let deletionRequestCount = 0;
  let releaseCancellation = () => undefined;
  const cancellationGate = new Promise<void>((resolve) => {
    releaseCancellation = resolve;
  });
  const cancelledJob = {
    ...fixtureJob("created"),
    completedAt: "2026-07-26T00:00:30.000Z",
    errorCode: "CANCELLED_BY_OWNER",
    status: "cancelled",
    updatedAt: "2026-07-26T00:00:30.000Z",
  } as const;

  await page.route("**/api/local/synthetic-upload", async (route) => {
    const request = parseLocalSyntheticRequest(route.request().postData());
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          request,
          upload: {
            confirmedAt: fixtureCreatedAt,
            createdAt: fixtureCreatedAt,
            declaredContentType: "audio/wav",
            expiresAt: fixtureSignedExpiresAt,
            originalFilename: "studymix-synthetic-tone.wav",
            sizeBytes: 32_044,
            status: "confirmed",
            uploadId: fixtureUploadId,
          },
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}/cancel`, async (route) => {
    cancellationRequestCount += 1;
    await cancellationGate;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(cancelledJob)),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    if (route.request().method() === "DELETE") {
      deletionRequestCount += 1;
      await route.fulfill({
        body: JSON.stringify(successEnvelope({ jobId: fixtureJobId, status: "deleted" })),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 200,
    });
  });

  await openPrivateAppInEnglish(page);
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Prepare synthetic source" }).click();
  await page.getByRole("button", { name: "Run local Workflow" }).click();
  await expect(page.getByRole("button", { name: "Cancel local job" })).toBeVisible();
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBe(fixtureJobId);

  await page.getByRole("button", { name: "Cancel local job" }).click();
  try {
    await expect.poll(() => cancellationRequestCount).toBe(1);
    await expect(page.getByRole("button", { name: "Cancelling local job…" })).toBeDisabled();
  } finally {
    releaseCancellation();
  }

  const cancelledRegion = page.getByRole("region", { name: "Local job cancelled" });
  await expect(cancelledRegion.getByRole("heading", { name: "Local job cancelled" })).toBeVisible();
  await expect(cancelledRegion.getByRole("status")).toContainText("Local job cancelled");
  await expect(
    page.getByText("reserved beta credits were released", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "We could not finish this study mix" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete this private mix" })).toBeVisible();

  await page.getByRole("button", { name: "Delete this private mix" }).click();
  await expect(page.getByRole("heading", { name: "Local synthetic source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare synthetic source" })).toBeDisabled();
  expect(cancellationRequestCount).toBe(1);
  expect(deletionRequestCount).toBe(1);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("explains insufficient beta credits without discarding the confirmed upload", async ({
  page,
}) => {
  await routeLocalAiSession(page);
  let cleanupRequestCount = 0;
  let jobRequestCount = 0;
  await page.route("**/api/local/synthetic-upload", async (route) => {
    const request = parseLocalSyntheticRequest(route.request().postData());
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          request,
          upload: {
            confirmedAt: fixtureCreatedAt,
            createdAt: fixtureCreatedAt,
            declaredContentType: "audio/wav",
            expiresAt: fixtureSignedExpiresAt,
            originalFilename: "studymix-synthetic-tone.wav",
            sizeBytes: 32_044,
            status: "confirmed",
            uploadId: fixtureUploadId,
          },
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: "Synthetic server-only credit detail.",
          retryable: false,
        },
        requestId: "req_55555555555555555555555555555555",
      }),
      contentType: "application/json",
      status: 409,
    });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}`, async (route) => {
    cleanupRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ status: "deleted", uploadId: fixtureUploadId })),
      contentType: "application/json",
      status: 200,
    });
  });

  await openPrivateAppInEnglish(page);
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Prepare synthetic source" }).click();
  await page.getByRole("button", { name: "Run local Workflow" }).click();

  const errorAlert = page.getByRole("alert");
  await expect(errorAlert).toContainText("There are not enough beta credits to create this mix.");
  await expect(errorAlert).not.toContainText("Synthetic server-only credit detail.");
  await expect(errorAlert).not.toContainText("req_55555555555555555555555555555555");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to private upload" })).toBeVisible();
  expect(jobRequestCount).toBe(1);
  expect(cleanupRequestCount).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadableText(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "繁體中文" }).click();
  await expect(page.getByRole("alert")).toContainText("目前沒有足夠 Beta 額度建立這個 Mix。");
  await page.getByRole("button", { name: "返回私人上載" }).click();

  await expect(
    page
      .getByLabel("把你的音樂變成專注讀書 Mix")
      .getByText("studymix-synthetic-tone.wav", { exact: true }),
  ).toBeVisible();
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  expect(jobRequestCount).toBe(1);
  expect(cleanupRequestCount).toBe(0);
});

test("keeps a confirmed private upload recoverable after job creation fails", async ({ page }) => {
  await routeLocalAiSession(page);
  let cleanupRequestCount = 0;
  const jobIdempotencyKeys: string[] = [];
  await page.route("**/api/local/synthetic-upload", async (route) => {
    const request = parseLocalSyntheticRequest(route.request().postData());
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          request,
          upload: {
            confirmedAt: fixtureCreatedAt,
            createdAt: fixtureCreatedAt,
            declaredContentType: "audio/wav",
            expiresAt: fixtureSignedExpiresAt,
            originalFilename: "studymix-synthetic-tone.wav",
            sizeBytes: 32_044,
            status: "confirmed",
            uploadId: fixtureUploadId,
          },
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobIdempotencyKeys.push(readJobIdempotencyKey(route));
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Synthetic provider is unavailable.",
          retryable: true,
        },
        requestId: "req_55555555555555555555555555555555",
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}`, async (route) => {
    cleanupRequestCount += 1;
    expect(route.request().method()).toBe("DELETE");
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ status: "deleted", uploadId: fixtureUploadId })),
      contentType: "application/json",
      status: 200,
    });
  });

  await openPrivateAppInEnglish(page);
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Prepare synthetic source" }).click();
  await page.getByRole("button", { name: "Run local Workflow" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "The private generation service could not complete this study mix.",
  );
  await expect(page.getByRole("button", { name: "Back to private upload" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start another mix" })).toHaveCount(0);
  expect(cleanupRequestCount).toBe(0);

  await page.getByRole("button", { name: "Back to private upload" }).click();
  await expect(
    page.getByText("Synthetic source confirmed in local R2.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete private upload" })).toBeVisible();
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  await page.getByRole("button", { name: "Run local Workflow" }).click();
  await expect(page.getByRole("button", { name: "Back to private upload" })).toBeVisible();
  expect(jobIdempotencyKeys).toHaveLength(2);
  expect(new Set(jobIdempotencyKeys).size).toBe(1);

  await page.getByRole("button", { name: "Back to private upload" }).click();
  await page.getByRole("button", { name: "Delete private upload" }).click();
  await expect(page.getByRole("button", { name: "Prepare synthetic source" })).toBeDisabled();
  expect(cleanupRequestCount).toBe(1);
  expect(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      activePrivateJobSessionKey,
    ),
  ).toBeNull();
});

test("rejects a local synthetic source success bound to another request", async ({ page }) => {
  await routeLocalAiSession(page);
  let jobRequestCount = 0;
  let sourceRequestCount = 0;
  await page.route("**/api/local/synthetic-upload", async (route) => {
    sourceRequestCount += 1;
    const request = parseLocalSyntheticRequest(route.request().postData());
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          request: { ...request, idempotencyKey: "stale-local-source-key" },
          upload: {
            confirmedAt: fixtureCreatedAt,
            createdAt: fixtureCreatedAt,
            declaredContentType: "audio/wav",
            expiresAt: fixtureSignedExpiresAt,
            originalFilename: "studymix-synthetic-tone.wav",
            sizeBytes: 32_044,
            status: "confirmed",
            uploadId: fixtureUploadId,
          },
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    if (await fulfillEmptyRecentJobsRead(route)) {
      return;
    }
    expect(route.request().method()).toBe("POST");
    jobRequestCount += 1;
    await route.fulfill({ status: 500 });
  });

  await openPrivateAppInEnglish(page);
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("button", { name: "Prepare synthetic source" }).click();

  await expect(
    page.getByText("The private upload could not be confirmed. Check the file and try again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run local Workflow" })).toHaveCount(0);
  expect(sourceRequestCount).toBe(1);
  expect(jobRequestCount).toBe(0);
});

test("lets a user cancel a stalled private upload and retry after cleanup", async ({ page }) => {
  let cleanupRequestCount = 0;
  let confirmRequestCount = 0;
  await routePrivateRealSession(page);
  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          allowedContentTypes: ["audio/wav"],
          expiresAt: fixtureSignedExpiresAt,
          idempotencyKey: readUploadIdempotencyKey(route),
          maxUploadBytes: 524_288_000,
          objectKey: fixtureUploadObjectKey,
          requiredHeaders: { "Content-Type": "audio/wav", "If-None-Match": "*" },
          uploadId: fixtureUploadId,
          uploadMethod: "PUT",
          uploadUrl: fixtureUploadUrl,
        }),
      ),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}/confirm`, async (route) => {
    confirmRequestCount += 1;
    await route.fulfill({ status: 500 });
  });
  await page.route(`**/api/uploads/${fixtureUploadId}`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    cleanupRequestCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope({ status: "deleted", uploadId: fixtureUploadId })),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const stalledUploadFetch: typeof window.fetch = async (input, init) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(requestUrl, window.location.href);
      if (url.hostname.endsWith(".r2.cloudflarestorage.com") && init?.method === "PUT") {
        document.documentElement.dataset.syntheticDirectUpload = "started";
        const signal = init.signal;
        if (!(signal instanceof AbortSignal)) {
          throw new TypeError("Expected a direct upload cancellation signal.");
        }
        return await new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return await originalFetch(input, init);
    };
    window.fetch = stalledUploadFetch;
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Securely upload audio" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.dataset.syntheticDirectUpload ?? null),
    )
    .toBe("started");
  await expect(page.getByText("Uploading directly to private Cloudflare R2…")).toBeVisible();
  await page.getByRole("button", { name: "Cancel upload" }).click();

  await expect(
    page.getByText("Private upload cancelled. Your file and selections remain ready to retry."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Securely upload audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Cancel upload" })).toHaveCount(0);
  await expect.poll(() => cleanupRequestCount).toBe(1);
  expect(confirmRequestCount).toBe(0);
});

test("rejects an expired private upload instruction before direct transfer", async ({ page }) => {
  const expiredSigningTime = new Date(fixtureSigningTime.getTime() - 2 * 3_600 * 1_000);
  const expiredSigningDate = expiredSigningTime.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const expiredUploadUrl = new URL(fixtureUploadUrl);
  expiredUploadUrl.searchParams.set(
    "X-Amz-Credential",
    `SYNTHETIC_ACCESS_KEY/${expiredSigningDate.slice(0, 8)}/auto/s3/aws4_request`,
  );
  expiredUploadUrl.searchParams.set("X-Amz-Date", expiredSigningDate);
  const expiredAt = new Date(expiredSigningTime.getTime() + 3_600 * 1_000).toISOString();

  await expectPrivateUploadInstructionRejected(page, {
    expiresAt: expiredAt,
    uploadUrl: expiredUploadUrl.toString(),
  });
});

test("rejects an upload instruction with an extra signed header before transfer", async ({
  page,
}) => {
  const uploadUrl = new URL(fixtureUploadUrl);
  uploadUrl.searchParams.set(
    "X-Amz-SignedHeaders",
    "content-length;content-type;host;if-none-match;x-unprovided",
  );

  await expectPrivateUploadInstructionRejected(page, {
    expiresAt: fixtureSignedExpiresAt,
    uploadUrl: uploadUrl.toString(),
  });
});

test("lets a user delete a completed private mix and return to a clean workspace", async ({
  page,
}) => {
  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();
  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible({
    timeout: 5_000,
  });

  await page.getByRole("button", { name: "Delete this private mix" }).click();
  await expect(page.getByRole("heading", { name: "Upload your audio" })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveValue("");
});

test("shows a retryable error summary when the mock job fails", async ({ page }) => {
  await prepareAuthorizedMix(page, "/app?mockScenario=failed");
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 5_000 });
  await expect(alert).toContainText("We could not finish this study mix");
  await expect(alert).toContainText("Retry is available");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this private mix" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start another mix" })).toHaveCount(0);
});

test("rejects a malformed mock job response with safe retry guidance", async ({ page }) => {
  await prepareAuthorizedMix(page, "/app?mockScenario=malformed");
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 5_000 });
  await expect(alert).toContainText("The request or service response was invalid.");
  await expect(alert).toContainText("Retry is available");
});

test("supports keyboard operation from the selected file through job submission", async ({
  page,
}) => {
  await openPrivateAppInEnglish(page);
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    buffer: fixtureWave(),
    mimeType: "audio/wav",
    name: "keyboard-recording.wav",
  });
  await fileInput.focus();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: /^Soft Piano\b/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox").nth(0)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox").nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Tab");
  }
  const submit = page.getByRole("button", { name: "Generate 2 candidates" });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Creating your study mix" })).toBeVisible();
});
