import { test, expect, type Page } from "@playwright/test";
async function start(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await expect(
    page.getByText(
      /Browser visibility, focus, fullscreen and editor paste events are recorded/,
    ),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin assessment" }).click();
  await expect(
    page.getByText("Browser monitoring active", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Python solution editor" }),
  ).toBeVisible();
}
async function report(page: Page) {
  return page.evaluate(async () =>
    (
      await fetch(`/api/attempts/${location.hash.split("/").pop()}/monitoring`)
    ).json(),
  );
}
test("records distinct browser observations and fullscreen, without clipboard contents", async ({
  page,
}) => {
  await start(page);
  // Controlled DOM events exercise instrumentation; OS/tab behaviour needs separate manual qualification.
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "SECRET CLIPBOARD CONTENT");
      document.querySelector(".monaco-editor textarea")!.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          clipboardData: clipboard,
        }),
      );
    }
    delete (document as any).hidden;
  });
  await expect
    .poll(async () => (await report(page)).counts.editor_paste, {
      timeout: 20000,
    })
    .toBe(20);
  const result = await report(page);
  expect(result.counts.window_blur).toBeGreaterThanOrEqual(20);
  expect(result.counts.window_focus).toBeGreaterThanOrEqual(20);
  expect(result.counts.visibility_hidden).toBe(20);
  expect(result.counts.visibility_visible).toBe(20);
  expect(JSON.stringify(result)).not.toContain("SECRET CLIPBOARD CONTENT");
  await page.getByRole("button", { name: "Toggle fullscreen" }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await page.getByRole("button", { name: "Toggle fullscreen" }).click();
  await expect
    .poll(async () => (await report(page)).counts.fullscreen_exit)
    .toBe(1);
  await page
    .getByRole("combobox", { name: "Filter timeline" })
    .selectOption("editor_paste");
  await expect(page.locator(".timeline-list li")).toHaveCount(12);
  await page.getByRole("button", { name: "Show more observations" }).click();
  await expect(page.locator(".timeline-list li")).toHaveCount(20);
  await expect
    .poll(async () => (await report(page)).coveredMs, { timeout: 10000 })
    .toBeGreaterThan(0);
  await page
    .locator(".monitor-panel")
    .screenshot({ path: "test-results/monitoring-timeline.png" });
});
test("queued observations survive reload, retry once and remain visible after submission", async ({
  page,
}) => {
  await start(page);
  await page.route("**/events/batch", (route) => route.abort());
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("blur"));
  });
  await expect(page.getByText(/Monitoring upload interrupted/)).toBeVisible({
    timeout: 10000,
  });
  const ids = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("vc-events:"))
      .flatMap((k) => JSON.parse(localStorage[k]))
      .map((e: any) => e.id),
  );
  expect(ids.length).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByText("Browser monitoring active", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/events/batch");
  await expect
    .poll(async () => (await report(page)).counts.connection_offline, {
      timeout: 15000,
    })
    .toBe(1);
  await expect(page.getByText("No buffered observations")).toBeVisible();
  const before = await report(page);
  expect(new Set(before.events.map((e: any) => e.id)).size).toBe(
    before.events.length,
  );
  await page.getByRole("button", { name: "Submit solution" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(
    page.getByText("Monitoring ended", { exact: true }),
  ).toBeVisible();
  expect((await report(page)).counts.connection_offline).toBe(1);
  await expect(
    page.getByRole("button", { name: "Toggle fullscreen" }),
  ).toHaveCount(0);
});

test("a 60-second browser network outage preserves observations and reconciles coverage", async ({
  page,
  context,
}) => {
  test.setTimeout(100000);
  await start(page);
  await context.setOffline(true);
  await expect(page.getByText(/Monitoring upload interrupted/)).toBeVisible({
    timeout: 10000,
  });
  await page.waitForTimeout(60000);
  const buffered = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("vc-events:"))
      .flatMap((k) => JSON.parse(localStorage[k])),
  );
  expect(
    buffered.filter((e: any) => e.type === "heartbeat").length,
  ).toBeGreaterThanOrEqual(10);
  await context.setOffline(false);
  await expect
    .poll(async () => (await report(page)).counts.connection_online, {
      timeout: 15000,
    })
    .toBe(1);
  await expect
    .poll(async () => (await report(page)).coveredMs, { timeout: 15000 })
    .toBeGreaterThan(50000);
  expect((await report(page)).counts.connection_offline).toBe(1);
  await expect(page.getByText("No buffered observations")).toBeVisible({
    timeout: 10000,
  });
});
