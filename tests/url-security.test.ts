import { describe, expect, it, vi } from "vitest";
import { isPublicIPv4, isPublicIPv6, normalizeWebsiteUrl } from "@/lib/security/url";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === "internal.example.com") return [{ address: "10.0.0.7", family: 4 }];
    if (host === "mixed.example.com")
      return [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ];
    if (host === "nowhere.example") throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

describe("normalizeWebsiteUrl", () => {
  it("accepts and normalizes public http(s) URLs", () => {
    expect(normalizeWebsiteUrl("https://example.com")).toMatchObject({ ok: true, url: "https://example.com/" });
    expect(normalizeWebsiteUrl("example.com/pricing?plan=team")).toMatchObject({
      ok: true,
      url: "https://example.com/pricing?plan=team",
    });
    expect(normalizeWebsiteUrl("  http://staging.example.co.uk:8080/app#section ")).toMatchObject({
      ok: true,
      url: "http://staging.example.co.uk:8080/app",
    });
  });

  it.each([
    ["ftp://example.com", "Only http"],
    ["javascript:alert(1)", "Only http"],
    ["file:///etc/passwd", "Only http"],
    ["", "Enter the website"],
    ["https://exa mple.com", "spaces"],
    ["https://user:pass@example.com", "username or password"],
  ])("rejects %s", (input, reason) => {
    const result = normalizeWebsiteUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://10.1.2.3",
    "http://192.168.0.10/admin",
    "http://172.16.4.4",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://2130706433/", // decimal form of 127.0.0.1
    "http://0x7f.0.0.1/", // hex form of 127.0.0.1
    "http://printer.local",
    "http://app.localhost",
  ])("blocks private or local destination %s", (input) => {
    const result = normalizeWebsiteUrl(input);
    expect(result.ok).toBe(false);
  });

  it("requires a full domain name", () => {
    const result = normalizeWebsiteUrl("http://intranet");
    expect(result.ok).toBe(false);
  });
});

describe("IP range checks", () => {
  it("classifies IPv4 addresses", () => {
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
    expect(isPublicIPv4("172.32.0.1")).toBe(true);
    expect(isPublicIPv4("172.31.255.255")).toBe(false);
    expect(isPublicIPv4("100.64.0.1")).toBe(false);
    expect(isPublicIPv4("0.0.0.0")).toBe(false);
  });

  it("classifies IPv6 addresses", () => {
    expect(isPublicIPv6("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIPv6("::1")).toBe(false);
    expect(isPublicIPv6("fe80::1")).toBe(false);
    expect(isPublicIPv6("fc00::1")).toBe(false);
    expect(isPublicIPv6("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicIPv6("64:ff9b::7f00:1")).toBe(false);
  });
});

describe("validatePublicWebsite (DNS)", () => {
  it("rejects domains that resolve to private addresses", async () => {
    const { validatePublicWebsite } = await import("@/lib/security/dns");
    expect((await validatePublicWebsite("internal.example.com")).ok).toBe(false);
    expect((await validatePublicWebsite("mixed.example.com")).ok).toBe(false);
  });

  it("explains domains that don't resolve", async () => {
    const { validatePublicWebsite } = await import("@/lib/security/dns");
    const result = await validatePublicWebsite("https://nowhere.example");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("couldn't find");
  });

  it("accepts public domains", async () => {
    const { validatePublicWebsite } = await import("@/lib/security/dns");
    expect(await validatePublicWebsite("example.com")).toMatchObject({ ok: true, url: "https://example.com/" });
  });
});

describe("safeHttpUrl (agent-reported links)", () => {
  it("only allows ordinary web addresses to become links", async () => {
    const { safeHttpUrl } = await import("@/lib/presentation/labels");
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>")).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
  });
});
