import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { db, env, getNotes, getSnapshot, getStatus, KEYS } from '../../../lib/store';
import { runSync } from '../../../lib/sync';
import { fetchLeague } from '../../../lib/espn';
import type { LogoIndex } from '../../../lib/logos';
import { getPreviewSet, previewsConfigured, triggerPreviews } from '../../../lib/previews';

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
      const logos = (await db.get<LogoIndex>(KEYS.logos)) ?? {};
      return json({ status, notes, teams: snap?.teams.map((t) => ({ id: t.id, name: t.name, logo: t.logo, logoOk: !!logos[t.id]?.ok, override: !!logos[t.id]?.override })) ?? [], hasEnvCookie: Boolean(env('ESPN_S2')) });
    }
    case 'sync': {
      try {
        const result = await runSync({ force: Boolean(body.force) });
        return json(result, result.ok ? 200 : 502);
      } catch (e: any) {
        return json({ error: `Sync crashed: ${e?.message ?? e}` }, 500);
      }
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
    case 'logo': {
      // Upload an image to use as a team's logo until ESPN reports a different logo URL for that team.
      const teamId = Number(body.teamId);
      const dataUrl = String(body.dataUrl ?? '');
      const m = /^data:(image\/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!Number.isInteger(teamId) || !m) return json({ error: 'Send a PNG, JPG, GIF, WebP or SVG image.' }, 400);
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.byteLength > 2 * 1024 * 1024) return json({ error: 'Keep the image under 2 MB.' }, 400);
      const snap = await getSnapshot();
      const team = snap?.teams.find((t) => t.id === teamId);
      if (!team) return json({ error: 'Unknown team.' }, 400);
      const index: LogoIndex = (await db.get<LogoIndex>(KEYS.logos, { strong: true })) ?? {};
      const espnSrc = index[teamId]?.src ?? team.logo;
      await db.setBytes(KEYS.logo(teamId), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      index[teamId] = { src: espnSrc, contentType: m[1], fetchedAt: new Date().toISOString(), ok: true, override: true };
      await db.set(KEYS.logos, index);
      await runSync(); // rewrites league.json so pages point at /logos/<id>
      return json({ ok: true });
    }
    case 'logo-clear': {
      const teamId = Number(body.teamId);
      const index: LogoIndex = (await db.get<LogoIndex>(KEYS.logos, { strong: true })) ?? {};
      delete index[teamId];
      await db.set(KEYS.logos, index);
      await db.del(KEYS.logo(teamId));
      await runSync(); // re-fetches from ESPN
      return json({ ok: true });
    }
    case 'previews': {
      // Kick off the background generator; the page polls 'previews-status' for progress.
      if (!previewsConfigured()) return json({ error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables.' }, 400);
      const week = body.week ? Number(body.week) : undefined;
      const r = await triggerPreviews({ week });
      return json(r, r.ok ? 202 : 502);
    }
    case 'previews-status': {
      const snap = await getSnapshot();
      if (!snap) return json({ configured: previewsConfigured(), set: null });
      const week = body.week ? Number(body.week) : snap.currentMatchupPeriod;
      const set = await getPreviewSet(snap.season, week, true);
      return json({
        configured: previewsConfigured(),
        week,
        set: set ? { status: set.status, startedAt: set.startedAt, finishedAt: set.finishedAt, model: set.model, error: set.error, count: set.previews.filter((p) => !p.error).length, total: set.previews.length, failures: set.previews.filter((p) => p.error).map((p) => ({ matchupId: p.matchupId, error: p.error })) } : null,
      });
    }
    case 'diag': {
      // Blob storage self-test: surfaces the real error when reads/writes fail
      const out: Record<string, unknown> = { deploy: env('DEPLOY_ID'), context: env('CONTEXT'), site: env('SITE_ID'), url: env('URL') };
      try {
        const { getStore } = await import('@netlify/blobs');
        const store = getStore({ name: 'league', consistency: 'strong' });
        out.read = (await store.get('status.json', { type: 'json' })) ? 'ok' : 'null';
        await store.setJSON('diag.json', { at: new Date().toISOString() });
        out.write = 'ok';
        const { blobs } = await store.list({ prefix: 'l' });
        out.list = blobs.map((b) => b.key);
      } catch (e: any) {
        out.error = e?.message ?? String(e);
        out.stack = String(e?.stack ?? '').split('\n').slice(0, 4);
      }
      return json(out);
    }
    default:
      return json({ error: 'Unknown action' }, 404);
  }
};
