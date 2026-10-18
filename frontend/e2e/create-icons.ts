import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = await fs.readFile('public/local/icon.svg', 'utf8');
  await p.setContent(`<style>body{margin:0}svg{width:100vw;height:100vh}</style>${svg}`);
  await p.screenshot({ path: `public/local/icon-${size}.png` });
  await p.close();
}
await browser.close();
