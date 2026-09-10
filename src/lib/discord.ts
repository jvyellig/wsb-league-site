import { env } from './store';

/** Post a message to the league's Discord channel via webhook (no-op when not configured). */
export async function postDiscord(content: string, embeds?: any[]): Promise<boolean> {
  const url = env('DISCORD_WEBHOOK_URL');
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds, username: 'WSB League Site' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
