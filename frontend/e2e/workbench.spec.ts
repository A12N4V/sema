import { test, expect, type Page } from "@playwright/test";
import { FRAME_SIZE } from "../src/lib/figures";

/**
 * The whole stack, end to end.
 *
 * These cover the things that can only be wrong in a real browser against a
 * real MNE process: a canvas that never paints, a matplotlib PNG that comes
 * back opaque white, a precompute job that never finishes, a drag that does not
 * move the cursor, a layout that overflows its viewport. Every one of those has
 * happened at least once in this project, and none of them is visible to a
 * jsdom test.
 *
 * Rule for this file: assert on what a user can see or do, never on class names.
 */

/** Open the synthetic recording and wait for the workspace. */
async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Synthetic sample/ }).click();
  await expect(page).toHaveURL(/\/s\/[a-z0-9]+/);
  await expect(page.getByRole("button", { name: /^Raw/ })).toBeVisible();
}

/**
 * Open a ribbon tab. Below 720px the six tabs collapse into a menu, so the
 * same intent is two different gestures: a test should say what it wants, not
 * which layout it is in.
 */
async function openRibbonTab(page: Page, name: string) {
  const narrow = (page.viewportSize()?.width ?? 1440) <= 720;
  if (narrow) {
    await page.getByRole("button", { expanded: false }).first().click();
    await page.getByRole("menuitem", { name }).click();
  } else {
    await page.getByRole("tab", { name }).click();
  }
}

/**
 * Wait for the precompute pass to finish. Asks the server, not the UI: the
 * status text is hidden on a phone, and a test for "are the figures ready"
 * should not also be a test for "is the label visible at this width".
 */
async function waitForFiguresReady(page: Page) {
  // FRAME_SIZE, imported rather than written out: the size is part of the
  // figure cache key, so a hard-coded copy here asks whether a filmstrip that
  // the app never requests is ready, and waits the full timeout for an answer
  // that can only be "no".
  await expect.poll(async () => page.evaluate(async (size: number) => {
    const id = location.pathname.split("/")[2];
    // figures are cached per theme, so ask about the theme the app is actually
    // rendering in: the browser under test may well be in light mode
    const explicit = document.documentElement.getAttribute("data-theme");
    const theme = explicit
      ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const r = await fetch(`/api/sessions/${id}/filmstrip?theme=${theme}&width=${size}&height=${size}`);
    return (await r.json()).ready as boolean;
  }, FRAME_SIZE), { timeout: 60_000, message: "the precompute pass never finished" }).toBe(true);
}

/** Collect page errors and console errors for the life of a test. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return errors;
}

test.describe("opening a recording", () => {
  test("lands in the workspace with no errors and prepares its figures", async ({ page }) => {
    const errors = watchForErrors(page);
    await openDemo(page);

    // the precompute pass runs on load and reports when it is done
    await waitForFiguresReady(page);
    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("the topography is a real figure, not a broken image", async ({ page }) => {
    await openDemo(page);
    const topo = page.getByAltText("scalp topography");
    await expect(topo).toBeVisible();
    // naturalWidth is 0 for an <img> whose source failed to decode
    expect(await topo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(50);
  });

  test("figures are transparent, so they take the pane's background", async ({ page }) => {
    await openDemo(page);
    const src = await page.getByAltText("scalp topography").getAttribute("src");
    const bytes = await page.evaluate(async (url) => {
      const buf = await (await fetch(url!)).arrayBuffer();
      return Array.from(new Uint8Array(buf.slice(0, 26)));
    }, src);
    // PNG magic, then IHDR: byte 25 is the colour type. 6 = RGBA, 4 = grey+alpha
    expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([4, 6]).toContain(bytes[25]);
  });
});

test.describe("the clock belongs to the session", () => {
  test("the transport survives every container switch", async ({ page }) => {
    await openDemo(page);
    // fit an ICA so its container exists
    await page.evaluate(async () => {
      const id = location.pathname.split("/")[2];
      const j = { "Content-Type": "application/json" };
      await fetch(`/api/sessions/${id}/ops`, { method: "POST", headers: j,
        body: JSON.stringify({ op_id: "filter", params: { l_freq: 1, h_freq: 40 } }) });
      await fetch(`/api/sessions/${id}/ica/fit`, { method: "POST", headers: j,
        body: JSON.stringify({ n_components: 6, method: "fastica" }) });
    });
    await page.reload();

    for (const container of ["Raw", "ICA"]) {
      await page.getByRole("button", { name: new RegExp(`^${container}`) }).click();
      await expect(page.getByRole("button", { name: "Play" }),
        `${container} lost the transport`).toBeVisible();
    }

    await page.getByRole("button", { name: /^Pipeline/ }).click();
    await expect(page.getByRole("button", { name: "Play" })).toHaveCount(0);
  });
});

test.describe("running an operation from the ribbon", () => {
  test("a band-pass takes one action and lands in the pipeline", async ({ page }) => {
    await openDemo(page);
    await openRibbonTab(page, "Clean");
    await page.getByLabel(/low-pass/i).fill("40");
    await page.getByLabel(/low-pass/i).press("Enter");

    await expect(page.getByText(/Filtered 1.40 Hz/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Pipeline 1/ })).toBeVisible();
  });

  test("a gate that cannot succeed is not offered", async ({ page }) => {
    await openDemo(page);
    await openRibbonTab(page, "Decompose");
    // no 1 Hz high-pass yet
    await expect(page.getByRole("button", { name: "Fit" })).toBeDisabled();
  });
});

test.describe("the figures are handled, not just displayed", () => {
  test("dragging the topography sweeps the recording", async ({ page }) => {
    await openDemo(page);
    await waitForFiguresReady(page);

    const before = await page.getByAltText("scalp topography").getAttribute("src");
    const box = (await page.getByAltText("scalp topography").boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();

    // the cursor moved a long way, so the figure must have changed with it
    await expect.poll(async () =>
      page.getByAltText("scalp topography").getAttribute("src")).not.toBe(before);
  });

  // a hover readout has no meaning on a touch screen
  test("the spectrum reads out a value under the pointer", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "no pointer to hover with");
    await openDemo(page);
    const spectrum = page.locator("canvas").last();
    await expect(spectrum).toBeVisible();
    const box = (await spectrum.boundingBox())!;
    // the readout is painted into the canvas, so assert the canvas repainted
    const before = await spectrum.screenshot();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(200);
    expect(Buffer.compare(before, await spectrum.screenshot())).not.toBe(0);
  });
});

test.describe("layout", () => {
  test("nothing overflows the viewport horizontally", async ({ page }) => {
    await openDemo(page);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
  });

  test("every control in the top bar stays reachable", async ({ page }) => {
    await openDemo(page);
    for (const name of ["Settings", "New session"]) {
      const el = page.getByRole("button", { name });
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(box.x + box.width, `${name} is off-screen`).toBeLessThanOrEqual(width);
    }
  });
});
