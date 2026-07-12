import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';

type TeamAssignmentRow = {
  id: string;
  assignment_date: string;
  round_number: number;
  title: string;
  team_type: string | null;
  racket_team: unknown;
  shuttle_team: unknown;
  team1: unknown;
  team2: unknown;
  team3: unknown;
  team4: unknown;
  pairs_data: unknown;
};

type TournamentRow = {
  id: string;
  title: string;
  tournament_date: string;
  round_number: number;
  team_assignment_id: string | null;
  match_type: string | null;
  team_type: string | null;
  total_teams: number | null;
  matches_per_player: number | null;
  created_at: string;
};

type MatchRow = {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[] | null;
  team2: string[] | null;
  court: string | null;
  scheduled_time: string | null;
  status: string | null;
  score_team1: number | null;
  score_team2: number | null;
  winner: 'team1' | 'team2' | 'draw' | null;
};

type TournamentMetrics = {
  matchCount: number;
  teamCount: number;
  playerCount: number;
  roundCount: number;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const toPairsRecord = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => [key, toStringArray(raw)])
  );
};

const extractSkillLevel = (nameWithLevel: string) => {
  const match = nameWithLevel.match(/\(([^)]+)\)(?!.*\()$/);
  return match ? match[1].toLowerCase().trim() : 'e2';
};

const getTeamKey = (players: string[]) =>
  [...players].map((player) => player.trim()).sort((left, right) => left.localeCompare(right, 'ko-KR')).join(' / ');

function isResultMatch(match: MatchRow) {
  return match.status === 'completed';
}

function normalizeMatches(data: MatchRow[]) {
  return (data || [])
    .map((match) => ({
      ...match,
      team1: toStringArray(match.team1),
      team2: toStringArray(match.team2),
      court: match.court || '',
      scheduled_time: match.scheduled_time || null,
      status: match.status || 'pending',
      score_team1: match.score_team1 ?? null,
      score_team2: match.score_team2 ?? null,
      winner: match.winner ?? null,
    }))
    .sort((left, right) => {
      const roundDiff = (left.round || 0) - (right.round || 0);
      if (roundDiff !== 0) {
        return roundDiff;
      }

      return (left.match_number || 0) - (right.match_number || 0);
    });
}

function getTournamentMetricsFromMatches(tournamentMatches: MatchRow[]): TournamentMetrics {
  const normalizedMatches = normalizeMatches(tournamentMatches);
  const uniqueTeams = new Set<string>();
  const uniquePlayers = new Set<string>();
  const uniqueRounds = new Set<number>();

  normalizedMatches.forEach((match) => {
    if (match.round) {
      uniqueRounds.add(match.round);
    }

    const team1 = match.team1.filter(Boolean);
    const team2 = match.team2.filter(Boolean);

    if (team1.length > 0) {
      uniqueTeams.add(getTeamKey(team1));
      team1.forEach((player) => uniquePlayers.add(player));
    }

    if (team2.length > 0) {
      uniqueTeams.add(getTeamKey(team2));
      team2.forEach((player) => uniquePlayers.add(player));
    }
  });

  return {
    matchCount: normalizedMatches.length,
    teamCount: uniqueTeams.size,
    playerCount: uniquePlayers.size,
    roundCount: uniqueRounds.size,
  };
}

async function fetchTeamAssignment(assignmentId: string | null | undefined) {
  if (!assignmentId) {
    return null;
  }

  const adminSupabase = await getFilteredAdminClient();
  const { data, error } = await adminSupabase
    .from('team_assignments')
    .select('id, assignment_date, round_number, title, team_type, racket_team, shuttle_team, team1, team2, team3, team4, pairs_data')
    .eq('id', assignmentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    ...data,
    racket_team: toStringArray(data.racket_team),
    shuttle_team: toStringArray(data.shuttle_team),
    team1: toStringArray(data.team1),
    team2: toStringArray(data.team2),
    team3: toStringArray(data.team3),
    team4: toStringArray(data.team4),
    pairs_data: toPairsRecord(data.pairs_data),
  };
}

async function fetchTeamAssignmentsByTournament(tournaments: TournamentRow[]) {
  const assignmentIds = Array.from(
    new Set(tournaments.map((t) => t.team_assignment_id).filter((id): id is string => typeof id === 'string'))
  );

  if (assignmentIds.length === 0) {
    return {};
  }

  const adminSupabase = await getFilteredAdminClient();
  const { data, error } = await adminSupabase
    .from('team_assignments')
    .select('id, assignment_date, round_number, title, team_type, racket_team, shuttle_team, team1, team2, team3, team4, pairs_data')
    .in('id', assignmentIds);

  if (error || !data) {
    return {};
  }

  const assignmentMap = new Map(
    data.map((row) => [
      row.id,
      {
        ...row,
        racket_team: toStringArray(row.racket_team),
        shuttle_team: toStringArray(row.shuttle_team),
        team1: toStringArray(row.team1),
        team2: toStringArray(row.team2),
        team3: toStringArray(row.team3),
        team4: toStringArray(row.team4),
        pairs_data: toPairsRecord(row.pairs_data),
      },
    ])
  );

  const entries = tournaments.map((tournament) => {
    const assignment = tournament.team_assignment_id
      ? (assignmentMap.get(tournament.team_assignment_id) || null)
      : null;
    return [tournament.id, assignment] as const;
  });

  return Object.fromEntries(entries);
}

function avoidConsecutiveMatches(
  matches: any[],
  courtCount: number,
  baseDate: string,
  sTime: string,
  interval: number
): any[] {
  if (matches.length <= 1) return matches;
  const C = courtCount > 0 ? courtCount : 4;

  const remaining = [...matches];
  const scheduled: any[] = [];
  const slotPlayers: Set<string>[] = [];

  let currentSlotIndex = 0;
  slotPlayers[0] = new Set<string>();

  while (remaining.length > 0) {
    const currentSlotMatches = scheduled.filter((_, idx) => Math.floor(idx / C) === currentSlotIndex);
    if (currentSlotMatches.length >= C) {
      currentSlotIndex += 1;
      slotPlayers[currentSlotIndex] = new Set<string>();
    }

    const prevSlotPlayers = currentSlotIndex > 0 ? slotPlayers[currentSlotIndex - 1] : new Set<string>();
    const currentSlotPlayers = slotPlayers[currentSlotIndex];

    let bestIndex = -1;
    let bestPenalty = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const match = remaining[i];
      const matchPlayers = [...match.team1, ...match.team2];
      
      let penalty = 0;

      const overlapsCurrent = matchPlayers.some(p => currentSlotPlayers.has(p));
      if (overlapsCurrent) {
        continue;
      }

      const overlapsPreviousCount = matchPlayers.filter(p => prevSlotPlayers.has(p)).length;
      penalty += overlapsPreviousCount * 1000;

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      currentSlotIndex += 1;
      slotPlayers[currentSlotIndex] = new Set<string>();
      continue;
    }

    const [selectedMatch] = remaining.splice(bestIndex, 1);
    scheduled.push(selectedMatch);

    const matchPlayers = [...selectedMatch.team1, ...selectedMatch.team2];
    matchPlayers.forEach(p => {
      slotPlayers[currentSlotIndex].add(p);
    });
  }

  return scheduled.map((match, idx) => {
    const matchNumber = idx + 1;
    const courtNum = (idx % C) + 1;
    const round = Math.floor(idx / C) + 1;

    // 시작시간 및 라운드(round)당 간격(interval)씩 증가
    const [startHour, startMin] = (sTime || '09:00').split(':').map(Number);
    const totalMins = startHour * 60 + startMin + (round - 1) * (interval || 10);
    const hour = Math.floor(totalMins / 60);
    const min = totalMins % 60;
    const hourStr = String(hour).padStart(2, '0');
    const minStr = String(min).padStart(2, '0');
    const scheduledTime = `${baseDate || '2026-07-01'}T${hourStr}:${minStr}:00`;

    return {
      ...match,
      match_number: matchNumber,
      court: `${courtNum}코트`,
      round: round,
      scheduled_time: scheduledTime,
    };
  });
}

async function recoverTournamentMatches(tournament: TournamentRow) {
  if (!tournament.team_assignment_id) {
    return { recovered: false };
  }

  const adminSupabase = await getFilteredAdminClient();
  const { data: assignment, error: assignmentError } = await adminSupabase
    .from('team_assignments')
    .select('id, assignment_date, round_number, title, team_type, racket_team, shuttle_team, team1, team2, team3, team4, pairs_data')
    .eq('id', tournament.team_assignment_id)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return { recovered: false };
  }

  const assignmentRow = assignment as TeamAssignmentRow;
  const playerList: string[] = [];

  if (assignmentRow.team_type === 'pairs') {
    Object.values(toPairsRecord(assignmentRow.pairs_data)).forEach((players) => {
      playerList.push(...players);
    });
  } else {
    playerList.push(...toStringArray(assignmentRow.racket_team));
    playerList.push(...toStringArray(assignmentRow.shuttle_team));
  }

  const uniquePlayers = [...new Set(playerList)]
    .filter((player) => player && typeof player === 'string')
    .map((player) => player.trim());

  if (uniquePlayers.length < 4) {
    return { recovered: false };
  }

  const minGamesPerPlayer = Math.max(1, tournament.matches_per_player || 1);
  const isMultiTeam = assignmentRow.team_type === '2teams' ||
                      (assignmentRow.racket_team && toStringArray(assignmentRow.racket_team).length > 0 &&
                       assignmentRow.shuttle_team && toStringArray(assignmentRow.shuttle_team).length > 0);

  let matchesToInsert: any[] = [];

  if (isMultiTeam) {
    const racketPlayers = toStringArray(assignmentRow.racket_team).map(p => p.trim()).filter(Boolean);
    const shuttlePlayers = toStringArray(assignmentRow.shuttle_team).map(p => p.trim()).filter(Boolean);

    if (racketPlayers.length >= 2 && shuttlePlayers.length >= 2) {
      const playerMatchCount: Record<string, number> = {};
      [...racketPlayers, ...shuttlePlayers].forEach(p => playerMatchCount[p] = 0);

      let currentMatchNumber = 1;

      for (let round = 1; round <= minGamesPerPlayer; round += 1) {
        const makePairs = (pool: string[]) => {
          const sorted = [...pool].sort((a, b) => {
            const aCount = playerMatchCount[a] || 0;
            const bCount = playerMatchCount[b] || 0;
            if (aCount !== bCount) return aCount - bCount;
            return Math.random() - 0.5;
          });

          const pairs: string[][] = [];
          const avail = [...sorted];
          while (avail.length >= 2) {
            pairs.push([avail.shift()!, avail.shift()!]);
          }
          return pairs;
        };

        const racketPairs = makePairs(racketPlayers);
        const shuttlePairs = makePairs(shuttlePlayers);

        const minPairs = Math.min(racketPairs.length, shuttlePairs.length);
        for (let i = 0; i < minPairs; i++) {
          const team1 = racketPairs[i];
          const team2 = shuttlePairs[i];

          matchesToInsert.push({
            tournament_id: tournament.id,
            round,
            match_number: currentMatchNumber,
            team1,
            team2,
            court: `Court ${((currentMatchNumber - 1) % 4) + 1}`,
            status: 'pending' as const,
            scheduled_time: null,
            score_team1: null,
            score_team2: null,
            winner: null,
          });

          [...team1, ...team2].forEach(p => {
            playerMatchCount[p] = (playerMatchCount[p] || 0) + 1;
          });

          currentMatchNumber += 1;
        }
      }

      // 목표 경기수 미달 선수 구제 로직 (Multi-team 버전)
      const maxTotalMatches = Math.ceil((([...racketPlayers, ...shuttlePlayers].length) * minGamesPerPlayer) / 4);
      while (matchesToInsert.length < maxTotalMatches) {
        const unplayedRacket = racketPlayers.filter(p => (playerMatchCount[p] || 0) < minGamesPerPlayer);
        const unplayedShuttle = shuttlePlayers.filter(p => (playerMatchCount[p] || 0) < minGamesPerPlayer);

        if (unplayedRacket.length === 0 && unplayedShuttle.length === 0) {
          break;
        }

        const getPair = (pool: string[]) => {
          const sorted = [...pool].sort((a, b) => {
            const aCount = playerMatchCount[a] || 0;
            const bCount = playerMatchCount[b] || 0;
            const aIsUnplayed = aCount < minGamesPerPlayer ? 1 : 0;
            const bIsUnplayed = bCount < minGamesPerPlayer ? 1 : 0;
            if (aIsUnplayed !== bIsUnplayed) return bIsUnplayed - aIsUnplayed;
            return aCount - bCount;
          });
          return sorted.slice(0, 2);
        };

        const team1 = getPair(racketPlayers);
        const team2 = getPair(shuttlePlayers);

        if (team1.length < 2 || team2.length < 2) {
          break;
        }

        matchesToInsert.push({
          tournament_id: tournament.id,
          round: minGamesPerPlayer + 1,
          match_number: currentMatchNumber,
          team1,
          team2,
          court: `Court ${((currentMatchNumber - 1) % 4) + 1}`,
          status: 'pending' as const,
          scheduled_time: null,
          score_team1: null,
          score_team2: null,
          winner: null,
        });

        [...team1, ...team2].forEach(p => {
          playerMatchCount[p] = (playerMatchCount[p] || 0) + 1;
        });

        currentMatchNumber += 1;
      }
    }
  } else {
    const players = uniquePlayers.map((name, index) => ({
      id: `recover-${tournament.id}-${index}`,
      name,
      skill_level: extractSkillLevel(name),
      skill_label: extractSkillLevel(name).toUpperCase(),
      skill_code: extractSkillLevel(name),
      gender: 'mixed' as const,
    }));

    const { createBalancedDoublesMatches, createMixedAndSameSexDoublesMatches, createRandomBalancedDoublesMatches } = await import('@/utils/match-utils');

    let generatedMatches;
    if (tournament.match_type === 'level_based') {
      generatedMatches = createBalancedDoublesMatches(players, minGamesPerPlayer);
    } else if (tournament.match_type === 'mixed_doubles') {
      generatedMatches = createMixedAndSameSexDoublesMatches(players, minGamesPerPlayer);
    } else {
      generatedMatches = createRandomBalancedDoublesMatches(players, minGamesPerPlayer);
    }

    matchesToInsert = generatedMatches.map((match, index) => ({
      tournament_id: tournament.id,
      round: 1,
      match_number: index + 1,
      team1: [match.team1.player1.name, match.team1.player2.name],
      team2: [match.team2.player1.name, match.team2.player2.name],
      court: '',
      status: 'pending' as const,
      scheduled_time: null,
      score_team1: null,
      score_team2: null,
      winner: null,
    }));
  }

  if (matchesToInsert.length > 0) {
    const baseDate = assignmentRow.assignment_date || '2026-07-01';
    matchesToInsert = avoidConsecutiveMatches(matchesToInsert, 4, baseDate, '17:30', 10);
  }

  if (matchesToInsert.length === 0) {
    return { recovered: false };
  }

  const { error: insertError } = await adminSupabase.from('tournament_matches').insert(matchesToInsert);
  return { recovered: !insertError };
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const activeClubId = cookieStore.get('active_club_id')?.value;

    const adminSupabase = await getFilteredAdminClient();
    const requestUrl = new URL(request.url);
    const tournamentId = requestUrl.searchParams.get('tournament_id');
    const includeMatches = requestUrl.searchParams.get('include_matches');

    const todayStr = getKoreaDate();

    // [Optimized Path] If a specific tournament_id is requested with matches
    if (tournamentId && (includeMatches === '1' || includeMatches === 'true')) {
      let tournamentQuery = adminSupabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId);
      if (activeClubId) {
        tournamentQuery = tournamentQuery.eq('club_id', activeClubId);
      }
      const { data: selectedTournament, error: tError } = await tournamentQuery.maybeSingle();

      if (tError || !selectedTournament || selectedTournament.tournament_date < todayStr) {
        return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
      }

      const { data: matchesData, error: matchesError } = await adminSupabase
        .from('tournament_matches')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('round', { ascending: true })
        .order('match_number', { ascending: true });

      let matches = (matchesData || []) as MatchRow[];

      if (matches.length === 0 && selectedTournament.team_assignment_id) {
        const recoveryResult = await recoverTournamentMatches(selectedTournament);
        if (recoveryResult.recovered) {
          const { data: recoveredMatches } = await adminSupabase
            .from('tournament_matches')
            .select('*')
            .eq('tournament_id', tournamentId)
            .order('round', { ascending: true })
            .order('match_number', { ascending: true });

          matches = (recoveredMatches || []) as MatchRow[];
        }
      }

      const selectedTeamAssignment = await fetchTeamAssignment(selectedTournament.team_assignment_id);
      const teamAssignmentsByTournament = selectedTournament.team_assignment_id && selectedTeamAssignment
        ? { [tournamentId]: selectedTeamAssignment }
        : {};

      return NextResponse.json({
        tournaments: [selectedTournament],
        metricsByTournament: {},
        teamAssignmentsByTournament,
        selectedTournament,
        selectedTeamAssignment,
        matches: normalizeMatches(matches),
      });
    }

    let listQuery = adminSupabase
      .from('tournaments')
      .select('*')
      .gte('tournament_date', todayStr);
    if (activeClubId) {
      listQuery = listQuery.eq('club_id', activeClubId);
    }
    const { data, error } = await listQuery
      .order('round_number', { ascending: true })
      .order('tournament_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ tournaments: [], metricsByTournament: {} });
      }

      return NextResponse.json({ error: 'Failed to fetch tournaments' }, { status: 500 });
    }

    const tournaments = (data || []) as TournamentRow[];
    
    // metrics 계산에 필요한 컬럼만 선택하여 데이터 전송 및 조회 부담을 줄임
    const { data: allMatchesData, error: allMatchesError } = await adminSupabase
      .from('tournament_matches')
      .select('id, tournament_id, round, match_number, team1, team2, court, scheduled_time, status, score_team1, score_team2, winner');

    if (allMatchesError && allMatchesError.code !== '42P01') {
      return NextResponse.json({ error: 'Failed to fetch tournament metrics' }, { status: 500 });
    }

    const groupedMatches = new Map<string, MatchRow[]>();
    ((allMatchesData || []) as any[]).forEach((match) => {
      const current = groupedMatches.get(match.tournament_id) || [];
      current.push(match);
      groupedMatches.set(match.tournament_id, current);
    });

    const metricsByTournament = Object.fromEntries(
      tournaments.map((tournament) => [tournament.id, getTournamentMetricsFromMatches(groupedMatches.get(tournament.id) || [])])
    );
    const teamAssignmentsByTournament = await fetchTeamAssignmentsByTournament(tournaments);

    if (includeMatches === '1' || includeMatches === 'true') {
      const selectedTournament =
        (tournamentId ? tournaments.find((tournament) => tournament.id === tournamentId) : null) ||
        tournaments[0] ||
        null;

      if (!selectedTournament) {
        return NextResponse.json({
          tournaments,
          metricsByTournament,
          teamAssignmentsByTournament,
          selectedTournament: null,
          selectedTeamAssignment: null,
          matches: [],
        });
      }

      let matches = groupedMatches.get(selectedTournament.id) || [];

      if (matches.length === 0 && selectedTournament.team_assignment_id) {
        const recoveryResult = await recoverTournamentMatches(selectedTournament);
        if (recoveryResult.recovered) {
          const { data: recoveredMatches } = await adminSupabase
            .from('tournament_matches')
            .select('*')
            .eq('tournament_id', selectedTournament.id)
            .order('round', { ascending: true })
            .order('match_number', { ascending: true });

          matches = (recoveredMatches || []) as MatchRow[];
        }
      }

      const selectedTeamAssignment = await fetchTeamAssignment(selectedTournament.team_assignment_id);

      return NextResponse.json({
        tournaments,
        metricsByTournament,
        teamAssignmentsByTournament,
        selectedTournament,
        selectedTeamAssignment,
        matches: normalizeMatches(matches),
        allMatches: normalizeMatches((allMatchesData as unknown as MatchRow[]) || []),
      });
    }

    return NextResponse.json({ tournaments, metricsByTournament, teamAssignmentsByTournament });
  } catch (error) {
    return NextResponse.json(
      { error: 'Unexpected server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
