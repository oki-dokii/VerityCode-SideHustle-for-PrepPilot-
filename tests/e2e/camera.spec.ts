import { test, expect, type Page, chromium } from "@playwright/test";
async function start(page: Page) {
  await page.goto("http://127.0.0.1:5173/");
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin assessment" }).click();
  await expect(
    page.getByRole("heading", { name: "Camera observations" }),
  ).toBeVisible();
}
test("camera remains off until consent; permission denial leaves coding available", async ({
  page,
}) => {
  await start(page);
  await expect(
    page.getByRole("button", { name: "Enable camera checks" }),
  ).toBeDisabled();
  expect(
    await page.locator("video").evaluate((v: any) => v.srcObject),
  ).toBeNull();
  await page.getByLabel("I agree to local camera").check();
  await page.getByRole("button", { name: "Enable camera checks" }).click();
  await expect(
    page.getByText("Camera permission denied.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("textbox", { name: "Python solution editor" }),
  ).toBeVisible();
});
test("real local model on synthetic camera: no-face observations, optional evidence, stop and reload", async () => {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await start(page);
    await page.getByLabel("I agree to local camera").check();
    await page.getByLabel("Also save optional webcam snapshots").check();
    await page.getByRole("button", { name: "Enable camera checks" }).click();
    await expect(
      page.getByText("Camera checks running locally", { exact: true }),
    ).toBeVisible({ timeout: 45000 });
    await expect(
      page
        .locator(".camera-timeline")
        .getByText(/No face detected/)
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("link", { name: "View optional snapshot" }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () =>
              (
                await (
                  await fetch(
                    `/api/attempts/${location.hash.split("/").pop()}/camera`,
                  )
                ).json()
              ).coveredMs,
          ),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    const report = await page.evaluate(async () =>
      (
        await fetch(`/api/attempts/${location.hash.split("/").pop()}/camera`)
      ).json(),
    );
    expect(report.coveredMs).toBeGreaterThan(0);
    expect(report.events.some((o: any) => o.phone === "not_detected")).toBe(
      true,
    );
    await page
      .getByRole("button", { name: "Calibrate gaze", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Gaze calibration", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel calibration" }).click();
    await expect(
      page.getByRole("dialog", { name: "Gaze calibration", exact: true }),
    ).toHaveCount(0);
    expect(report.sessions[0].version).toContain("tasks-0.10.32");
    await page.screenshot({
      path: "test-results/camera-synthetic.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Delete snapshots & revoke consent" })
      .click();
    await expect(
      page.getByText("Snapshots deleted and upload consent revoked.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View optional snapshot" }),
    ).toHaveCount(0);
    await page.route("**/camera/batch", (route) => route.abort("failed"));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.keys(localStorage)
              .filter((k) => k.startsWith("vc-camera:"))
              .flatMap((k) => JSON.parse(localStorage.getItem(k) || "[]"))
              .length,
        ),
      )
      .toBeGreaterThan(2);
    const pendingIds = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("vc-camera:"))
        .flatMap((k) => JSON.parse(localStorage.getItem(k) || "[]"))
        .map((o) => o.id),
    );
    await page.evaluate(() => {
      (window as any).__cameraTracks = (
        document.querySelector("video")!.srcObject as MediaStream
      ).getTracks();
    });
    await page
      .getByRole("button", { name: "Stop camera", exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        (window as any).__cameraTracks.every(
          (t: MediaStreamTrack) => t.readyState === "ended",
        ),
      ),
    ).toBe(true);
    await page.unroute("**/camera/batch");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Enable camera checks" }),
    ).toBeDisabled();
    expect(
      await page.locator("video").evaluate((v: any) => v.srcObject),
    ).toBeNull();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.keys(localStorage)
              .filter((k) => k.startsWith("vc-camera:"))
              .flatMap((k) => JSON.parse(localStorage.getItem(k) || "[]"))
              .length,
        ),
      )
      .toBe(0);
    expect(pendingIds.length).toBeGreaterThan(2);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
