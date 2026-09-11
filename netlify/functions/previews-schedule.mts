import type { Config } from '@netlify/functions';
import { triggerPreviews } from '../../src/lib/previews';

/**
 * Wednesday 6:00 AM Pacific (13:00 UTC during daylight time; 5:00 AM PT once clocks fall back).
 * Scheduled functions are capped at 30 seconds, so this only kicks off the background function
 * that does the real work.
 */
export default async () => {
  const r = await triggerPreviews();
  console.log('previews-schedule', JSON.stringify(r));
};

export const config: Config = {
  schedule: '0 13 * * 3',
};
