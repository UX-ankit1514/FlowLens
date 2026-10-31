// Usage: node tests/e2e/shot.mjs <url> <out.png> [width] [height] [fullPage]
import { chromium } from "playwright-core";
const [url, out, w = "1440", h = "900", full = "1"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: full === "1" });
console.log(logs.slice(0, 20).join("\n") || "no console errors");
await browser.close();
