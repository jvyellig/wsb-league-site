/**
 * Team logos: ESPN lets owners upload custom images, but those live behind ESPN's login
 * (mystique-api.fantasy.espn.com answers 401 without the cookies), and many owners hotlink
 * images from sites that block third-party embedding. So the sync fetches every logo once
 * (with the league cookies where needed), keeps a copy in Blobs, and pages serve /logos/<teamId>.
 * A logo is re-fetched only when the owner changes it on ESPN.
 */
import type { EspnCreds } from './espn';
import { db, KEYS } from './store';
import type { Snapshot } from './types';

export interface LogoIndex {
  [teamId: string]: { src: string; contentType: string; fetchedAt: string; ok: boolean; override?: boolean };
}

const MAX_BYTES = 4 * 1024 * 1024;

export async function cacheLogos(snap: Snapshot, creds: EspnCreds): Promise<void> {
  const index: LogoIndex = (await db.get<LogoIndex>(KEYS.logos, { strong: true })) ?? {};
  let changed = false;
  for (const team of snap.teams) {
    const src = team.logo;
    const entry = index[team.id];
    if (!src || !/^https?:\/\//.test(src)) continue;
    if (entry && entry.src === src) {
      if (entry.ok) {
        team.logo = `/logos/${team.id}`;
        continue; // cached for this exact URL
      }
      if (Date.now() - new Date(entry.fetchedAt).getTime() < 24 * 3600 * 1000) continue; // known-bad: retry daily
    }
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 (league site)' };
    if (/espn\.com$/.test(new URL(src).hostname) || src.includes('espn.com/')) headers.Cookie = `SWID=${creds.swid}; espn_s2=${creds.s2}`;
    let ok = false;
    let contentType = '';
    try {
      const res = await fetch(src, { headers, signal: AbortSignal.timeout(8000) });
      contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.startsWith('image/')) {
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES) {
          await db.setBytes(KEYS.logo(team.id), bytes);
          ok = true;
        }
      }
    } catch {}
    index[team.id] = { src, contentType, fetchedAt: new Date().toISOString(), ok };
    changed = true;
    if (ok) team.logo = `/logos/${team.id}`;
  }
  if (changed) await db.set(KEYS.logos, index);
}
