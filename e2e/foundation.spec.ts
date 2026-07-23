import { expect, test } from "@playwright/test";

test("renders the StudyMix AI foundation shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Turn your track into a study mix" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upload your audio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate 2 candidates" })).toBeDisabled();
});
