import { expect, test, type Page } from "@playwright/test";

async function prepareAuthorizedMix(page: Page, path = "/") {
  await page.goto(path);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("test-audio-placeholder"),
    mimeType: "audio/wav",
    name: "authorized-recording.wav",
  });
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
}

test("renders the StudyMix AI foundation shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Turn your track into a study mix" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upload your audio" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign out" })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
  await expect(page.getByRole("button", { name: "Generate 2 candidates" })).toBeDisabled();
  await expect(
    page.getByRole("navigation", { name: "Legal documents" }).getByRole("link", {
      name: "Terms of Use",
    }),
  ).toHaveAttribute("href", "/legal/terms");
});

test("requires both rights and current legal documents before generation can be requested", async ({
  page,
}) => {
  await page.goto("/");
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

  await expect(page.getByRole("heading", { name: "Creating your study mix" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Request received|Generating candidates/);
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

test("shows a retryable error summary when the mock job fails", async ({ page }) => {
  await prepareAuthorizedMix(page, "/?mockScenario=failed");
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 5_000 });
  await expect(alert).toContainText("We could not finish this study mix");
  await expect(alert).toContainText("Retry is available");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start another mix" })).toBeVisible();
});

test("rejects a malformed mock job response with safe retry guidance", async ({ page }) => {
  await prepareAuthorizedMix(page, "/?mockScenario=malformed");
  await page.getByRole("button", { name: "Generate 2 candidates" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 5_000 });
  await expect(alert).toContainText("The job service returned an invalid response.");
  await expect(alert).toContainText("Retry is available");
});

test("supports keyboard operation from the selected file through job submission", async ({
  page,
}) => {
  await page.goto("/");
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
