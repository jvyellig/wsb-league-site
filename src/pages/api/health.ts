import type { APIRoute } from 'astro';
import { db, env, KEYS, storeHealth } from '../../lib/store';

/**
 * Public, secret-free health check: can this deploy reach its data store?
 * Handy when a deploy comes up blank — open <deploy-permalink>/api/health.
 */
export const GET: APIRoute = async () => {
  const out: Record<string, unknown> = {
    deploy: env('DEPLOY_ID') ?? null,
    context: env('CONTEXT') ?? null,
    hasBlobsContext: Boolean(env('NETLIFY_BLOBS_CONTEXT')),
    explicitBlobsCreds: Boolean(env('NETLIFY_BLOBS_TOKEN')),
    siteIdInjected: Boolean(env('SITE_ID')),
    localStore: Boolean(env('LOCAL_BLOBS_DIR')),
  };
  // Test both read paths separately: eventual (edge-cached, what pages prefer) and strong (direct).
  try {
    const { getStore } = await import('@netlify/blobs');
    const token = env('NETLIFY_BLOBS_TOKEN');
    const explicit = token ? { siteID: env('SITE_ID') || 'd34155a9-ab21-4e3c-8b69-8b2274e3c91b', token } : {};
    const probe = async (consistency: 'eventual' | 'strong') => {
      try {
        const v = await getStore({ name: 'league', consistency, ...explicit }).get(KEYS.status, { type: 'json' });
        return v ? 'ok' : 'empty';
      } catch (e: any) {
        return `error: ${e?.name ?? 'Error'}: ${e?.message ?? e}`.slice(0, 300);
      }
    };
    out.edgeRead = await probe('eventual');
    out.directRead = await probe('strong');
    const status = await db.get(KEYS.status, { strong: true, throwOnError: true });
    out.storage = status ? 'ok' : 'reachable but empty';
    out.lastSyncSuccess = status?.lastSuccess ?? null;
  } catch (e: any) {
    out.storage = 'error';
    out.error = `${e?.name ?? 'Error'}: ${e?.message ?? e}`.slice(0, 300);
  }
  out.instance = storeHealth;
  return new Response(JSON.stringify(out, null, 2), { status: out.storage === 'error' ? 503 : 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
