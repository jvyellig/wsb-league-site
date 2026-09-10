export const POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST', 7: 'P', 9: 'DT', 10: 'DE', 11: 'LB', 12: 'CB', 13: 'S',
};

export const SLOTS: Record<number, string> = {
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 8: 'DT', 9: 'DE', 10: 'LB',
  11: 'DL', 12: 'CB', 13: 'S', 14: 'DB', 15: 'DP', 16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BE', 21: 'IR', 22: '',
  23: 'FLEX', 24: 'EDR',
};

/** Which positions can fill which lineup slot (for optimal-lineup math). */
export const SLOT_ELIGIBLE: Record<number, string[]> = {
  0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 23: ['RB', 'WR', 'TE'], 3: ['RB', 'WR'], 5: ['WR', 'TE'],
  7: ['QB', 'RB', 'WR', 'TE'], 16: ['D/ST'], 17: ['K'],
};

export const BENCH_SLOTS = new Set([20, 21]);

export const PRO_TEAMS: Record<number, string> = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN',
  11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
  21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU',
};

/**
 * Replacement-level depth per position for VOR (12-team league):
 * dedicated starters + share of FLEX + streaming buffer. Mirrors the draft board.
 */
export const REPLACEMENT_RANK: Record<string, number> = { QB: 14, RB: 31, WR: 31, TE: 15, K: 13, 'D/ST': 13 };

/** Power-ranking weights (weeks 1+). Documented on /methodology. */
export const WEIGHTS = { results: 0.35, scoring: 0.35, roster: 0.2, activity: 0.1 } as const;
export const BENCH_VOR_WEIGHT = 0.35;
export const DRAFT_PRIOR_WEEKS = 6; // draft grade fully faded by this week

export const ACQUIRED_TYPES = new Set(['WAIVER', 'FREEAGENT', 'TRADE']);
