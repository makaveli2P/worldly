import { UpstreamError } from './providers/types.js';

export const PROVIDER_TIMEOUT_MS = 4000;

const USER_AGENT = 'Mozilla/5.0 (compatible; Worldly/0.1)';

/**
 * GETs a URL with a timeout. Throws UpstreamError with only the status code, so
 * the URL (which can hold an API key) and the body never reach logs.
 */
export async function getText(url: string, signal: AbortSignal, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json, application/rss+xml, application/xml;q=0.9, */*;q=0.5' },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    throw new UpstreamError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError(`http ${response.status}`);
  }
  return response.text();
}

export async function getJson(url: string, signal: AbortSignal, timeoutMs?: number): Promise<unknown> {
  const text = await getText(url, signal, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError('invalid json');
  }
}
