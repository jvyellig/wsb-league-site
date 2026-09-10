import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { db, env, getNotes, getSnapshot, getStatus, KEYS } from '../../../lib/store';
import { runSync } from '../../../lib/sync';
import { fetchLeague } from '../../../lib/espn';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function authorized(req: Request): boolean {
  const expected = env('ADMIN_PASSPHRASE') ?? '';
  const given = req.headers.get('x-admin-key') ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ params, request }) => {
  if (!authorized(request)) return json({ error: 'Wrong passphrase.' }, 401);
  const action = params.action;
  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  switch (action) {
    case 'state': {
      const [status, notes, snap] = await Promise.all([getStatus(true), getNotes(true), getSnapshot()]);
      return json({ status, notes, teams: snap?.teams.map((t) => ({ id: t.id, name: t.name })) ?? [], hasEnvCookie: Boolean(env('ESPN_S2')) });
    }
    case 'sync': {
      const result = await runSync({ force: Boolean(body.force) });
      return json(result, result.ok ? 200 : 502);
    }
    case 'cookie': {
      const s2 = String(body.s2 ?? '').trim();
      if (s2.length < 40) return json({ error: 'That does not look like an espn_s2 value.' }, 400);
      const creds = { leagueId: env('ESPN_LEAGUE_ID') ?? '', swid: env('ESPN_SWID') ?? '', s2 };
      try {
        await fetchLeague(creds, Number(env('ESPN_SEASON') ?? new Date().getFullYear()));
      } catch (e: any) {
        return json({ error: `ESPN rejected that cookie: ${e?.message ?? e}` }, 400);
      }
      await db.set(KEYS.cookie, { s2, updatedAt: new Date().toISOString() });
      const result = await runSync();
      return json({ ok: true, sync: result });
    }
    case 'cookie-reset': {
      await db.del(KEYS.cookie);
      const result = await runSync();
      return json({ ok: true, sync: result });
    }
    case 'notes': {
      const teamId = String(body.teamId ?? '');
      if (!teamId) return json({ error: 'teamId required' }, 400);
      const notes = await getNotes(true);
      const text = String(body.markdown ?? '').slice(0, 20000);
      if (text.trim()) notes[teamId] = text;
      else delete notes[teamId];
      await db.set(KEYS.notes, notes);
      return json({ ok: true });
    }
    default:
      return json({ error: 'Unknown action' }, 404);
  }
};
