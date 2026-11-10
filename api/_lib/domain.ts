// Publisher hosts: normalise a URL or a bare host, and find the host of a story.

// Prefixes that do not change the publisher. "www3." stays: www3.nhk.or.jp is NHK World, not NHK.
const HOST_PREFIX = /^(?:www|m|amp|mobile)\./;

// Hosts that link to other publishers' stories. Their host is never the publisher of a story.
const AGGREGATORS = new Set([
  'news.google.com', 'google.com', 'msn.com', 'flipboard.com', 'apple.news', 'newsbreak.com', 'ground.news',
  'feedproxy.google.com', 'feeds.feedburner.com',
]);

/**
 * "https://www.TheGuardian.com/world" -> "theguardian.com"; "nytimes.com" -> "nytimes.com".
 * Removes "www.", "m.", "amp." and "mobile.". Returns null for anything that is not an http(s) URL or a host.
 */
export function normalizeHost(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim().toLowerCase();
  if (!raw || raw.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;
  let host: string;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    host = url.hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '');
  while (HOST_PREFIX.test(host)) host = host.replace(HOST_PREFIX, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}

/** True for a host that only links to other publishers (news.google.com, msn.com, ...). */
export function isAggregatorHost(host: string): boolean {
  return AGGREGATORS.has(host) || host.endsWith('.google.com');
}

/**
 * The publisher host of a story. Tries each input in order and skips aggregator hosts,
 * so a news.google.com redirect link never gives the domain.
 */
export function publisherHost(...inputs: unknown[]): string | null {
  for (const input of inputs) {
    const host = normalizeHost(input);
    if (host && !isAggregatorHost(host)) return host;
  }
  return null;
}

// Two-level public suffixes. Under these, the registrable domain has 3 labels ("bbc.co.uk").
const TWO_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.za', 'co.jp', 'or.jp', 'ne.jp', 'co.in',
  'com.br', 'com.ng', 'co.nz', 'com.sg', 'com.my', 'com.ph', 'com.pk', 'co.ke', 'co.il', 'com.hk', 'com.tr',
  'com.mx', 'com.ar', 'com.cn', 'com.tw', 'co.kr', 'com.bd', 'com.np', 'com.lk', 'com.eg', 'com.sa', 'co.tz',
  'co.ug', 'co.zw', 'com.gh', 'com.fj', 'gov.in', 'nic.in', 'gov.au', 'go.jp', 'gob.mx', 'gov.br', 'com.ua',
]);

/** "news.bbc.co.uk" -> "bbc.co.uk"; "au.investing.com" -> "investing.com". */
export function registrableDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/**
 * The host, then each parent down to the registrable domain:
 * "edition.cnn.com" -> ["edition.cnn.com", "cnn.com"].
 */
export function hostChain(host: string): string[] {
  const stop = registrableDomain(host);
  const out = [host];
  let h = host;
  while (h !== stop && h.includes('.')) {
    h = h.slice(h.indexOf('.') + 1);
    out.push(h);
  }
  return out;
}
