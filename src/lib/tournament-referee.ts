export type TournamentRefereeMatch = {
  id?: string | null;
  tournament_id?: string | null;
  round?: number | null;
  match_number?: number | null;
  team1?: string[] | null;
  team2?: string[] | null;
  court?: string | null;
  scheduled_time?: string | null;
  status?: string | null;
  winner?: 'team1' | 'team2' | 'draw' | string | null;
  referee_name?: string | null;
};

export function getRefereePlayerName(name: string) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export function getRefereePlayerKey(name: string) {
  return getRefereePlayerName(name).replace(/\s+/g, '').toLowerCase();
}

export function getMatchPlayerNames(match: TournamentRefereeMatch) {
  return [...(match.team1 || []), ...(match.team2 || [])]
    .map(getRefereePlayerName)
    .filter(Boolean);
}

function getScheduleKey(match: TournamentRefereeMatch) {
  return match.scheduled_time?.trim().slice(0, 19) || '';
}

function compareFallbackOrder(left: TournamentRefereeMatch, right: TournamentRefereeMatch) {
  const roundDifference = (left.round || 1) - (right.round || 1);
  if (roundDifference !== 0) return roundDifference;
  return (left.match_number || 0) - (right.match_number || 0);
}

function isBeforeTarget(candidate: TournamentRefereeMatch, target: TournamentRefereeMatch) {
  const candidateTime = getScheduleKey(candidate);
  const targetTime = getScheduleKey(target);

  if (candidateTime && targetTime) {
    return candidateTime < targetTime;
  }

  return candidate.tournament_id === target.tournament_id && compareFallbackOrder(candidate, target) < 0;
}

export function findPreviousCourtMatch<T extends TournamentRefereeMatch>(target: T, dayMatches: T[]) {
  const candidates = dayMatches.filter((candidate) =>
    candidate.id !== target.id &&
    Boolean(target.court) &&
    candidate.court === target.court &&
    isBeforeTarget(candidate, target)
  );

  return candidates.sort((left, right) => {
    const leftTime = getScheduleKey(left);
    const rightTime = getScheduleKey(right);
    if (leftTime && rightTime && leftTime !== rightTime) {
      return rightTime.localeCompare(leftTime);
    }
    return compareFallbackOrder(right, left);
  })[0] || null;
}

export function getSameTimePlayerKeys(target: TournamentRefereeMatch, dayMatches: TournamentRefereeMatch[]) {
  const targetTime = getScheduleKey(target);
  const sameTimeMatches = targetTime
    ? dayMatches.filter((match) => getScheduleKey(match) === targetTime)
    : [target];

  return new Set(
    sameTimeMatches.flatMap(getMatchPlayerNames).map(getRefereePlayerKey).filter(Boolean)
  );
}

export function getAutomaticRefereeName(
  target: TournamentRefereeMatch,
  dayMatches: TournamentRefereeMatch[]
) {
  if (target.referee_name?.trim()) return target.referee_name.trim();

  const previousMatch = findPreviousCourtMatch(target, dayMatches);
  if (!previousMatch || previousMatch.status !== 'completed') return null;

  const winningPlayers = previousMatch.winner === 'team1'
    ? previousMatch.team1 || []
    : previousMatch.winner === 'team2'
      ? previousMatch.team2 || []
      : [];
  const sameTimePlayers = getSameTimePlayerKeys(target, dayMatches);
  const availableWinners = winningPlayers
    .map(getRefereePlayerName)
    .filter(Boolean)
    .filter((name) => !sameTimePlayers.has(getRefereePlayerKey(name)));

  return availableWinners.length > 0 ? Array.from(new Set(availableWinners)).join(', ') : null;
}

export async function fetchTournamentDayMatches(
  client: any,
  tournamentId: string,
  clubId?: string | null
): Promise<TournamentRefereeMatch[]> {
  let tournamentQuery = client
    .from('tournaments')
    .select('id, tournament_date')
    .eq('id', tournamentId);
  if (clubId) tournamentQuery = tournamentQuery.eq('club_id', clubId);

  const { data: tournament, error: tournamentError } = await tournamentQuery.maybeSingle();
  if (tournamentError || !tournament?.tournament_date) return [];

  let tournamentsQuery = client
    .from('tournaments')
    .select('id')
    .eq('tournament_date', tournament.tournament_date);
  if (clubId) tournamentsQuery = tournamentsQuery.eq('club_id', clubId);

  const { data: sameDayTournaments, error: tournamentsError } = await tournamentsQuery;
  if (tournamentsError || !sameDayTournaments?.length) return [];

  const tournamentIds = sameDayTournaments.map((item: { id: string }) => item.id);
  const { data: dayMatches, error: matchesError } = await client
    .from('tournament_matches')
    .select('id, tournament_id, round, match_number, team1, team2, court, scheduled_time, status, winner, referee_name')
    .in('tournament_id', tournamentIds);

  return matchesError ? [] : (dayMatches || []) as TournamentRefereeMatch[];
}
