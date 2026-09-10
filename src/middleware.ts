import { defineMiddleware } from 'astro:middleware';

export const TEAM_COOKIE = 'wsb_team';

/** Paths that never require picking a team. */
const EXEMPT = [/^\/whoami/, /^\/api\//, /^\/logos\//, /^\/admin/, /^\/favicon/, /^\/_/];

/**
 * First visit: send people to the "who are you?" screen. The choice is stored in a cookie for a year
 * (honor system). "0" means "just watching" and is respected the same as a team pick.
 */
export const onRequest = defineMiddleware((context, next) => {
  const raw = context.cookies.get(TEAM_COOKIE)?.value ?? '';
  const teamId = /^\d+$/.test(raw) ? Number(raw) : null;
  context.locals.teamId = teamId; // null = not chosen yet, 0 = spectator, n = team id
  const path = context.url.pathname;
  if (teamId === null && !EXEMPT.some((re) => re.test(path)) && context.request.method === 'GET') {
    const next = path + context.url.search;
    return context.redirect(`/whoami?next=${encodeURIComponent(next)}`, 302);
  }
  return next();
});
