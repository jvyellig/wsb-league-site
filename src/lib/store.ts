/**
 * Data layer. In production this is Netlify Blobs (store "league").
 * Locally (LOCAL_BLOBS_DIR set, or Blobs unavailable) it falls back to JSON files on disk
 * so the site can be developed with `astro dev` and plain node scripts.
 */
import type { Snapshot, SyncStatus, Rankings, DraftRecap, Derived, BoxScore } from './types';

export const KEYS = {
  league: 'league.json',
  status: 'status.json',
  rankings: 'rankings.json',
  draft: 'draft.json',
  derived: 'derived.json',
  notes: 'notes.json',
  players: 'players.json',
  cookie: 'config/espn_s2.json',
  box: (w: number) => `box/${w}.json`,
  history: (season: number) => `history/${season}.json`,
};

interface KV {
  get(key: string, strong?: boolean): Promise<any | null>;
  set(key: string, value: any): Promise<void>;
  del(key: string): Promise<void>;
}

let kv: KV | null = null;

export function env(name: string): string | undefined {
  const g: any = globalThis as any;
  try {
    const v = g.Netlify?.env?.get?.(name);
    if (v) return v;
  } catch {}
  return process.env[name];
}

async function fileKV(dir: string): Promise<KV> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const p = (k: string) => path.join(dir, k);
  return {
    async get(key) {
      try {
        return JSON.parse(await fs.readFile(p(key), 'utf8'));
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await fs.mkdir(path.dirname(p(key)), { recursive: true });
      await fs.writeFile(p(key), JSON.stringify(value));
    },
    async del(key) {
      try {
        await fs.unlink(p(key));
      } catch {}
    },
  };
}

async function blobKV(): Promise<KV> {
  const { getStore } = await import('@netlify/blobs');
  // Pages read with eventual consistency (fast, edge-cached); the sync/admin paths read strongly
  // so read-modify-write on status/rankings never works from a stale copy.
  const eventual = getStore({ name: 'league' });
  const strong = getStore({ name: 'league', consistency: 'strong' });
  return {
    get: (key, useStrong = false) => (useStrong ? strong : eventual).get(key, { type: 'json' }),
    set: async (key, value) => {
      await strong.setJSON(key, value);
    },
    del: (key) => strong.delete(key),
  };
}

async function getKV(): Promise<KV> {
  if (kv) return kv;
  const local = env('LOCAL_BLOBS_DIR');
  kv = local ? await fileKV(local) : await blobKV();
  return kv;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const db = {
  /** Read a JSON blob. Retries once on a transient failure; `strong` forces a read-after-write-consistent read. */
  async get<T = any>(key: string, opts: { strong?: boolean; throwOnError?: boolean } = {}): Promise<T | null> {
    const store = await getKV();
    for (let attempt = 0; ; attempt++) {
      try {
        return await store.get(key, opts.strong);
      } catch (e) {
        if (attempt < 2) {
          await sleep(150 * (attempt + 1));
          continue;
        }
        console.error(`blob read failed for ${key}:`, e);
        if (opts.throwOnError) throw e;
        return null;
      }
    }
  },
  async set(key: string, value: any) {
    return (await getKV()).set(key, value);
  },
  async del(key: string) {
    return (await getKV()).del(key);
  },
};

export const getSnapshot = () => db.get<Snapshot>(KEYS.league);
export const getStatus = async (strong = false): Promise<SyncStatus> =>
  (await db.get<SyncStatus>(KEYS.status, { strong })) ?? {
    lastAttempt: null,
    lastSuccess: null,
    lastError: null,
    authExpired: false,
    authExpiredSince: null,
    cookieSource: null,
    cookieUpdatedAt: null,
    log: [],
  };
export const getRankings = async (strong = false): Promise<Rankings> => (await db.get<Rankings>(KEYS.rankings, { strong })) ?? { weeks: {}, awards: {} };
export const getDraftRecap = () => db.get<DraftRecap>(KEYS.draft);
export const getDerived = () => db.get<Derived>(KEYS.derived);
export const getNotes = async (strong = false): Promise<Record<string, string>> => (await db.get(KEYS.notes, { strong })) ?? {};
export const getBox = (w: number) => db.get<BoxScore>(KEYS.box(w));

/** Everything a page typically needs, in one round of parallel reads. Never throws — a failed read comes back null/empty. */
export async function loadAll() {
  const [snapshot, status, rankings, derived, notes, draft] = await Promise.all([
    getSnapshot().catch(() => null),
    getStatus().catch(() => getStatus()),
    getRankings().catch(() => ({ weeks: {}, awards: {} }) as Rankings),
    getDerived().catch(() => null),
    getNotes().catch(() => ({}) as Record<string, string>),
    getDraftRecap().catch(() => null),
  ]);
  return { snapshot, status, rankings, derived, notes, draft };
}
