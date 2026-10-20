import type { NewsArticle, NewsProvider } from '../../../src/types';

export interface NewsCountry {
  id: string;
  name: string;
  iso2: string | null;
}

export interface Provider {
  name: NewsProvider;
  /** False when the provider needs config that is missing (an API key). */
  enabled(): boolean;
  /** Returns up to `limit` articles. Throws on network or upstream failure. */
  fetchTop(country: NewsCountry, limit: number, signal: AbortSignal): Promise<NewsArticle[]>;
}

/** Thrown for a failed upstream call. The message never holds the request URL or the body. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}
