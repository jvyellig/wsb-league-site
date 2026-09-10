import { BENCH_SLOTS, SLOT_ELIGIBLE } from './constants';

export interface Valued {
  pos: string;
  value: number;
}

/**
 * Best possible lineup for a roster given the league's slot counts, e.g. {"0":1,"2":2,"4":2,"6":1,"23":1,"16":1,"17":1,"20":7}.
 * Dedicated slots are filled first, then flex slots from what's left. Returns the chosen players (indexes).
 */
export function optimalLineup<T extends Valued>(players: T[], lineupSlots: Record<string, number>): { starters: T[]; bench: T[]; total: number } {
  const slots = Object.entries(lineupSlots)
    .map(([id, count]) => ({ id: Number(id), count: Number(count) }))
    .filter((s) => s.count > 0 && !BENCH_SLOTS.has(s.id) && SLOT_ELIGIBLE[s.id]);
  // dedicated (single-position) slots first, then multi-position slots
  slots.sort((a, b) => SLOT_ELIGIBLE[a.id].length - SLOT_ELIGIBLE[b.id].length);
  const remaining = [...players].sort((a, b) => b.value - a.value);
  const starters: T[] = [];
  for (const slot of slots) {
    for (let i = 0; i < slot.count; i++) {
      const idx = remaining.findIndex((p) => SLOT_ELIGIBLE[slot.id].includes(p.pos));
      if (idx >= 0) starters.push(remaining.splice(idx, 1)[0]);
    }
  }
  return { starters, bench: remaining, total: starters.reduce((s, p) => s + p.value, 0) };
}

/** Injury-adjusted projected value for roster-strength math. */
export function injuryFactor(status: string): number {
  switch (status) {
    case 'OUT':
    case 'INJURY_RESERVE':
    case 'SUSPENSION':
      return 0;
    case 'DOUBTFUL':
      return 0.5;
    case 'QUESTIONABLE':
      return 0.85;
    default:
      return 1;
  }
}
