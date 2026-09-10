/**
 * Web push. Subscriptions live in Netlify Blobs (server-only), keyed by endpoint, each tied to the
 * team the subscriber picked. Sending uses VAPID keys from environment variables.
 */
import webpush from 'web-push';
import { db, env } from './store';

export interface PushPrefs {
  trades: boolean; // new trade block posts
  chat: boolean; // league chat messages
  replies: boolean; // comments on my trade posts
}

export interface PushSub {
  teamId: number;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  prefs: PushPrefs;
  createdAt: string;
  lastChatPushAt?: string;
  userAgent?: string;
}

const KEY = 'push/subscriptions.json';
const CHAT_THROTTLE_MS = 90_000;

export function pushConfigured(): boolean {
  return Boolean(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));
}

function configure() {
  webpush.setVapidDetails(env('VAPID_SUBJECT') ?? 'mailto:yellig@gmail.com', env('VAPID_PUBLIC_KEY')!, env('VAPID_PRIVATE_KEY')!);
}

export async function loadSubs(): Promise<Record<string, PushSub>> {
  return (await db.get<Record<string, PushSub>>(KEY, { strong: true })) ?? {};
}

export async function saveSub(sub: PushSub) {
  const all = await loadSubs();
  all[sub.endpoint] = { ...all[sub.endpoint], ...sub };
  await db.set(KEY, all);
}

export async function removeSub(endpoint: string) {
  const all = await loadSubs();
  delete all[endpoint];
  await db.set(KEY, all);
}

export async function getSub(endpoint: string): Promise<PushSub | null> {
  return (await loadSubs())[endpoint] ?? null;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Send to every subscription matching `filter`. Dead subscriptions (410/404) are pruned.
 * Returns how many were attempted.
 */
export async function sendPush(msg: PushMessage, filter: (s: PushSub) => boolean, opts: { throttleChat?: boolean } = {}): Promise<number> {
  if (!pushConfigured()) return 0;
  configure();
  const all = await loadSubs();
  const now = Date.now();
  const targets = Object.values(all).filter((s) => {
    if (!filter(s)) return false;
    if (opts.throttleChat && s.lastChatPushAt && now - new Date(s.lastChatPushAt).getTime() < CHAT_THROTTLE_MS) return false;
    return true;
  });
  let changed = false;
  await Promise.all(
    targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg), { TTL: 60 * 60 * 6 });
        if (opts.throttleChat) {
          all[s.endpoint].lastChatPushAt = new Date().toISOString();
          changed = true;
        }
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          delete all[s.endpoint];
          changed = true;
        } else {
          console.error('push failed', code, e?.message);
        }
      }
    }),
  );
  if (changed) await db.set(KEY, all);
  return targets.length;
}
