import type { Database } from '@/types/supabase';
import type { getSupabaseClient } from '@/lib/supabase';

type BrowserSupabaseClient = ReturnType<typeof getSupabaseClient>;
type TournamentRow = Database['public']['Tables']['tournaments']['Row'];
type TournamentMatchRow = Database['public']['Tables']['tournament_matches']['Row'];
type TeamAssignmentRow = Database['public']['Tables']['team_assignments']['Row'];

export interface MyTournamentMatchView {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[];
  team2: string[];
  court: string;
  scheduled_time?: string | null;
  status: string;
  score_team1?: number | null;
  score_team2?: number | null;
  winner?: 'team1' | 'team2' | 'draw' | null;
  tournament_title?: string;
  tournament_date?: string | null;
  match_type?: string | null;
}

export const normalizeTournamentPlayerName = (value?: string | null) =>
  String(value || '')
    .replace(/\s+/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();

const tournamentNamesMatch = (candidate: string, teamMember: string) => {
  if (!candidate || !teamMember) return false;
  return candidate === teamMember || candidate.includes(teamMember) || teamMember.includes(candidate);
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

const getAssignmentPlayerNames = (
  assignment?: Pick<
    TeamAssignmentRow,
    'racket_team' | 'shuttle_team' | 'team1' | 'team2' | 'team3' | 'team4' | 'pairs_data'
  > | null
) => {
  if (!assignment) {
    return [];
  }

  return [
    ...toStringArray(assignment.racket_team),
    ...toStringArray(assignment.shuttle_team),
    ...toStringArray(assignment.team1),
    ...toStringArray(assignment.team2),
    ...toStringArray(assignment.team3),
    ...toStringArray(assignment.team4),
    ...Object.values(toPairsRecord(assignment.pairs_data)).flat(),
  ];
};

export async function fetchMyTournamentMatches(
  supabase: BrowserSupabaseClient,
  profile?: {
    username?: string | null;
    full_name?: string | null;
  } | null
): Promise<{
  allTournamentMatchCount: number;
  allMatches: MyTournamentMatchView[];
  matches: MyTournamentMatchView[];
}> {
  const searchNames = [profile?.username, profile?.full_name]
    .map((value) => normalizeTournamentPlayerName(value))
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);

  if (searchNames.length === 0) {
    return {
      allTournamentMatchCount: 0,
      allMatches: [],
      matches: [],
    };
  }

  const response = await fetch('/api/tournaments?include_matches=1', {
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || '대회 게임을 불러오지 못했습니다.');
  }

  const tournaments = Array.isArray(payload?.tournaments) ? (payload.tournaments as TournamentRow[]) : [];
  const teamAssignmentsByTournament =
    payload?.teamAssignmentsByTournament && typeof payload.teamAssignmentsByTournament === 'object'
      ? (payload.teamAssignmentsByTournament as Record<string, TeamAssignmentRow | null>)
      : {};
  const initialAllMatches = Array.isArray(payload?.allMatches)
    ? (payload.allMatches as TournamentMatchRow[])
    : [];

  const memberTournamentIds = new Set<string>();

  initialAllMatches.forEach((match) => {
    const team1Names = (match.team1 || []).map((name) => normalizeTournamentPlayerName(name));
    const team2Names = (match.team2 || []).map((name) => normalizeTournamentPlayerName(name));
    const isMember = searchNames.some((name) =>
      team1Names.some((teamName) => tournamentNamesMatch(name, teamName)) ||
      team2Names.some((teamName) => tournamentNamesMatch(name, teamName))
    );

    if (isMember && match.tournament_id) {
      memberTournamentIds.add(match.tournament_id);
    }
  });

  tournaments.forEach((tournament) => {
    const assignmentPlayers = getAssignmentPlayerNames(teamAssignmentsByTournament[tournament.id] || null)
      .map((name) => normalizeTournamentPlayerName(name));
    const isMember = searchNames.some((name) =>
      assignmentPlayers.some((playerName) => tournamentNamesMatch(name, playerName))
    );

    if (isMember) {
      memberTournamentIds.add(tournament.id);
    }
  });

  const allMatchesByTournament = new Map<string, TournamentMatchRow[]>();
  initialAllMatches.forEach((match) => {
    const current = allMatchesByTournament.get(match.tournament_id) || [];
    current.push(match);
    allMatchesByTournament.set(match.tournament_id, current);
  });

  for (const tournamentId of memberTournamentIds) {
    if ((allMatchesByTournament.get(tournamentId) || []).length > 0) {
      continue;
    }

    const tournamentResponse = await fetch(`/api/tournaments?include_matches=1&tournament_id=${tournamentId}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const tournamentPayload = await tournamentResponse.json().catch(() => null);

    if (!tournamentResponse.ok) {
      continue;
    }

    const recoveredMatches = Array.isArray(tournamentPayload?.matches)
      ? (tournamentPayload.matches as TournamentMatchRow[])
      : [];

    if (recoveredMatches.length > 0) {
      allMatchesByTournament.set(tournamentId, recoveredMatches);
    }
  }

  const tournamentMap = new Map(
    tournaments.map((tournament) => [
      tournament.id,
      {
        title: tournament.title,
        tournament_date: tournament.tournament_date,
        match_type: tournament.match_type,
      },
    ])
  );

  const filteredMatches = Array.from(memberTournamentIds).flatMap((tournamentId) =>
    (allMatchesByTournament.get(tournamentId) || []).filter((match) => {
      const team1Names = (match.team1 || []).map((name) => normalizeTournamentPlayerName(name));
      const team2Names = (match.team2 || []).map((name) => normalizeTournamentPlayerName(name));
      return searchNames.some((name) =>
        team1Names.some((teamName) => tournamentNamesMatch(name, teamName)) ||
        team2Names.some((teamName) => tournamentNamesMatch(name, teamName))
      );
    })
  );

  const toTournamentMatchView = (match: TournamentMatchRow): MyTournamentMatchView => {
      const tournament = tournamentMap.get(match.tournament_id);
      return {
        ...match,
        team1: (match.team1 || []).map((name) => String(name).replace(/\s*\([^)]*\)\s*$/, '').trim()),
        team2: (match.team2 || []).map((name) => String(name).replace(/\s*\([^)]*\)\s*$/, '').trim()),
        winner: (match.winner as MyTournamentMatchView['winner']) ?? null,
        tournament_title: tournament?.title || '대회',
        tournament_date: tournament?.tournament_date || null,
        match_type: tournament?.match_type || null,
      };
  };

  const sortMatches = (left: MyTournamentMatchView, right: MyTournamentMatchView) => {
    const leftDate = left.scheduled_time || left.tournament_date || '';
    const rightDate = right.scheduled_time || right.tournament_date || '';
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate, 'ko');
    }

    const courtDiff = String(left.court || '').localeCompare(String(right.court || ''), 'ko', { numeric: true });
    if (courtDiff !== 0) {
      return courtDiff;
    }

    if (left.round !== right.round) {
      return left.round - right.round;
    }

    return left.match_number - right.match_number;
  };

  const allMatches = Array.from(allMatchesByTournament.values())
    .flat()
    .map(toTournamentMatchView)
    .sort(sortMatches);

  const matches: MyTournamentMatchView[] = filteredMatches
    .map(toTournamentMatchView)
    .sort(sortMatches);

  return {
    allTournamentMatchCount: initialAllMatches.length,
    allMatches,
    matches,
  };
}
