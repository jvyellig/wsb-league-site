/** Is any NFL game in progress right now? Uses ESPN's public scoreboard (no auth). */
export async function isGameLive(): Promise<{ live: boolean; inProgress: string[] }> {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { live: false, inProgress: [] };
    const data = await res.json();
    const inProgress: string[] = (data.events ?? [])
      .filter((e: any) => e.status?.type?.state === 'in')
      .map((e: any) => e.shortName ?? e.name);
    return { live: inProgress.length > 0, inProgress };
  } catch {
    return { live: false, inProgress: [] };
  }
}
