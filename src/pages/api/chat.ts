import type { APIRoute } from 'astro';
import { env, getSnapshot } from '../../lib/store';
import { postDiscord } from '../../lib/discord';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * Post a chat message. The sender is whichever team the visitor picked (honor system, cookie);
 * the server stamps the team so the page can't send a different one, saves to Supabase, and
 * mirrors to Discord when a webhook is configured.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const teamId = locals.teamId;
  if (!teamId) return json({ error: 'Pick your team before chatting.' }, 403);
  let body: any = {};
  try {
    body = await request.json();
  } catch {}
  const text = String(body.body ?? '').trim().slice(0, 500);
  if (!text) return json({ error: 'Empty message.' }, 400);

  const snap = await getSnapshot();
  const team = snap?.teams.find((t) => t.id === teamId);
  if (!team) return json({ error: 'Unknown team.' }, 400);

  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY');
  if (!url || !key) return json({ error: 'Chat storage is not configured.' }, 500);

  const res = await fetch(`${url}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ team_id: team.id, team_name: team.name, body: text }),
  });
  if (!res.ok) return json({ error: `Could not save message (${res.status}).` }, 502);
  const [row] = await res.json();

  // Fire-and-forget mirror to Discord (no-op without DISCORD_WEBHOOK_URL)
  postDiscord(`**${team.name}:** ${text}`).catch(() => {});

  return json({ ok: true, message: row });
};
