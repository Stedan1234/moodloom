// Outbound requests to URLs that a USER supplied (a captured page, a remote
// image). Left unguarded, that is a server-side request forgery hole: the
// caller could point the server at its own network (localhost admin panels,
// cloud metadata at 169.254.169.254, other internal services) and read back
// the response as a "preview".
//
// The guard here works at connection time, not on the URL string:
//   1. only http/https, no credentials in the URL, only default-ish ports;
//   2. the hostname is resolved by OUR lookup function, which refuses any
//      address that is not ordinary public unicast (private, loopback,
//      link-local, CGNAT, multicast, IPv4-mapped IPv6 and so on);
//   3. the socket connects to exactly the address that was checked, so a DNS
//      answer that changes between "check" and "use" (rebinding) cannot slip
//      a private address through;
//   4. redirects are followed by hand, at most three, each hop re-checked;
//   5. the response body is capped and the whole request has a deadline.
import dns from 'dns';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { config } from '../config.js';

export function isPublicAddress(address) {
  let parsed;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const blocked = new Error(`Refusing to connect to a non-public address for ${hostname}`);
      blocked.code = 'ESSRF';
      return callback(blocked);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const guardedAgent = new Agent({
  connect: { lookup: guardedLookup, timeout: 5000 },
  headersTimeout: 8000,
  bodyTimeout: 8000,
});

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

// Checks everything that can be decided from the URL alone. Returns the
// parsed URL, or null if it should never be fetched.
export function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (!ALLOWED_PORTS.has(url.port)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return null;
  }
  // A literal IP is checked right here; a name is checked when it resolves.
  if (ipaddr.isValid(host) && !isPublicAddress(host)) return null;
  return url;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; MoodloomBot/1.0; link preview)';

/**
 * Fetches a user-supplied URL safely.
 * Resolves to { ok, status, contentType, body: Buffer, finalUrl } or null when
 * the URL is refused, unreachable, too slow, or the wrong kind of content.
 * Never throws: a preview is a nice-to-have, not something that fails a capture.
 */
export async function safeFetch(rawUrl, { maxBytes = 500_000, timeoutMs = 8000, accept = null, stopWhen = null } = {}) {
  let url = checkUrl(rawUrl);
  if (!url) return null;
  if (config.remoteFetchDisabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= 3; hop++) {
      const res = await undiciFetch(url, {
        dispatcher: guardedAgent,
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: accept || '*/*' },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) return null;
        url = checkUrl(new URL(location, url).toString());
        if (!url) return null;
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const declared = Number(res.headers.get('content-length'));
      if (!stopWhen && Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, status: res.status, contentType, body: Buffer.alloc(0), finalUrl: url.toString() };
      }

      const chunks = [];
      let received = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        chunks.push(Buffer.from(value));
        if (stopWhen && stopWhen(chunks)) break;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          if (stopWhen) break; // a page head is allowed to be cut short
          return null; // a binary file over the cap is refused outright
        }
      }
      reader.cancel().catch(() => {});
      return { ok: true, status: res.status, contentType, body: Buffer.concat(chunks), finalUrl: url.toString() };
    }
    return null; // too many redirects
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
