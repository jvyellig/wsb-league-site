import type { Config } from '@netlify/functions';
import { timingSafeEqual } from 'node:crypto';
import { generatePreviews } from '../../src/lib/previews';
import { env } from '../../src/lib/store';

/**
 * Background function (up to 15 minutes): writes this week's AI matchup previews.
 * Triggered by the Wednesday scheduler and by the "Regenerate previews" button on /admin.
 * Protected by the admin passphrase so nobody else can burn API credits.
 */
function authorized(req: Request): boolean {
  const expected = env('ADMIN_PASSPHRASE') ?? '';
  const given = req.headers.get('x-admin-key') ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req: Request) => {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  let week: number | undefined;
  try {
    const body = await req.json();
    if (body?.week) week = Number(body.week);
  } catch {}
  console.log('previews-background: start', { week });
  const result = await generatePreviews({ week });
  console.log('previews-background: done', JSON.stringify(result));
};

export const config: Config = {
  background: true,
};
