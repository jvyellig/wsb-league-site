import { POSITIONS, PRO_TEAMS, SLOTS, BENCH_SLOTS } from './constants';
import type { BoxScore, DraftPick, Matchup, PoolPlayer, RosterPlayer, Snapshot, Team, Transaction } from './types';

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

export class EspnAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EspnAuthError';
  }
}

export interface EspnCreds {
  leagueId: string;
  swid: string;
  s2: string;
}

async function espnGet(creds: EspnCreds, season: number, query: string, filter?: object) {
  const url = `${BASE}/seasons/${season}/segments/0/leagues/${creds.leagueId}?${query}`;
  const headers: Record<string, string> = {
    Cookie: `SWID=${creds.swid}; espn_s2=${creds.s2}`,
    Accept: 'application/json',
  };
  if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);
  const res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.messages?.[0] ?? '';
    } catch {}
    throw new EspnAuthError(`ESPN rejected the credentials (${res.status}). ${detail}`.trim());
  }
  if (!res.ok) throw new Error(`ESPN request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

function statTotal(stats: any[] | undefined, id: string): number | undefined {
  const s = stats?.find((x) => x.id === id);
  return s ? num(s.appliedTotal) : undefined;
}
function statAvg(stats: any[] | undefined, id: string): number | undefined {
  const s = stats?.find((x) => x.id === id);
  return s ? num(s.appliedAverage) : undefined;
}

/** ESPN stat ids worth keeping for a readable stat line. */
const KEEP_STATS = new Set([0, 1, 3, 4, 20, 23, 24, 25, 42, 43, 53, 58, 72, 83, 84, 86, 87, 95, 96, 97, 98, 99, 101, 102, 103, 104, 105, 120, 127]);

/** Keep just the interesting raw stats from an ESPN stat entry, or undefined if nothing was recorded. */
function pickStats(entry: any): Record<string, number> | undefined {
  const raw = entry?.stats;
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  let any = false;
  for (const [k, v] of Object.entries(raw)) {
    if (KEEP_STATS.has(Number(k)) && typeof v === 'number') {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** In-week entries: actual (source 0) and projected (source 1) for one scoring period. ESPN keys actuals by game id, so match on source/period rather than id. */
const weekEntry = (stats: any[], source: number, week: number) => stats.find((s) => s.statSourceId === source && s.statSplitTypeId === 1 && s.scoringPeriodId === week);

function normalizePlayer(entry: any, season: number, week: number): RosterPlayer {
  const p = entry.playerPoolEntry?.player ?? {};
  const stats: any[] = p.stats ?? [];
  const slotId = num(entry.lineupSlotId, 20);
  const actual = weekEntry(stats, 0, week);
  return {
    id: num(entry.playerId),
    name: p.fullName ?? 'Unknown',
    pos: POSITIONS[p.defaultPositionId] ?? '?',
    proTeam: PRO_TEAMS[p.proTeamId] ?? 'FA',
    slot: SLOTS[slotId] ?? '?',
    slotId,
    starter: !BENCH_SLOTS.has(slotId),
    injuryStatus: p.injuryStatus ?? 'ACTIVE',
    acquisitionType: entry.acquisitionType ?? 'DRAFT',
    acquisitionDate: entry.acquisitionDate ?? null,
    projWeek: num(weekEntry(stats, 1, week)?.appliedTotal),
    actualWeek: num(actual?.appliedTotal),
    seasonProj: statTotal(stats, `10${season}`) ?? 0,
    seasonProjAvg: statAvg(stats, `10${season}`) ?? 0,
    seasonPts: statTotal(stats, `00${season}`) ?? 0,
    percentOwned: num(p.ownership?.percentOwned),
    adp: p.ownership?.averageDraftPosition ?? null,
    stats: pickStats(actual),
  };
}

export type NameMap = Record<string, { name: string; pos: string; proTeam: string }>;

/** ESPN D/ST ids are -16000 - proTeamId. */
function dstName(id: number) {
  const abbr = PRO_TEAMS[-16000 - id];
  return abbr ? { name: `${abbr} D/ST`, pos: 'D/ST', proTeam: abbr } : undefined;
}

export function normalizeLeague(raw: any, names: NameMap = {}): Snapshot {
  const season = num(raw.seasonId);
  const week = num(raw.scoringPeriodId, 1);
  const members: Record<string, string> = {};
  for (const m of raw.members ?? []) {
    const full = `${(m.firstName ?? '').trim()} ${(m.lastName ?? '').trim()}`.trim();
    members[m.id] = full || m.displayName || 'Owner';
  }
  const playerNames: NameMap = { ...names };
  const lookup = (id: number) => playerNames[id] ?? (id < -16000 ? dstName(id) : undefined);

  const teams: Team[] = (raw.teams ?? []).map((t: any): Team => {
    const roster: RosterPlayer[] = (t.roster?.entries ?? []).map((e: any) => normalizePlayer(e, season, week));
    for (const p of roster) playerNames[p.id] = { name: p.name, pos: p.pos, proTeam: p.proTeam };
    const rec = t.record?.overall ?? {};
    const tc = t.transactionCounter ?? {};
    const name = (t.name ?? `${t.location ?? ''} ${t.nickname ?? ''}`).trim();
    return {
      id: t.id,
      name,
      abbrev: t.abbrev ?? '',
      logo: t.logo ?? '',
      owners: (t.owners ?? []).map((o: string) => members[o] ?? 'Owner'),
      wins: num(rec.wins),
      losses: num(rec.losses),
      ties: num(rec.ties),
      pointsFor: num(rec.pointsFor),
      pointsAgainst: num(rec.pointsAgainst),
      streakType: rec.streakType ?? 'NONE',
      streakLength: num(rec.streakLength),
      playoffSeed: num(t.playoffSeed),
      espnRank: num(t.rankCalculatedFinal) || num(t.currentProjectedRank),
      waiverRank: num(t.waiverRank),
      moves: num(tc.acquisitions),
      trades: num(tc.trades),
      roster: roster.sort((a, b) => a.slotId - b.slotId),
    };
  });

  const side = (s: any) =>
    s
      ? {
          teamId: num(s.teamId),
          points: num(s.totalPoints),
          live: num(s.totalPointsLive, num(s.totalPoints)),
          projected: num(s.totalProjectedPointsLive, num(s.totalProjectedPoints)),
          winProb: typeof s.winProbability === 'number' ? s.winProbability : undefined,
        }
      : null;

  const schedule: Matchup[] = (raw.schedule ?? [])
    .map((m: any) => ({
      id: m.id,
      week: num(m.matchupPeriodId),
      playoffTier: m.playoffTierType ?? 'NONE',
      home: side(m.home)!,
      away: side(m.away),
      winner: m.winner ?? 'UNDECIDED',
    }))
    .filter((m: Matchup) => m.home);

  const draftRaw = raw.draftDetail ?? {};
  const draft: DraftPick[] = (draftRaw.picks ?? []).map((p: any) => {
    const info = lookup(p.playerId);
    return {
      overall: num(p.overallPickNumber),
      round: num(p.roundId),
      pick: num(p.roundPickNumber),
      teamId: num(p.teamId),
      playerId: num(p.playerId),
      name: info?.name ?? `Player ${p.playerId}`,
      pos: info?.pos ?? '?',
      proTeam: info?.proTeam ?? '',
      autoDraft: num(p.autoDraftTypeId) !== 0,
    };
  });

  const transactions: Transaction[] = (raw.transactions ?? [])
    .filter((t: any) => t.type !== 'DRAFT' && t.type !== 'FUTURE_ROSTER' && t.type !== 'ROSTER')
    .map((t: any) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      teamId: num(t.teamId),
      date: num(t.processDate ?? t.proposedDate),
      week: num(t.scoringPeriodId),
      bid: num(t.bidAmount),
      items: (t.items ?? []).map((i: any) => ({
        type: i.type,
        playerId: num(i.playerId),
        playerName: lookup(i.playerId)?.name ?? `Player ${i.playerId}`,
        fromTeamId: num(i.fromTeamId),
        toTeamId: num(i.toTeamId),
      })),
    }))
    .sort((a: Transaction, b: Transaction) => b.date - a.date);

  const settings = raw.settings ?? {};
  const sched = settings.scheduleSettings ?? {};
  const status = raw.status ?? {};
  return {
    fetchedAt: new Date().toISOString(),
    season,
    leagueName: settings.name ?? 'Fantasy League',
    currentWeek: week,
    currentMatchupPeriod: num(status.currentMatchupPeriod, week),
    regularSeasonWeeks: num(sched.matchupPeriodCount, 14),
    finalWeek: num(status.finalScoringPeriod, 17),
    playoffTeams: num(sched.playoffTeamCount, 6),
    lineupSlots: settings.rosterSettings?.lineupSlotCounts ?? {},
    teams,
    schedule,
    transactions,
    draft: draft.sort((a, b) => a.overall - b.overall),
    draftComplete: !!draftRaw.drafted,
  };
}

export async function fetchLeague(creds: EspnCreds, season: number, names: NameMap = {}): Promise<Snapshot> {
  const views = ['mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mSettings', 'mStatus', 'mDraftDetail', 'mTransactions2'];
  const raw = await espnGet(creds, season, views.map((v) => `view=${v}`).join('&'));
  return normalizeLeague(raw, names);
}

/** Top ~400 players league-wide (rostered + free agents) with season projections — used for VOR baselines. */
export async function fetchPlayerPool(creds: EspnCreds, season: number): Promise<PoolPlayer[]> {
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS', 'ONTEAM'] },
      filterSlotIds: { value: [0, 2, 4, 6, 16, 17] },
      limit: 450,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const raw = await espnGet(creds, season, 'view=kona_player_info', filter);
  return (raw.players ?? []).map((e: any): PoolPlayer => {
    const p = e.player ?? {};
    return {
      id: num(e.id),
      name: p.fullName ?? 'Unknown',
      pos: POSITIONS[p.defaultPositionId] ?? '?',
      proTeam: PRO_TEAMS[p.proTeamId] ?? 'FA',
      onTeamId: num(e.onTeamId),
      seasonProj: statTotal(p.stats, `10${season}`) ?? 0,
      adp: p.ownership?.averageDraftPosition ?? null,
      percentOwned: num(p.ownership?.percentOwned),
    };
  });
}

/** Box score (lineups + points) for a completed scoring period. */
export async function fetchBoxScore(creds: EspnCreds, season: number, week: number): Promise<BoxScore> {
  const raw = await espnGet(creds, season, `view=mBoxscore&view=mMatchupScore&scoringPeriodId=${week}`);
  const box: BoxScore = { week, teams: {} };
  for (const m of raw.schedule ?? []) {
    if (m.matchupPeriodId !== week) continue;
    for (const s of [m.home, m.away]) {
      if (!s) continue;
      const entries = s.rosterForCurrentScoringPeriod?.entries ?? [];
      const players = entries.map((e: any) => {
        const p = e.playerPoolEntry?.player ?? {};
        const slotId = num(e.lineupSlotId, 20);
        const stats: any[] = p.stats ?? [];
        const actual = weekEntry(stats, 0, week);
        return {
          id: num(e.playerId),
          name: p.fullName ?? 'Unknown',
          pos: POSITIONS[p.defaultPositionId] ?? '?',
          proTeam: PRO_TEAMS[p.proTeamId] ?? 'FA',
          slotId,
          slot: SLOTS[slotId] ?? '?',
          starter: !BENCH_SLOTS.has(slotId),
          points: num(e.playerPoolEntry?.appliedStatTotal, num(actual?.appliedTotal)),
          proj: num(weekEntry(stats, 1, week)?.appliedTotal),
          injuryStatus: p.injuryStatus ?? 'ACTIVE',
          stats: pickStats(actual),
        };
      });
      box.teams[String(s.teamId)] = {
        teamId: num(s.teamId),
        total: num(s.pointsByScoringPeriod?.[week], num(s.totalPoints)),
        players,
      };
    }
  }
  return box;
}

/** Prior-season schedule (for head-to-head history). */
export async function fetchSeasonSchedule(creds: EspnCreds, season: number) {
  const raw = await espnGet(creds, season, 'view=mMatchupScore&view=mTeam');
  const teams: Record<string, string> = {};
  for (const t of raw.teams ?? []) teams[t.id] = (t.name ?? `${t.location ?? ''} ${t.nickname ?? ''}`).trim();
  const games = (raw.schedule ?? [])
    .filter((m: any) => m.away && m.winner && m.winner !== 'UNDECIDED')
    .map((m: any) => ({
      week: num(m.matchupPeriodId),
      playoffTier: m.playoffTierType ?? 'NONE',
      homeId: num(m.home.teamId),
      awayId: num(m.away.teamId),
      homePts: num(m.home.totalPoints),
      awayPts: num(m.away.totalPoints),
      winner: m.winner,
    }));
  return { season, teams, games };
}
