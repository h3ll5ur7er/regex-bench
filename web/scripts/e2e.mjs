// End-to-end checks of the production build in a real browser:
//  - no request ever leaves the origin (ADR-002),
//  - matching works on each backend (native, translated, Rust WASM),
//  - a runaway pattern is stopped and the app recovers (ADR-003),
//  - a share link round-trips,
//  - after the first visit the installed app works offline (M2).
//
// Usage: node scripts/e2e.mjs [dist-dir] [base-path]
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const root = process.argv[2] ?? 'dist/web/browser';
const base = process.argv[3] ?? '/';
const port = 4399;
const origin = `http://localhost:${port}`;
const url = origin + base;

const server = await serve(root, port, base);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const failures = [];
const external = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

context.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u);
});
page.on('pageerror', (e) => failures.push('page error: ' + e.message));

const status = () => page.locator('rb-pattern-bar .status').innerText();
async function waitForStatus(re, timeout = 8000) {
  const end = Date.now() + timeout;
  let s = '';
  while (Date.now() < end) {
    s = await status();
    if (re.test(s)) return s;
    await page.waitForTimeout(100);
  }
  return s;
}
async function replace(selector, text) {
  await page.locator(selector).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

try {
  await page.goto(url);
  check(/4 matches/.test(await waitForStatus(/matches/)), 'default session shows 4 matches');
  await page.locator('rb-diagram-strip img').waitFor({ timeout: 15000 });
  check(true, 'railroad diagram renders (rockuml WASM)');

  await page.selectOption('rb-workbench select.field', 'rust');
  check(/4 matches.*Rust/s.test(await waitForStatus(/Rust/, 15000)), 'Rust flavor runs on the Rust core (WASM)');

  await page.selectOption('rb-workbench select.field', 'pcre');
  await replace('rb-pattern-bar .cm-content', '(?>\\d+)-(?P<m>\\d\\d)');
  check(/5 matches.*translated/s.test(await waitForStatus(/5 matches/)), 'PCRE atomic group runs translated');

  await page.selectOption('rb-workbench select.field', 'ecmascript');
  await replace('rb-text-pane .cm-content', 'a'.repeat(34) + '!');
  await replace('rb-pattern-bar .cm-content', '(a+)+$');
  check(/too slow/.test(await waitForStatus(/too slow/, 6000)), 'catastrophic backtracking is stopped');
  await replace('rb-pattern-bar .cm-content', 'a+!');
  check(/1 match/.test(await waitForStatus(/1 match/)), 'the sandbox recovers after a timeout');

  // Share link round trip
  await page.getByRole('button', { name: /Share/ }).click();
  await page.getByRole('button', { name: /Create and copy/ }).click();
  await page.waitForFunction(() => !!document.querySelector('rb-share-dialog input.field')?.value);
  const link = await page.locator('rb-share-dialog input.field').inputValue();
  const page2 = await context.newPage();
  await page2.goto(link);
  await page2.waitForTimeout(1500);
  const shared = await page2.locator('rb-pattern-bar .cm-content').innerText();
  check(shared === 'a+!', 'share link restores the pattern');
  await page2.close();
  await page.keyboard.press('Escape');

  // Offline: wait until the service worker has cached the build, then go offline and reload.
  const cached = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return false;
    for (let i = 0; i < 120; i++) {
      const keys = await caches.keys();
      let entries = 0;
      for (const k of keys) entries += (await (await caches.open(k)).keys()).length;
      if (entries > 10 && navigator.serviceWorker.controller) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  });
  if (!cached) await page.reload();
  check(cached || !!(await page.evaluate(() => navigator.serviceWorker.controller)), 'service worker installed and caching');
  await page.waitForTimeout(3000);
  await context.setOffline(true);
  await page.reload();
  check(/match/.test(await waitForStatus(/match/, 10000)), 'the app works offline after the first visit');
  await page.selectOption('rb-workbench select.field', 'rust');
  check(/Rust/.test(await waitForStatus(/Rust/, 15000)), 'the Rust core works offline');
  await context.setOffline(false);

  check(external.length === 0, `no request left the origin${external.length ? ': ' + external.join(', ') : ''}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall end-to-end checks passed');
