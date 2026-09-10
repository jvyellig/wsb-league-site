import type { Config } from '@netlify/functions';
import { runSync } from '../../src/lib/sync';

// Runs every 15 minutes, all season. Idempotent: fetches ESPN, closes out any newly finished week,
// recomputes standings/odds/previews. See src/lib/sync.ts.
export default async (req: Request) => {
  const result = await runSync();
  console.log('sync-espn', JSON.stringify(result));
};

export const config: Config = {
  schedule: '*/15 * * * *',
};
