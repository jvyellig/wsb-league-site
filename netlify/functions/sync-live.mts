import type { Config } from '@netlify/functions';
import { runSync } from '../../src/lib/sync';
import { getStatus } from '../../src/lib/store';
import { isGameLive } from '../../src/lib/nfl';

// Game-day cadence: every 2 minutes, but only does work while an NFL game is in progress.
// The regular sync-espn function still runs every 15 minutes regardless.
export default async (req: Request) => {
  const { live, inProgress } = await isGameLive();
  if (!live) {
    console.log('sync-live: no game in progress, skipping');
    return;
  }
  const status = await getStatus();
  const sinceLast = status.lastAttempt ? Date.now() - new Date(status.lastAttempt).getTime() : Infinity;
  if (sinceLast < 90_000) {
    console.log('sync-live: synced ' + Math.round(sinceLast / 1000) + 's ago, skipping');
    return;
  }
  const result = await runSync();
  console.log('sync-live', JSON.stringify({ inProgress, ...result }));
};

export const config: Config = {
  schedule: '*/2 * * * *',
};
