import { ACQUIRED_TYPES, BENCH_VOR_WEIGHT, DRAFT_PRIOR_WEEKS, REPLACEMENT_RANK, WEIGHTS } from './constants';
import { injuryFactor, optimalLineup } from './lineup';
import type { BoxScore, DraftGrade, DraftRecap, PoolPlayer, RankEntry, Rankings, Snapshot, Team, WeekRankings } from './types';

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Min-max scale a map of teamId → raw value onto 0..100. Identical values → 50. */
export function scale(values: Map<number, number>): Map<number, number> {
  const arr = [...values.values()];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const out = new Map<number, number>();
  for (const [k, v] of values) out.set(k, max === min ? 50 : ((v - min) / (max - min)) * 100);
  return out;
}

export function letterGrade(pct: number): string {
  if (pct >= 0.85) return 'A';
  if (pct >= 0.7) return 'A-';
  if (pct >= 0.55) return 'B+';
  if (pct >= 0.4) return 'B';
  if (pct >= 0.25) return 'B-';
  if (pct >= 0.12) return 'C+';
  return 'C';
}

// ---------------------------------------------------------------------------
// Week 0: draft grades via value over replacement
// ---------------------------------------------------------------------------
export function computeDraftRecap(snap: Snapshot, pool: PoolPlayer[]): DraftRecap {
  // Merge pool + rostered players into one projection table
  const proj = new Map<number, { name: string; pos: string; proj: number; adp: number | null }>();
  for (const p of pool) proj.set(p.id, { name: p.name, pos: p.pos, proj: p.seasonProj, adp: p.adp });
  for (const t of snap.teams) for (const p of t.roster) if (!proj.has(p.id)) proj.set(p.id, { name: p.name, pos: p.pos, proj: p.seasonProj, adp: p.adp });

  const byPos = new Map<string, { name: string; proj: number }[]>();
  for (const p of proj.values()) {
    if (!byPos.has(p.pos)) byPos.set(p.pos, []);
    byPos.get(p.pos)!.push(p);
  }
  const baselines: DraftRecap['baselines'] = {};
  for (const [pos, list] of byPos) {
    list.sort((a, b) => b.proj - a.proj);
    const rank = REPLACEMENT_RANK[pos];
    if (!rank) continue;
    const b = list[Math.min(rank, list.length) - 1];
    baselines[pos] = { rank, points: r1(b.proj), player: b.name };
  }

  const picks = snap.draft.map((pk) => {
    const p = proj.get(pk.playerId);
    const points = p?.proj ?? 0;
    const pos = p?.pos ?? pk.pos;
    const base = baselines[pos]?.points ?? 0;
    return { ...pk, name: p?.name ?? pk.name, pos, proj: r1(points), vor: r1(points - base), expectedVor: 0, delta: 0, adp: p?.adp ?? null };
  });
  // "Perfect draft" order: what the n-th pick would have been worth if everyone picked by VOR
  // VOR is floored at zero: a replacement-level player is always available on waivers, so no pick is worth less than nothing.
  const perfect = [...picks].map((p) => Math.max(0, p.vor)).sort((a, b) => b - a);
  for (const pk of picks) {
    pk.expectedVor = r1(perfect[pk.overall - 1] ?? 0);
    pk.delta = r1(Math.max(0, pk.vor) - pk.expectedVor);
  }

  const grades: DraftGrade[] = snap.teams.map((t) => {
    const mine = picks.filter((p) => p.teamId === t.id);
    const { starters, bench } = optimalLineup(mine.map((p) => ({ ...p, value: p.proj })), snap.lineupSlots);
    const starterVor = starters.reduce((s, p) => s + Math.max(0, p.vor), 0);
    const benchVor = bench.reduce((s, p) => s + Math.max(0, p.vor), 0);
    const sorted = [...mine].sort((a, b) => b.delta - a.delta);
    const pickInfo = (p: (typeof mine)[number] | undefined) => (p ? { name: p.name, pos: p.pos, overall: p.overall, vor: p.vor, delta: p.delta } : null);
    return {
      teamId: t.id,
      starterVor: r1(starterVor),
      benchVor: r1(benchVor),
      total: r1(starterVor + BENCH_VOR_WEIGHT * benchVor),
      grade: '',
      rank: 0,
      bestPick: pickInfo(sorted[0]),
      worstPick: pickInfo(sorted[sorted.length - 1]),
    };
  });
  grades.sort((a, b) => b.total - a.total);
  const max = grades[0].total;
  const min = grades[grades.length - 1].total;
  grades.forEach((g, i) => {
    g.rank = i + 1;
    g.grade = letterGrade(max === min ? 0.5 : (g.total - min) / (max - min));
  });
  return { computedAt: new Date().toISOString(), baselines, grades, picks };
}

export function week0Rankings(recap: DraftRecap): WeekRankings {
  const totals = new Map(recap.grades.map((g) => [g.teamId, g.total]));
  const scaled = scale(totals);
  return {
    week: 0,
    computedAt: recap.computedAt,
    entries: recap.grades.map((g) => ({
      teamId: g.teamId,
      rank: g.rank,
      prevRank: null,
      score: r1(scaled.get(g.teamId)!),
      components: { draft: { raw: g.total, scaled: r1(scaled.get(g.teamId)!) } },
      draftPrior: null,
      draftWeight: 1,
      grade: g.grade,
      blurb: `Draft grade ${g.grade}: ${g.starterVor} points of starting-lineup value over replacement plus ${g.benchVor} on the bench.` +
        (g.bestPick ? ` Best pick: ${g.bestPick.name} (${g.bestPick.pos}, #${g.bestPick.overall} overall, +${g.bestPick.delta}).` : ''),
    })),
  };
}

// ---------------------------------------------------------------------------
// Weeks 1+: power score
// ---------------------------------------------------------------------------
export interface WeekResult {
  teamId: number;
  week: number;
  points: number;
  oppId: number | null;
  oppPoints: number;
  won: boolean;
  lost: boolean;
  tie: boolean;
}

/** Completed weeks: every matchup for the week has a decided winner. */
export function completedWeeks(snap: Snapshot): number[] {
  const weeks = new Set<number>();
  const byWeek = new Map<number, typeof snap.schedule>();
  for (const m of snap.schedule) {
    if (m.week > snap.regularSeasonWeeks) continue;
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week)!.push(m);
  }
  for (const [w, ms] of byWeek) {
    if (ms.every((m) => m.winner !== 'UNDECIDED') && w < snap.currentMatchupPeriod) weeks.add(w);
  }
  return [...weeks].sort((a, b) => a - b);
}

export function weekResults(snap: Snapshot, weeks: number[]): WeekResult[] {
  const out: WeekResult[] = [];
  const set = new Set(weeks);
  for (const m of snap.schedule) {
    if (!set.has(m.week)) continue;
    const h = m.home;
    const a = m.away;
    if (!a) {
      out.push({ teamId: h.teamId, week: m.week, points: h.points, oppId: null, oppPoints: 0, won: false, lost: false, tie: false });
      continue;
    }
    const tie = m.winner === 'TIE';
    out.push({ teamId: h.teamId, week: m.week, points: h.points, oppId: a.teamId, oppPoints: a.points, won: m.winner === 'HOME', lost: m.winner === 'AWAY', tie });
    out.push({ teamId: a.teamId, week: m.week, points: a.points, oppId: h.teamId, oppPoints: h.points, won: m.winner === 'AWAY', lost: m.winner === 'HOME', tie });
  }
  return out;
}

/** (teamId, playerId) pairs added via waiver / free agency / trade. */
export function acquiredSet(snap: Snapshot): Set<string> {
  const s = new Set<string>();
  for (const t of snap.transactions) {
    if (t.status !== 'EXECUTED' || !ACQUIRED_TYPES.has(t.type)) continue;
    for (const i of t.items) if ((i.type === 'ADD' || i.type === 'TRADE') && i.toTeamId) s.add(`${i.toTeamId}:${i.playerId}`);
  }
  for (const t of snap.teams) for (const p of t.roster) if (ACQUIRED_TYPES.has(p.acquisitionType)) s.add(`${t.id}:${p.id}`);
  return s;
}

export function rosterStrength(team: Team, lineupSlots: Record<string, number>): number {
  const valued = team.roster
    .filter((p) => p.slotId !== 21)
    .map((p) => ({ pos: p.pos, value: p.seasonProjAvg * injuryFactor(p.injuryStatus) }));
  return optimalLineup(valued, lineupSlots).total;
}

function allPlayForWeek(results: WeekResult[], week: number): Map<number, { w: number; l: number }> {
  const wk = results.filter((r) => r.week === week);
  const out = new Map<number, { w: number; l: number }>();
  for (const r of wk) {
    let w = 0,
      l = 0;
    for (const o of wk) {
      if (o.teamId === r.teamId) continue;
      if (r.points > o.points) w++;
      else if (r.points < o.points) l++;
    }
    out.set(r.teamId, { w, l });
  }
  return out;
}

export function computeWeekRankings(
  snap: Snapshot,
  week: number,
  boxes: Record<number, BoxScore>,
  rankings: Rankings,
): WeekRankings {
  const weeks = Array.from({ length: week }, (_, i) => i + 1);
  const results = weekResults(snap, weeks);
  const acquired = acquiredSet(snap);
  const teams = snap.teams;
  const n = teams.length;

  const raw = {
    results: new Map<number, number>(),
    scoring: new Map<number, number>(),
    roster: new Map<number, number>(),
    activity: new Map<number, number>(),
  };
  const facts = new Map<number, any>();

  for (const t of teams) {
    const mine = results.filter((r) => r.teamId === t.id);
    const games = mine.filter((r) => r.oppId !== null);
    const wins = games.filter((r) => r.won).length + games.filter((r) => r.tie).length * 0.5;
    const winPct = games.length ? wins / games.length : 0;
    let apW = 0,
      apL = 0;
    for (const w of weeks) {
      const ap = allPlayForWeek(results, w).get(t.id);
      if (ap) {
        apW += ap.w;
        apL += ap.l;
      }
    }
    const apPct = apW + apL ? apW / (apW + apL) : 0;
    raw.results.set(t.id, 0.5 * winPct + 0.5 * apPct);

    const pts = mine.map((r) => r.points);
    const ppg = pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : 0;
    const last3 = pts.slice(-3);
    const l3 = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
    raw.scoring.set(t.id, 0.6 * ppg + 0.4 * l3);

    raw.roster.set(t.id, rosterStrength(t, snap.lineupSlots));

    let act = 0;
    for (const w of weeks) {
      const bt = boxes[w]?.teams[String(t.id)];
      if (!bt) continue;
      for (const p of bt.players) if (p.starter && acquired.has(`${t.id}:${p.id}`)) act += p.points;
    }
    raw.activity.set(t.id, act);

    const thisWeek = mine.find((r) => r.week === week);
    const ap = allPlayForWeek(results, week).get(t.id);
    const box = boxes[week]?.teams[String(t.id)];
    const top = box ? [...box.players].filter((p) => p.starter).sort((a, b) => b.points - a.points)[0] : null;
    facts.set(t.id, { wins: games.filter((r) => r.won).length, losses: games.filter((r) => r.lost).length, ties: games.filter((r) => r.tie).length, ppg, thisWeek, ap, top, winPct, apW, apL });
  }

  const scaled = {
    results: scale(raw.results),
    scoring: scale(raw.scoring),
    roster: scale(raw.roster),
    activity: scale(raw.activity),
  };

  const week0 = rankings.weeks['0'];
  const prev = rankings.weeks[String(week - 1)];
  const draftWeight = Math.max(0, (DRAFT_PRIOR_WEEKS - week) / DRAFT_PRIOR_WEEKS);

  // Week score ranks for blurbs
  const weekPts = results.filter((r) => r.week === week).sort((a, b) => b.points - a.points);
  const ppgRank = [...teams].sort((a, b) => facts.get(b.id).ppg - facts.get(a.id).ppg).map((t) => t.id);

  const entries: RankEntry[] = teams.map((t) => {
    const comps: RankEntry['components'] = {};
    let blend = 0;
    for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
      const s = scaled[key].get(t.id)!;
      comps[key] = { raw: r2(raw[key].get(t.id)!), scaled: r1(s) };
      blend += WEIGHTS[key] * s;
    }
    const draftPrior = week0?.entries.find((e) => e.teamId === t.id)?.score ?? null;
    const score = draftPrior !== null ? (1 - draftWeight) * blend + draftWeight * draftPrior : blend;
    return {
      teamId: t.id,
      rank: 0,
      prevRank: prev?.entries.find((e) => e.teamId === t.id)?.rank ?? null,
      score: r1(score),
      components: comps,
      draftPrior,
      draftWeight: r2(draftWeight),
      blurb: '',
    };
  });

  entries.sort((a, b) => b.score - a.score || raw.results.get(b.teamId)! - raw.results.get(a.teamId)! || facts.get(b.teamId).ppg - facts.get(a.teamId).ppg);
  entries.forEach((e, i) => (e.rank = i + 1));

  const name = (id: number | null) => teams.find((t) => t.id === id)?.name ?? '—';
  const ord = (k: number) => `${k}${['th', 'st', 'nd', 'rd'][(k % 100 >> 3) ^ 1 && k % 10] || 'th'}`;

  for (const e of entries) {
    const f = facts.get(e.teamId);
    const parts: string[] = [];
    const mv = e.prevRank === null ? null : e.prevRank - e.rank;
    if (mv === null) parts.push(`Debuts at No. ${e.rank}.`);
    else if (mv > 0) parts.push(`Up ${mv} to No. ${e.rank}.`);
    else if (mv < 0) parts.push(`Down ${-mv} to No. ${e.rank}.`);
    else parts.push(`Holds at No. ${e.rank}.`);

    const tw = f.thisWeek;
    if (tw && tw.oppId !== null) {
      const scoreRank = weekPts.findIndex((r) => r.teamId === e.teamId) + 1;
      const pick = (e.teamId + week) % 3;
      let s: string;
      if (tw.tie) s = `Tied ${name(tw.oppId)} ${r1(tw.points)}-${r1(tw.oppPoints)}`;
      else if (tw.won) s = [`Beat ${name(tw.oppId)} ${r1(tw.points)}-${r1(tw.oppPoints)}`, `Took down ${name(tw.oppId)} ${r1(tw.points)}-${r1(tw.oppPoints)}`, `Handled ${name(tw.oppId)} ${r1(tw.points)}-${r1(tw.oppPoints)}`][pick];
      else s = [`Fell to ${name(tw.oppId)} ${r1(tw.oppPoints)}-${r1(tw.points)}`, `Lost to ${name(tw.oppId)} ${r1(tw.oppPoints)}-${r1(tw.points)}`, `Dropped one to ${name(tw.oppId)} ${r1(tw.oppPoints)}-${r1(tw.points)}`][pick];
      if (scoreRank === 1) s += ' with the week\'s top score';
      else if (scoreRank === n) s += ' with the week\'s lowest score';
      else if (tw.won && f.ap && f.ap.w < f.ap.l) s += ` — a fortunate W, since that total would have lost to ${f.ap.l} of ${n - 1} other teams`;
      else if (tw.lost && f.ap && f.ap.w > f.ap.l) s += ` — a tough-luck loss, since that total beats ${f.ap.w} of ${n - 1} other teams`;
      parts.push(s + '.');
    } else if (tw) {
      parts.push(`On a bye this week with ${r1(tw.points)} points.`);
    }
    if (f.top) parts.push(`${f.top.name} led the way with ${r1(f.top.points)}.`);
    const rec = `${f.wins}-${f.losses}${f.ties ? `-${f.ties}` : ''}`;
    const pr = ppgRank.indexOf(e.teamId) + 1;
    const apStr = f.apW + f.apL ? ` and a ${f.apW}-${f.apL} all-play record` : '';
    parts.push(`Now ${rec} with the ${pr === 1 ? "league's best" : `${ord(pr)}-best`} scoring average (${r1(f.ppg)})${apStr}.`);
    if (draftWeight > 0 && e.draftPrior !== null) parts.push(`Draft grade still carries ${Math.round(draftWeight * 100)}% of the weight.`);
    e.blurb = parts.join(' ');
  }

  return { week, computedAt: new Date().toISOString(), entries };
}
