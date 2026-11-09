import { expect, test } from "@playwright/test";

test("app renders", async ({ page }) => {
  await page.goto("");
  await expect(page.getByRole("heading", { name: "Hello, data app" })).toBeVisible();
});
