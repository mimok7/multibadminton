export type BracketMatch = {
  id: string;
  tournament_id?: string;
  next_match_id?: string | null;
  next_match_slot?: number | null;
  competition_phase?: string | null;
  competition_group_key?: string | null;
  team1?: string[] | null;
  team2?: string[] | null;
  winner?: 'team1' | 'team2' | 'draw' | null;
};

type TournamentMatchClient = {
  from: (table: 'tournament_matches') => any;
};

const hasPlayers = (team: string[] | null | undefined) => Array.isArray(team) && team.length > 0;

const getWinnerPlayers = (match: BracketMatch) => {
  if (match.winner === 'team1') return match.team1 || [];
  if (match.winner === 'team2') return match.team2 || [];
  return [];
};

export async function ensureBracketResultCanChange(
  supabase: TournamentMatchClient,
  match: BracketMatch
) {
  if (!match.next_match_id) return;

  const { data: nextMatch, error } = await supabase
    .from('tournament_matches')
    .select('status')
    .eq('id', match.next_match_id)
    .maybeSingle();

  if (error) throw error;
  if (nextMatch?.status === 'in_progress' || nextMatch?.status === 'completed') {
    throw new Error('다음 라운드가 이미 시작되어 이전 경기 결과를 변경할 수 없습니다.');
  }
}

export async function resolveKnockoutBye(supabase: TournamentMatchClient, matchId: string): Promise<void> {
  const { data: match, error } = await supabase
    .from('tournament_matches')
    .select('id, next_match_id, next_match_slot, team1, team2, winner, status')
    .eq('id', matchId)
    .maybeSingle();

  if (error || !match || match.status !== 'pending') return;

  const { data: feederMatches, error: feederError } = await supabase
    .from('tournament_matches')
    .select('status')
    .eq('next_match_id', match.id);

  if (feederError) throw feederError;
  if ((feederMatches || []).some((feeder: { status: string }) => feeder.status !== 'completed')) return;

  const team1 = (match.team1 || []) as string[];
  const team2 = (match.team2 || []) as string[];
  const byeWinner = hasPlayers(team1) && !hasPlayers(team2)
    ? 'team1'
    : hasPlayers(team2) && !hasPlayers(team1)
      ? 'team2'
      : null;

  if (!byeWinner && (hasPlayers(team1) || hasPlayers(team2))) return;

  const { data: completedMatch, error: completeError } = await supabase
    .from('tournament_matches')
    .update({ winner: byeWinner || 'draw', status: 'completed', score_team1: null, score_team2: null })
    .eq('id', match.id)
    .select('id, next_match_id, next_match_slot, team1, team2, winner')
    .single();

  if (completeError) throw completeError;
  if (byeWinner) {
    await advanceBracketWinner(supabase, completedMatch as BracketMatch);
  }
}

export async function advanceBracketWinner(
  supabase: TournamentMatchClient,
  match: BracketMatch
): Promise<void> {
  const winnerPlayers = getWinnerPlayers(match);
  if (winnerPlayers.length === 0) return;

  const { data: sourceTargets, error: sourceTargetsError } = await supabase
    .from('tournament_matches')
    .select('id, team1_source_match_id, team2_source_match_id')
    .or(`team1_source_match_id.eq.${match.id},team2_source_match_id.eq.${match.id}`);

  if (sourceTargetsError) throw sourceTargetsError;
  for (const target of sourceTargets || []) {
    const update: Record<string, unknown> = {};
    if (target.team1_source_match_id === match.id) update.team1 = winnerPlayers;
    if (target.team2_source_match_id === match.id) update.team2 = winnerPlayers;
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from('tournament_matches').update(update).eq('id', target.id);
      if (error) throw error;
    }
  }

  if (!match.next_match_id || (match.next_match_slot !== 1 && match.next_match_slot !== 2)) return;

  const slot = match.next_match_slot === 1 ? 'team1' : 'team2';
  const { data: nextMatch, error: nextMatchError } = await supabase
    .from('tournament_matches')
    .select('id, status')
    .eq('id', match.next_match_id)
    .maybeSingle();

  if (nextMatchError) throw nextMatchError;
  if (!nextMatch) throw new Error('다음 라운드 경기를 찾을 수 없습니다.');
  if (nextMatch.status === 'in_progress' || nextMatch.status === 'completed') {
    throw new Error('다음 라운드가 이미 시작되어 승자를 변경할 수 없습니다.');
  }

  const { error: updateError } = await supabase
    .from('tournament_matches')
    .update({
      [slot]: winnerPlayers,
      score_team1: null,
      score_team2: null,
      winner: null,
      status: 'pending',
    })
    .eq('id', match.next_match_id);

  if (updateError) throw updateError;
  await resolveKnockoutBye(supabase, match.next_match_id);
}

export async function advanceLeagueFinalists(
  supabase: TournamentMatchClient,
  match: BracketMatch
): Promise<void> {
  if (match.competition_phase !== 'ranking_league' || !match.tournament_id || !match.competition_group_key) return;

  const { data: leagueMatches, error: leagueError } = await supabase
    .from('tournament_matches')
    .select('id, status, team1, team2, score_team1, score_team2')
    .eq('tournament_id', match.tournament_id)
    .eq('competition_group_key', match.competition_group_key)
    .eq('competition_phase', 'ranking_league');
  if (leagueError) throw leagueError;
  if (!leagueMatches?.length || leagueMatches.some((leagueMatch: { status: string }) => leagueMatch.status !== 'completed')) return;

  const standings = new Map<string, { team: string[]; wins: number; difference: number; points: number }>();
  const keyOf = (team: string[]) => [...team].sort((left, right) => left.localeCompare(right, 'ko-KR')).join('\u0001');
  const record = (team: string[]) => {
    const key = keyOf(team);
    const current = standings.get(key) || { team, wins: 0, difference: 0, points: 0 };
    standings.set(key, current);
    return current;
  };

  for (const leagueMatch of leagueMatches) {
    const team1 = Array.isArray(leagueMatch.team1) ? leagueMatch.team1 : [];
    const team2 = Array.isArray(leagueMatch.team2) ? leagueMatch.team2 : [];
    const score1 = Number(leagueMatch.score_team1);
    const score2 = Number(leagueMatch.score_team2);
    if (!team1.length || !team2.length || !Number.isFinite(score1) || !Number.isFinite(score2)) return;

    const record1 = record(team1);
    const record2 = record(team2);
    record1.difference += score1 - score2;
    record2.difference += score2 - score1;
    record1.points += score1;
    record2.points += score2;
    if (score1 > score2) record1.wins += 1;
    if (score2 > score1) record2.wins += 1;
  }

  const finalists = [...standings.values()]
    .sort((left, right) => {
      const basicDifference = right.wins - left.wins || right.difference - left.difference || right.points - left.points;
      if (basicDifference !== 0) return basicDifference;

      const headToHead = leagueMatches.find((leagueMatch: { team1: string[]; team2: string[] }) =>
        (keyOf(leagueMatch.team1 || []) === keyOf(left.team) && keyOf(leagueMatch.team2 || []) === keyOf(right.team)) ||
        (keyOf(leagueMatch.team1 || []) === keyOf(right.team) && keyOf(leagueMatch.team2 || []) === keyOf(left.team))
      );
      if (headToHead) {
        const leftWasTeam1 = keyOf(headToHead.team1 || []) === keyOf(left.team);
        const leftScore = Number(leftWasTeam1 ? headToHead.score_team1 : headToHead.score_team2);
        const rightScore = Number(leftWasTeam1 ? headToHead.score_team2 : headToHead.score_team1);
        if (leftScore !== rightScore) return rightScore - leftScore;
      }
      return keyOf(left.team).localeCompare(keyOf(right.team), 'ko-KR');
    })
    .slice(0, 2);
  if (finalists.length < 2) return;

  const { data: finalMatch, error: finalError } = await supabase
    .from('tournament_matches')
    .select('id, status')
    .eq('tournament_id', match.tournament_id)
    .eq('competition_group_key', match.competition_group_key)
    .eq('competition_phase', 'ranking_final')
    .maybeSingle();
  if (finalError) throw finalError;
  if (!finalMatch || finalMatch.status === 'in_progress' || finalMatch.status === 'completed') return;

  const { error: updateError } = await supabase
    .from('tournament_matches')
    .update({ team1: finalists[0].team, team2: finalists[1].team, status: 'pending' })
    .eq('id', finalMatch.id);
  if (updateError) throw updateError;
}
