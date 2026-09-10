/**
 * The whole update pipeline, idempotent and safe to run every 15 minutes:
 *   1. fetch ESPN → league.json (auth failures flip status.authExpired and keep the last good snapshot)
 *   2. week 0 draft grades once the draft is complete (frozen after first computation)
 *   3. for every newly completed week: box score → power rankings + awards (frozen)
 *   4. derived data every run: standings/luck, playoff odds, matchup previews
 */
import { EspnAuthError, fetchBoxScore, fetchLeague, fetchPlayerPool, fetchSeasonSchedule, type EspnCreds, type NameMap } from './espn';
import { db, env, getRankings, getStatus, KEYS } from './store';
import { completedWeeks, computeDraftRecap, computeWeekRankings, week0Rankings } from './rankings';
import { computeAwards, computeDerived, type HistoryGame } from './analytics';
import { postDiscord } from './discord';
import type { BoxScore, Snapshot, SyncStatus, WeekRankings } from './types';

export async function getCreds(): Promise<EspnCreds & { source: 'env' | 'admin'; updatedAt: string | null }> {
  const override = await db.get<{ s2: string; updatedAt: string }>(KEYS.cookie, { strong: true });
  const leagueId = env('ESPN_LEAGUE_ID') ?? '';
  const swid = env('ESPN_SWID') ?? '';
  if (override?.s2) return { leagueId, swid, s2: override.s2, source: 'admin', updatedAt: override.updatedAt };
  return { leagueId, swid, s2: env('ESPN_S2') ?? '', source: 'env', updatedAt: null };
}

function log(status: SyncStatus, msg: string, ok = true) {
  status.log.unshift({ at: new Date().toISOString(), msg, ok });
  status.log = status.log.slice(0, 30);
}

export interface SyncResult {
  ok: boolean;
  message: string;
  newWeeks: number[];
}

export async function runSync(opts: { force?: boolean } = {}): Promise<SyncResult> {
  const status = await getStatus(true);
  status.lastAttempt = new Date().toISOString();
  const creds = await getCreds();
  status.cookieSource = creds.source;
  status.cookieUpdatedAt = creds.updatedAt;
  const season = Number(env('ESPN_SEASON') ?? new Date().getFullYear());
  const newWeeks: number[] = [];

  if (!creds.leagueId || !creds.swid || !creds.s2) {
    status.lastError = 'Missing ESPN_LEAGUE_ID, ESPN_SWID or ESPN_S2.';
    log(status, status.lastError, false);
    await db.set(KEYS.status, status);
    return { ok: false, message: status.lastError, newWeeks };
  }

  // Player-name cache so transactions can name players who are no longer on any roster
  const names: NameMap = (await db.get<NameMap>(KEYS.players, { strong: true })) ?? {};
  let pool: Awaited<ReturnType<typeof fetchPlayerPool>> | null = null;

  let snap: Snapshot;
  try {
    try {
      pool = await fetchPlayerPool(creds, season);
      for (const p of pool) names[p.id] = { name: p.name, pos: p.pos, proTeam: p.proTeam };
    } catch (e) {
      if (e instanceof EspnAuthError) throw e; // anything else: the name cache is a nice-to-have
    }
    snap = await fetchLeague(creds, season, names);
    for (const t of snap.teams) for (const p of t.roster) names[p.id] = { name: p.name, pos: p.pos, proTeam: p.proTeam };
    await db.set(KEYS.players, names);
  } catch (e: any) {
    const auth = e instanceof EspnAuthError;
    status.lastError = e?.message ?? String(e);
    if (auth) {
      const first = !status.authExpired;
      status.authExpired = true;
      status.authExpiredSince ??= new Date().toISOString();
      if (first) await postDiscord('⚠️ The league site can no longer reach ESPN — the espn_s2 cookie has expired. Commissioner, refresh it at /admin.');
    }
    log(status, `Fetch failed: ${status.lastError}`, false);
    await db.set(KEYS.status, status);
    return { ok: false, message: status.lastError!, newWeeks };
  }

  status.authExpired = false;
  status.authExpiredSince = null;
  status.lastError = null;
  status.lastSuccess = new Date().toISOString();
  await db.set(KEYS.league, snap);

  const rankings = await getRankings(true);
  let changed = false;

  // Week 0 — draft grades (once)
  if (snap.draftComplete && snap.draft.length && !rankings.weeks['0']) {
    try {
      const recap = computeDraftRecap(snap, pool ?? (await fetchPlayerPool(creds, season)));
      await db.set(KEYS.draft, recap);
      rankings.weeks['0'] = week0Rankings(recap);
      changed = true;
      log(status, 'Computed draft grades (week 0 power rankings)');
    } catch (e: any) {
      log(status, `Draft grade failed: ${e?.message}`, false);
    }
  }

  // Newly completed weeks
  const done = completedWeeks(snap);
  const boxes: Record<number, BoxScore> = {};
  const needBoxes = done.filter((w) => !rankings.weeks[String(w)]);
  if (needBoxes.length) {
    for (const w of done) {
      const cached = await db.get<BoxScore>(KEYS.box(w));
      if (cached) boxes[w] = cached;
    }
  }
  for (const w of done) {
    if (rankings.weeks[String(w)] && !opts.force) continue;
    try {
      if (!boxes[w]) {
        boxes[w] = await fetchBoxScore(creds, season, w);
        await db.set(KEYS.box(w), boxes[w]);
      }
      const wr = computeWeekRankings(snap, w, boxes, rankings);
      rankings.weeks[String(w)] = wr;
      rankings.awards[String(w)] = computeAwards(snap, w, boxes[w]);
      newWeeks.push(w);
      changed = true;
      log(status, `Computed week ${w} power rankings and awards`);
    } catch (e: any) {
      log(status, `Week ${w} compute failed: ${e?.message}`, false);
      break;
    }
  }
  if (changed) await db.set(KEYS.rankings, rankings);

  // Prior seasons (fetched once, used for head-to-head history)
  const history: { season: number; games: HistoryGame[] }[] = [];
  for (const s of [season - 3, season - 2, season - 1]) {
    let h = await db.get(KEYS.history(s));
    if (!h) {
      try {
        h = await fetchSeasonSchedule(creds, s);
        await db.set(KEYS.history(s), h);
      } catch {
        h = { season: s, teams: {}, games: [] };
        await db.set(KEYS.history(s), h);
      }
    }
    if (h?.games?.length) history.push(h);
  }

  try {
    const derived = computeDerived(snap, rankings, history);
    await db.set(KEYS.derived, derived);
  } catch (e: any) {
    log(status, `Derived data failed: ${e?.message}`, false);
  }

  for (const w of newWeeks) await announceWeek(snap, rankings.weeks[String(w)]);

  log(status, `Synced week ${snap.currentWeek}${newWeeks.length ? ` (+ closed week${newWeeks.length > 1 ? 's' : ''} ${newWeeks.join(', ')})` : ''}`);
  await db.set(KEYS.status, status);
  return { ok: true, message: 'ok', newWeeks };
}

async function announceWeek(snap: Snapshot, wr: WeekRankings) {
  const site = env('URL') ?? env('SITE_URL') ?? '';
  const name = (id: number) => snap.teams.find((t) => t.id === id)?.name ?? '—';
  const lines = wr.entries.map((e) => {
    const mv = e.prevRank === null ? '' : e.prevRank - e.rank > 0 ? ` ▲${e.prevRank - e.rank}` : e.prevRank - e.rank < 0 ? ` ▼${e.rank - e.prevRank}` : ' —';
    return `**${e.rank}.** ${name(e.teamId)}${mv}`;
  });
  await postDiscord(`📊 **Week ${wr.week} Power Rankings** are up${site ? ` — ${site}/power-rankings` : ''}\n${lines.join('\n')}`);
}
