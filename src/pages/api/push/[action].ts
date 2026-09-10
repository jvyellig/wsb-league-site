import type { APIRoute } from 'astro';
import { env } from '../../../lib/store';
import { getSub, pushConfigured, removeSub, saveSub, sendPush, type PushPrefs } from '../../../lib/push';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function cleanPrefs(p: any): PushPrefs {
  return { trades: p?.trades !== false, chat: p?.chat !== false, replies: p?.replies !== false };
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!pushConfigured()) return json({ error: 'Push notifications are not configured on the server.' }, 500);
  let body: any = {};
  try {
    body = await request.json();
  } catch {}
  const teamId = locals.teamId;

  switch (params.action) {
    case 'config':
      return json({ publicKey: env('VAPID_PUBLIC_KEY'), teamId });

    case 'subscribe': {
      if (!teamId) return json({ error: 'Pick your team first — alerts are tied to a team.' }, 403);
      const s = body.subscription;
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ error: 'Invalid subscription.' }, 400);
      await saveSub({
        teamId,
        endpoint: String(s.endpoint),
        keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) },
        prefs: cleanPrefs(body.prefs),
        createdAt: new Date().toISOString(),
        userAgent: String(request.headers.get('user-agent') ?? '').slice(0, 200),
      });
      return json({ ok: true });
    }

    case 'prefs': {
      const sub = await getSub(String(body.endpoint ?? ''));
      if (!sub) return json({ error: 'Not subscribed on this device.' }, 404);
      sub.prefs = cleanPrefs(body.prefs);
      if (teamId) sub.teamId = teamId;
      await saveSub(sub);
      return json({ ok: true, prefs: sub.prefs });
    }

    case 'status': {
      const sub = await getSub(String(body.endpoint ?? ''));
      return json({ subscribed: !!sub, prefs: sub?.prefs ?? null, teamId: sub?.teamId ?? null });
    }

    case 'unsubscribe': {
      await removeSub(String(body.endpoint ?? ''));
      return json({ ok: true });
    }

    case 'test': {
      const endpoint = String(body.endpoint ?? '');
      const n = await sendPush({ title: 'WSB Generations', body: 'Alerts are on for this device. 🏈', url: '/alerts', tag: 'wsb-test' }, (s) => s.endpoint === endpoint);
      return json({ ok: n > 0 });
    }

    default:
      return json({ error: 'Unknown action' }, 404);
  }
};
