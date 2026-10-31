import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicIp, normalizeWebsiteUrl, type UrlCheck } from "./url";

/**
 * Full server-side destination check: syntax + scheme + hostname rules, then
 * DNS resolution so that public-looking names pointing at private, loopback or
 * cloud-metadata addresses are rejected (SSRF protection).
 *
 * FlowLens itself never fetches the target website; TinyFish's cloud browser
 * does. This check still runs so the app can never be used to aim a browser
 * at internal infrastructure, and so unreachable domains fail fast with a
 * clear explanation.
 */
export async function validatePublicWebsite(input: string): Promise<UrlCheck> {
  const check = normalizeWebsiteUrl(input);
  if (!check.ok) return check;

  const host = check.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return check; // literal IPs were already range-checked

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return {
        ok: false,
        reason: `We couldn't find ${host}. Check the spelling — the domain doesn't resolve to a website.`,
      };
    }
    return {
      ok: false,
      reason: `We couldn't look up ${host} right now (${code ?? "DNS error"}). Try again in a moment.`,
    };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `We couldn't find ${host}. The domain doesn't resolve to a website.` };
  }
  if (addresses.some((a) => !isPublicIp(a.address))) {
    return {
      ok: false,
      reason:
        "This domain resolves to a local or private network address. FlowLens can only test publicly reachable websites.",
    };
  }
  return check;
}
