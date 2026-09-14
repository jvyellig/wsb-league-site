/**
 * AI weekly recaps. After a week closes (the sync has stored its box score, awards and rankings),
 * one Anthropic call writes a columnist-style recap of every matchup, grounded strictly in the
 * numbers we hand it — no web search, no invented stats. Stored in Blobs like the previews:
 * recaps/<season>/<week>.json, plus recaps/<season>/index.json for the archive page.
 *
 * Home-page takeover is state-driven (see recapTakeover()): the newest recap owns the home page
 * until the current week's previews are ready.
 */
import Anthropic from '@anthropic-ai/sdk';
import { db, env, getBox, getDerived, getRankings, getSnapshot, getStatus } from './store';
import type { Award, BoxPlayer, BoxScore, Matchup, Snapshot } from './types';
import { fmt1, statLine, teamById } from './format';
import { optimalLineup } from './lineup';
import { cleanText, getPreviewSet } from './previews';

export interface RecapPerformer {
  teamId: number;
  name: string;
  pos: string;
  points: number;
  proj: number | null;
  line: string;
}

export interface RecapMatchup {
  matchupId: number;
  homeId: number;
  awayId: number;
  homePts: number;
  awayPts: number;
  winnerId: number | null; // null = tie
  headline: string;
  blurb: string;
  keys: string[];
  performers: RecapPerformer[]; // computed, top scorers across both teams
}

export interface RecapCallout {
  key: 'top' | 'blowout' | 'close';
  title: string;
  emoji: string;
  teamId: number;
  value: string;
  detail: string;
  quip: string;
}

export interface Recap {
  season: number;
  week: number;
  status: 'running' | 'ready' | 'error';
  startedAt: string;
  finishedAt: string | null;
  model: string;
  error: string | null;
  headline: string;
  intro: string;
  matchups: RecapMatchup[];
  callouts: RecapCallout[];
  awards: Award[];
}

export interface RecapIndexEntry {
  week: number;
  headline: string;
  finishedAt: string;
}

export const recapKey = (season: number, week: number) => `recaps/${season}/${week}.json`;
export const recapIndexKey = (season: number) => `recaps/${season}/index.json`;
export const getRecap = (season: number, week: number, strong = false) => db.get<Recap>(recapKey(season, week), { strong });
export const getRecapIndex = async (season: number, strong = false): Promise<RecapIndexEntry[]> => (await db.get<RecapIndexEntry[]>(recapIndexKey(season), { strong })) ?? [];

const MODEL = () => env('ANTHROPIC_MODEL') || 'claude-sonnet-5';

/** The most recent finished recap for this season, if any. */
export async function latestRecap(season: number): Promise<Recap | null> {
  const index = await getRecapIndex(season);
  if (!index.length) return null;
  const newest = [...index].sort((a, b) => b.week - a.week)[0];
  const r = await getRecap(season, newest.week);
  return r && r.status === 'ready' && r.headline ? r : null;
}

/**
 * Should the home page show the recap instead of the normal content?
 * Yes when the newest recap covers the week that just finished and the current week's previews
 * aren't out yet. Purely state-driven — no days of the week involved.
 */
export async function recapTakeover(snap: Snapshot): Promise<Recap | null> {
  const recap = await latestRecap(snap.season);
  if (!recap) return null;
  if (recap.week !== snap.currentMatchupPeriod - 1) return null;
  const previews = await getPreviewSet(snap.season, snap.currentMatchupPeriod);
  const previewsOut = !!previews && previews.status === 'ready' && previews.previews.some((p) => p.body && !p.error);
  return previewsOut ? null : recap;
}

// ---------- facts ----------

function teamFacts(snap: Snapshot, box: BoxScore, teamId: number, week: number): string {
  const team = teamById(snap, teamId)!;
  const bt = box.teams[String(teamId)];
  if (!bt) return `${team.name}: no box score available.`;
  const starters = bt.players.filter((p) => p.starter).sort((a, b) => b.points - a.points);
  const bench = bt.players.filter((p) => !p.starter && p.slotId !== 21).sort((a, b) => b.points - a.points);
  const projTotal = starters.reduce((s, p) => s + (p.proj ?? 0), 0);
  const line = (p: BoxPlayer) => `${p.name} (${p.pos}${p.slot === 'FLEX' ? ', flex' : ''}) ${fmt1(p.points)}${p.proj !== undefined ? ` vs proj ${fmt1(p.proj)}` : ''}${statLine(p.pos, p.stats) ? ` — ${statLine(p.pos, p.stats)}` : ''}`;
  const valued = bt.players.filter((p) => p.slotId !== 21).map((p) => ({ ...p, value: p.points }));
  const opt = optimalLineup(valued, snap.lineupSlots);
  const gap = opt.total - bt.total;
  let blunder = '';
  if (gap > 0.05) {
    const benched = bench.filter((p) => opt.starters.some((s) => s.id === p.id))[0];
    const started = starters.filter((p) => !opt.starters.some((s) => s.id === p.id)).sort((a, b) => a.points - b.points)[0];
    blunder = `Left ${fmt1(gap)} points on the bench (optimal lineup ${fmt1(opt.total)})${benched && started ? `: benched ${benched.name} (${fmt1(benched.points)}) while starting ${started.name} (${fmt1(started.points)})` : ''}.`;
  } else blunder = 'Started the optimal lineup.';
  const out = [
    `${team.name} (${team.abbrev}) — ${fmt1(bt.total)} points${projTotal ? ` (starters were projected for ${fmt1(projTotal)})` : ''}. Record after week ${week}: ${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}.`,
    `Starters: ` + starters.map(line).join('; '),
    `Bench: ` + (bench.length ? bench.map((p) => `${p.name} (${p.pos}) ${fmt1(p.points)}`).join('; ') : 'none'),
    blunder,
  ];
  return out.join('\n');
}

function performers(box: BoxScore, ids: number[], n = 4): RecapPerformer[] {
  const all: RecapPerformer[] = [];
  for (const id of ids) {
    const bt = box.teams[String(id)];
    if (!bt) continue;
    for (const p of bt.players) if (p.starter) all.push({ teamId: id, name: p.name, pos: p.pos, points: p.points, proj: p.proj ?? null, line: statLine(p.pos, p.stats) });
  }
  return all.sort((a, b) => b.points - a.points).slice(0, n);
}

function buildPrompt(snap: Snapshot, week: number, box: BoxScore, matchups: Matchup[], awards: Award[], rankMoves: string): string {
  const name = (id: number) => teamById(snap, id)?.name ?? '?';
  const parts: string[] = [];
  parts.push(`LEAGUE: WSB Generations League — 12-team ESPN fantasy football league of longtime friends, half-PPR. Season ${snap.season}. This recap covers WEEK ${week}, which is complete.`);
  const results = matchups.map((m) => {
    const hp = m.home.points, ap = m.away!.points;
    const w = m.winner === 'TIE' ? 'TIE' : m.winner === 'HOME' ? name(m.home.teamId) : name(m.away!.teamId);
    return `Matchup ${m.id}: ${name(m.home.teamId)} ${fmt1(hp)} – ${name(m.away!.teamId)} ${fmt1(ap)} (winner: ${w}, margin ${fmt1(Math.abs(hp - ap))})`;
  });
  parts.push(`RESULTS:\n` + results.join('\n'));
  parts.push(`AWARDS (already computed from the data — use them):\n` + awards.map((a) => `${a.title}: ${name(a.teamId)} — ${a.value} — ${a.detail}`).join('\n'));
  if (rankMoves) parts.push(`POWER RANKING MOVES AFTER THIS WEEK:\n${rankMoves}`);
  for (const m of matchups) {
    parts.push(`=== MATCHUP ${m.id}: ${name(m.home.teamId)} vs ${name(m.away!.teamId)} ===\n${teamFacts(snap, box, m.home.teamId, week)}\n\n${teamFacts(snap, box, m.away!.teamId, week)}`);
  }
  return parts.join('\n\n');
}

const SYSTEM = `You are the resident columnist for the WSB Generations League, a 12-team fantasy football league of longtime friends. Every week you write the league's recap. Your voice: fun, confident, a little biting — a beat writer who has watched these teams for years and has no patience for a bad lineup decision. Playful trash talk is encouraged: roast teams for blowing games, benching the wrong guy, riding a lucky bounce, or scoring like a JV squad. Keep it in the spirit of friends ribbing each other — never mean about the actual people behind the teams, and never comment on anyone's personal life. Refer to teams by their team names, not owner names.

You will receive the complete data for the week: every final score, every starter's points and stat line, projections, bench points, lineup mistakes, and the week's awards. THIS DATA IS THE ONLY SOURCE OF TRUTH. Every number, stat, and player performance you mention must appear in the data exactly as given. Do not invent stats, do not round differently, do not describe NFL games or plays you cannot see in the data, and do not speculate about injuries. If you want to say a player "went off", say it with his actual line.

Output (send via the submit_recap tool):
- headline: punchy, 4–10 words, capturing the week's biggest storyline. No trailing period.
- intro: 60–110 words setting up the week — the storyline, the standout result, the shame.
- matchups: one entry per matchup, in the order given, each with:
  - matchupId (copy exactly)
  - headline: 3–8 words
  - blurb: 70–120 words — the final score, who carried the winner (with actual stats), what sank the loser, and the turning point.
  - keys: 2–3 short phrases (under 12 words each) naming what decided the game — a boom, a bust, a bench blunder, a lucky break, a bad start-sit call.
- callouts: one sentence of commentary (under 30 words) for each of: top (the week's high score), blowout (the biggest margin), close (the closest game). The numbers are already known; your job is the color.
Plain prose only: no markdown, no bullet characters, no citation tags.`;

const SUBMIT_TOOL: Anthropic.Tool = {
  name: 'submit_recap',
  description: 'Submit the finished weekly recap. Call this exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string' },
      intro: { type: 'string' },
      matchups: {
        type: 'array',
        items: {
          type: 'object',
          properties: { matchupId: { type: 'number' }, headline: { type: 'string' }, blurb: { type: 'string' }, keys: { type: 'array', items: { type: 'string' } } },
          required: ['matchupId', 'headline', 'blurb', 'keys'],
        },
      },
      callouts: {
        type: 'object',
        properties: { top: { type: 'string' }, blowout: { type: 'string' }, close: { type: 'string' } },
        required: ['top', 'blowout', 'close'],
      },
    },
    required: ['headline', 'intro', 'matchups', 'callouts'],
  },
};

/** Turn the model's submit_recap input into the stored shape, with all numbers taken from our own data. Returns null if empty. */
export function assembleRecap(snap: Snapshot, week: number, box: BoxScore, matchups: Matchup[], awards: Award[], input: any): Pick<Recap, 'headline' | 'intro' | 'matchups' | 'callouts'> | null {
  const byId = new Map<number, any>();
  for (const m of input?.matchups ?? []) byId.set(Number(m?.matchupId), m);
  const recapMatchups: RecapMatchup[] = matchups.map((m) => {
    const w = byId.get(m.id) ?? {};
    return {
      matchupId: m.id,
      homeId: m.home.teamId,
      awayId: m.away!.teamId,
      homePts: m.home.points,
      awayPts: m.away!.points,
      winnerId: m.winner === 'TIE' ? null : m.winner === 'HOME' ? m.home.teamId : m.away!.teamId,
      headline: cleanText(w.headline).replace(/\.$/, ''),
      blurb: cleanText(w.blurb),
      keys: (Array.isArray(w.keys) ? w.keys : []).map((k: any) => cleanText(k)).filter(Boolean).slice(0, 3),
      performers: performers(box, [m.home.teamId, m.away!.teamId]),
    };
  });
  const calloutFor = (key: RecapCallout['key'], awardKey: string, quip: string): RecapCallout | null => {
    const a = awards.find((x) => x.key === awardKey);
    return a ? { key, title: a.title, emoji: a.emoji, teamId: a.teamId, value: a.value, detail: a.detail, quip: cleanText(quip) } : null;
  };
  const callouts = [calloutFor('top', 'top', input?.callouts?.top), calloutFor('blowout', 'blowout', input?.callouts?.blowout), calloutFor('close', 'close', input?.callouts?.close)].filter((c): c is RecapCallout => !!c);
  const headline = cleanText(input?.headline).replace(/\.$/, '');
  const intro = cleanText(input?.intro);
  if (!headline || !intro || recapMatchups.every((m) => !m.blurb)) return null;
  return { headline, intro, matchups: recapMatchups, callouts };
}

// ---------- generation ----------

export interface RecapResult {
  ok: boolean;
  week: number;
  skipped?: string;
  error?: string;
}

async function saveIndex(season: number, entry: RecapIndexEntry) {
  const index = (await getRecapIndex(season, true)).filter((e) => e.week !== entry.week);
  index.push(entry);
  index.sort((a, b) => a.week - b.week);
  await db.set(recapIndexKey(season), index);
}

/**
 * Write the recap for `week` (default: the most recently completed week).
 * `auto` = scheduled run: skips quietly when that week's recap already exists.
 * Fails gracefully (status: error, nothing shown on the site) when the week hasn't closed or ESPN
 * access is broken.
 */
export async function generateRecap(opts: { week?: number; auto?: boolean } = {}): Promise<RecapResult> {
  const startedAt = new Date().toISOString();
  const [snap, status, derived, rankings] = await Promise.all([getSnapshot(), getStatus(true), getDerived(), getRankings(true)]);
  if (!snap) return { ok: false, week: 0, error: 'No league data yet — run an ESPN sync first.' };
  const completed = derived?.completedWeeks ?? [];
  const week = opts.week && opts.week > 0 ? opts.week : completed.length ? Math.max(...completed) : 0;
  if (!week) return { ok: false, week: 0, skipped: 'No completed week yet.' };
  const key = recapKey(snap.season, week);
  const previous = await db.get<Recap>(key, { strong: true });
  if (opts.auto && previous?.status === 'ready' && previous.headline) return { ok: true, week, skipped: 'Recap already exists.' };

  const fail = async (error: string): Promise<RecapResult> => {
    // Keep a good previous copy visible; only overwrite a missing/failed one.
    if (!(previous?.status === 'ready' && previous.headline)) {
      await db.set(key, { season: snap.season, week, status: 'error', startedAt, finishedAt: new Date().toISOString(), model: MODEL(), error, headline: '', intro: '', matchups: [], callouts: [], awards: [] } satisfies Recap);
    }
    return { ok: false, week, error };
  };
  if (status.authExpired) return fail('ESPN cookie has expired — refresh it on /admin, then regenerate.');
  if (!completed.includes(week)) return fail(`Week ${week} hasn't closed on ESPN yet.`);
  if (!env('ANTHROPIC_API_KEY')) return fail("ANTHROPIC_API_KEY is not set in the site's environment variables.");
  const box = await getBox(week);
  if (!box || !Object.keys(box.teams).length) return fail(`No box score stored for week ${week} yet — the next ESPN sync should add it.`);
  const matchups = snap.schedule.filter((m) => m.week === week && m.away && m.winner !== 'UNDECIDED');
  if (!matchups.length) return fail(`No finished matchups found for week ${week}.`);
  const awards = rankings.awards[String(week)] ?? [];
  const wr = rankings.weeks[String(week)];
  const rankMoves = wr
    ? wr.entries
        .filter((e) => e.prevRank && e.prevRank !== e.rank)
        .map((e) => `${teamById(snap, e.teamId)?.name}: #${e.prevRank} → #${e.rank}`)
        .join('; ')
    : '';

  await db.set(key, { ...(previous?.status === 'ready' && previous.headline ? previous : { headline: '', intro: '', matchups: [], callouts: [], awards: [] }), season: snap.season, week, status: 'running', startedAt, finishedAt: null, model: MODEL(), error: null } as Recap);

  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), maxRetries: 4 });
  const prompt = buildPrompt(snap, week, box, matchups, awards, rankMoves);
  let input: any = null;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2 && !input; attempt++) {
    try {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${prompt}\n\nWrite the week ${week} recap and submit it with submit_recap.` }];
      for (let turn = 0; turn < 2 && !input; turn++) {
        const res = await client.messages.create({ model: MODEL(), max_tokens: 7000, system: SYSTEM, tools: [SUBMIT_TOOL], messages }, { timeout: 240_000 });
        const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_recap');
        if (call) input = call.input;
        else if (res.stop_reason === 'max_tokens') throw new Error('Model ran out of room before submitting.');
        else {
          messages.push({ role: 'assistant', content: res.content as any });
          messages.push({ role: 'user', content: 'Now submit the recap with the submit_recap tool.' });
        }
      }
      if (!input) throw new Error('Model never called submit_recap.');
    } catch (e: any) {
      lastErr = e;
      console.error(`recap attempt ${attempt + 1} failed:`, e?.message ?? e);
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
  if (!input) return fail(lastErr?.status ? `${lastErr.status} ${lastErr?.message ?? ''}`.trim() : (lastErr?.message ?? 'Generation failed.'));

  const assembled = assembleRecap(snap, week, box, matchups, awards, input);
  if (!assembled) return fail('Model submitted an empty recap.');

  const finishedAt = new Date().toISOString();
  const recap: Recap = { ...assembled, season: snap.season, week, status: 'ready', startedAt, finishedAt, model: MODEL(), error: null, awards };
  const headline = recap.headline;
  await db.set(key, recap);
  await saveIndex(snap.season, { week, headline, finishedAt });
  return { ok: true, week };
}

/** Kick off the background generator over HTTP (returns as soon as Netlify accepts the job). */
export async function triggerRecap(opts: { week?: number; auto?: boolean } = {}): Promise<{ ok: boolean; status: number; error?: string }> {
  const base = (env('URL') || env('DEPLOY_PRIME_URL') || 'https://wsbgenerations.com').replace(/\/$/, '');
  const key = env('ADMIN_PASSPHRASE') ?? '';
  if (!key) return { ok: false, status: 0, error: 'ADMIN_PASSPHRASE is not set.' };
  try {
    const res = await fetch(`${base}/.netlify/functions/recap-background`, { method: 'POST', headers: { 'x-admin-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ week: opts.week ?? null, auto: !!opts.auto }) });
    const ok = res.status === 202 || res.ok;
    return { ok, status: res.status, error: ok ? undefined : `Background function returned ${res.status}.` };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message ?? String(e) };
  }
}

/** For local inspection: the exact data prompt a week's recap would get. */
export async function debugRecapPrompt(week: number): Promise<string> {
  const [snap, rankings, box] = await Promise.all([getSnapshot(), getRankings(), getBox(week)]);
  if (!snap || !box) return 'no snapshot/box';
  const matchups = snap.schedule.filter((m) => m.week === week && m.away && m.winner !== 'UNDECIDED');
  return buildPrompt(snap, week, box, matchups, rankings.awards[String(week)] ?? [], '');
}
