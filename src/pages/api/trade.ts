import type { APIRoute } from 'astro';
import { env, getSnapshot } from '../../lib/store';
import { sendPush } from '../../lib/push';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function sb(path: string, init: RequestInit = {}) {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Trade block storage is not configured.');
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  });
}

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Trade block writes go through the server so the poster's team comes from the identity cookie
 * and so we can send push alerts. Reads stay direct from the browser.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const teamId = locals.teamId;
  if (!teamId) return json({ error: 'Pick your team before posting.' }, 403);
  let body: any = {};
  try {
    body = await request.json();
  } catch {}
  const snap = await getSnapshot();
  const team = snap?.teams.find((t) => t.id === teamId);
  if (!team) return json({ error: 'Unknown team.' }, 400);

  try {
    if (body.type === 'post') {
      const offering = String(body.offering ?? '').trim().slice(0, 500);
      const seeking = String(body.seeking ?? '').trim().slice(0, 500);
      const notes = String(body.notes ?? '').trim().slice(0, 300);
      if (!offering || !seeking) return json({ error: 'Fill in both what you are shopping and what you want.' }, 400);
      const res = await sb('trade_posts', { method: 'POST', body: JSON.stringify({ team_id: team.id, team_name: team.name, offering, seeking, notes: notes || null }) });
      if (!res.ok) return json({ error: `Could not post (${res.status}).` }, 502);
      const [row] = await res.json();
      sendPush(
        { title: `Trade block: ${team.name}`, body: `Shopping ${trim(offering, 80)} · wants ${trim(seeking, 60)}`, url: '/trade-block', tag: 'wsb-trade' },
        (s) => s.prefs.trades && s.teamId !== team.id,
      ).catch(() => {});
      return json({ ok: true, post: row });
    }

    if (body.type === 'comment') {
      const postId = String(body.postId ?? '');
      const text = String(body.body ?? '').trim().slice(0, 400);
      if (!postId || !text) return json({ error: 'Empty comment.' }, 400);
      const res = await sb('trade_comments', { method: 'POST', body: JSON.stringify({ post_id: postId, team_id: team.id, team_name: team.name, body: text }) });
      if (!res.ok) return json({ error: `Could not reply (${res.status}).` }, 502);
      const [row] = await res.json();
      // Notify the post's owner (unless they replied to themselves)
      const p = await sb(`trade_posts?id=eq.${encodeURIComponent(postId)}&select=team_id,team_name`);
      const [post] = p.ok ? await p.json() : [];
      if (post && post.team_id !== team.id) {
        sendPush(
          { title: `${team.name} replied to your trade post`, body: trim(text, 120), url: '/trade-block', tag: 'wsb-reply' },
          (s) => s.prefs.replies && s.teamId === post.team_id,
        ).catch(() => {});
      }
      return json({ ok: true, comment: row });
    }

    return json({ error: 'Unknown request.' }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? 'Failed.' }, 500);
  }
};
