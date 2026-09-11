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

/**
 * Turn ESPN's raw stat map into a short human line, e.g. "18 car · 51 yds · 1 TD · 5 rec · 44 yds".
 * Stat ids: 0 att, 1 comp, 3 pass yds, 4 pass TD, 20 INT, 23 rush att, 24 rush yds, 25 rush TD,
 * 53 rec, 58 tgt, 42 rec yds, 43 rec TD, 72 fumbles lost, 83/84 FG made/att, 86/87 XP made/att,
 * 99 sacks, 95 INT, 96 fum rec, 98 safeties, 97 blocks, 101-105 defensive/return TDs, 120 pts allowed.
 */
export function statLine(pos: string, stats?: Record<string, number> | null): string {
  if (!stats) return '';
  const g = (id: number) => stats[String(id)] ?? 0;
  const parts: string[] = [];
  const yds = (n: number) => `${Math.round(n)} yds`;
  if (pos === 'QB') {
    if (g(0) || g(1)) parts.push(`${g(1)}/${g(0)}, ${yds(g(3))}, ${g(4)} TD${g(20) ? `, ${g(20)} INT` : ''}`);
    if (g(23)) parts.push(`${g(23)} car, ${yds(g(24))}${g(25) ? `, ${g(25)} TD` : ''}`);
  } else if (pos === 'K') {
    parts.push(`${g(83)}/${g(84)} FG`, `${g(86)}/${g(87)} XP`);
  } else if (pos === 'D/ST') {
    parts.push(`${g(120)} pts allowed`);
    if (g(99)) parts.push(`${g(99)} sack${g(99) === 1 ? '' : 's'}`);
    const to = g(95) + g(96);
    if (to) parts.push(`${to} TO`);
    const tds = g(101) + g(102) + g(103) + g(104) + g(105);
    if (tds) parts.push(`${tds} TD`);
    if (g(98)) parts.push(`${g(98)} safety`);
    if (g(97)) parts.push(`${g(97)} block`);
  } else {
    if (g(23)) parts.push(`${g(23)} car, ${yds(g(24))}${g(25) ? `, ${g(25)} TD` : ''}`);
    if (g(53) || g(58)) parts.push(`${g(53)}/${g(58)} rec, ${yds(g(42))}${g(43) ? `, ${g(43)} TD` : ''}`);
    if (g(0)) parts.push(`${g(1)}/${g(0)} pass, ${yds(g(3))}${g(4) ? `, ${g(4)} TD` : ''}`);
  }
  if (g(72)) parts.push(`${g(72)} fum lost`);
  return parts.join(' · ');
}

/** Lineup display order for slot ids: QB, RB, WR, TE, FLEX, D/ST, K, then bench/IR. */
const SLOT_ORDER = [0, 2, 4, 6, 23, 16, 17, 20, 21];
export const slotRank = (slotId: number) => {
  const i = SLOT_ORDER.indexOf(slotId);
  return i === -1 ? 50 + slotId : i;
};
