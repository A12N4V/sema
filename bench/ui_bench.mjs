// Static UI/iconography audit + production bundle size. Lower is better for all.
//
//   node bench/ui_bench.mjs [--no-build]
//
// The audit is regex-level on purpose: cheap, deterministic, and legible to an
// agent reading the score. It measures *consistency*, not taste:
//   icon_size_variants   distinct lucide `size={n}` values (target: a small scale, e.g. 12/14/16)
//   icon_off_scale       lucide icons whose size is not on ICON_SCALE
//   raw_hex_colors       hard-coded #rrggbb in .tsx (should come from theme tokens / CSS vars)
//   unlabeled_icon_btns  <button> whose body is only an icon and has no aria-label/title
//   inline_styles        style={{...}} and el.style.x = ... in .tsx (dynamic geometry via CSS vars is fine)
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "frontend/src");
const ICON_SCALE = new Set([12, 14, 16, 20, 24]);

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const tsx = walk(SRC).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

const out = { icon_size_variants: 0, icon_off_scale: 0, raw_hex_colors: 0, unlabeled_icon_btns: 0, inline_styles: 0 };
const sizes = new Set();
for (const f of tsx) {
  const s = readFileSync(f, "utf8");
  const icons = new Set((s.match(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/)?.[1] ?? "")
    .split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  for (const m of s.matchAll(/<([A-Z]\w*)\b[^>]*?\bsize=\{(\d+)\}/g)) {
    if (!icons.has(m[1])) continue;
    const n = +m[2]; sizes.add(n); if (!ICON_SCALE.has(n)) out.icon_off_scale++;
  }
  out.raw_hex_colors += (s.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
  // Imperative style writes count too, or moving style={{}} into a ref callback "wins".
  out.inline_styles += (s.match(/style=\{\{/g) ?? []).length + (s.match(/\.style\.\w+\s*=|\.style\.setProperty\(/g) ?? []).length;
  for (const m of s.matchAll(/<button\b([^>]*)>\s*<([A-Z]\w*)\b[^>]*\/>\s*<\/button>/g)) {
    if (icons.has(m[2]) && !/aria-label|title=/.test(m[1])) out.unlabeled_icon_btns++;
  }
}
out.icon_size_variants = sizes.size;

if (!process.argv.includes("--no-build")) {
  execSync("npx vite build --logLevel error", { cwd: join(ROOT, "frontend"), stdio: "ignore" });
  let js = 0, css = 0;
  for (const f of walk(join(ROOT, "frontend/dist/assets"))) {
    const gz = gzipSync(readFileSync(f)).length / 1024;
    if (f.endsWith(".js")) js += gz; else if (f.endsWith(".css")) css += gz;
  }
  out.bundle_js_gz_kb = +js.toFixed(1);
  out.bundle_css_gz_kb = +css.toFixed(1);
}
console.log(JSON.stringify(out));
