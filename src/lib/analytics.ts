import { optimalLineup } from './lineup';
import { acquiredSet, completedWeeks, r1, r2, weekResults, rosterStrength } from './rankings';
import type { Award, BoxScore, Derived, Odds, Preview, PreviewSide, Rankings, Snapshot, StandingRow } from './types';

// ---------------------------------------------------------------------------
// Standings with all-play + luck
// ---------------------------------------------------------------------------
export function computeStandings(snap: Snapshot, weeks: number[]): StandingRow[] {
  const results = weekResults(snap, weeks);
  const n = snap.teams.length;
  const rows: StandingRow[] = snap.teams.map((t) => {
    const mine = results.filter((r) => r.teamId === t.id);
    const games = mine.filter((r) => r.oppId !== null);
    let apW = 0,
      apL = 0,
      medianWins = 0;
    for (const r of mine) {
      const wk = results.filter((x) => x.week === r.week && x.teamId !== t.id).map((x) => x.points);
      apW += wk.filter((p) => r.points > p).length;
      apL += wk.filter((p) => r.points < p).length;
      const all = [...wk, r.points].sort((a, b) => a - b);
      const median = (all[Math.floor((all.length - 1) / 2)] + all[Math.ceil((all.length - 1) / 2)]) / 2;
      if (r.points > median) medianWins++;
    }
    const wins = games.filter((r) => r.won).length;
    const losses = games.filter((r) => r.lost).length;
    const ties = games.filter((r) => r.tie).length;
    const pf = mine.reduce((s, r) => s + r.points, 0);
    const pa = games.reduce((s, r) => s + r.oppPoints, 0);
    const expected = mine.length ? (apW + 0.5 * (mine.length * (n - 1) - apW - apL)) / (n - 1) : 0;
    return {
      teamId: t.id,
      wins,
      losses,
      ties,
      pointsFor: r2(pf),
      pointsAgainst: r2(pa),
      allPlayWins: apW,
      allPlayLosses: apL,
      expectedWins: r2(expected),
      luck: r2(wins + 0.5 * ties - expected),
      ppg: mine.length ? r1(pf / mine.length) : 0,
      seed: 0,
      medianWins,
    };
  });
  rows.sort((a, b) => b.wins + 0.5 * b.ties - (a.wins + 0.5 * a.ties) || b.pointsFor - a.pointsFor);
  rows.forEach((r, i) => (r.seed = i + 1));
  return rows;
}

// ---------------------------------------------------------------------------
// Weekly awards
// ---------------------------------------------------------------------------
export function computeAwards(snap: Snapshot, week: number, box: BoxScore | null): Award[] {
  const results = weekResults(snap, [week]);
  const name = (id: number) => snap.teams.find((t) => t.id === id)?.name ?? '—';
  const awards: Award[] = [];
  if (!results.length) return awards;
  const sorted = [...results].sort((a, b) => b.points - a.points);
  awards.push({ key: 'top', title: 'Top Gun', emoji: '🔥', teamId: sorted[0].teamId, value: `${r1(sorted[0].points)} pts`, detail: `Highest score of week ${week}` });
  const low = sorted[sorted.length - 1];
  awards.push({ key: 'low', title: 'Toilet Bowl', emoji: '🚽', teamId: low.teamId, value: `${r1(low.points)} pts`, detail: `Lowest score of week ${week}` });

  const games = results.filter((r) => r.oppId !== null && r.won);
  if (games.length) {
    const margins = games.map((r) => ({ r, m: r.points - r.oppPoints })).sort((a, b) => b.m - a.m);
    const big = margins[0];
    awards.push({ key: 'blowout', title: 'Blowout of the Week', emoji: '💥', teamId: big.r.teamId, value: `by ${r1(big.m)}`, detail: `${r1(big.r.points)}-${r1(big.r.oppPoints)} over ${name(big.r.oppId!)}` });
    const close = margins[margins.length - 1];
    awards.push({ key: 'close', title: 'Nail-biter', emoji: '😰', teamId: close.r.teamId, value: `by ${r1(close.m)}`, detail: `${r1(close.r.points)}-${r1(close.r.oppPoints)} over ${name(close.r.oppId!)}` });
  }

  if (box) {
    // Bench blunder: biggest gap between optimal and actual lineup
    let worst: { teamId: number; gap: number; detail: string } | null = null;
    const acquired = acquiredSet(snap);
    let wizard: { teamId: number; pts: number; detail: string } | null = null;
    for (const bt of Object.values(box.teams)) {
      const valued = bt.players.filter((p) => p.slotId !== 21).map((p) => ({ ...p, value: p.points }));
      const opt = optimalLineup(valued, snap.lineupSlots);
      const actual = bt.players.filter((p) => p.starter).reduce((s, p) => s + p.points, 0);
      const gap = opt.total - actual;
      if (gap > 0.05 && (!worst || gap > worst.gap)) {
        const benched = bt.players.filter((p) => !p.starter && opt.starters.some((s) => s.id === p.id)).sort((a, b) => b.points - a.points)[0];
        const started = bt.players.filter((p) => p.starter && !opt.starters.some((s) => s.id === p.id)).sort((a, b) => a.points - b.points)[0];
        worst = { teamId: bt.teamId, gap, detail: benched && started ? `Benched ${benched.name} (${r1(benched.points)}), started ${started.name} (${r1(started.points)})` : `Left ${r1(gap)} points on the bench` };
      }
      const acq = bt.players.filter((p) => p.starter && acquired.has(`${bt.teamId}:${p.id}`));
      const pts = acq.reduce((s, p) => s + p.points, 0);
      if (pts > 0 && (!wizard || pts > wizard.pts)) {
        const best = [...acq].sort((a, b) => b.points - a.points)[0];
        wizard = { teamId: bt.teamId, pts, detail: `${r1(pts)} pts from pickups, led by ${best.name} (${r1(best.points)})` };
      }
    }
    if (worst) awards.push({ key: 'bench', title: 'Bench Blunder', emoji: '🪑', teamId: worst.teamId, value: `-${r1(worst.gap)}`, detail: worst.detail });
    if (wizard) awards.push({ key: 'waiver', title: 'Waiver Wizard', emoji: '🧙', teamId: wizard.teamId, value: `${r1(wizard.pts)} pts`, detail: wizard.detail });
  }
  return awards;
}

// ---------------------------------------------------------------------------
// Playoff odds (Monte Carlo)
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateSeason(snap: Snapshot, weeks: number[], runs = 10000, seed = 42): Odds[] {
  const rand = mulberry32(seed);
  const gauss = () => {
    let u = 0,
      v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const teams = snap.teams;
  const n = teams.length;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const results = weekResults(snap, weeks);

  // Scoring model: observed mean/sd shrunk toward the roster projection with a 4-game prior
  const PRIOR_GAMES = 4;
  const PRIOR_SD = 22;
  const model = teams.map((t) => {
    const pts = results.filter((r) => r.teamId === t.id).map((r) => r.points);
    const k = pts.length;
    const prior = rosterStrength(t, snap.lineupSlots) || 100;
    const obsMean = k ? pts.reduce((a, b) => a + b, 0) / k : prior;
    const mean = (k * obsMean + PRIOR_GAMES * prior) / (k + PRIOR_GAMES);
    const obsVar = k > 1 ? pts.reduce((s, p) => s + (p - obsMean) ** 2, 0) / (k - 1) : PRIOR_SD ** 2;
    const sd = Math.sqrt((k * obsVar + PRIOR_GAMES * PRIOR_SD ** 2) / (k + PRIOR_GAMES));
    return { mean, sd: Math.max(sd, 12) };
  });

  const baseWins = new Array(n).fill(0);
  const basePts = new Array(n).fill(0);
  for (const r of results) {
    const i = idx.get(r.teamId)!;
    basePts[i] += r.points;
    if (r.won) baseWins[i] += 1;
    else if (r.tie) baseWins[i] += 0.5;
  }
  const done = new Set(weeks);
  const remaining = snap.schedule.filter((m) => m.week <= snap.regularSeasonWeeks && !done.has(m.week) && m.away);

  const P = snap.playoffTeams;
  const bracketSize = 2 ** Math.ceil(Math.log2(P));
  const byes = bracketSize - P;
  const tally = teams.map(() => ({ playoff: 0, bye: 0, title: 0, last: 0, wins: 0, seed: 0 }));

  const sample = (i: number) => Math.max(30, model[i].mean + model[i].sd * gauss());

  for (let run = 0; run < runs; run++) {
    const wins = [...baseWins];
    const pts = [...basePts];
    for (const m of remaining) {
      const h = idx.get(m.home.teamId)!;
      const a = idx.get(m.away!.teamId)!;
      const hs = sample(h);
      const as = sample(a);
      pts[h] += hs;
      pts[a] += as;
      if (hs > as) wins[h] += 1;
      else if (as > hs) wins[a] += 1;
      else {
        wins[h] += 0.5;
        wins[a] += 0.5;
      }
    }
    const order = teams.map((_, i) => i).sort((x, y) => wins[y] - wins[x] || pts[y] - pts[x]);
    order.forEach((i, s) => {
      tally[i].wins += wins[i];
      tally[i].seed += s + 1;
      if (s < P) tally[i].playoff++;
      if (s < byes) tally[i].bye++;
      if (s === n - 1) tally[i].last++;
    });
    // Playoff bracket: seeds 1..P, byes for top seeds, no reseeding
    let alive = order.slice(0, P);
    let round: number[] = alive.slice(byes);
    let winners: number[] = alive.slice(0, byes);
    // first round: highest remaining vs lowest remaining
    while (round.length > 1) {
      const w: number[] = [];
      for (let i = 0; i < round.length / 2; i++) {
        const x = round[i];
        const y = round[round.length - 1 - i];
        w.push(sample(x) >= sample(y) ? x : y);
      }
      round = w;
    }
    winners = [...winners, ...round];
    // subsequent rounds keep seed order (bye teams first)
    while (winners.length > 1) {
      const w: number[] = [];
      for (let i = 0; i < winners.length / 2; i++) {
        const x = winners[i];
        const y = winners[winners.length - 1 - i];
        w.push(sample(x) >= sample(y) ? x : y);
      }
      winners = w;
    }
    tally[winners[0]].title++;
  }
  return teams.map((t, i) => ({
    teamId: t.id,
    playoff: r1((tally[i].playoff / runs) * 100),
    bye: r1((tally[i].bye / runs) * 100),
    title: r1((tally[i].title / runs) * 100),
    last: r1((tally[i].last / runs) * 100),
    avgWins: r1(tally[i].wins / runs),
    avgSeed: r1(tally[i].seed / runs),
  }));
}

// ---------------------------------------------------------------------------
// Matchup previews
// ---------------------------------------------------------------------------
export interface HistoryGame {
  week: number;
  playoffTier: string;
  homeId: number;
  awayId: number;
  homePts: number;
  awayPts: number;
  winner: string;
}

export function computePreviews(snap: Snapshot, weeks: number[], rankings: Rankings, history: { season: number; games: HistoryGame[] }[]): Preview[] {
  const week = snap.currentMatchupPeriod;
  const standings = computeStandings(snap, weeks);
  const latestWeek = Math.max(-1, ...Object.keys(rankings.weeks).map(Number));
  const latest = latestWeek >= 0 ? rankings.weeks[String(latestWeek)] : null;
  const rankOf = (id: number) => latest?.entries.find((e) => e.teamId === id)?.rank ?? null;

  const thisSeason: HistoryGame[] = snap.schedule
    .filter((m) => m.away && m.winner !== 'UNDECIDED' && m.week < week)
    .map((m) => ({ week: m.week, playoffTier: m.playoffTier, homeId: m.home.teamId, awayId: m.away!.teamId, homePts: m.home.points, awayPts: m.away!.points, winner: m.winner }));
  const allGames = [...history.flatMap((h) => h.games.map((g) => ({ ...g, season: h.season }))), ...thisSeason.map((g) => ({ ...g, season: snap.season }))];

  const side = (teamId: number): PreviewSide => {
    const t = snap.teams.find((x) => x.id === teamId)!;
    const s = standings.find((x) => x.teamId === teamId)!;
    const starters = t.roster.filter((p) => p.starter);
    const projected = starters.reduce((sum, p) => sum + p.projWeek, 0);
    return {
      teamId,
      record: `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`,
      ppg: s.ppg,
      projected: r1(projected),
      powerRank: rankOf(teamId),
      keyPlayers: [...starters].sort((a, b) => b.projWeek - a.projWeek).slice(0, 3).map((p) => ({ name: p.name, pos: p.pos, proj: r1(p.projWeek) })),
      questionable: starters.filter((p) => ['QUESTIONABLE', 'DOUBTFUL', 'OUT'].includes(p.injuryStatus)).map((p) => `${p.name} (${p.injuryStatus[0]})`),
    };
  };

  const previews: Preview[] = snap.schedule
    .filter((m) => m.week === week)
    .map((m) => {
      const home = side(m.home.teamId);
      const away = m.away ? side(m.away.teamId) : null;
      // prefer ESPN's live projection once games start
      if (m.home.projected > 0) home.projected = r1(m.home.projected);
      if (away && m.away!.projected > 0) away.projected = r1(m.away!.projected);
      let hw = 0,
        aw = 0,
        ties = 0,
        last: string | null = null;
      if (away) {
        const games = allGames.filter((g) => (g.homeId === home.teamId && g.awayId === away.teamId) || (g.homeId === away.teamId && g.awayId === home.teamId));
        for (const g of games) {
          const homeWon = (g.winner === 'HOME' && g.homeId === home.teamId) || (g.winner === 'AWAY' && g.awayId === home.teamId);
          const awayWon = (g.winner === 'HOME' && g.homeId === away.teamId) || (g.winner === 'AWAY' && g.awayId === away.teamId);
          if (homeWon) hw++;
          else if (awayWon) aw++;
          else ties++;
        }
        const lg = games.sort((a, b) => b.season - a.season || b.week - a.week)[0];
        if (lg) {
          const hp = lg.homeId === home.teamId ? lg.homePts : lg.awayPts;
          const ap = lg.homeId === home.teamId ? lg.awayPts : lg.homePts;
          last = `${lg.season} wk ${lg.week}: ${r1(hp)}-${r1(ap)}`;
        }
      }
      return { matchupId: m.id, week, home, away, edge: away ? r1(home.projected - away.projected) : 0, gameOfWeek: false, series: { homeWins: hw, awayWins: aw, ties, lastMeeting: last } };
    });

  // Game of the week: best combined power rank, tiebreak closest projection
  const scored = previews
    .filter((p) => p.away)
    .map((p) => ({ p, s: (p.home.powerRank ?? 6) + (p.away!.powerRank ?? 6), e: Math.abs(p.edge) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  if (scored[0]) scored[0].p.gameOfWeek = true;
  return previews;
}

export function computeDerived(snap: Snapshot, rankings: Rankings, history: { season: number; games: HistoryGame[] }[]): Derived {
  const weeks = completedWeeks(snap);
  return {
    computedAt: new Date().toISOString(),
    standings: computeStandings(snap, weeks),
    odds: simulateSeason(snap, weeks),
    previews: computePreviews(snap, weeks, rankings, history),
    completedWeeks: weeks,
    simRuns: 10000,
  };
}
