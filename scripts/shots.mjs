/**
 * Capture the README screenshots against the real running stack.
 *
 *   ./dev.sh                     # in another shell
 *   node scripts/shots.mjs
 *
 * Writes 2x PNGs into docs/img/. Every frame is a real session: a real MNE
 * `Raw`, a real ICA fit, real matplotlib figures. Nothing here is mocked, so a
 * screenshot that looks wrong means the app is wrong, which is the point of
 * regenerating them rather than keeping stale ones in git.
 *
 * Pass --theme light for the light-mode set.
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Playwright is a frontend devDependency, and node resolves bare specifiers
// from the *script's* directory, not the cwd, so importing it by name from
// scripts/ fails however you invoke this. Resolve it against frontend/.
const require_ = createRequire(resolve(ROOT, "frontend/package.json"));
const { chromium } = require_("@playwright/test");   // CJS, so require, not import
const OUT = resolve(ROOT, "docs/img");
const BASE = process.env.SEMA_URL ?? "http://localhost:5173";
const THEME = process.argv.includes("--theme") ? process.argv[process.argv.indexOf("--theme") + 1] : "dark";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: THEME,
});

const suffix = THEME === "light" ? "-light" : "";
const shot = async (name, ms = 1200) => {
  await page.waitForTimeout(ms);
  const path = `${OUT}/${name}${suffix}.png`;
  await page.screenshot({ path });
  console.log("  ✓", path.replace(ROOT + "/", ""));
};

const post = (id, url, body) =>
  page.evaluate(
    ([id, url, body]) =>
      fetch(`/api/sessions/${id}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [id, url, body],
  );

const op = (id, op_id, params) => post(id, "/ops", { op_id, params });

console.log(`capturing (${THEME}) from ${BASE}`);

// ---- 1. the launcher -------------------------------------------------------
await page.goto(BASE);
await page.waitForTimeout(1500);      // let the signal field draw a few frames
await shot("launcher", 400);

// ---- 2. a live session -----------------------------------------------------
await page.getByRole("button", { name: /Synthetic sample/ }).click();
await page.waitForURL(/\/s\//);
const id = new URL(page.url()).pathname.split("/")[2];
await page.waitForTimeout(9000);      // precompute pass + first figures
await shot("signal");

// ---- 3. channels and annotations -------------------------------------------
await page.goto(`${BASE}/s/${id}/channels`);
await shot("channels", 3000);

// ---- 4. ICA with ICLabel ---------------------------------------------------
await op(id, "filter", { l_freq: 1, h_freq: 40 });
await post(id, "/ica/fit", { n_components: 15, method: "fastica" });
await op(id, "label_ica", {});
await page.goto(`${BASE}/s/${id}/ica`);
await shot("ica", 8000);

// ---- 5. the epoched chain --------------------------------------------------
await op(id, "make_epochs", { tmin: -0.2, tmax: 0.8 });
await op(id, "average_epochs", {});
await page.goto(`${BASE}/s/${id}/evoked`);
await shot("evoked", 6000);

await op(id, "compute_tfr", { fmin: 4, fmax: 40, n_freqs: 24 });
await page.goto(`${BASE}/s/${id}/tfr`);
await shot("tfr", 8000);

// ---- 6. the provenance graph -----------------------------------------------
await page.goto(`${BASE}/s/${id}/pipeline`);
await shot("pipeline", 2500);

// ---- 7. the phone layout ---------------------------------------------------
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  colorScheme: THEME,
  isMobile: true,
  hasTouch: true,
});
await phone.goto(`${BASE}/s/${id}/signal`);
await phone.waitForTimeout(6000);
await phone.screenshot({ path: `${OUT}/phone${suffix}.png` });
console.log("  ✓ docs/img/phone" + suffix + ".png");

await browser.close();

// ---- 8. shrink them ---------------------------------------------------------
// Captured at 2x for sharpness, then resized and palette-quantised, because
// GitHub renders a README image at about 900 CSS px and the raw 2880px PNGs
// were 5.4 MB of screenshots headed into git history for no visible gain.
const py = resolve(ROOT, "backend/.venv/bin/python");
if (existsSync(py)) {
  const script = `
from PIL import Image
from pathlib import Path
for p in sorted(Path("${OUT}").glob("*.png")):
    im = Image.open(p).convert("RGB")
    target = 900 if "phone" in p.name else 1800
    if im.width > target:
        im = im.resize((target, round(im.height * target / im.width)), Image.LANCZOS)
    im.quantize(colors=256).save(p, optimize=True)
    print("  compressed", p.name, f"{p.stat().st_size // 1024}K")
`;
  const r = spawnSync(py, ["-c", script], { encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) console.warn("  (compression skipped:", (r.stderr ?? "").trim().split("\n").pop(), ")");
} else {
  console.warn("  (no backend venv, skipping compression: run ./scripts/setup.sh)");
}

console.log("done");
