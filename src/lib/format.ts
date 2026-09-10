import type { Snapshot, Team } from './types';

export const fmt1 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : (Math.round(n * 10) / 10).toFixed(1));
export const fmt2 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : (Math.round(n * 100) / 100).toFixed(2));
export const pct = (n: number) => `${Math.round(n)}%`;
export const signed = (n: number, digits = 1) => (n > 0 ? '+' : '') + n.toFixed(digits);

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtDate(iso: string | number | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', ...opts });
}

export const record = (t: { wins: number; losses: number; ties: number }) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;

export function teamById(snap: Snapshot | null, id: number | null | undefined): Team | undefined {
  if (!snap || id === null || id === undefined) return undefined;
  return snap.teams.find((t) => t.id === id);
}

export const slug = (t: Team) => String(t.id);

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function posClass(pos: string): string {
  return 'pos pos-' + pos.replace('/', '');
}

export function injuryTag(status: string): { text: string; cls: string } | null {
  switch (status) {
    case 'QUESTIONABLE':
      return { text: 'Q', cls: 'inj q' };
    case 'DOUBTFUL':
      return { text: 'D', cls: 'inj' };
    case 'OUT':
      return { text: 'O', cls: 'inj' };
    case 'INJURY_RESERVE':
      return { text: 'IR', cls: 'inj' };
    case 'SUSPENSION':
      return { text: 'SUSP', cls: 'inj' };
    default:
      return null;
  }
}

export function headshot(playerId: number, pos: string, proTeam: string): string {
  if (pos === 'D/ST') return `https://a.espncdn.com/i/teamlogos/nfl/500/${proTeam.toLowerCase()}.png`;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function movement(prev: number | null, rank: number): { text: string; cls: string } {
  if (prev === null) return { text: 'NEW', cls: 'move same' };
  const d = prev - rank;
  if (d > 0) return { text: `▲ ${d}`, cls: 'move up' };
  if (d < 0) return { text: `▼ ${-d}`, cls: 'move down' };
  return { text: '—', cls: 'move same' };
}
