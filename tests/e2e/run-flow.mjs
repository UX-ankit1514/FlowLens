// End-to-end check of the full FlowLens journey against a REAL website and a
// REAL TinyFish run (this uses TinyFish balance).
//
// Usage:
//   node tests/e2e/run-flow.mjs <config.json> <output-dir> [baseUrl]
// config.json: { websiteUrl, persona, goal, successCriteria: string[], stopAfterSeconds? }
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [configPath, outDir, baseUrl = "http://localhost:3000"] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
// Only FlowLens's own page; messages from TinyFish's embedded viewer are excluded.
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const src = m.location()?.url ?? "";
  if (src && !src.startsWith(baseUrl)) return;
  if (/cross-origin subframe|Protocol Error/.test(m.text())) return;
  consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(`${baseUrl}/new`, { waitUntil: "networkidle" });
const run = page.getByRole("button", { name: "Run usability test" });
log("Run disabled before input:", await run.isDisabled());

await page.getByLabel("Website to test").fill(config.websiteUrl);
await page.getByLabel("Who are we testing for?").fill(config.persona);
await page.getByLabel("What does this user want to accomplish?").fill(config.goal);
await page.getByLabel("What counts as success?").fill(config.successCriteria.join("\n"));
await page.screenshot({ path: join(outDir, "1-setup-filled.png"), fullPage: true });
log("Run enabled after input:", await run.isEnabled());

await run.click();
await page.waitForURL(/\/sessions\/[0-9a-f-]+$/, { timeout: 30_000 });
const sessionId = page.url().split("/").pop();
log("Session", sessionId);
await page.screenshot({ path: join(outDir, "2-live-preparing.png") });

// Wait for the live iframe, then capture it a few times while the agent works.
try {
  await page.locator("iframe").waitFor({ timeout: 60_000 });
  log("Live iframe attached");
  if (!config.stopAfterSeconds) {
    await page.waitForTimeout(8_000);
    await page.screenshot({ path: join(outDir, "3-live-running.png") });
    await page.waitForTimeout(15_000);
    await page.screenshot({ path: join(outDir, "4-live-running-later.png") });
  }
} catch {
  log("No live iframe within 60s");
  await page.screenshot({ path: join(outDir, "3-live-no-iframe.png") });
}

if (config.stopAfterSeconds) {
  await page.waitForTimeout(config.stopAfterSeconds * 1000);
  log("Clicking Stop test");
  await page.getByRole("button", { name: "Stop test" }).click({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(outDir, "4-stopping.png") });
}

// Wait for the session to reach a terminal state (max 10 minutes).
let session;
for (let i = 0; i < 200; i++) {
  session = await (await fetch(`${baseUrl}/api/sessions/${sessionId}`)).json();
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(session.executionStatus)) break;
  await new Promise((r) => setTimeout(r, 3_000));
}
log("Terminal status:", session.executionStatus, "| outcome:", session.taskOutcome);
await page.waitForTimeout(2_000);
await page.screenshot({ path: join(outDir, "5-live-finished.png") });

if (session.report) {
  await page.goto(`${baseUrl}/sessions/${sessionId}/report`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(outDir, "6-report-top.png") });
  // Scroll through so lazy-loaded evidence images load before the full-page capture.
  for (let y = 0; y < 12; y++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(outDir, "7-report-full.png"), fullPage: true });
}

writeFileSync(join(outDir, "session.json"), JSON.stringify(session, null, 2));
const r = session.report;
log("Events:", session.events.length, "| steps:", session.steps.length, "| screenshots:", session.steps.filter((s) => s.hasScreenshot).length);
if (r) {
  log("Report method:", r.method, "| checkpoints:", r.checkpoints.map((c) => c.status).join(", "));
  log("Findings:", r.findings.length, "| technical blockers:", r.technicalBlockers.length, "| patterns:", r.journey.patterns.length, "| valid structured result:", r.structuredResultValid);
}
if (session.error) log("Error:", JSON.stringify(session.error));
log("Console errors:", consoleErrors.length ? consoleErrors.slice(0, 10) : "none");
await browser.close();
