// UI validation checks (no TinyFish runs are started).
// Usage: node tests/e2e/validation.mjs <output-dir> [baseUrl]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [outDir, baseUrl = "http://localhost:3000"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const results = [];
const check = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}`);

await page.goto(`${baseUrl}/new`, { waitUntil: "networkidle" });
const run = page.getByRole("button", { name: "Run usability test" });

// Required fields show inline errors after blur, and Run stays disabled.
for (const label of ["Website to test", "Who are we testing for?", "What does this user want to accomplish?", "What counts as success?"]) {
  await page.getByLabel(label).focus();
  await page.getByLabel(label).blur();
}
await page.waitForTimeout(300);
check("Run disabled with empty form", await run.isDisabled());
check("Inline error for persona", await page.getByText("Describe who you're testing for").isVisible());
check("Inline error for success criteria", await page.getByText("Add at least one success criterion").isVisible());
await page.screenshot({ path: join(outDir, "v1-empty-errors.png"), fullPage: true });

// Private network URL is rejected client-side.
await page.getByLabel("Website to test").fill("http://192.168.1.10/admin");
await page.getByLabel("Website to test").blur();
await page.waitForTimeout(200);
check("Private IP rejected inline", await page.getByText("local or private network").first().isVisible());

// Fill the rest; Run enables for a public URL; server rejects a non-existent domain.
await page.getByLabel("Who are we testing for?").fill("Dana, a freelance designer who buys software for herself.");
await page.getByLabel("What does this user want to accomplish?").fill("Find the price of the cheapest paid plan.");
await page.getByLabel("What counts as success?").fill("Find the pricing page\nIdentify the cheapest paid plan price");
await page.getByLabel("Website to test").fill("https://flowlens-nonexistent-domain-check-7731.com");
await page.waitForTimeout(200);
check("Run enabled when all fields valid", await run.isEnabled());
await run.click();
await page.waitForTimeout(1500);
check("Stays on setup page after server rejection", !page.url().includes("/sessions/"));
check("Server DNS error shown inline", await page.getByText("couldn't find").first().isVisible());
await page.screenshot({ path: join(outDir, "v2-dns-error.png"), fullPage: true });

// Keyboard: tabbing from the last field reaches the Run button.
await page.getByLabel("Website to test").fill("https://example.com");
await page.getByLabel("Session name").focus();
let reachedRun = false;
for (let i = 0; i < 6 && !reachedRun; i++) {
  await page.keyboard.press("Tab");
  reachedRun = await page.evaluate(() => document.activeElement?.textContent?.includes("Run usability test") ?? false);
}
check("Run button reachable by keyboard", reachedRun);

// Narrow viewport: the layout stacks.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "v3-mobile.png"), fullPage: true });

console.log(results.join("\n"));
await browser.close();
