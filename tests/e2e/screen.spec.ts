import { test, expect, type Page } from "@playwright/test";
async function start(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin assessment" }).click();
  await expect(
    page.getByRole("heading", { name: "Selected-screen snapshots" }),
  ).toBeVisible();
}
test("screen picker cancellation is optional and never starts collection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        throw new DOMException("Cancelled", "NotAllowedError");
      },
    });
  });
  await start(page);
  await expect(
    page.getByRole("button", { name: "Choose screen to share" }),
  ).toBeDisabled();
  await page.getByLabel("I consent to uploading snapshots").check();
  await page.getByRole("button", { name: "Choose screen to share" }).click();
  await expect(
    page.getByText(
      "Screen sharing cancelled or denied. Nothing will be captured.",
    ),
  ).toBeVisible();
  const r = await page.evaluate(async () =>
    (
      await fetch(`/api/attempts/${location.hash.split("/").pop()}/screen`)
    ).json(),
  );
  expect(r.sessions).toHaveLength(0);
});
test("synthetic selected surface: explicit consent, captures, revoke, track release and reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__screenRequests = 0;
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        (window as any).__screenRequests++;
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d")!;
        function paint() {
          ctx.fillStyle = "#dae8dc";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "#173a2c";
          ctx.fillText(
            "SYNTHETIC TEST SURFACE " + performance.now().toFixed(0),
            40,
            100,
          );
          requestAnimationFrame(paint);
        }
        paint();
        const stream = canvas.captureStream(10);
        (window as any).__screenStream = stream;
        Object.defineProperty(stream.getVideoTracks()[0], "getSettings", {
          value: () => ({ displaySurface: "window" }),
        });
        return stream;
      },
    });
  });
  await start(page);
  expect(await page.evaluate(() => (window as any).__screenRequests)).toBe(0);
  await page.getByLabel("I consent to uploading snapshots").check();
  await page.getByRole("button", { name: "Choose screen to share" }).click();
  await expect(
    page.getByRole("link", { name: "View screen snapshot" }),
  ).toBeVisible({ timeout: 15000 });
  const before = await page.evaluate(async () =>
    (
      await fetch(`/api/attempts/${location.hash.split("/").pop()}/screen`)
    ).json(),
  );
  expect(before.sessions[0].surface).toBe("window");
  await page
    .getByRole("button", { name: "Delete screen snapshots & revoke consent" })
    .click();
  await expect(
    page.getByText("Screen snapshots deleted and consent revoked."),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__screenStream
        .getTracks()
        .every((t: MediaStreamTrack) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await expect(
    page.getByRole("link", { name: "View screen snapshot" }),
  ).toHaveCount(0);
  await page.reload();
  expect(await page.evaluate(() => (window as any).__screenRequests)).toBe(0);
  await expect(
    page.getByRole("button", { name: "Choose screen to share" }),
  ).toBeDisabled();
});
