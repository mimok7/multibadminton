import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';
import { advanceBracketWinner, advanceLeagueFinalists, ensureBracketResultCanChange, resolveKnockoutBye } from '@/lib/tournament-bracket';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';
import {
  fetchTournamentDayMatches,
  getMatchPlayerNames,
  getRefereePlayerKey,
  getSameTimePlayerKeys,
} from '@/lib/tournament-referee';
import { createBalancedDoublesMatches, createMixedAndSameSexDoublesMatches, createRandomBalancedDoublesMatches } from '@/utils/match-utils';
import type { Player } from '@/types';

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
  club_id?: string | null;
  match_type: string | null;
  matches_per_player: number | null;
  team_assignment_id: string;
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

function avoidConsecutiveMatches(
  matches: any[],
  courtCount: number,
  baseDate: string,
  sTime: string,
  interval: number
): any[] {
  if (matches.length <= 1) return matches;
  const C = courtCount > 0 ? courtCount : 4;

  const result = [...matches];
  const cleanName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

  for (let i = 0; i < result.length; i++) {
    const slotStart = Math.floor(i / C) * C;
    const currentSlotPlayers = new Set<string>();
    for (let j = slotStart; j < i; j++) {
      [...result[j].team1, ...result[j].team2].map(cleanName).forEach((p: string) => currentSlotPlayers.add(p));
    }

    const matchPlayers = [...result[i].team1, ...result[i].team2].map(cleanName);
    const hasOverlap = matchPlayers.some((p: string) => currentSlotPlayers.has(p));

    if (hasOverlap) {
      let swapIdx = -1;
      for (let k = i + 1; k < result.length; k++) {
        const candidatePlayers = [...result[k].team1, ...result[k].team2].map(cleanName);
        if (!candidatePlayers.some((p: string) => currentSlotPlayers.has(p))) {
          swapIdx = k;
          break;
        }
      }
      if (swapIdx !== -1) {
        const temp = result[i];
        result[i] = result[swapIdx];
        result[swapIdx] = temp;
      }
    }
  }

  const [startHour, startMin] = (sTime || '09:00').split(':').map(Number);

  return result.map((match, idx) => {
    const slot = Math.floor(idx / C);
    const courtNum = (idx % C) + 1;

    const totalMins = startHour * 60 + startMin + (slot * (interval || 10));
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const scheduledTime = `${baseDate || '2026-07-01'}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

    return {
      ...match,
      match_number: idx + 1,
      court: `${courtNum}코트`,
      round: 1,
      scheduled_time: scheduledTime,
    };
  });
}

async function recoverTournamentMatches(
  adminSupabase: any,
  tournament: TournamentRow
) {
  const { data: assignment, error: assignmentError } = await adminSupabase
    .from('team_assignments')
    .select('id, assignment_date, round_number, title, team_type, racket_team, shuttle_team, team1, team2, team3, team4, pairs_data')
    .eq('id', tournament.team_assignment_id)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return { recovered: false, error: assignmentError?.message || 'Team assignment not found' };
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
    return { recovered: false, error: 'Not enough players to recover tournament matches' };
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
    const players: Player[] = uniquePlayers.map((name, index) => ({
      id: `recover-${tournament.id}-${index}`,
      name,
      skill_level: extractSkillLevel(name),
      skill_label: extractSkillLevel(name).toUpperCase(),
      skill_code: extractSkillLevel(name),
      gender: 'mixed',
    }));

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
    return { recovered: false, error: 'Recovered match list is empty' };
  }

  if (!tournament.club_id) {
    return { recovered: false, error: 'Tournament has no club assigned' };
  }

  matchesToInsert = matchesToInsert.map((match) => ({ ...match, club_id: tournament.club_id }));

  const { error: insertError } = await adminSupabase
    .from('tournament_matches')
    .insert(matchesToInsert);

  if (insertError) {
    return { recovered: false, error: insertError.message };
  }

  return { recovered: true, error: null };
}

async function fetchTeamAssignment(
  adminSupabase: any,
  assignmentId: string | null | undefined
) {
  if (!assignmentId) {
    return null;
  }

  const { data, error } = await adminSupabase
    .from('team_assignments')
    .select('id, assignment_date, round_number, title, team_type, racket_team, shuttle_team, team1, team2, team3, team4, pairs_data')
    .eq('id', assignmentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

async function requireAdminOrManager() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
}

async function findScopedTournamentMatch(
  context: { adminSupabase: any; clubId: string },
  matchId: string
) {
  const { data: scopedMatch } = await context.adminSupabase
    .from('tournament_matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();

  if (scopedMatch) {
    return { match: scopedMatch, client: context.adminSupabase, needsClubRepair: false };
  }

  // Legacy matches created before club_id was propagated can still be shown by older data paths.
  // Validate the parent tournament globally before repairing the child row's club scope.
  const globalClient = getUnfilteredGlobalAdminClient();
  const { data: legacyMatch } = await globalClient
    .from('tournament_matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();

  if (!legacyMatch) return null;

  const { data: tournament } = await globalClient
    .from('tournaments')
    .select('id, club_id')
    .eq('id', legacyMatch.tournament_id)
    .maybeSingle();

  if (!tournament || tournament.club_id !== context.clubId) return null;
  if (legacyMatch.club_id && legacyMatch.club_id !== context.clubId) return null;

  return { match: legacyMatch, client: globalClient, needsClubRepair: !legacyMatch.club_id };
}

export async function GET(request: Request) {
  try {
    const adminContext = await requireAdminOrManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const requestUrl = new URL(request.url);
    const tournamentId = requestUrl.searchParams.get('tournament_id');
    const includeMatches = requestUrl.searchParams.get('include_matches');

    const { data, error } = await adminContext.adminSupabase
      .from('tournaments')
      .select('*')
      .order('round_number', { ascending: true })
      .order('tournament_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ tournaments: [] });
      }

      return NextResponse.json(
        {
          error: 'Failed to fetch tournaments',
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    const tournaments = data || [];

    const { data: profilesData } = await adminContext.adminSupabase
      .from('profiles')
      .select('id, full_name, username')
      .order('full_name', { ascending: true });
    const profiles = profilesData || [];

    if (includeMatches === '1' || includeMatches === 'true') {
      const selectedTournament =
        (tournamentId ? tournaments.find((tournament) => tournament.id === tournamentId) : null) ||
        tournaments[0] ||
        null;
      const targetTournamentId = selectedTournament?.id || null;
      const selectedTeamAssignment = await fetchTeamAssignment(
        adminContext.adminSupabase,
        selectedTournament?.team_assignment_id
      );

      if (!targetTournamentId) {
        return NextResponse.json({ tournaments, selectedTournament: null, selectedTeamAssignment: null, matches: [], profiles });
      }

      const { data: matchesData, error: matchesError } = await adminContext.adminSupabase
        .from('tournament_matches')
        .select('*')
        .eq('tournament_id', targetTournamentId)
        .order('round', { ascending: true })
        .order('match_number', { ascending: true });

      if (matchesError) {
        return NextResponse.json(
          {
            error: 'Failed to fetch tournament matches',
            code: matchesError.code,
            message: matchesError.message,
            details: matchesError.details,
            hint: matchesError.hint,
          },
          { status: 500 }
        );
      }

      let normalizedMatches = matchesData || [];

      if (normalizedMatches.length === 0 && selectedTournament?.team_assignment_id) {
        const recoveryResult = await recoverTournamentMatches(
          adminContext.adminSupabase,
          selectedTournament as TournamentRow
        );

        if (recoveryResult.recovered) {
          const { data: recoveredMatches, error: recoveredMatchesError } = await adminContext.adminSupabase
            .from('tournament_matches')
            .select('*')
            .eq('tournament_id', targetTournamentId)
            .order('round', { ascending: true })
            .order('match_number', { ascending: true });

          if (recoveredMatchesError) {
            return NextResponse.json(
              {
                error: 'Failed to fetch recovered tournament matches',
                code: recoveredMatchesError.code,
                message: recoveredMatchesError.message,
                details: recoveredMatchesError.details,
                hint: recoveredMatchesError.hint,
              },
              { status: 500 }
            );
          }

          normalizedMatches = recoveredMatches || [];
        }
      }

      return NextResponse.json({
        tournaments,
        selectedTournament,
        selectedTeamAssignment,
        matches: normalizedMatches,
        profiles,
      });
    }

    return NextResponse.json({ tournaments, profiles });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdminOrManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);
    const tournament = payload?.tournament;
    const matches = Array.isArray(payload?.matches) ? payload.matches : [];

    if (!tournament || typeof tournament !== 'object') {
      return NextResponse.json({ error: 'Invalid tournament payload' }, { status: 400 });
    }

    const tournamentToInsert = {
      // Superadmins use an unfiltered service client, so club_id must be
      // persisted explicitly instead of relying on withClubFilter.
      club_id: adminContext.clubId,
      title: typeof tournament.title === 'string' ? tournament.title : '',
      tournament_date: typeof tournament.tournament_date === 'string' ? tournament.tournament_date : '',
      round_number: typeof tournament.round_number === 'number' ? tournament.round_number : 1,
      match_type: typeof tournament.match_type === 'string' ? tournament.match_type : 'random',
      team_assignment_id: typeof tournament.team_assignment_id === 'string' ? tournament.team_assignment_id : '',
      team_type: typeof tournament.team_type === 'string' ? tournament.team_type : '',
      total_teams: typeof tournament.total_teams === 'number' ? tournament.total_teams : 0,
      matches_per_player: typeof tournament.matches_per_player === 'number' ? tournament.matches_per_player : 1,
    };

    if (!tournamentToInsert.title || !tournamentToInsert.tournament_date || !tournamentToInsert.team_assignment_id || !tournamentToInsert.team_type) {
      return NextResponse.json({ error: 'Invalid tournament payload' }, { status: 400 });
    }

    const { data: createdTournament, error: tournamentError } = await adminContext.adminSupabase
      .from('tournaments')
      .insert(tournamentToInsert)
      .select()
      .single();

    if (tournamentError) {
      return NextResponse.json(
        {
          error: 'Failed to create tournament',
          code: tournamentError.code,
          message: tournamentError.message,
          details: tournamentError.details,
          hint: tournamentError.hint,
        },
        { status: 500 }
      );
    }

    if (matches.length > 0) {
      const matchesToSave = matches.map((match: any) => ({
        tournament_id: createdTournament.id,
        club_id: adminContext.clubId,
        round: typeof match?.round === 'number' ? match.round : 1,
        match_number: typeof match?.match_number === 'number' ? match.match_number : 0,
        team1: Array.isArray(match?.team1) ? match.team1.filter((value: unknown): value is string => typeof value === 'string') : [],
        team2: Array.isArray(match?.team2) ? match.team2.filter((value: unknown): value is string => typeof value === 'string') : [],
        court: typeof match?.court === 'string' ? match.court : '',
        scheduled_time: typeof match?.scheduled_time === 'string' ? match.scheduled_time : null,
        status:
          match?.status === 'in_progress' || match?.status === 'completed'
            ? match.status
            : 'pending',
        score_team1: typeof match?.score_team1 === 'number' ? match.score_team1 : null,
        score_team2: typeof match?.score_team2 === 'number' ? match.score_team2 : null,
        winner:
          match?.winner === 'team1' || match?.winner === 'team2' || match?.winner === 'draw'
            ? match.winner
            : null,
        competition_phase: typeof match?.competition_phase === 'string' ? match.competition_phase : 'standard',
        competition_group_key: typeof match?.competition_group_key === 'string' ? match.competition_group_key : null,
      }));

      const bracketTargetMatchNumbers = new Set(
        matches
          .map((match: any) => match?.next_match_number)
          .filter((matchNumber: unknown): matchNumber is number => typeof matchNumber === 'number')
      );
      const bracketSlotMatchNumbers = new Set(
        matches
          .filter((match: any) => match?.is_bracket_slot === true)
          .map((match: any) => match?.match_number)
          .filter((matchNumber: unknown): matchNumber is number => typeof matchNumber === 'number')
      );
      const sourceTargetMatchNumbers = new Set(
        matches.flatMap((match: any) => [match?.team1_source_match_number, match?.team2_source_match_number])
          .filter((matchNumber: unknown): matchNumber is number => typeof matchNumber === 'number')
      );
      const hasBracketMatches = bracketTargetMatchNumbers.size > 0 || bracketSlotMatchNumbers.size > 0 || sourceTargetMatchNumbers.size > 0;
      const hasInvalidMatch = matchesToSave.some((match: {
        match_number: number;
        team1: string[];
        team2: string[];
      }) => {
        const isBracketSlot =
          bracketSlotMatchNumbers.has(match.match_number) ||
          bracketTargetMatchNumbers.has(match.match_number) ||
          matches.some((source: any) => source?.match_number === match.match_number && typeof source?.next_match_number === 'number') ||
          sourceTargetMatchNumbers.has(match.match_number);
        return match.match_number <= 0 || ((match.team1.length === 0 || match.team2.length === 0) && !isBracketSlot);
      });

      if (hasInvalidMatch) {
        await adminContext.adminSupabase.from('tournaments').delete().eq('id', createdTournament.id);
        return NextResponse.json({ error: 'Invalid tournament matches payload' }, { status: 400 });
      }

      const { data: insertedMatches, error: matchesError } = await adminContext.adminSupabase
        .from('tournament_matches')
        .insert(matchesToSave as any)
        .select('id, match_number');

      if (matchesError) {
        return NextResponse.json(
          {
            error: 'Failed to save tournament matches',
            code: matchesError.code,
            message: matchesError.message,
            details: matchesError.details,
            hint: matchesError.hint,
          },
          { status: 500 }
        );
      }

      if (hasBracketMatches) {
        const matchIdByNumber = new Map(
          (insertedMatches || []).map((match: { id: string; match_number: number }) => [match.match_number, match.id])
        );
        const links = matches
          .map((match: any) => ({
            matchId: matchIdByNumber.get(match?.match_number),
            nextMatchId: matchIdByNumber.get(match?.next_match_number),
            nextMatchSlot: match?.next_match_slot,
          }))
          .filter((link: { matchId?: string; nextMatchId?: string; nextMatchSlot?: unknown }) =>
            link.matchId && link.nextMatchId && (link.nextMatchSlot === 1 || link.nextMatchSlot === 2)
          );

        for (const link of links) {
          const { error: linkError } = await (adminContext.adminSupabase
            .from('tournament_matches') as any)
            .update({ next_match_id: link.nextMatchId, next_match_slot: link.nextMatchSlot })
            .eq('id', link.matchId);

          if (linkError) {
            await adminContext.adminSupabase.from('tournaments').delete().eq('id', createdTournament.id);
            return NextResponse.json(
              { error: '토너먼트 연결 정보를 저장하지 못했습니다. SQL 마이그레이션을 먼저 실행하세요.' },
              { status: 500 }
            );
          }
        }

        const sourceLinks = matches.flatMap((match: any) => {
          const matchId = matchIdByNumber.get(match?.match_number);
          return [
            { matchId, column: 'team1_source_match_id', sourceId: matchIdByNumber.get(match?.team1_source_match_number) },
            { matchId, column: 'team2_source_match_id', sourceId: matchIdByNumber.get(match?.team2_source_match_number) },
          ];
        }).filter((link: { matchId?: string; sourceId?: string }) => link.matchId && link.sourceId);

        for (const link of sourceLinks) {
          const { error: sourceLinkError } = await (adminContext.adminSupabase
            .from('tournament_matches') as any)
            .update({ [link.column]: link.sourceId })
            .eq('id', link.matchId);

          if (sourceLinkError) {
            await adminContext.adminSupabase.from('tournaments').delete().eq('id', createdTournament.id);
            return NextResponse.json(
              { error: '풀리그 진출 연결 정보를 저장하지 못했습니다. SQL 마이그레이션을 먼저 실행하세요.' },
              { status: 500 }
            );
          }
        }

        const downstreamMatchNumbers = new Set(
          matches
            .map((source: any) => source?.next_match_number)
            .filter((matchNumber: unknown): matchNumber is number => typeof matchNumber === 'number')
        );
        const openingMatches = (insertedMatches || []).filter(
          (match: { match_number: number }) => !downstreamMatchNumbers.has(match.match_number)
        );
        for (const openingMatch of openingMatches) {
          const { data: openingMatchData } = await (adminContext.adminSupabase
            .from('tournament_matches') as any)
            .select('id, next_match_id, next_match_slot, team1, team2, winner')
            .eq('id', openingMatch.id)
            .maybeSingle();
          if (openingMatchData) {
            await resolveKnockoutBye(adminContext.adminSupabase, openingMatchData.id);
          }
        }
      }
    }

    return NextResponse.json({ success: true, tournament: createdTournament });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const adminContext = await requireAdminOrManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);
    const matchId = typeof payload?.match_id === 'string' ? payload.match_id : '';

    if (!matchId) {
      return NextResponse.json({ error: 'match_id is required' }, { status: 400 });
    }

    // 심판 배정 모드 (referee_name이 있고 점수가 없는 경우)
    const hasRefereeUpdate = 'referee_name' in (payload || {});
    const scoreTeam1 = typeof payload?.score_team1 === 'number' ? payload.score_team1 : null;
    const scoreTeam2 = typeof payload?.score_team2 === 'number' ? payload.score_team2 : null;
    const scopedMatch = await findScopedTournamentMatch(adminContext, matchId);
    if (!scopedMatch) {
      return NextResponse.json({ error: 'Tournament match not found' }, { status: 404 });
    }

    const existingMatch = scopedMatch.match;
    const mutationClient = scopedMatch.client;

    if (hasRefereeUpdate && scoreTeam1 == null && scoreTeam2 == null) {
      const requestedRefereeName = typeof payload?.referee_name === 'string'
        ? payload.referee_name.trim()
        : '';
      let refereeName: string | null = requestedRefereeName || null;
      let refereeId: string | null = null;

      if (refereeName) {
        const dayMatches = await fetchTournamentDayMatches(
          mutationClient,
          existingMatch.tournament_id,
          adminContext.clubId
        );
        const participantNames = new Map<string, string>();
        dayMatches.forEach((dayMatch) => {
          getMatchPlayerNames(dayMatch).forEach((name) => {
            const key = getRefereePlayerKey(name);
            if (key && !participantNames.has(key)) participantNames.set(key, name);
          });
        });

        const refereeKey = getRefereePlayerKey(refereeName);
        const canonicalName = participantNames.get(refereeKey);
        if (!canonicalName) {
          return NextResponse.json(
            { error: '해당 날짜의 대회 참가 선수만 심판으로 배정할 수 있습니다.' },
            { status: 400 }
          );
        }

        if (getSameTimePlayerKeys(existingMatch, dayMatches).has(refereeKey)) {
          return NextResponse.json(
            { error: '같은 시간대에 경기가 있는 선수는 심판으로 배정할 수 없습니다.' },
            { status: 409 }
          );
        }
        refereeName = canonicalName;
      }

      if (!refereeId && refereeName) {
        const { data: profile } = await mutationClient
          .from('profiles')
          .select('id')
          .eq('full_name', refereeName.trim())
          .limit(1)
          .maybeSingle();
        if (profile) {
          refereeId = profile.id;
        }
      }

      const updateData: Record<string, unknown> = {
        referee_name: refereeName,
        referee_id: refereeId || null,
      };
      if (scopedMatch.needsClubRepair) {
        updateData.club_id = adminContext.clubId;
      }

      const { data, error } = await mutationClient
        .from('tournament_matches')
        .update(updateData)
        .eq('id', matchId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json(
          {
            error: 'Failed to assign referee',
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, match: data });
    }

    // 점수 업데이트 모드
    if (scoreTeam1 == null || scoreTeam2 == null) {
      return NextResponse.json({ error: 'Invalid score payload' }, { status: 400 });
    }

    if (!Array.isArray(existingMatch.team1) || !Array.isArray(existingMatch.team2) || existingMatch.team1.length === 0 || existingMatch.team2.length === 0) {
      return NextResponse.json({ error: '참가 팀이 확정된 뒤에 결과를 저장할 수 있습니다.' }, { status: 409 });
    }

    const isKnockoutMatch = Boolean(existingMatch.next_match_id) || existingMatch.competition_phase === 'preliminary' || existingMatch.competition_phase === 'ranking_final';
    if (isKnockoutMatch && scoreTeam1 === scoreTeam2) {
      return NextResponse.json({ error: '토너먼트 경기는 무승부로 종료할 수 없습니다.' }, { status: 400 });
    }

    try {
      await ensureBracketResultCanChange(mutationClient, existingMatch);
    } catch (advanceError) {
      return NextResponse.json(
        { error: advanceError instanceof Error ? advanceError.message : '토너먼트 진행 상태를 확인하지 못했습니다.' },
        { status: 409 }
      );
    }

    const winner = scoreTeam1 > scoreTeam2 ? 'team1' : scoreTeam2 > scoreTeam1 ? 'team2' : 'draw';

    const scoreUpdate: Record<string, unknown> = {
      score_team1: scoreTeam1,
      score_team2: scoreTeam2,
      winner,
      status: 'completed',
    };
    if (scopedMatch.needsClubRepair) {
      scoreUpdate.club_id = adminContext.clubId;
    }

    const { data, error } = await mutationClient
      .from('tournament_matches')
      .update(scoreUpdate)
      .eq('id', matchId)
      .select('*')
      .single();

    if (error) {
      const isScoreLimit = error.message.includes('score_limit');
      return NextResponse.json(
        {
          error: isScoreLimit ? '점수는 25점을 초과할 수 없습니다.' : 'Failed to update tournament match score',
          code: error.code,
          message: isScoreLimit ? '점수는 25점을 초과할 수 없습니다.' : error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    try {
      await advanceBracketWinner(mutationClient, data as any);
      await advanceLeagueFinalists(mutationClient, data as any);
    } catch (advanceError) {
      return NextResponse.json(
        {
          error: advanceError instanceof Error ? advanceError.message : '승자를 다음 라운드에 배정하지 못했습니다.',
          match: data,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, match: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const adminContext = await requireAdminOrManager();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);
    const tournamentId = typeof payload?.tournamentId === 'string' ? payload.tournamentId : '';

    if (!tournamentId) {
      return NextResponse.json({ error: 'Invalid tournament id' }, { status: 400 });
    }

    const { error: matchesDeleteError } = await adminContext.adminSupabase
      .from('tournament_matches')
      .delete()
      .eq('tournament_id', tournamentId);

    if (matchesDeleteError) {
      return NextResponse.json(
        {
          error: 'Failed to delete tournament matches',
          code: matchesDeleteError.code,
          message: matchesDeleteError.message,
          details: matchesDeleteError.details,
          hint: matchesDeleteError.hint,
        },
        { status: 500 }
      );
    }

    const { error: tournamentDeleteError } = await adminContext.adminSupabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);

    if (tournamentDeleteError) {
      return NextResponse.json(
        {
          error: 'Failed to delete tournament',
          code: tournamentDeleteError.code,
          message: tournamentDeleteError.message,
          details: tournamentDeleteError.details,
          hint: tournamentDeleteError.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, tournamentId });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
