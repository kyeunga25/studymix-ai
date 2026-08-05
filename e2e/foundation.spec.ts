import { expect, test, type Page } from "@playwright/test";

const fixtureUploadId = "upl_11111111111111111111111111111111";
const fixtureJobId = "job_22222222222222222222222222222222";
const fixtureOutputIds = [
  "out_33333333333333333333333333333333",
  "out_44444444444444444444444444444444",
] as const;
const fixtureCreatedAt = "2026-07-26T00:00:00.000Z";
const fixtureExpiresAt = "2026-08-02T00:00:00.000Z";

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

function successEnvelope(data: unknown) {
  return {
    data,
    error: null,
    requestId: "req_55555555555555555555555555555555",
  };
}

async function openPrivateAppInEnglish(page: Page, path = "/app") {
  await page.goto(path);
  await page.getByRole("button", { name: "EN" }).click();
}

async function prepareAuthorizedMix(page: Page, path = "/app") {
  await openPrivateAppInEnglish(page, path);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("test-audio-placeholder"),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
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
  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toHaveCount(0);
});

test("provides a dedicated beta sign-in page with future registration space", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "返回你的私人 StudyMix 工作區" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "登入", selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /建立帳戶/ })).toBeDisabled();
  await expect(page.getByText("公開註冊尚未開放", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "繼續安全登入" })).toHaveAttribute("href", "/app");
  await expect(
    page.getByRole("navigation", { name: "法律文件" }).getByRole("link", {
      name: "AI 及輸出聲明",
    }),
  ).toHaveAttribute("href", "/legal/ai-output-notice");
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
});

test("verifies the invited test session before showing the private app", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("status")).toContainText("私密測試存取權已驗證");
  await expect(page.getByRole("status")).toContainText("擁有者工作區：啟用");
  await expect(page.getByRole("status")).toContainText("真實 AI：不可用");
  await expect(page.getByRole("status")).toContainText("付款：不可用");
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登出" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
});

test("does not expose the private workspace when session verification fails", async ({ page }) => {
  await page.route("**/api/session", async (route) => {
    expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
    await route.fulfill({
      body: JSON.stringify({
        data: null,
        error: { code: "UNAUTHORIZED", message: "Sign-in is required.", retryable: false },
        requestId: "req_0123456789abcdef0123456789abcdef",
      }),
      contentType: "application/json",
      status: 401,
    });
  });
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "登入工作階段已結束" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回登入" })).toHaveAttribute("href", "/login");
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

  await expect(page.getByRole("heading", { name: "此帳戶未獲 Beta 測試權限" })).toBeVisible();
  await expect(page.getByRole("link", { name: "驗證另一個身份" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("requires both rights and current legal documents before generation can be requested", async ({
  page,
}) => {
  await openPrivateAppInEnglish(page);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("test-audio-placeholder"),
    mimeType: "audio/mpeg",
    name: "authorized-recording.mp3",
  });

  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(0).check();
  await expect(page.getByRole("button", { name: "Generate 2 candidates" })).toBeDisabled();
  await checkboxes.nth(1).check();
  await expect(page.getByRole("button", { name: "Generate 2 candidates" })).toBeEnabled();
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
});

test("continues polling when the provider job remains in the same state", async ({ page }) => {
  let pollCount = 0;
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("created"))),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route(`**/api/jobs/${fixtureJobId}`, async (route) => {
    pollCount += 1;
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob(pollCount >= 2 ? "completed" : "created"))),
      contentType: "application/json",
      status: 200,
    });
  });

  await prepareAuthorizedMix(page);
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  await expect(page.getByRole("heading", { name: "Your study mix is ready" })).toBeVisible({
    timeout: 6_000,
  });
  expect(pollCount).toBeGreaterThanOrEqual(2);
});

test("uses the private real-provider API flow without browser-to-provider calls", async ({
  page,
}) => {
  let directUploadSeen = false;
  let submittedJob: unknown;
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
        }),
      ),
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
  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        successEnvelope({
          allowedContentTypes: ["audio/wav"],
          expiresAt: "2026-07-26T00:15:00.000Z",
          maxUploadBytes: 524_288_000,
          objectKey: "owners/opaque/uploads/opaque/source",
          requiredHeaders: { "Content-Type": "audio/wav", "If-None-Match": "*" },
          uploadId: fixtureUploadId,
          uploadMethod: "PUT",
          uploadUrl: "https://uploads.example.test/private-source",
        }),
      ),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("https://uploads.example.test/private-source", async (route) => {
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
          expiresAt: fixtureExpiresAt,
          originalFilename: "authorized-recording.wav",
          sizeBytes: 22,
          status: "confirmed",
          uploadId: fixtureUploadId,
        }),
      ),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/jobs", async (route) => {
    submittedJob = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify(successEnvelope(fixtureJob("completed"))),
      contentType: "application/json",
      status: 202,
    });
  });
  for (const [candidateIndex, outputId] of fixtureOutputIds.entries()) {
    await page.route(`**/api/outputs/${outputId}/download`, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          successEnvelope({
            downloadMethod: "GET",
            downloadUrl: `https://downloads.example.test/candidate-${candidateIndex.toString()}.wav`,
            expiresAt: "2026-07-26T00:15:00.000Z",
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
  expect(submittedJob).toMatchObject({
    candidateCount: 2,
    presetId: "soft-piano",
    rightsDeclarationVersion: "v1",
    uploadId: fixtureUploadId,
  });
  expect(JSON.stringify(submittedJob)).not.toContain("fal");
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
    buffer: Buffer.from("test-audio-placeholder"),
    mimeType: "audio/wav",
    name: "keyboard-recording.wav",
  });
  await fileInput.focus();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Soft Piano" })).toBeFocused();
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
