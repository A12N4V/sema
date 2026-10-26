// Tab rows must fit their width, as Sema's do: report every strip, ribbon tab
// row and tablist whose content is wider than its box, per page and viewport.
//   node e2e/tabs-overflow.mjs http://localhost:8125 /p/<run> /k/<run> /s/<session>
import { chromium } from "playwright";
const [base, ...paths] = process.argv.slice(2);
const sizes = [[1440, 900], [1100, 800], [768, 1024], [390, 844]];
const browser = await chromium.launch();
let bad = 0;
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const over = await page.evaluate(() => {
      const els = [...document.querySelectorAll('[role="tablist"], nav, [aria-label="Results"]')];
      // Sema's container strip and ribbon tab row are plain divs: include any row of tabs
      document.querySelectorAll("button[role=tab]").forEach((b) => els.push(b.parentElement));
      const strip = document.querySelector('[aria-current="page"]')?.parentElement;
      if (strip) els.push(strip);
      return [...new Set(els)].filter(Boolean).filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.getAttribute("aria-label") ?? e.getAttribute("role") ?? e.tagName.toLowerCase()}[${(e.className || "").toString().slice(0, 60)}] ${e.scrollWidth}>${e.clientWidth}`);
    });
    const page_ = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (over.length || page_) bad++;
    console.log(`${p} @${w}`.padEnd(34), over.length || page_ ? `OVERFLOW ${over.join(" · ")}${page_ ? " · page" : ""}` : "fits");
  }
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
