export interface RosterPlayer {
  id: number;
  name: string;
  pos: string;
  proTeam: string;
  slot: string;
  slotId: number;
  starter: boolean;
  injuryStatus: string;
  acquisitionType: string;
  acquisitionDate: number | null;
  projWeek: number; // this scoring period's projection
  actualWeek: number; // this scoring period's actual so far
  seasonProj: number; // full-season projection
  seasonProjAvg: number; // projected per game
  seasonPts: number;
  percentOwned: number;
  adp: number | null;
  stats?: Record<string, number>; // this week's raw stat line (ESPN stat ids), when the player has played
}

export interface Team {
  id: number;
  name: string;
  abbrev: string;
  logo: string;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  streakType: string;
  streakLength: number;
  playoffSeed: number;
  espnRank: number;
  waiverRank: number;
  moves: number;
  trades: number;
  roster: RosterPlayer[];
}

export interface MatchupSide {
  teamId: number;
  points: number;
  live: number;
  projected: number;
  winProb?: number;
}

export interface Matchup {
  id: number;
  week: number;
  playoffTier: string;
  home: MatchupSide;
  away: MatchupSide | null;
  winner: 'HOME' | 'AWAY' | 'TIE' | 'UNDECIDED';
}

export interface Transaction {
  id: string;
  type: string;
  status: string;
  teamId: number;
  date: number;
  week: number;
  bid: number;
  items: { type: string; playerId: number; playerName: string; fromTeamId: number; toTeamId: number }[];
}

export interface DraftPick {
  overall: number;
  round: number;
  pick: number;
  teamId: number;
  playerId: number;
  name: string;
  pos: string;
  proTeam: string;
  autoDraft: boolean;
}

export interface Snapshot {
  fetchedAt: string;
  season: number;
  leagueName: string;
  currentWeek: number;
  currentMatchupPeriod: number;
  regularSeasonWeeks: number;
  finalWeek: number;
  playoffTeams: number;
  lineupSlots: Record<string, number>;
  teams: Team[];
  schedule: Matchup[];
  transactions: Transaction[];
  draft: DraftPick[];
  draftComplete: boolean;
}

export interface PoolPlayer {
  id: number;
  name: string;
  pos: string;
  proTeam: string;
  onTeamId: number;
  seasonProj: number;
  adp: number | null;
  percentOwned: number;
}

export interface BoxPlayer {
  id: number;
  name: string;
  pos: string;
  slotId: number;
  slot: string;
  starter: boolean;
  points: number;
  proTeam: string;
  proj?: number; // pre-game projection for the week
  injuryStatus?: string;
  stats?: Record<string, number>; // raw stat line (ESPN stat ids)
}

export interface BoxScore {
  week: number;
  teams: Record<string, { teamId: number; total: number; players: BoxPlayer[] }>;
}

export interface SyncStatus {
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  authExpired: boolean;
  authExpiredSince: string | null;
  cookieSource: 'env' | 'admin' | null;
  cookieUpdatedAt: string | null;
  log: { at: string; msg: string; ok: boolean }[];
}

export interface RankComponent {
  raw: number;
  scaled: number;
}

export interface RankEntry {
  teamId: number;
  rank: number;
  prevRank: number | null;
  score: number;
  components: Record<string, RankComponent>;
  draftPrior: number | null;
  draftWeight: number;
  blurb: string;
  grade?: string;
}

export interface WeekRankings {
  week: number;
  computedAt: string;
  entries: RankEntry[];
}

export interface Award {
  key: string;
  title: string;
  emoji: string;
  teamId: number;
  value: string;
  detail: string;
}

export interface Rankings {
  weeks: Record<string, WeekRankings>;
  awards: Record<string, Award[]>;
}

export interface DraftGrade {
  teamId: number;
  starterVor: number;
  benchVor: number;
  total: number;
  grade: string;
  rank: number;
  bestPick: { name: string; pos: string; overall: number; vor: number; delta: number } | null;
  worstPick: { name: string; pos: string; overall: number; vor: number; delta: number } | null;
}

export interface DraftRecap {
  computedAt: string;
  baselines: Record<string, { rank: number; points: number; player: string }>;
  grades: DraftGrade[];
  picks: (DraftPick & { proj: number; vor: number; expectedVor: number; delta: number; adp: number | null })[];
}

export interface StandingRow {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  allPlayWins: number;
  allPlayLosses: number;
  expectedWins: number;
  luck: number;
  ppg: number;
  seed: number;
  medianWins: number;
}

export interface Odds {
  teamId: number;
  playoff: number;
  bye: number;
  title: number;
  last: number;
  avgWins: number;
  avgSeed: number;
}

export interface Preview {
  matchupId: number;
  week: number;
  home: PreviewSide;
  away: PreviewSide | null;
  edge: number; // projected margin home - away
  gameOfWeek: boolean;
  series: { homeWins: number; awayWins: number; ties: number; lastMeeting: string | null };
}

export interface PreviewSide {
  teamId: number;
  record: string;
  ppg: number;
  projected: number;
  powerRank: number | null;
  keyPlayers: { name: string; pos: string; proj: number }[];
  questionable: string[];
}

export interface Derived {
  computedAt: string;
  standings: StandingRow[];
  odds: Odds[];
  previews: Preview[];
  completedWeeks: number[];
  simRuns: number;
}
