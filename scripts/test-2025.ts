// Exercise the weekly pipeline against last season's completed schedule.
import fs from 'node:fs';
import { normalizeLeague } from '../src/lib/espn';
import { completedWeeks, computeWeekRankings } from '../src/lib/rankings';
import { computeAwards, computeStandings, simulateSeason } from '../src/lib/analytics';
import type { Rankings } from '../src/lib/types';
const raw = JSON.parse(fs.readFileSync(process.env.SP + '/espn2025.json', 'utf8'));
const snap = normalizeLeague(raw);
snap.currentMatchupPeriod = 15;
const weeks = completedWeeks(snap);
console.log('completed weeks', weeks, 'teams', snap.teams.map(t=>t.name).join(', '));
const rankings: Rankings = { weeks: {}, awards: {} };
for (const w of weeks) {
  rankings.weeks[String(w)] = computeWeekRankings(snap, w, {}, rankings);
  rankings.awards[String(w)] = computeAwards(snap, w, null);
}
const last = rankings.weeks[String(weeks[weeks.length-1])];
for (const e of last.entries) console.log(e.rank, snap.teams.find(t=>t.id===e.teamId)!.name, e.score, e.prevRank, JSON.stringify(e.components), '\n   ', e.blurb);
console.log(rankings.awards['5']);
console.table(computeStandings(snap, weeks).map(s=>({...s, name: snap.teams.find(t=>t.id===s.teamId)!.name})));
console.time('sim'); const odds = simulateSeason(snap, weeks.slice(0,6)); console.timeEnd('sim');
console.table(odds.map(o=>({...o, name: snap.teams.find(t=>t.id===o.teamId)!.name})));
