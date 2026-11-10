// Publisher ratings: the MBFC lean (when a table exists) and the State Media Monitor tag.
// The rating is for the publisher, never for the article. The tables stay on the server.
//
// The MBFC table (api/_lib/generated/mbfc.json) is not in git: MBFC does not allow redistribution.
// scripts/build-bias.mjs writes it when RAPIDAPI_KEY is set. With no table, every lean is null
// and the UI shows no lean. The State Media Monitor table (state-media.json, CC BY 4.0) is in git.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArticleBias } from '../../src/types';
import rules from './bias-rules.json' with { type: 'json' };
import { hostChain, normalizeHost } from './domain.js';
import stateMedia from './state-media.json' with { type: 'json' };
import { fold } from './text.js';

/** One MBFC record: [outlet name, lean (-2..2) or null, MBFC page slug]. */
export type MbfcTuple = [name: string, lean: number | null, slug: string];

export interface MbfcTable {
  v: 1;
  generatedAt: string;
  hosts: Record<string, MbfcTuple>;
}

/** One State Media Monitor record: [class code, smm_id, entity, iso3]. */
export type StateTuple = [code: string, smmId: string, entity: string, iso3: string];

export interface StateTable {
  hosts: Record<string, StateTuple>;
}

export interface BiasRules {
  deny: string[];
  /** Hosts whose MBFC record names another outlet. They get no lean; a state tag still applies. */
  wrongRecords?: string[];
  aliases: Record<string, string>;
  stopParents: string[];
  names: Record<string, string>;
}

const LEAN_LABEL: Record<number, string> = { [-2]: 'Left', [-1]: 'Lean left', 0: 'Centre', 1: 'Lean right', 2: 'Right' };

const STATE: Record<string, { state: NonNullable<ArticleBias['state']>; label: string }> = {
  SC: { state: 'state-controlled', label: 'STATE-CONTROLLED' },
  CaPu: { state: 'captured', label: 'CAPTURED' },
  CaPr: { state: 'captured', label: 'CAPTURED' },
  IP: { state: 'public', label: 'PUBLIC' },
  ISF: { state: 'public', label: 'PUBLIC' },
  ISFM: { state: 'public', label: 'PUBLIC' },
  ISM: { state: 'public', label: 'PUBLIC' },
};

/** The MBFC page of an outlet, from its slug. */
export const mbfcUrl = (slug: string) => `https://mediabiasfactcheck.com/${encodeURI(slug)}/`;

/** Checks the shape of a loaded MBFC table. Returns null for anything else. */
export function asMbfcTable(value: unknown): MbfcTable | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Partial<MbfcTable>;
  if (t.v !== 1 || !t.hosts || typeof t.hosts !== 'object') return null;
  return t as MbfcTable;
}

/**
 * Makes a lookup function from the tables. Pure, so tests can pass synthetic tables.
 * Order: the exact host, then each parent down to the registrable domain, each with its alias.
 * A host under a "stop parent" (indiatimes.com) never falls back to that parent.
 * A host on the deny list (news.google.com, msn.com, ...), or under one, gets no rating.
 * A host on the wrongRecords list gets no MBFC lean (its record names another outlet).
 * A publisher name is used only when the domain is null, and only through a short hand allowlist.
 */
export function createBiasLookup(mbfc: MbfcTable | null, state: StateTable, r: BiasRules) {
  const deny = new Set(r.deny);
  const wrong = new Set(r.wrongRecords ?? []);
  const stopParents = new Set(r.stopParents);

  function chain(host: string): string[] {
    const out: string[] = [];
    for (const h of hostChain(host)) {
      if (h !== host && stopParents.has(h)) break;
      out.push(h);
      const alias = Object.hasOwn(r.aliases, h) ? r.aliases[h] : null;
      if (alias) out.push(alias);
    }
    return out;
  }

  return function lookupBias(domain: string | null | undefined, name?: string | null): ArticleBias | null {
    let host = normalizeHost(domain ?? null);
    if (!host && name) {
      const key = fold(name).replace(/\s+/g, ' ').trim();
      host = Object.hasOwn(r.names, key) ? r.names[key] : null;
    }
    if (!host || deny.has(host)) return null;
    const hosts = chain(host);
    // A subdomain of a platform ("someone.medium.com") is the platform too.
    if (hosts.some((h) => deny.has(h))) return null;

    let lean: ArticleBias['lean'] = null;
    let ref: string | null = null;
    if (mbfc) {
      // The first record found decides, even when it has no lean (Questionable, Satire, ...).
      for (const h of hosts) {
        if (wrong.has(h)) break;
        const rec = Object.hasOwn(mbfc.hosts, h) ? mbfc.hosts[h] : undefined;
        if (!rec) continue;
        const [, value, slug] = rec;
        if (value === -2 || value === -1 || value === 0 || value === 1 || value === 2) {
          lean = value;
          ref = slug ? mbfcUrl(slug) : null;
        }
        break;
      }
    }

    let tag: (typeof STATE)[string] | null = null;
    for (const h of hosts) {
      const rec = Object.hasOwn(state.hosts, h) ? state.hosts[h] : undefined;
      if (rec) {
        tag = STATE[rec[0]] ?? null;
        break;
      }
    }

    if (lean === null && !tag) return null;
    return {
      lean,
      leanLabel: lean === null ? null : LEAN_LABEL[lean],
      rater: lean === null ? null : 'MBFC',
      ref: lean === null ? null : ref,
      state: tag?.state ?? null,
      stateLabel: tag?.label ?? null,
    };
  };
}

/** Parses a table file. Null when the file is missing or not a table. */
function readTable(read: () => string): MbfcTable | null {
  try {
    return asMbfcTable(JSON.parse(read()));
  } catch {
    // No table here. This is the normal state with no RAPIDAPI_KEY.
    return null;
  }
}

/**
 * Reads the MBFC table, when one exists. Tries next to this module, then from the project root.
 * Keep each path a literal in its call: the Vercel file trace (@vercel/nft) finds the file
 * only in this form, and then puts it in the function bundle.
 */
function loadMbfc(): MbfcTable | null {
  return (
    readTable(() => readFileSync(new URL('./generated/mbfc.json', import.meta.url), 'utf8')) ??
    readTable(() => readFileSync(join(process.cwd(), 'api/_lib/generated/mbfc.json'), 'utf8'))
  );
}

let lookup: ReturnType<typeof createBiasLookup> | null = null;
let mbfcLoaded = false;

/** True when an MBFC table is present on this server. */
export function hasMbfcTable(): boolean {
  getLookup();
  return mbfcLoaded;
}

function getLookup(): ReturnType<typeof createBiasLookup> {
  if (!lookup) {
    const table = loadMbfc();
    mbfcLoaded = table !== null;
    lookup = createBiasLookup(table, stateMedia as unknown as StateTable, rules as BiasRules);
  }
  return lookup;
}

/** The rating of a publisher, from its host (and, only when the host is null, its name). Null when unknown. */
export function lookupBias(domain: string | null | undefined, name?: string | null): ArticleBias | null {
  return getLookup()(domain, name);
}
