// UX + layout benchmark in a real Chromium against the real stack.
//
//   node bench/ux_bench.mjs [--root DIR] [--no-build] [--shots]
//
// Builds the frontend, serves it from one FastAPI process (exactly like the HF
// Space), opens the demo, and visits every workspace page at phone, tablet and
// desktop sizes. Prints one JSON object; every number is lower-is-better.
// --shots writes screenshots to bench/out/ux/ so a human or agent can look.
//
// Per page x viewport it measures, then sums:
//   ux_axe_serious      axe-core violations with impact serious|critical (nodes)
//   ux_axe_moderate     axe-core violations with impact moderate|minor (nodes)
//   ux_overflow_px      horizontal page overflow (scrollWidth - innerWidth)
//   ux_overlaps         pairs of visible interactive elements whose boxes intersect
//   ux_small_targets    visible interactive elements under 24x24 css px (WCAG 2.5.8)
//   ux_clipped_text     text clipped by overflow:hidden with no title/aria-label to recover it
//   ux_tiny_text        visible text nodes rendered under 11px
//   ux_offscreen_ctrls  interactive elements partly outside the viewport horizontally
//   ux_console_errors   console errors + uncaught page errors
//   ux_cls              cumulative layout shift during page load (x1000)
// And timings (median over pages, desktop):
//   ux_first_trace_ms   demo click -> waveform canvas has painted pixels
//   ux_page_switch_ms   click a container tab -> its main content is visible
//   ux_palette_ms       Cmd/Ctrl-K -> command palette input focused
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = resolve(HERE, "..");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ROOT = resolve(arg("--root") ?? MAIN);
const SHOTS = process.argv.includes("--shots");
const PAGES = ["signal", "channels", "ica", "epochs", "evoked", "tfr", "source", "pipeline"];
const VIEWPORTS = { phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] };
// Playwright and axe come from the frontend install; bench/ has no node_modules.
const { chromium } = createRequire(join(MAIN, "frontend/package.json"))("@playwright/test");
const AXE = readFileSync(join(MAIN, "frontend/node_modules/axe-core/axe.min.js"), "utf8");

const freePort = () => new Promise((ok) => {
  const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); });
});
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

async function startServer() {
  if (!process.argv.includes("--no-build"))
    execSync("npx vite build --logLevel error", { cwd: join(ROOT, "frontend"), stdio: "ignore" });
  const port = await freePort();
  const proc = spawn(join(MAIN, "backend/.venv/bin/python"),
    ["-m", "uvicorn", "app.main:app", "--port", String(port), "--log-level", "warning"],
    { cwd: join(ROOT, "backend"), stdio: "ignore",
      env: { ...process.env, SEMA_STATIC_DIR: join(ROOT, "frontend/dist"),
             SEMA_DATA_DIR: join(MAIN, "bench/out/ux-data-" + port) } });
  const url = `http://127.0.0.1:${port}`;
  process.on("exit", () => rmSync(join(MAIN, "bench/out/ux-data-" + port), { recursive: true, force: true }));
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(url + "/api/health")).ok) return { proc, url }; } catch {}
    await new Promise((z) => setTimeout(z, 250));
  }
  proc.kill(); throw new Error("server did not start");
}

// Runs inside the page. Pure DOM geometry, no framework knowledge.
function audit() {
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
      && +cs.opacity > 0 && r.bottom > 0 && r.top < vh * 3;
  };
  const sel = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [tabindex]:not([tabindex='-1'])";
  const ctrls = [...document.querySelectorAll(sel)].filter(visible);
  const boxes = ctrls.map((el) => el.getBoundingClientRect());
  let overlaps = 0;
  for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
    if (ctrls[i].contains(ctrls[j]) || ctrls[j].contains(ctrls[i])) continue;
    const a = boxes[i], b = boxes[j];
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 2 && iy > 2) overlaps++;
  }
  const small = boxes.filter((r, i) => (r.width < 24 || r.height < 24)
    && !["INPUT"].includes(ctrls[i].tagName) && ctrls[i].getAttribute("role") !== "slider").length;
  // A control inside a horizontal scroller is reachable by scrolling; only
  // count ones the page itself cuts off.
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
  const offscreen = boxes.filter((r, i) => (r.left < -1 || r.right > vw + 1) && !inScroller(ctrls[i])).length;
  let clipped = 0, tiny = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    if (parseFloat(getComputedStyle(el).fontSize) < 11) tiny++;
  }
  for (const el of seen) {
    const cs = getComputedStyle(el);
    if ((cs.overflow + cs.overflowX).includes("hidden") && el.scrollWidth > el.clientWidth + 1
        && !el.closest("[title],[aria-label]")) clipped++;
  }
  return { overflow: Math.max(0, document.documentElement.scrollWidth - vw), overlaps, small,
           offscreen, clipped, tiny };
}

async function run() {
  const { proc, url } = await startServer();
  const browser = await chromium.launch();
  const out = { ux_axe_serious: 0, ux_axe_moderate: 0, ux_overflow_px: 0, ux_overlaps: 0,
    ux_small_targets: 0, ux_clipped_text: 0, ux_tiny_text: 0, ux_offscreen_ctrls: 0,
    ux_console_errors: 0, ux_cls: 0 };
  const detail = {}, errors = [];
  const firstTrace = [], pageSwitch = [], palette = [];
  if (SHOTS) mkdirSync(join(MAIN, "bench/out/ux"), { recursive: true });
  try {
    for (const [vpName, [w, h]] of Object.entries(VIEWPORTS)) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h },
        isMobile: vpName === "phone", hasTouch: vpName !== "desktop" });
      await ctx.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
          .observe({ type: "layout-shift", buffered: true });
      });
      const page = await ctx.newPage();
      page.on("console", (m) => { if (m.type() === "error") { out.ux_console_errors++; errors.push(`${vpName}: ${m.text().slice(0, 200)}`); } });
      page.on("pageerror", (e) => { out.ux_console_errors++; errors.push(`${vpName}: ${String(e).slice(0, 200)}`); });

      await page.goto(url + "/");
      await page.addScriptTag({ content: AXE });
      await measure(page, `connect@${vpName}`);

      const t0 = Date.now();
      await page.getByRole("button", { name: /Synthetic sample/ }).click();
      await page.waitForURL(/\/s\/[a-z0-9]+/);
      await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some((c) => {
        if (c.width < 50 || c.height < 50) return false;
        const g = c.getContext("2d"); if (!g) return false;
        const d = g.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 64) if (d[i]) return true;
        return false;
      }), null, { timeout: 30000 });
      if (vpName === "desktop") firstTrace.push(Date.now() - t0);
      const sid = page.url().split("/")[4];
      await page.waitForTimeout(1500);

      for (const p of PAGES) {
        const ts = Date.now();
        await page.goto(`${url}/s/${sid}/${p}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        if (vpName === "desktop") pageSwitch.push(Date.now() - ts);
        await page.addScriptTag({ content: AXE });
        await measure(page, `${p}@${vpName}`);
      }
      if (vpName === "desktop") {
        await page.goto(`${url}/s/${sid}/signal`); await page.waitForLoadState("networkidle").catch(() => {});
        for (let i = 0; i < 3; i++) {
          const ts = Date.now();
          await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
          await page.waitForFunction(() => document.activeElement?.tagName === "INPUT", null, { timeout: 5000 })
            .then(() => palette.push(Date.now() - ts)).catch(() => palette.push(5000));
          await page.keyboard.press("Escape");
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close(); proc.kill();
  }

  async function measure(page, key) {
    await page.waitForTimeout(400);
    const a = await page.evaluate(audit);
    const axe = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ["violations"] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length }));
    });
    const cls = await page.evaluate(() => window.__cls || 0);
    const serious = axe.filter((v) => v.impact === "serious" || v.impact === "critical").reduce((s, v) => s + v.n, 0);
    const moderate = axe.reduce((s, v) => s + v.n, 0) - serious;
    out.ux_axe_serious += serious; out.ux_axe_moderate += moderate;
    out.ux_overflow_px += a.overflow; out.ux_overlaps += a.overlaps; out.ux_small_targets += a.small;
    out.ux_clipped_text += a.clipped; out.ux_tiny_text += a.tiny; out.ux_offscreen_ctrls += a.offscreen;
    out.ux_cls += Math.round(cls * 1000);
    detail[key] = { ...a, axe: axe.map((v) => `${v.id}:${v.impact}:${v.n}`), cls: +cls.toFixed(3) };
    if (SHOTS) await page.screenshot({ path: join(MAIN, "bench/out/ux", key.replace("@", "_") + ".png") });
  }

  out.ux_first_trace_ms = median(firstTrace);
  out.ux_page_switch_ms = median(pageSwitch);
  out.ux_palette_ms = median(palette);
  mkdirSync(join(MAIN, "bench/out"), { recursive: true });
  writeFileSync(join(MAIN, "bench/out/ux_detail.json"), JSON.stringify({ ...detail, console_errors: errors }, null, 1));
  console.log(JSON.stringify(out));
}

run().catch((e) => { console.error(e); process.exit(1); });
