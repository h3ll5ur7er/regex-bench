// Renders public/icons/icon.svg into the PNG icons the PWA manifest and the desktop app need.
// Usage: node scripts/icons.mjs   (needs Playwright's Chromium; run `npx tauri icon` in desktop/ afterwards)
import { readFile, writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, file, padding = 0) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  await page.setContent(`<html><body style="margin:0;background:${padding ? '#5b4dff' : 'transparent'}">
    <div style="padding:${padding}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await writeFile(file, await page.screenshot({ omitBackground: !padding }));
}
await render(192, 'public/icons/icon-192x192.png');
await render(512, 'public/icons/icon-512x512.png');
await render(512, 'public/icons/icon-maskable-512x512.png', 64);
await render(1024, '../desktop/src-tauri/icons/source.png');
await browser.close();
for (const s of [72, 96, 128, 144, 152, 384]) await rm(`public/icons/icon-${s}x${s}.png`, { force: true });
console.log('icons written');
