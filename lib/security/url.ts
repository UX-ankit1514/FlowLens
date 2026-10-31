/**
 * Website URL validation shared by the browser form and the server.
 *
 * This file is isomorphic (no Node APIs) so the form can give instant inline
 * feedback. The server additionally resolves DNS (see ./dns.ts) before a run
 * starts, so hostnames that point at private networks are also rejected.
 */

export type UrlCheck =
  | { ok: true; url: string; hostname: string }
  | { ok: false; reason: string };

const MAX_URL_LENGTH = 2048;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
  ".arpa",
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

const PRIVATE_DESTINATION =
  "This address points to a local or private network. FlowLens can only test publicly reachable websites.";

/** Normalizes user input into an absolute http(s) URL, or explains why not. */
export function normalizeWebsiteUrl(input: string): UrlCheck {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Enter the website address you want to test." };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "This address is too long." };
  if (/\s/.test(trimmed)) return { ok: false, reason: "Website addresses can't contain spaces." };

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  // "example.com:8080" looks like a scheme to the regex; treat host:port as schemeless.
  const looksLikeHostPort = /^[^/:]+:\d+(\/|$)/.test(trimmed);
  const candidate = hasScheme && !looksLikeHostPort ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid website address." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http:// and https:// websites can be tested." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Remove the username or password from the address." };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, reason: "The address is missing a domain name." };

  const hostCheck = checkHostname(hostname);
  if (!hostCheck.ok) return hostCheck;

  parsed.hash = "";
  return { ok: true, url: parsed.toString(), hostname };
}

export function checkHostname(hostname: string): { ok: true } | { ok: false; reason: string } {
  const host = hostname.replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: PRIVATE_DESTINATION };
  }

  if (isIPv4(host)) {
    return isPublicIPv4(host) ? { ok: true } : { ok: false, reason: PRIVATE_DESTINATION };
  }
  if (host.includes(":")) {
    return isPublicIPv6(host) ? { ok: true } : { ok: false, reason: PRIVATE_DESTINATION };
  }

  if (!host.includes(".")) {
    return { ok: false, reason: "Use a full public domain, for example example.com." };
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((label) => !label || label.length > 63)) {
    return { ok: false, reason: "That domain name isn't valid." };
  }
  return { ok: true };
}

export function isIPv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p)
  );
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPublicIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return false;
  const value = ipv4ToInt(ip);
  return !PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expands an IPv6 string into 8 16-bit groups. Returns null if invalid. */
function expandIPv6(ip: string): number[] | null {
  let address = ip.toLowerCase().split("%")[0];
  // Embedded IPv4 tail, e.g. ::ffff:127.0.0.1
  const v4Match = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    if (!isIPv4(v4Match[1])) return null;
    const n = ipv4ToInt(v4Match[1]);
    address = address.slice(0, -v4Match[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

export function isPublicIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return false;
  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (g.every((x) => x === 0)) return false; // ::
  if (allZeroPrefix(7) && g[7] === 1) return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (allZeroPrefix(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPublicIPv4(v4);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // NAT64 well-known prefix embeds an IPv4 address
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPublicIPv4(v4);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) {
    // 6to4 embeds an IPv4 address in groups 1-2
    const v4 = `${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`;
    return isPublicIPv4(v4);
  }
  return true;
}

export function isPublicIp(ip: string): boolean {
  return isIPv4(ip) ? isPublicIPv4(ip) : isPublicIPv6(ip);
}
