export interface NewsCountry {
  id: string;
  name: string;
  iso2: string | null;
}

/** The feed that gave a candidate story. */
export type Feed = 'nation' | 'top' | 'search' | 'outlet' | 'newsdata';

/** One story from one feed, before clustering and ranking. */
export interface Candidate {
  title: string;
  url: string;
  /** Publisher name, for example "The Hindu". */
  source: string;
  /** Publisher host with no "www.", for example "thehindu.com". Null when unknown. */
  domain: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  feed: Feed;
  /** 1-based position in a Google edition feed (nation, top). Null for other feeds. */
  rank: number | null;
  /** Outlets that Google lists for the same story. Empty when the feed has no such list. */
  outlets: string[];
  /** BCP-47 language of the title when it is not English, else null. */
  lang: string | null;
  /** NewsData source_priority: a reach rank (lower is bigger). */
  priority?: number;
  /**
   * True when the source already tied the story to the country: a search that asked for the capital
   * too. Then the bare name of a homonym country ("Georgia") is enough (see relevance 'weak').
   */
  confirmed?: boolean;
}

/** Thrown for a failed upstream call. The message never holds the request URL or the body. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}
