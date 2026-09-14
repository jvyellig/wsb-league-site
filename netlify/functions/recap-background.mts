import type { Config } from '@netlify/functions';
import { timingSafeEqual } from 'node:crypto';
import { generateRecap } from '../../src/lib/recaps';
import { env } from '../../src/lib/store';

/** Background function (up to 15 minutes): writes the weekly AI recap. Passphrase-protected. */
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
  let auto = false;
  try {
    const body = await req.json();
    if (body?.week) week = Number(body.week);
    auto = Boolean(body?.auto);
  } catch {}
  console.log('recap-background: start', { week, auto });
  const result = await generateRecap({ week, auto });
  console.log('recap-background: done', JSON.stringify(result));
};

export const config: Config = {
  background: true,
};
