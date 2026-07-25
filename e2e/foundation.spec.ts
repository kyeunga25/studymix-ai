import { expect, test, type Page } from "@playwright/test";

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
    "/app",
  );
  await expect(
    page.getByRole("navigation", { name: "法律文件" }).getByRole("link", {
      name: "使用條款",
    }),
  ).toHaveAttribute("href", "/legal/terms");
  await expect(page.getByRole("heading", { name: "上載你的音訊" })).toHaveCount(0);
});

test("verifies the invited test session before showing the private app", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("status")).toContainText("私密測試存取權已驗證");
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登出" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
});

test("does not expose the private workspace when session verification fails", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
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

  await expect(page.getByRole("status")).toContainText("未能驗證存取權");
  await expect(page.getByRole("heading", { name: "把你的音樂變成專注讀書 Mix" })).toHaveCount(0);
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
    await expect(page.getByText("Document version: 2026-07-24")).toBeVisible();
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
  await expect(alert).toContainText("The job service returned an invalid response.");
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
