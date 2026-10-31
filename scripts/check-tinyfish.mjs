// Connectivity check: runs one small, real TinyFish streaming automation and
// prints every event it receives. Usage: npm run check:tinyfish
import { TinyFish } from "@tiny-fish/sdk";

if (!process.env.TINYFISH_API_KEY) {
  console.error("TINYFISH_API_KEY is not set. Add it to .env.local or your shell.");
  process.exit(1);
}

const client = new TinyFish();
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

try {
  const wallet = await client.wallet.get();
  console.log(`[wallet] ${wallet.available_balance} ${wallet.currency}`);
} catch (err) {
  console.log(`[wallet] not available (${err?.status ?? ""} ${err?.message ?? err})`);
}

let runId;
let streamingUrl;
const stream = await client.agent.stream({
  url: "https://example.com",
  goal: "Read the main heading and the text of the link on this page. Do not leave the page.",
  output_schema: {
    type: "object",
    properties: {
      heading: { type: "string" },
      link_text: { type: "string" },
      outcome: { type: "string", enum: ["achieved", "not_achieved"] },
    },
    required: ["heading", "outcome"],
  },
});

for await (const event of stream) {
  if (event.type === "STARTED") runId = event.run_id;
  if (event.type === "STREAMING_URL") streamingUrl = event.streaming_url;
  console.log(`[${elapsed()}] ${event.type}`, JSON.stringify(event));
}

if (streamingUrl) {
  try {
    const res = await fetch(streamingUrl, { method: "GET" });
    console.log(`[stream-url] HTTP ${res.status}`, {
      "x-frame-options": res.headers.get("x-frame-options"),
      "content-security-policy": res.headers.get("content-security-policy"),
    });
  } catch (err) {
    console.log("[stream-url] fetch failed:", err.message);
  }
}

if (runId) {
  const res = await fetch(`https://agent.tinyfish.ai/v1/runs/${runId}?screenshots=url`, {
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
  });
  const run = await res.json();
  console.log("[run] status", run.status, "steps", run.steps?.length, "video_url", Boolean(run.video_url));
  console.log("[run] first steps", JSON.stringify(run.steps?.slice(0, 3), null, 2));
  const shot = run.steps?.find((s) => s.screenshot)?.screenshot;
  if (shot) {
    const anon = await fetch(shot);
    const authed = await fetch(shot, { headers: { "X-API-Key": process.env.TINYFISH_API_KEY } });
    console.log("[screenshot] anon", anon.status, anon.headers.get("content-type"), "| with key", authed.status, authed.headers.get("content-type"));
  }
}
