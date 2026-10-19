import { test, expect } from "@playwright/test";
test("dashboard, preflight, editor autosave, refresh, unavailable run and final submission", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next step starts here." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await expect(
    page.getByRole("button", { name: "Begin assessment" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin assessment" }).click();
  await expect(
    page.getByRole("heading", { name: "Best streak." }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Python solution editor" });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("print(6)");
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  const before = await page.evaluate(async () => {
    const id = location.hash.split("/").pop();
    return (await fetch(`/api/attempts/${id}`)).json();
  });
  expect(before.draft).toBe("print(6)");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Best streak." }),
  ).toBeVisible();
  const after = await page.evaluate(async () => {
    const id = location.hash.split("/").pop();
    return (await fetch(`/api/attempts/${id}`)).json();
  });
  expect(after.deadline).toBe(before.deadline);
  expect(after.draft).toBe("print(6)");
  await page.screenshot({ path: "test-results/workspace.png", fullPage: true });
  await page.getByRole("button", { name: "Run examples" }).click();
  await expect(
    page.getByText("Execution unavailable", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Submit solution" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your submission is safe. Grading is unavailable.",
    }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Run examples" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Arrays & problem solving.*Submitted/ }),
  ).toBeVisible();
});

test("recovers unsaved local edits and rejects a stale tab without losing its text", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin assessment" }).click();
  const editor = page.getByRole("textbox", { name: "Python solution editor" });
  await expect(editor).toBeVisible();
  await page.route("**/api/attempts/*/draft", (route) => route.abort());
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText('print("recover me")');
  await expect(page.getByRole("status")).toHaveText("Not saved to server");
  await page.reload();
  await expect(
    page.getByText(
      "A different local draft was recovered. Choose which version to continue with.",
    ),
  ).toBeVisible();
  await page.unroute("**/api/attempts/*/draft");
  await page.getByRole("button", { name: "Restore local draft" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  const result = await page.evaluate(async () => {
    const id = location.hash.split("/").pop();
    const a = await (await fetch(`/api/attempts/${id}`)).json();
    if (a.draft !== 'print("recover me")')
      throw new Error("Recovered code was not saved");
    return (
      await fetch(`/api/attempts/${id}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-VerityCode": "1" },
        body: JSON.stringify({
          code: 'print("other tab")',
          revision: a.revision,
        }),
      })
    ).status;
  });
  expect(result).toBe(200);
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText('print("stale tab")');
  await expect(
    page.getByRole("button", { name: "Download local draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load saved draft" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await expect(
    page.getByRole("button", { name: "Download local draft" }),
  ).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const id = location.hash.split("/").pop();
    return (await fetch(`/api/attempts/${id}`)).json();
  });
  expect(saved.draft).toBe('print("other tab")');
});

test("small viewport stays within the screen and preflight supports keyboard dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next step starts here." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await expect(page.getByRole("checkbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/mobile-dashboard.png",
    fullPage: true,
  });
});

test("C++ and Java have persistent separate drafts and a locked submission language", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start a practice assessment" })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin assessment" }).click();
  const selector = page.getByRole("combobox", { name: "Coding language" });
  await selector.selectOption("cpp");
  const cpp = page.getByRole("textbox", {
    name: "C++ solution editor",
    exact: true,
  });
  await expect(cpp).toBeVisible();
  await cpp.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("// my C++ draft\nint main() { return 0; }");
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await selector.selectOption("java");
  await expect(page.getByText("Main.java", { exact: true })).toBeVisible();
  const java = page.getByRole("textbox", {
    name: "Java solution editor",
    exact: true,
  });
  await java.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "public class Main { public static void main(String[] args) {} }",
  );
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await selector.selectOption("cpp");
  await expect(cpp).toBeVisible();
  let stored = await page.evaluate(async () =>
    (await fetch(`/api/attempts/${location.hash.split("/").pop()}`)).json(),
  );
  expect(stored.draft).toBe("// my C++ draft\nint main() { return 0; }");
  await page.reload();
  await expect(selector).toHaveValue("cpp");
  await selector.selectOption("java");
  await expect(java).toBeVisible();
  stored = await page.evaluate(async () =>
    (await fetch(`/api/attempts/${location.hash.split("/").pop()}`)).json(),
  );
  expect(stored.draft).toBe(
    "public class Main { public static void main(String[] args) {} }",
  );
  await page.getByRole("button", { name: "Submit solution" }).click();
  await page.getByRole("button", { name: "Confirm submission" }).click();
  await expect(selector).toBeDisabled();
  await expect(selector).toHaveValue("java");
});
