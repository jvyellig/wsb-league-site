import type { Config } from '@netlify/functions';
import { triggerRecap } from '../../src/lib/recaps';

/**
 * Tuesday mornings Pacific (13:00, 15:00 and 18:00 UTC = 6, 8 and 11 AM PDT). Each run only writes
 * a recap if the latest completed week doesn't have one yet, so the extra slots are just retries
 * in case ESPN closes the week late or a sync hasn't stored the box score by 6 AM.
 */
export default async () => {
  const r = await triggerRecap({ auto: true });
  console.log('recap-schedule', JSON.stringify(r));
};

export const config: Config = {
  schedule: '0 13,15,18 * * 2',
};
