import { expect, test } from "@playwright/test";

test.describe("AI Studio critical flows", () => {
  test("home page exposes workflow catalog, files, knowledge, and admin surfaces", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("AI Studio").first()).toBeVisible();
    await expect(page.getByText(/Workflows/i).first()).toBeVisible();
    await expect(page.getByText(/Files/i).first()).toBeVisible();
    await expect(page.getByText(/Knowledge/i).first()).toBeVisible();
    await expect(page.getByText(/Usage/i).first()).toBeVisible();
  });

  test("builder route loads visual editor chrome", async ({ page }) => {
    await page.goto("/builder");

    await expect(page.getByText(/Drag blocks/i).or(page.getByText(/Search nodes/i))).toBeVisible();
    await expect(page.getByText(/Run/i).first()).toBeVisible();
    await expect(page.getByText(/Save/i).first()).toBeVisible();
  });

  test("file library route is reachable for reusable uploads", async ({ page }) => {
    await page.goto("/files");

    await expect(page.getByText(/File Library/i).first()).toBeVisible();
    await expect(page.getByText(/Upload/i).first()).toBeVisible();
  });
});

