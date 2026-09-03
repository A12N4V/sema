#!/usr/bin/env node
// Render an HTML wireframe to PDF via headless Chrome.
//
//   node build.mjs --html <path/to/wireframe.html> --out <path/to/out.pdf>
//                  [--orientation landscape|portrait]  (default: landscape)
//                  [--settle 2200]                     (ms to wait for wired-elements to draw)
//   node build.mjs --find-chrome                       (print the chrome path and exit 0/1)
//
// Serves the HTML's directory on a random localhost port (so ES-module / font / asset
// loads work), waits for fonts + custom elements, prints, and shuts down. No external
// server, no python. Needs puppeteer-core installed in the workspace.

import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

// ---------- args ----------
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

// ---------- resolve modules from the WORKSPACE, not the skill dir ----------
// deps (puppeteer-core, maybe puppeteer) are installed next to the HTML, not here.
function requireFromWorkspace() {
  const starts = [arg('--html', ''), process.cwd()].filter(Boolean).map((p) => resolve(p));
  for (let dir of starts) {
    if (existsSync(dir) && !dir.endsWith('.html')) dir = dir; else dir = dirname(dir);
    for (let d = dir, prev = ''; d !== prev; prev = d, d = dirname(d)) {
      if (existsSync(join(d, 'node_modules'))) return createRequire(join(d, 'package.json'));
    }
  }
  return createRequire(import.meta.url); // fallback: skill dir
}
const require = requireFromWorkspace();

// ---------- chrome discovery ----------
async function* walkChrome(root) {
  if (!existsSync(root)) return;
  for (const ent of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!ent.isDirectory()) continue;
    yield join(root, ent.name);
  }
}
async function findChrome() {
  // 1. a full `puppeteer` install knows its own browser
  try {
    const pptr = require('puppeteer');
    const p = pptr.executablePath?.();
    if (p && existsSync(p)) return p;
  } catch {}
  // 2. glob the standard caches (version-agnostic)
  const roots = [
    join(homedir(), '.cache/puppeteer/chrome'),
    join(homedir(), '.cache/puppeteer/chrome-headless-shell'),
    join(homedir(), 'Library/Caches/ms-playwright'),
  ];
  const names = [
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chrome-headless-shell-mac-x64/chrome-headless-shell',
    'chrome-linux64/chrome',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-win64/chrome.exe',
  ];
  for (const root of roots) {
    for await (const verDir of walkChrome(root)) {
      for await (const inner of walkChrome(verDir)) {
        for (const n of names) {
          const cand = join(inner, n);
          if (existsSync(cand)) return cand;
        }
        for (const n of names) {
          const cand = join(verDir, n);
          if (existsSync(cand)) return cand;
        }
      }
    }
  }
  // 3. common system installs
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) if (existsSync(p)) return p;
  return null;
}

if (has('--find-chrome')) {
  const c = await findChrome();
  if (c) { console.log(c); process.exit(0); }
  console.error('no chrome found'); process.exit(1);
}

// ---------- static server ----------
const htmlPath = resolve(arg('--html', ''));
const outPath = resolve(arg('--out', htmlPath.replace(/\.html?$/, '') + '.pdf'));
const orientation = arg('--orientation', 'landscape');
const settle = parseInt(arg('--settle', '2200'), 10);
if (!htmlPath || !existsSync(htmlPath)) { console.error('--html <file> is required and must exist'); process.exit(1); }

const ROOT = dirname(htmlPath);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '') p = '/' + basename(htmlPath);
    const fp = join(ROOT, p);
    if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const s = await stat(fp).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch (e) { res.writeHead(500).end(String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/${basename(htmlPath)}`;

// ---------- render ----------
const chrome = await findChrome();
if (!chrome) { console.error('No Chrome binary. Run: npx @puppeteer/browsers install chrome@stable'); process.exit(1); }

const puppeteer = require('puppeteer-core');
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text()); });
  page.on('requestfailed', (r) => console.log('[request failed]', r.url(), r.failure()?.errorText));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(async () => {
    await (window.__WIRED_READY__ || Promise.resolve());
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await new Promise((r) => setTimeout(r, settle));
  // wired-elements redraw on resize — nudge, then wait once more
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise((r) => setTimeout(r, Math.min(settle, 800)));

  await page.pdf({
    path: outPath,
    printBackground: true,
    preferCSSPageSize: true,          // the @page rule in the HTML wins
    landscape: orientation === 'landscape',
    format: 'A4',
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  console.log('wrote', outPath);
} finally {
  await browser.close().catch(() => {});
  server.closeAllConnections?.();
  server.close();
}
// Chrome/keep-alive sockets can keep the event loop alive — exit deterministically.
process.exit(0);
