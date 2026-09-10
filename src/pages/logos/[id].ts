import type { APIRoute } from 'astro';
import { db, KEYS } from '../../lib/store';
import type { LogoIndex } from '../../lib/logos';

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('Not found', { status: 404 });
  const [bytes, index] = await Promise.all([db.getBytes(KEYS.logo(id)), db.get<LogoIndex>(KEYS.logos)]);
  if (!bytes) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  const type = index?.[id]?.contentType || 'image/png';
  return new Response(bytes, {
    headers: {
      'Content-Type': type.replace('image/jpg', 'image/jpeg'),
      'Cache-Control': 'public, max-age=3600',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};
