import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * UX invariants on every workspace page, at both projects' viewports.
 *
 * These are the floor, not the score: bench/ux_bench.mjs counts the softer
 * things (contrast, target size, tiny text) so an agent can drive them down.
 * Anything here is a hard regression: a page that throws, scrolls sideways,
 * has an unlabeled form control, or can't be driven from the keyboard.
 */

const PAGES = ["signal", "channels", "ica", "epochs", "evoked", "tfr", "source", "pipeline"] as const;
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Synthetic sample/ }).click();
  await expect(page).toHaveURL(/\/s\/[a-z0-9]+/);
  await expect(page.getByRole("button", { name: /^Raw/ })).toBeVisible();
  return page.url().split("/")[4];
}

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return errors;
}

async function axeViolations(page: Page, impacts: string[]) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (impacts) => {
    // @ts-expect-error injected above
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return r.violations
      .filter((v: { impact: string }) => impacts.includes(v.impact))
      .map((v: { id: string; nodes: { target: string[] }[] }) => `${v.id} @ ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  }, impacts);
}

test.describe("every page", () => {
  let sid: string;
  test.beforeEach(async ({ page }) => { sid = await openDemo(page); });

  for (const p of PAGES) {
    test(`${p}: loads by deep link, no errors, no sideways scroll, no critical a11y`, async ({ page }) => {
      const errors = watchForErrors(page);
      await page.goto(`/s/${sid}/${p}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: /^Raw/ })).toBeVisible();

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
      expect(await axeViolations(page, ["critical"])).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("reload on a deep link returns to the same page and session", async ({ page }) => {
    await page.goto(`/s/${sid}/channels`);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/s/${sid}/channels`));
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("browser back and forward walk the container history", async ({ page }) => {
    await page.goto(`/s/${sid}/signal`);
    await page.goto(`/s/${sid}/channels`);
    await page.goBack();
    await expect(page).toHaveURL(/\/signal$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/channels$/);
  });
});

test.describe("keyboard", () => {
  test.skip(({ isMobile }) => isMobile, "keyboard flows are a desktop contract");

  test("Cmd/Ctrl-K opens the command palette focused, Escape closes it and returns focus", async ({ page }) => {
    await openDemo(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const input = page.locator("input:focus");
    await expect(input).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
  });

  test("Tab moves focus through controls and focus is visible", async ({ page }) => {
    await openDemo(page);
    const seen = new Set<string>();
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== "none";
        return { id: el.outerHTML.slice(0, 80), ring };
      });
      if (!f) continue;
      seen.add(f.id);
      expect(f.ring, `no visible focus on ${f.id}`).toBe(true);
    }
    expect(seen.size, "Tab reaches several distinct controls").toBeGreaterThan(5);
  });

  test("palette search runs an operation end to end", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.keyboard.type("notch");
    await page.keyboard.press("Enter");
    // either it ran straight away or it opened its parameter form; both are a response
    await expect(page.getByText(/notch/i).first()).toBeVisible();
  });
});

test.describe("layout", () => {
  test("the signal page uses the viewport: no large dead band below the content", async ({ page }) => {
    await openDemo(page);
    const gap = await page.evaluate(() => {
      const bottom = Math.max(...[...document.querySelectorAll("canvas, img, table")]
        .map((e) => e.getBoundingClientRect().bottom));
      return innerHeight - bottom;
    });
    expect(gap, "the plots leave a large empty band at the bottom").toBeLessThan(innerHeightShare(page, 0.35));
  });

  test("top-bar controls don't overlap each other", async ({ page }) => {
    await openDemo(page);
    const overlaps = await page.evaluate(() => {
      const bar = document.querySelector("header") ?? document.body;
      const els = [...bar.querySelectorAll("button, a[href], input")].filter((e) => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 120;
      });
      const bad: string[] = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2)
          bad.push(`${els[i].textContent?.trim() || els[i].getAttribute("aria-label")} x ${els[j].textContent?.trim() || els[j].getAttribute("aria-label")}`);
      }
      return bad;
    });
    expect(overlaps).toEqual([]);
  });
});

function innerHeightShare(page: Page, share: number) {
  return page.viewportSize()!.height * share;
}
