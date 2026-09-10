import type { APIRoute } from 'astro';
import { TEAM_COOKIE } from '../../middleware';

const YEAR = 60 * 60 * 24 * 365;

function safeNext(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/';
}

/** POST team=<id|0>&next=/path — sets the identity cookie and redirects. GET ?clear=1 forgets it. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const team = String(form.get('team') ?? '');
  const next = safeNext(String(form.get('next') ?? '/'));
  if (!/^\d{1,3}$/.test(team)) return redirect('/whoami', 302);
  cookies.set(TEAM_COOKIE, team, { path: '/', maxAge: YEAR, sameSite: 'lax', secure: true, httpOnly: false });
  return redirect(next, 302);
};

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (url.searchParams.get('clear')) {
    cookies.delete(TEAM_COOKIE, { path: '/' });
    return redirect(`/whoami?next=${encodeURIComponent(safeNext(url.searchParams.get('next')))}`, 302);
  }
  return redirect('/whoami', 302);
};
