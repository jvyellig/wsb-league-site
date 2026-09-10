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
  get(key: string): Promise<any | null>;
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
  const store = getStore({ name: 'league', consistency: 'strong' });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: async (key, value) => {
      await store.setJSON(key, value);
    },
    del: (key) => store.delete(key),
  };
}

async function getKV(): Promise<KV> {
  if (kv) return kv;
  const local = env('LOCAL_BLOBS_DIR');
  kv = local ? await fileKV(local) : await blobKV();
  return kv;
}

export const db = {
  async get<T = any>(key: string): Promise<T | null> {
    return (await getKV()).get(key);
  },
  async set(key: string, value: any) {
    return (await getKV()).set(key, value);
  },
  async del(key: string) {
    return (await getKV()).del(key);
  },
};

export const getSnapshot = () => db.get<Snapshot>(KEYS.league);
export const getStatus = async (): Promise<SyncStatus> =>
  (await db.get<SyncStatus>(KEYS.status)) ?? {
    lastAttempt: null,
    lastSuccess: null,
    lastError: null,
    authExpired: false,
    authExpiredSince: null,
    cookieSource: null,
    cookieUpdatedAt: null,
    log: [],
  };
export const getRankings = async (): Promise<Rankings> => (await db.get<Rankings>(KEYS.rankings)) ?? { weeks: {}, awards: {} };
export const getDraftRecap = () => db.get<DraftRecap>(KEYS.draft);
export const getDerived = () => db.get<Derived>(KEYS.derived);
export const getNotes = async (): Promise<Record<string, string>> => (await db.get(KEYS.notes)) ?? {};
export const getBox = (w: number) => db.get<BoxScore>(KEYS.box(w));

/** Everything a page typically needs, in one round of parallel reads. */
export async function loadAll() {
  const [snapshot, status, rankings, derived, notes, draft] = await Promise.all([
    getSnapshot(),
    getStatus(),
    getRankings(),
    getDerived(),
    getNotes(),
    getDraftRecap(),
  ]);
  return { snapshot, status, rankings, derived, notes, draft };
}
