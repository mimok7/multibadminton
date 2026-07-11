'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trophy } from 'lucide-react';
import { useUser } from '@/hooks/useUser';

import { getKoreaDate } from '@/lib/date';
import { getSupabaseClient } from '@/lib/supabase';
import type { Json } from '@/types/supabase';
import { getFriendlyErrorMessage } from '@/lib/utils';

interface Match {
  id?: string;
  tournament_id?: string;
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
  referee_id?: string | null;
  referee_name?: string | null;
}

interface Tournament {
  id: string;
  title: string;
  tournament_date: string;
  round_number: number;
  team_assignment_id?: string;
  match_type: string;
  team_type: string;
  total_teams: number;
  matches_per_player: number;
  created_at: string;
}

interface TeamAssignment {
  id: string;
  round_number: number;
  assignment_date: string;
  title: string;
  team_type: '2teams' | '3teams' | '4teams' | 'pairs';
  racket_team?: string[];
  shuttle_team?: string[];
  team1?: string[];
  team2?: string[];
  team3?: string[];
  team4?: string[];
  pairs_data?: Record<string, string[]>;
  pair_groups?: PairGroupDefinition[];
}

type PairGroupDefinition = {
  groupName: string;
  pairNames: string[];
};

type ScoreDraft = {
  score1: string;
  score2: string;
};

type AdminTournamentTab = 'overview' | 'results' | string;
type UserTournamentTab = 'bracket' | 'results' | string;

type TournamentBracketViewProps = {
  adminMode?: boolean;
  homeHref?: string;
};

type TournamentMetrics = {
  matchCount: number;
  teamCount: number;
  playerCount: number;
  roundCount: number;
};

type TeamAssignmentMap = Record<string, TeamAssignment | null>;

type MatchGroupSection = {
  groupName: string;
  matches: Match[];
};

function formatGroupLabel(label: string) {
  return label
    .replace(/상위\s*그룹/g, 'A 그룹')
    .replace(/중상\s*그룹/g, 'B 그룹')
    .replace(/중위\s*그룹/g, 'B 그룹')
    .replace(/중하\s*그룹/g, 'C 그룹')
    .replace(/하위\s*그룹/g, 'C 그룹')
    .replace(/상위/g, 'A')
    .replace(/중상/g, 'B')
    .replace(/중위/g, 'B')
    .replace(/중하/g, 'C')
    .replace(/하위/g, 'C');
}

function extractPairGroupLabel(court: string) {
  const match = court.trim().match(/^\[(.+?)\]/i);
  const label = match?.[1]?.trim() || '';
  return formatGroupLabel(label);
}

function formatCourtLabel(court: string) {
  const trimmedCourt = court.trim();

  if (!trimmedCourt) {
    return '코트 미정';
  }

  const bracketMatch = trimmedCourt.match(/^\[.+?\]\s*(.+)$/i);
  const courtName = bracketMatch ? bracketMatch[1].trim() : trimmedCourt;

  const customPatternMatch = courtName.match(/(\d+)코트$/i);
  if (customPatternMatch?.[1]) {
    return `${customPatternMatch[1]}코트`;
  }

  const courtNumberMatch = courtName.match(/^Court\s*(.+)$/i);
  if (courtNumberMatch?.[1]) {
    return `코트 ${courtNumberMatch[1].trim()}`;
  }

  return courtName;
}

const formatScheduledTime = (timeStr: string | undefined | null) => {
  if (!timeStr) return '';
  try {
    const timePart = timeStr.split('T')[1] || '';
    const [h, m] = timePart.split(':');
    if (h && m) {
      let hourNum = parseInt(h, 10);
      const isPm = hourNum >= 12;
      const ampm = isPm ? '오후' : '오전';
      if (hourNum > 12) hourNum -= 12;
      if (hourNum === 0) hourNum = 12;
      const hourStr = String(hourNum).padStart(2, '0');
      return `${ampm} ${hourStr}:${m}`;
    }
  } catch {
    // fallback
  }
  return '';
};

function avoidConsecutiveMatches(
  matches: Match[],
  C: number,
  baseDate: string,
  startTime: string,
  timeInterval: number
): Match[] {
  const result = [...matches];
  const cleanName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

  for (let i = 0; i < result.length; i++) {
    const slotStart = Math.floor(i / C) * C;
    const currentSlotPlayers = new Set<string>();
    for (let j = slotStart; j < i; j++) {
      [...result[j].team1, ...result[j].team2].map(cleanName).forEach(p => currentSlotPlayers.add(p));
    }

    const matchPlayers = [...result[i].team1, ...result[i].team2].map(cleanName);
    const hasOverlap = matchPlayers.some(p => currentSlotPlayers.has(p));

    if (hasOverlap) {
      let swapIdx = -1;
      for (let k = i + 1; k < result.length; k++) {
        const candidatePlayers = [...result[k].team1, ...result[k].team2].map(cleanName);
        if (!candidatePlayers.some(p => currentSlotPlayers.has(p))) {
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

  const [startHour, startMin] = (startTime || '17:30').split(':').map(Number);

  return result.map((match, idx) => {
    const slot = Math.floor(idx / C);
    const courtNum = (idx % C) + 1;
    
    const totalMins = startHour * 60 + startMin + (slot * timeInterval);
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

function scheduleMatchesWithBracketStages(
  matches: Match[],
  courtCount: number,
  baseDate: string,
  startTime: string,
  timeInterval: number
): Match[] {
  const playableMatches = matches.filter((match) => match.team1.length > 0 && match.team2.length > 0);
  const pendingBracketMatches = matches
    .filter((match) => match.team1.length === 0 || match.team2.length === 0)
    .sort((left, right) => (left.round - right.round) || (left.match_number - right.match_number));
  const originalMatchData = new Map(matches.map((match) => [match.id, match]));
  const scheduledPlayableMatches = avoidConsecutiveMatches(playableMatches, courtCount, baseDate, startTime, timeInterval)
    .map((match) => {
      const originalMatch = originalMatchData.get(match.id);
      return originalMatch
        ? { ...match, round: originalMatch.round, match_number: originalMatch.match_number }
        : match;
    });

  const [startHour, startMinute] = (startTime || '17:30').split(':').map(Number);
  const playableSlotCount = Math.ceil(scheduledPlayableMatches.length / courtCount);
  const scheduledPendingBracketMatches = pendingBracketMatches.map((match, index) => {
    const slot = playableSlotCount + Math.floor(index / courtCount);
    const totalMinutes = startHour * 60 + startMinute + (slot * timeInterval);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;

    return {
      ...match,
      court: `${(index % courtCount) + 1}코트`,
      scheduled_time: `${baseDate || '2026-07-01'}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
    };
  });

  return [...scheduledPlayableMatches, ...scheduledPendingBracketMatches];
}

function formatTournamentTitle(title: string) {
  return title
    .replace(/^라뚱\s*대회|^대회경기/u, '대회 경기')
    .replace(/라운드\s*\d+/g, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

function getMatchTypeLabel(matchType: string) {
  if (matchType === 'level_based') return '레벨';
  if (matchType === 'mixed_doubles') return '혼복';
  return '랜덤';
}

function getTournamentDisplayRound(tournament?: Tournament | null) {
  return tournament?.round_number || 1;
}

function getDisplayMatchNumber(match: Match, fallbackIndex: number) {
  return match.match_number > 0 ? match.match_number : fallbackIndex + 1;
}

function getResolvedWinner(match: Match): Match['winner'] {
  if (match.status !== 'completed') return null;
  if (typeof match.score_team1 === 'number' && typeof match.score_team2 === 'number') {
    if (match.score_team1 > match.score_team2) return 'team1';
    if (match.score_team2 > match.score_team1) return 'team2';
    return 'draw';
  }

  return match.winner ?? null;
}

function getBracketStageName(match: Match, matches: Match[]) {
  const maxRound = Math.max(...matches.map((item) => item.round));
  const roundsUntilFinal = maxRound - match.round;

  if (roundsUntilFinal <= 0) return '결승';
  if (roundsUntilFinal === 1) return '4강';
  if (roundsUntilFinal === 2) return '8강';
  return '예선';
}

function formatBracketTeam(team: string[], match?: Match, matches: Match[] = [], isPairTournament = false) {
  if (team.length > 0) return team.join(' / ');
  if (!isPairTournament || !match || matches.length === 0) return '대진 대기';
  return `${getBracketStageName(match, matches)} 진출팀`;
}

function isResultMatch(match: Match) {
  return match.status === 'completed';
}

function getTeamKey(players: string[]) {
  return [...players].map((player) => player.trim()).sort((left, right) => left.localeCompare(right, 'ko-KR')).join(' / ');
}

function getAssignmentTeamGroups(teamAssignment: TeamAssignment) {
  if (teamAssignment.team_type === 'pairs') {
    const pairMap = new Map(Object.entries(teamAssignment.pairs_data || {}));

    if (teamAssignment.pair_groups && teamAssignment.pair_groups.length > 0) {
      return teamAssignment.pair_groups
        .map((group) => ({
          label: group.groupName,
          players: group.pairNames.flatMap((pairName) => pairMap.get(pairName) || []),
        }))
        .filter((group) => group.players.length > 0);
    }

    return Object.entries(teamAssignment.pairs_data || {})
      .map(([label, players]) => ({ label, players }))
      .filter((group) => group.players.length > 0);
  }

  if (teamAssignment.team_type === '2teams') {
    return [
      { label: '라켓팀', players: (teamAssignment.racket_team && teamAssignment.racket_team.length > 0 ? teamAssignment.racket_team : teamAssignment.team1) || [] },
      { label: '셔틀팀', players: (teamAssignment.shuttle_team && teamAssignment.shuttle_team.length > 0 ? teamAssignment.shuttle_team : teamAssignment.team2) || [] },
    ].filter((group) => group.players.length > 0);
  }

  return [
    { label: '1팀', players: teamAssignment.team1 || [] },
    { label: '2팀', players: teamAssignment.team2 || [] },
    { label: '3팀', players: teamAssignment.team3 || [] },
    { label: '4팀', players: teamAssignment.team4 || [] },
  ].filter((group) => group.players.length > 0);
}

function toStringArray(value: Json | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toPairsRecord(value: Json | null | undefined): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const rawPairs = (value as { pairs?: Json | null }).pairs;
  const source =
    rawPairs && typeof rawPairs === 'object' && !Array.isArray(rawPairs)
      ? rawPairs
      : value;

  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => /^pair\d+$/i.test(key))
      .map(([key, raw]) => [
        key,
        Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [],
      ])
  );
}

function toPairGroups(value: Json | null | undefined): PairGroupDefinition[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const rawGroups = (value as { groups?: Json | null }).groups;
  if (!Array.isArray(rawGroups)) return [];

  return rawGroups
    .map((group) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        return null;
      }

      const groupName = String((group as { groupName?: unknown }).groupName || '').trim();
      const pairNames = Array.isArray((group as { pairNames?: unknown }).pairNames)
        ? (group as { pairNames: unknown[] }).pairNames
            .filter((item): item is string => typeof item === 'string')
            .map((pairName) => pairName.trim())
            .filter(Boolean)
        : [];

      if (!groupName || pairNames.length === 0) {
        return null;
      }

      return { groupName, pairNames };
    })
    .filter((group): group is PairGroupDefinition => Boolean(group));
}

function mapTeamAssignmentRow(team: {
  id: string;
  round_number: number;
  assignment_date: string;
  title: string;
  team_type: string;
  racket_team?: Json | null;
  shuttle_team?: Json | null;
  team1?: Json | null;
  team2?: Json | null;
  team3?: Json | null;
  team4?: Json | null;
  pairs_data?: Json | null;
}): TeamAssignment {
  return {
    id: team.id,
    round_number: team.round_number,
    assignment_date: team.assignment_date,
    title: team.title,
    team_type: (team.team_type as TeamAssignment['team_type']) || '2teams',
    racket_team: toStringArray(team.racket_team),
    shuttle_team: toStringArray(team.shuttle_team),
    team1: toStringArray(team.team1),
    team2: toStringArray(team.team2),
    team3: toStringArray(team.team3),
    team4: toStringArray(team.team4),
    pairs_data: toPairsRecord(team.pairs_data),
    pair_groups: toPairGroups(team.pairs_data),
  };
}

function mapTeamAssignmentMap(value: unknown): TeamAssignmentMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([tournamentId, teamAssignment]) => {
      if (!teamAssignment || typeof teamAssignment !== 'object' || Array.isArray(teamAssignment)) {
        return [tournamentId, null];
      }

      return [tournamentId, mapTeamAssignmentRow(teamAssignment as Parameters<typeof mapTeamAssignmentRow>[0])];
    })
  );
}

function groupMatchesByPairGroup(matches: Match[]): MatchGroupSection[] {
  const grouped = new Map<string, Match[]>();

  matches.forEach((match) => {
    const groupName = extractPairGroupLabel(match.court) || '기타 그룹';
    const current = grouped.get(groupName) || [];
    current.push(match);
    grouped.set(groupName, current);
  });

  return Array.from(grouped.entries()).map(([groupName, groupedMatches]) => ({
    groupName,
    matches: groupedMatches,
  }));
}

function groupMatchesByCourt(matches: Match[]): MatchGroupSection[] {
  const grouped = new Map<string, Match[]>();

  matches.forEach((match) => {
    const courtName = formatCourtLabel(match.court);
    const current = grouped.get(courtName) || [];
    current.push(match);
    grouped.set(courtName, current);
  });

  return Array.from(grouped.entries())
    .map(([groupName, groupedMatches]) => {
      const sortedMatches = [...groupedMatches].sort((a, b) => {
        if (a.round !== b.round) {
          return a.round - b.round;
        }
        return a.match_number - b.match_number;
      });
      return {
        groupName,
        matches: sortedMatches,
      };
    })
    .sort((a, b) => {
      if (a.groupName === '코트 미정') return 1;
      if (b.groupName === '코트 미정') return -1;
      return a.groupName.localeCompare(b.groupName, 'ko', { numeric: true });
    });
}

function groupMatchesByTime(matches: Match[]): MatchGroupSection[] {
  const grouped = new Map<string, Match[]>();

  matches.forEach((match) => {
    let timeLabel = '(시간 미정)';
    if (match.scheduled_time) {
      const formatted = formatScheduledTime(match.scheduled_time);
      if (formatted) {
        timeLabel = formatted;
      }
    }
    const current = grouped.get(timeLabel) || [];
    current.push(match);
    grouped.set(timeLabel, current);
  });

  return Array.from(grouped.entries())
    .map(([groupName, groupedMatches]) => {
      const sortedMatches = [...groupedMatches].sort((a, b) => {
        const aCourt = formatCourtLabel(a.court);
        const bCourt = formatCourtLabel(b.court);
        if (aCourt === '코트 미정') return 1;
        if (bCourt === '코트 미정') return -1;
        return aCourt.localeCompare(bCourt, 'ko', { numeric: true });
      });
      return {
        groupName,
        matches: sortedMatches,
      };
    })
    .sort((a, b) => {
      if (a.groupName === '(시간 미정)') return 1;
      if (b.groupName === '(시간 미정)') return -1;
      
      const parseTimeToMinutes = (label: string) => {
        const parts = label.split(' ');
        if (parts.length !== 2) return 0;
        const ampm = parts[0];
        const [h, m] = parts[1].split(':').map(Number);
        let total = h * 60 + m;
        if (ampm === '오후' && h !== 12) total += 12 * 60;
        if (ampm === '오전' && h === 12) total -= 12 * 60;
        return total;
      };

      return parseTimeToMinutes(a.groupName) - parseTimeToMinutes(b.groupName);
    });
}

function getGroupIcon(groupName: string) {
  const name = groupName.trim();
  if (name.includes('상위') || name.includes('A')) return '🥇';
  if (name.includes('중위') || name.includes('B')) return '🥈';
  if (name.includes('하위') || name.includes('C')) return '🥉';
  return '🏸';
}

function getTournamentGroupLabel(title: string) {
  const formattedTitle = formatTournamentTitle(title);
  const prefixRegex = /^(대회\s*경기\s*\d{4}-\d{2}-\d{2})\s*(.*)$/u;
  const titleMatch = formattedTitle.match(prefixRegex);
  const label = titleMatch ? titleMatch[2].trim() : formattedTitle;
  return formatGroupLabel(label);
}

function getHeadToHeadWinner(teamAKey: string, teamBKey: string, matches: Match[]): number {
  let teamAWins = 0;
  let teamBWins = 0;

  matches.forEach((match) => {
    if (!isResultMatch(match)) return;

    const t1Key = getTeamKey(match.team1);
    const t2Key = getTeamKey(match.team2);

    const isT1A = t1Key === teamAKey;
    const isT2B = t2Key === teamBKey;
    const isT1B = t1Key === teamBKey;
    const isT2A = t2Key === teamAKey;

    if ((isT1A && isT2B) || (isT1B && isT2A)) {
      const winner = getResolvedWinner(match);
      if (winner === 'team1') {
        if (isT1A) teamAWins += 1;
        else teamBWins += 1;
      } else if (winner === 'team2') {
        if (isT2A) teamAWins += 1;
        else teamBWins += 1;
      }
    }
  });

  if (teamAWins > teamBWins) return -1; // teamA가 이김 -> left가 상위
  if (teamBWins > teamAWins) return 1;  // teamB가 이김 -> right가 상위
  return 0; // 동률
}

function getPairStats(
  sourceMatches: Match[],
  assignmentsByTournament: TeamAssignmentMap,
  fallbackTeamAssignment?: TeamAssignment | null
) {
  const pairStats: Record<
    string,
    {
      groupName: string;
      matches: number;
      wins: number;
      losses: number;
      draws: number;
      pointsWon: number;
      pointsLost: number;
    }
  > = {};

  const registerAllPairs = (assignment: TeamAssignment) => {
    const pairMap = new Map(Object.entries(assignment.pairs_data || {}));
    
    if (assignment.pair_groups && assignment.pair_groups.length > 0) {
      assignment.pair_groups.forEach((group) => {
        group.pairNames.forEach((pairName) => {
          const players = pairMap.get(pairName);
          if (players && players.length > 0) {
            const key = getTeamKey(players);
            pairStats[key] = {
              groupName: formatGroupLabel(group.groupName),
              matches: 0,
              wins: 0,
              losses: 0,
              draws: 0,
              pointsWon: 0,
              pointsLost: 0,
            };
          }
        });
      });
    } else {
      Object.values(assignment.pairs_data || {}).forEach((players) => {
        if (players && players.length > 0) {
          const key = getTeamKey(players);
          pairStats[key] = {
            groupName: '페어 그룹',
            matches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            pointsWon: 0,
            pointsLost: 0,
          };
        }
      });
    }
  };

  if (fallbackTeamAssignment) {
    registerAllPairs(fallbackTeamAssignment);
  }
  
  Object.values(assignmentsByTournament).forEach((assignment) => {
    if (assignment) registerAllPairs(assignment);
  });

  sourceMatches.forEach((match) => {
    if (!isResultMatch(match)) return;

    const team1Key = getTeamKey(match.team1);
    const team2Key = getTeamKey(match.team2);
    const resolvedWinner = getResolvedWinner(match);
    const groupName = extractPairGroupLabel(match.court) || '기타 그룹';

    if (!pairStats[team1Key]) {
      pairStats[team1Key] = { groupName, matches: 0, wins: 0, losses: 0, draws: 0, pointsWon: 0, pointsLost: 0 };
    }
    if (!pairStats[team2Key]) {
      pairStats[team2Key] = { groupName, matches: 0, wins: 0, losses: 0, draws: 0, pointsWon: 0, pointsLost: 0 };
    }

    pairStats[team1Key].matches += 1;
    pairStats[team2Key].matches += 1;

    if (groupName && groupName !== '기타 그룹') {
      pairStats[team1Key].groupName = groupName;
      pairStats[team2Key].groupName = groupName;
    }

    const score1 = match.score_team1 ?? 0;
    const score2 = match.score_team2 ?? 0;

    pairStats[team1Key].pointsWon += score1;
    pairStats[team1Key].pointsLost += score2;

    pairStats[team2Key].pointsWon += score2;
    pairStats[team2Key].pointsLost += score1;

    if (resolvedWinner === 'team1') {
      pairStats[team1Key].wins += 1;
      pairStats[team2Key].losses += 1;
    } else if (resolvedWinner === 'team2') {
      pairStats[team2Key].wins += 1;
      pairStats[team1Key].losses += 1;
    } else {
      pairStats[team1Key].draws += 1;
      pairStats[team2Key].draws += 1;
    }
  });

  return pairStats;
}

export default function TournamentBracketView({ adminMode = false, homeHref: homeHrefOverride }: TournamentBracketViewProps) {
  const supabase = getSupabaseClient();
  const searchParams = useSearchParams();
  const { profile } = useUser();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teamAssignmentsByTournament, setTeamAssignmentsByTournament] = useState<TeamAssignmentMap>({});
  const [viewMode, setViewMode] = useState<'round' | 'court' | 'time'>('court');
  const [layoutMode, setLayoutMode] = useState<'card' | 'table'>('card');
  const [allTournamentsMatches, setAllTournamentsMatches] = useState<Match[]>([]);
  const [selectedCourtFilter, setSelectedCourtFilter] = useState<string>('all');

  const [batchCourts, setBatchCourts] = useState(4);
  const [batchStartTime, setBatchStartTime] = useState('17:30');
  const [batchInterval, setBatchInterval] = useState(10);
  const batchDate = '';
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editCourtDraft, setEditCourtDraft] = useState('');
  const [editTimeDraft, setEditTimeDraft] = useState('');

  const getMatchTournament = (match: Match) => {
    return tournaments.find((t) => t.id === match.tournament_id) || null;
  };

  const getMatchTournamentGroupLabel = (match: Match) => {
    const t = tournaments.find((x) => x.id === match.tournament_id);
    if (!t) return '';
    const formattedTitle = formatTournamentTitle(t.title);
    const prefixRegex = /^(대회\s*경기\s*\d{4}-\d{2}-\d{2})\s*(.*)$/u;
    const titleMatch = formattedTitle.match(prefixRegex);
    return formatGroupLabel(titleMatch ? titleMatch[2].trim() : formattedTitle);
  };
  const [tournamentMetrics, setTournamentMetrics] = useState<Record<string, TournamentMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, ScoreDraft>>({});
  const [availableTeams, setAvailableTeams] = useState<TeamAssignment[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamAssignment | null>(null);
  const [selectedTournamentAssignment, setSelectedTournamentAssignment] = useState<TeamAssignment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adminActiveTab, setAdminActiveTab] = useState<AdminTournamentTab>('overview');
  const [userActiveTab, setUserActiveTab] = useState<UserTournamentTab>('bracket');
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [submittedPlayerSearchQuery, setSubmittedPlayerSearchQuery] = useState('');
  const [refereeDrafts, setRefereeDrafts] = useState<Record<string, string>>({});
  const [rankingCriteria, setRankingCriteria] = useState<string[]>([
    'winRate',
    'pointsDiff',
    'h2h',
  ]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string; full_name: string; role: string } | null>(null);

  useEffect(() => {
    setSelectedCourtFilter('all');
  }, [viewMode]);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, role')
            .eq('id', user.id)
            .maybeSingle();

          setCurrentUser({
            id: user.id,
            full_name: profile?.full_name || '',
            role: profile?.role || 'member',
          });
        }
      } catch (err) {
        console.error('사용자 정보 로드 실패:', err);
      }
    };
    void fetchUser();
  }, [supabase]);

  const getDisplayRefereeName = (match: Match) => {
    if (match.referee_name) {
      return match.referee_name;
    }

    const currentRound = match.round || 1;
    const currentMatchNum = match.match_number || 0;
    const courtName = match.court || '';

    const precedingMatches = matches.filter((m) => {
      if (m.court !== courtName || m.id === match.id) return false;
      return (
        (m.round || 1) < currentRound ||
        ((m.round || 1) === currentRound && (m.match_number || 0) < currentMatchNum)
      );
    });

    if (precedingMatches.length === 0) {
      return null;
    }

    precedingMatches.sort((a, b) => {
      const roundDiff = (b.round || 1) - (a.round || 1);
      if (roundDiff !== 0) return roundDiff;
      return (b.match_number || 0) - (a.match_number || 0);
    });

    const precedingMatch = precedingMatches[0];
    if (precedingMatch.status !== 'completed') {
      return null;
    }

    const winner = precedingMatch.winner;
    let winningPlayers: string[] = [];
    if (winner === 'team1') {
      winningPlayers = precedingMatch.team1 || [];
    } else if (winner === 'team2') {
      winningPlayers = precedingMatch.team2 || [];
    }

    if (winningPlayers.length > 0) {
      return winningPlayers.map((name) => name.replace(/\([^)]*\)$/, '').trim()).join(', ');
    }

    return null;
  };

  const getRefereeOptions = (match: Match) => {
    const inProgressPlayers = new Set<string>();
    const currentMatchPlayers = new Set<string>();
    const nextMatchPlayers = new Set<string>();

    if (Array.isArray(match.team1)) {
      match.team1.forEach((p) => currentMatchPlayers.add(p.replace(/\([^)]*\)$/, '').trim().toLowerCase()));
    }
    if (Array.isArray(match.team2)) {
      match.team2.forEach((p) => currentMatchPlayers.add(p.replace(/\([^)]*\)$/, '').trim().toLowerCase()));
    }

    matches.forEach((m) => {
      if (m.status === 'in_progress') {
        if (Array.isArray(m.team1)) {
          m.team1.forEach((p) => inProgressPlayers.add(p.replace(/\([^)]*\)$/, '').trim().toLowerCase()));
        }
        if (Array.isArray(m.team2)) {
          m.team2.forEach((p) => inProgressPlayers.add(p.replace(/\([^)]*\)$/, '').trim().toLowerCase()));
        }
      }
    });

    const currentRound = match.round || 1;
    const currentMatchNum = match.match_number || 0;
    const courtName = match.court || '';

    const futureCourtMatches = matches.filter((m) => {
      if (m.court !== courtName || m.id === match.id) return false;
      return (
        (m.round || 1) > currentRound ||
        ((m.round || 1) === currentRound && (m.match_number || 0) > currentMatchNum)
      );
    });

    futureCourtMatches.sort((a, b) => {
      const roundDiff = (a.round || 1) - (b.round || 1);
      if (roundDiff !== 0) return roundDiff;
      return (a.match_number || 0) - (b.match_number || 0);
    });

    if (futureCourtMatches.length > 0) {
      const nextMatch = futureCourtMatches[0];
      if (Array.isArray(nextMatch.team1)) {
        nextMatch.team1.forEach((p) => nextMatchPlayers.add(p.replace(/\([^)]*\)$/, '').trim().toLowerCase()));
      }
      if (Array.isArray(nextMatch.team2)) {
        nextMatch.team2.forEach((p) => nextMatchPlayers.add(p.replace(/\([^)]*\)$/, '').trim().toLowerCase()));
      }
    }

    const excludedPlayers = new Set<string>([
      ...inProgressPlayers,
      ...currentMatchPlayers,
      ...nextMatchPlayers,
    ]);

    const playerMatchesMap = new Map<string, number[]>();
    matches.forEach((m) => {
      const mNum = m.match_number;
      const teamPlayers = [...(m.team1 || []), ...(m.team2 || [])];
      teamPlayers.forEach((p) => {
        const cleanName = p.replace(/\([^)]*\)$/, '').trim().toLowerCase();
        if (cleanName) {
          const nums = playerMatchesMap.get(cleanName) || [];
          if (!nums.includes(mNum)) {
            nums.push(mNum);
          }
          playerMatchesMap.set(cleanName, nums);
        }
      });
    });

    const eligibleReferees = profiles.filter((p) => {
      const name = p.full_name?.trim();
      if (!name) return false;
      const cleanNameLower = name.toLowerCase();
      
      // 경기에 참가한 선수만 드롭다운에 표시되도록 제한
      if (!playerMatchesMap.has(cleanNameLower)) return false;
      
      return !excludedPlayers.has(cleanNameLower) || (match.referee_name && match.referee_name.toLowerCase().includes(cleanNameLower));
    });

    const sortedReferees = [...eligibleReferees].sort((a, b) => 
      (a.full_name || '').localeCompare(b.full_name || '', 'ko-KR')
    );

    return sortedReferees.map((p) => {
      const cleanNameLower = (p.full_name || '').trim().toLowerCase();
      const playerMatchNums = playerMatchesMap.get(cleanNameLower) || [];
      const matchSuffix = playerMatchNums.length > 0 ? ` (${playerMatchNums.sort((a, b) => a - b).join(', ')}경기)` : '';

      return (
        <option key={p.id} value={p.full_name || ''}>
          {p.full_name}{matchSuffix}
        </option>
      );
    });
  };

  useEffect(() => {
    if (selectedTournament?.match_type) {
      const matchType = selectedTournament.match_type;
      if (matchType.startsWith('pairs_custom:')) {
        const criteriaParts = matchType.split(':')[1]?.split(',').filter(Boolean);
        if (criteriaParts && criteriaParts.length === 3) {
          setRankingCriteria(criteriaParts);
          return;
        }
      }
    }
    setRankingCriteria(['winRate', 'pointsDiff', 'h2h']);
  }, [selectedTournament]);

  const handleCriteriaChange = (index: number, value: string) => {
    const next = [...rankingCriteria];
    const prevVal = next[index];
    const duplicateIndex = next.indexOf(value);
    if (duplicateIndex !== -1) {
      next[duplicateIndex] = prevVal;
    }
    next[index] = value;
    setRankingCriteria(next);
  };

  const saveRankingCriteria = async () => {
    if (!selectedTournament) return;
    try {
      const nextMatchType = `pairs_custom:${rankingCriteria.join(',')}`;
      const { error } = await supabase
        .from('tournaments')
        .update({ match_type: nextMatchType })
        .eq('id', selectedTournament.id);

      if (error) throw error;

      setSelectedTournament((prev) => (prev ? { ...prev, match_type: nextMatchType } : null));
      alert('순위 결정 기준이 영구 저장되었습니다!');
    } catch (error) {
      console.error('순위 기준 저장 실패:', error);
      alert(getFriendlyErrorMessage(error));
    }
  };


  const tournamentQueryId = searchParams.get('tournament');

  const getTodayLocal = () => getKoreaDate();

  const getTournamentMetricsFromMatches = (tournamentMatches: Match[]): TournamentMetrics => {
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
        uniqueTeams.add(team1.join(' / '));
        team1.forEach((player) => uniquePlayers.add(player));
      }

      if (team2.length > 0) {
        uniqueTeams.add(team2.join(' / '));
        team2.forEach((player) => uniquePlayers.add(player));
      }
    });

    return {
      matchCount: normalizedMatches.length,
      teamCount: uniqueTeams.size,
      playerCount: uniquePlayers.size,
      roundCount: uniqueRounds.size,
    };
  };

  const fetchTournamentMetrics = async (tournamentList: Tournament[]) => {
    if (!adminMode) {
      return;
    }

    if (tournamentList.length === 0) {
      setTournamentMetrics({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from('tournament_matches')
        .select('tournament_id, round, match_number, team1, team2, court, scheduled_time, status, score_team1, score_team2, winner');

      if (error && error.code !== '42P01') {
        throw error;
      }

      const groupedMatches = new Map<string, Match[]>();
      ((data || []) as Match[]).forEach((match) => {
        if (!match.tournament_id) return;
        const current = groupedMatches.get(match.tournament_id) || [];
        current.push(match);
        groupedMatches.set(match.tournament_id, current);
      });

      const nextMetrics = Object.fromEntries(
        tournamentList.map((tournament) => {
          const tournamentMatches = groupedMatches.get(tournament.id) || [];
          return [tournament.id, getTournamentMetricsFromMatches(tournamentMatches)];
        })
      );

      setTournamentMetrics(nextMetrics);
    } catch (error) {
      console.error('대회 통계 조회 오류:', error);
      setTournamentMetrics({});
    }
  };

  const fetchMatches = async (tournamentId: string, currentTournamentsList: Tournament[] = tournaments) => {
    try {
      const targets = currentTournamentsList.length > 0
        ? currentTournamentsList
        : tournaments.length > 0
          ? tournaments
          : selectedTournament
            ? [selectedTournament]
            : [];

      if (targets.length === 0) {
        const endpoint = adminMode ? '/api/admin/tournaments' : '/api/tournaments';
        const params = new URLSearchParams({
          include_matches: '1',
          tournament_id: tournamentId,
        });
        const response = await fetch(`${endpoint}?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '대회 데이터를 불러오지 못했습니다.');
        }
        const singleMatches = normalizeMatches(Array.isArray(payload?.matches) ? payload.matches : []);
        setMatches(singleMatches);
        setAllTournamentsMatches(singleMatches);
        if (payload?.selectedTournament) {
          setSelectedTournament(payload.selectedTournament);
        }
        setSelectedTournamentAssignment(
          adminMode
            ? (payload?.selectedTeamAssignment ? mapTeamAssignmentRow(payload.selectedTeamAssignment) : null)
            : (payload?.selectedTeamAssignment || null)
        );
        if (adminMode && Array.isArray(payload?.profiles)) {
          setProfiles(payload.profiles);
        }
        if (!adminMode && payload?.teamAssignmentsByTournament) {
          setTeamAssignmentsByTournament(mapTeamAssignmentMap(payload.teamAssignmentsByTournament));
        }
        setLoadError(null);
        return;
      }

      const results = await Promise.all(
        targets.map(async (t) => {
          const endpoint = adminMode ? '/api/admin/tournaments' : '/api/tournaments';
          const params = new URLSearchParams({
            include_matches: '1',
            tournament_id: t.id,
          });
          const response = await fetch(`${endpoint}?${params.toString()}`, {
            method: 'GET',
            cache: 'no-store',
          });
          const payload = await response.json().catch(() => null);
          return {
            tournamentId: t.id,
            ok: response.ok,
            error: payload?.error,
            matches: Array.isArray(payload?.matches) ? payload.matches : [],
            selectedTournament: payload?.selectedTournament || null,
            selectedTeamAssignment: payload?.selectedTeamAssignment || null,
            profiles: payload?.profiles || [],
            teamAssignmentsByTournament: payload?.teamAssignmentsByTournament || null,
          };
        })
      );

      const failed = results.find((r) => !r.ok);
      if (failed) {
        throw new Error(failed.error || '대회 데이터를 불러오지 못했습니다.');
      }

      const allFetched = results.flatMap((r) => r.matches);
      const targetIds = new Set(results.map((r) => r.tournamentId).filter(Boolean) as string[]);

      setAllTournamentsMatches((prev) => {
        const unchanged = prev.filter((m) => !m.tournament_id || !targetIds.has(m.tournament_id));
        return normalizeMatches([...unchanged, ...allFetched]);
      });

      const activeResult = results.find((r) => r.tournamentId === tournamentId);
      const activeMatches = activeResult 
        ? normalizeMatches(activeResult.matches)
        : [];
      setMatches(activeMatches);

      if (activeResult) {
        if (activeResult.selectedTournament) {
          setSelectedTournament(activeResult.selectedTournament);
        }
        setSelectedTournamentAssignment(
          adminMode
            ? (activeResult.selectedTeamAssignment ? mapTeamAssignmentRow(activeResult.selectedTeamAssignment) : null)
            : (activeResult.selectedTeamAssignment || null)
        );
        if (adminMode && Array.isArray(activeResult.profiles)) {
          setProfiles(activeResult.profiles);
        }
      }

      if (!adminMode) {
        setTeamAssignmentsByTournament((prev) => {
          const nextAssignments = { ...prev };
          results.forEach((r) => {
            if (r.teamAssignmentsByTournament) {
              Object.assign(nextAssignments, mapTeamAssignmentMap(r.teamAssignmentsByTournament));
            }
          });
          return nextAssignments;
        });
      }

      setLoadError(null);
    } catch (error) {
      console.error('경기 조회 오류:', error);
      setMatches([]);
      setAllTournamentsMatches([]);
      setLoadError(error instanceof Error ? error.message : '경기 데이터를 불러오지 못했습니다.');
    }
  };

  const normalizeMatches = (data: Match[]) =>
    (data || [])
      .map((match) => ({
        ...match,
        scheduled_time: match.scheduled_time || null,
        status: match.status || 'pending',
        score_team1: match.score_team1 ?? null,
        score_team2: match.score_team2 ?? null,
        winner: getResolvedWinner(match),
      }))
      .sort((left, right) => {
        const roundDiff = (left.round || 0) - (right.round || 0);
        if (roundDiff !== 0) {
          return roundDiff;
        }
        return (left.match_number || 0) - (right.match_number || 0);
      });

  const handleApplyCourtAndTimeBatch = async () => {
    if (!selectedTournament) {
      alert('대회를 선택하세요.');
      return;
    }

    // Gather ALL matches from all tournaments on the same date
    const sameDateTournaments = tournaments.filter(
      (t) => t.tournament_date === selectedTournament.tournament_date
    );
    const sameDateTournamentIds = new Set(sameDateTournaments.map((t) => t.id));

    // Use allTournamentsMatches filtered to same date, or fall back to matches
    const allMatchesForDate = allTournamentsMatches.filter(
      (m) => m.tournament_id && sameDateTournamentIds.has(m.tournament_id)
    );
    const targetMatches = allMatchesForDate.length > 0 ? allMatchesForDate : matches;

    if (targetMatches.length === 0) {
      alert('배정할 경기가 없습니다.');
      return;
    }
    
    if (!confirm(`같은 날짜(${selectedTournament.tournament_date})의 모든 경기(${targetMatches.length}개)에 코트와 시간을 일괄 배정하고 저장하시겠습니까?`)) {
      return;
    }

    setApplyingBatch(true);
    try {
      const C = batchCourts > 0 ? batchCourts : 4;
      const baseDate = batchDate || selectedTournament.tournament_date || '2026-07-01';
      const sTime = batchStartTime || '17:30';
      const interval = batchInterval || 10;

      // Keep bracket round and match numbers intact. Empty bracket slots are scheduled
      // after playable matches in round order, so semifinals always precede the final.
      const optimized = scheduleMatchesWithBracketStages(targetMatches, C, baseDate, sTime, interval);

      // Batch update DB
      const matchesToUpdate = optimized.filter(m => m.id).map(m => ({
        id: m.id,
        court: m.court,
        scheduled_time: m.scheduled_time,
      }));

      if (matchesToUpdate.length > 0) {
        const response = await fetch('/api/admin/tournament-matches/batch-update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matches: matchesToUpdate })
        });

        if (!response.ok) {
          const resData = await response.json().catch(() => null);
          throw new Error(resData?.error || '일괄 업데이트에 실패했습니다.');
        }
      }

      alert(`코트와 시간 일괄 배정이 완료되었습니다. (${matchesToUpdate.length}경기)`);
      // Reload all tournaments to refresh the view
      await fetchMatches(selectedTournament.id);
    } catch (error: any) {
      console.error('일괄 배정 오류:', error);
      alert('일괄 배정 처리 중 오류가 발생했습니다: ' + error.message);
    } finally {
      setApplyingBatch(false);
    }
  };

  const handleUpdateMatchSchedule = async (matchId: string, newCourt: string, newTime: string) => {
    try {
      let finalTime: string | null = null;
      if (newTime) {
        const baseDate = selectedTournament?.tournament_date || '2026-07-01';
        finalTime = `${baseDate}T${newTime}:00`;
      }

      const response = await fetch('/api/admin/tournament-matches/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId,
          court: newCourt || null,
          scheduled_time: finalTime
        })
      });

      if (!response.ok) {
        const resData = await response.json().catch(() => null);
        throw new Error(resData?.error || '일정 수정에 실패했습니다.');
      }

      setMatches((prev) =>
        prev.map((m) => (m.id === matchId ? { ...m, court: newCourt, scheduled_time: finalTime } : m))
      );
      setEditingMatchId(null);
    } catch (error: any) {
      console.error('개별 경기 일정 수정 오류:', error);
      alert('일정 수정 중 오류가 발생했습니다: ' + error.message);
    }
  };

  const getTeamCountFromAssignment = (teamAssignment: TeamAssignment) => {
    if (teamAssignment.team_type === 'pairs') {
      return Object.keys(teamAssignment.pairs_data || {}).length;
    }

    const groups = [
      teamAssignment.racket_team,
      teamAssignment.shuttle_team,
      teamAssignment.team1,
      teamAssignment.team2,
      teamAssignment.team3,
      teamAssignment.team4,
    ];

    return groups.filter((group) => Array.isArray(group) && group.length > 0).length;
  };

  const fetchSelectedTournamentAssignment = async (tournament: Tournament | null) => {
    const assignmentId = tournament?.team_assignment_id;

    if (!assignmentId) {
      setSelectedTournamentAssignment(null);
      return;
    }

    const cachedAssignment = availableTeams.find((team) => team.id === assignmentId);
    if (cachedAssignment) {
      setSelectedTournamentAssignment(cachedAssignment);
      return;
    }

    if (adminMode) {
      return;
    }

    try {
      const params = new URLSearchParams({
        include_matches: '1',
        tournament_id: tournament?.id || '',
      });

      const response = await fetch(`/api/tournaments?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || '팀 구성을 불러오지 못했습니다.');
      }

      setSelectedTournamentAssignment(payload?.selectedTeamAssignment || null);
    } catch (error) {
      console.error('선택 대회 팀 구성 조회 실패:', error);
      setSelectedTournamentAssignment(null);
    }
  };

  const handleSelectTournament = async (tournament: Tournament) => {
    setSelectedTournament(tournament);
    await fetchSelectedTournamentAssignment(tournament);
    await fetchMatches(tournament.id, tournaments);
  };

  const fetchTournaments = async () => {
    try {
      setLoadError(null);

      if (adminMode) {
        const params = new URLSearchParams({ include_matches: '1' });
        if (tournamentQueryId) {
          params.set('tournament_id', tournamentQueryId);
        }

        const response = await fetch(`/api/admin/tournaments?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.error || '관리자 대회 데이터를 불러오지 못했습니다.');
        }

        const tournamentList = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
        const selected = payload?.selectedTournament || null;
        const selectedAssignment = payload?.selectedTeamAssignment
          ? mapTeamAssignmentRow(payload.selectedTeamAssignment)
          : null;

        setTournaments(tournamentList);
        setSelectedTournament(selected);
        setSelectedTournamentAssignment(selectedAssignment);
        if (selected) {
          await fetchMatches(selected.id, tournamentList);
        }
        if (Array.isArray(payload?.profiles)) {
          setProfiles(payload.profiles);
        }
        await fetchTournamentMetrics(tournamentList);
        return;
      }

      const params = new URLSearchParams({ include_matches: '1' });
      if (tournamentQueryId) {
        params.set('tournament_id', tournamentQueryId);
      }

      const response = await fetch(`/api/tournaments?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || '대회 데이터를 불러오지 못했습니다.');
      }

      const tournamentList = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
      setTournaments(tournamentList);
      setTournamentMetrics(payload?.metricsByTournament && typeof payload.metricsByTournament === 'object' ? payload.metricsByTournament : {});
      const selected = payload?.selectedTournament || null;
      setSelectedTournament(selected);
      setSelectedTournamentAssignment(payload?.selectedTeamAssignment || null);
      setTeamAssignmentsByTournament(mapTeamAssignmentMap(payload?.teamAssignmentsByTournament));
      if (selected) {
        await fetchMatches(selected.id, tournamentList);
      }
    } catch (error) {
      console.error('대회 조회 오류:', error);
      setTournaments([]);
      setTournamentMetrics({});
      setSelectedTournament(null);
      setSelectedTournamentAssignment(null);
      setTeamAssignmentsByTournament({});
      setMatches([]);
      setLoadError(error instanceof Error ? error.message : '대회 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableTeams = async () => {
    if (!adminMode) {
      setAvailableTeams([]);
      return;
    }

    try {
      const today = getTodayLocal();
      const { data, error } = await supabase
        .from('team_assignments')
        .select('*')
        .eq('assignment_date', today)
        .order('round_number', { ascending: false });

      if (error) throw error;

      setAvailableTeams((data || []).map((team) => mapTeamAssignmentRow(team)));
    } catch (error) {
      console.error('팀 구성 조회 실패:', error);
      setAvailableTeams([]);
    }
  };

  useEffect(() => {
    void fetchTournaments();
    void fetchAvailableTeams();
  }, [tournamentQueryId]);

  useEffect(() => {
    if (!adminMode) return;
    setAdminActiveTab('overview');
  }, [adminMode, tournamentQueryId]);

  // Realtime 구독 - 점수 실시간 갱신
  useEffect(() => {
    if (tournaments.length === 0) return;
    if (!supabase || !supabase.channel) return;

    const tournamentIds = tournaments.map((t) => t.id);

    const channel = supabase
      .channel(`tournament-scores-global`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournament_matches',
        },
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.id || !updated.tournament_id) return;

          if (!tournamentIds.includes(updated.tournament_id)) return;

          const updatedMatch = {
            id: updated.id,
            tournament_id: updated.tournament_id,
            round: updated.round,
            match_number: updated.match_number,
            team1: toStringArray(updated.team1),
            team2: toStringArray(updated.team2),
            court: updated.court,
            status: updated.status,
            score_team1: updated.score_team1,
            score_team2: updated.score_team2,
            winner: updated.winner,
            referee_name: updated.referee_name,
            referee_id: updated.referee_id,
          };

          setAllTournamentsMatches((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updatedMatch } : m))
          );

          if (updated.tournament_id === selectedTournament?.id) {
            setMatches((prev) =>
              prev.map((m) => (m.id === updated.id ? { ...m, ...updatedMatch } : m))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tournaments, selectedTournament?.id, supabase]);

  // 심판 배정 함수
  const assignReferee = async (matchId: string, refereeName: string) => {
    try {
      const response = await fetch('/api/admin/tournaments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId,
          referee_name: refereeName || null,
        }),
      });

      if (!response.ok) {
        throw new Error('심판 배정에 실패했습니다.');
      }

      // 로컬 상태 업데이트
      setMatches((prev) =>
        prev.map((m) =>
          m.id === matchId ? { ...m, referee_name: refereeName || null } : m
        )
      );
    } catch (error) {
      console.error('심판 배정 오류:', error);
      alert(getFriendlyErrorMessage(error));
    }
  };

  useEffect(() => {
    setScoreDrafts(
      Object.fromEntries(
        matches
          .filter((match): match is Match & { id: string } => Boolean(match.id))
          .map((match) => [
            match.id,
            {
              score1: match.score_team1 != null ? String(match.score_team1) : '',
              score2: match.score_team2 != null ? String(match.score_team2) : '',
            },
          ])
      )
    );
  }, [matches]);

  const generateMatchesFromTeam = async (teamAssignment: TeamAssignment, matchesPerPlayer: number, matchType: string) => {
    if (!teamAssignment) return [] as Match[];

    const isMultiTeam = teamAssignment.team_type === '2teams' || 
                        (teamAssignment.racket_team && teamAssignment.racket_team.length > 0 && 
                         teamAssignment.shuttle_team && teamAssignment.shuttle_team.length > 0);

    if (isMultiTeam) {
      const racketPlayers = (teamAssignment.racket_team || []).map(p => p.trim()).filter(Boolean);
      const shuttlePlayers = (teamAssignment.shuttle_team || []).map(p => p.trim()).filter(Boolean);

      if (racketPlayers.length < 2 || shuttlePlayers.length < 2) {
        alert('각 팀에 최소 2명의 선수가 필요합니다.');
        return [];
      }

      const playerMatchCount: Record<string, number> = {};
      [...racketPlayers, ...shuttlePlayers].forEach(p => playerMatchCount[p] = 0);

      const finalMatches: Match[] = [];
      const totalRounds = Math.max(1, matchesPerPlayer);
      let currentMatchNumber = 1;

      for (let round = 1; round <= totalRounds; round += 1) {
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

          finalMatches.push({
            round,
            match_number: currentMatchNumber,
            team1,
            team2,
            court: `Court ${((currentMatchNumber - 1) % 4) + 1}`,
            status: 'pending',
          });

          [...team1, ...team2].forEach(p => {
            playerMatchCount[p] = (playerMatchCount[p] || 0) + 1;
          });

          currentMatchNumber += 1;
        }
      }

      // 목표 경기수 미달 선수 구제 로직 (Multi-team 버전)
      const maxTotalMatches = Math.ceil((([...racketPlayers, ...shuttlePlayers].length) * totalRounds) / 4);
      while (finalMatches.length < maxTotalMatches) {
        const unplayedRacket = racketPlayers.filter(p => (playerMatchCount[p] || 0) < totalRounds);
        const unplayedShuttle = shuttlePlayers.filter(p => (playerMatchCount[p] || 0) < totalRounds);

        if (unplayedRacket.length === 0 && unplayedShuttle.length === 0) {
          break;
        }

        const getPair = (pool: string[]) => {
          const sorted = [...pool].sort((a, b) => {
            const aCount = playerMatchCount[a] || 0;
            const bCount = playerMatchCount[b] || 0;
            const aIsUnplayed = aCount < totalRounds ? 1 : 0;
            const bIsUnplayed = bCount < totalRounds ? 1 : 0;
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

        finalMatches.push({
          round: totalRounds + 1,
          match_number: currentMatchNumber,
          team1,
          team2,
          court: `Court ${((currentMatchNumber - 1) % 4) + 1}`,
          status: 'pending',
        });

        [...team1, ...team2].forEach(p => {
          playerMatchCount[p] = (playerMatchCount[p] || 0) + 1;
        });

        currentMatchNumber += 1;
      }

      const maxCourts = 4;
      const baseDate = teamAssignment.assignment_date || '2026-07-01';
      const startTime = '17:30';
      const timeInterval = 10;
      return avoidConsecutiveMatches(finalMatches, maxCourts, baseDate, startTime, timeInterval);
    }

    const playerList: string[] = [];

    if (teamAssignment.team_type === 'pairs' && teamAssignment.pairs_data) {
      Object.values(teamAssignment.pairs_data).forEach((players) => {
        playerList.push(...(Array.isArray(players) ? players : []));
      });
    } else if (teamAssignment.racket_team && teamAssignment.shuttle_team) {
      playerList.push(...(Array.isArray(teamAssignment.racket_team) ? teamAssignment.racket_team : []));
      playerList.push(...(Array.isArray(teamAssignment.shuttle_team) ? teamAssignment.shuttle_team : []));
    }

    const uniquePlayers = [...new Set(playerList)]
      .filter((player) => player && typeof player === 'string')
      .map((player) => player.trim());

    if (uniquePlayers.length < 4) {
      alert('최소 4명의 선수가 필요합니다.');
      return [];
    }

    const players = uniquePlayers.map((name, index) => {
      const extractedLevelMatch = name.match(/\(([^)]+)\)(?!.*\()$/);
      const extractedLevel = extractedLevelMatch?.[1]?.trim().toLowerCase() || 'e2';

      return {
        id: `player-${index}-${Date.now()}`,
        name,
        skill_level: extractedLevel,
        skill_label: extractedLevel.toUpperCase(),
        skill_code: extractedLevel,
        gender: 'mixed' as const,
      };
    });

    let generatedMatches: any[] = [];

    try {
      if (matchType === 'level_based') {
        const { createBalancedDoublesMatches } = await import('@/utils/match-utils');
        generatedMatches = createBalancedDoublesMatches(players, 1);
      } else if (matchType === 'mixed_doubles') {
        const { createMixedAndSameSexDoublesMatches } = await import('@/utils/match-utils');
        generatedMatches = createMixedAndSameSexDoublesMatches(players, 1);
      } else {
        const { createRandomBalancedDoublesMatches } = await import('@/utils/match-utils');
        generatedMatches = createRandomBalancedDoublesMatches(players, 1);
      }
    } catch (error) {
      console.error('경기 생성 함수 로드 오류:', error);
      return [];
    }

    const finalMatches: Match[] = [];
    const maxRounds = Math.max(1, matchesPerPlayer);
    let currentMatchNumber = 1;
    let roundIndex = 0;

    for (let round = 1; round <= maxRounds; round += 1) {
      const matchesPerRound = Math.ceil(uniquePlayers.length / 4);

      for (let index = 0; index < matchesPerRound; index += 1) {
        if (roundIndex >= generatedMatches.length) {
          const shuffled = [...uniquePlayers].sort(() => Math.random() - 0.5);

          for (let shuffleIndex = 0; shuffleIndex < shuffled.length - 3; shuffleIndex += 4) {
            const group = shuffled.slice(shuffleIndex, shuffleIndex + 4);
            if (group.length !== 4) continue;

            const team1 = [group[0], group[1]];
            const team2 = [group[2], group[3]];
            const courtNumber = ((currentMatchNumber - 1) % 4) + 1;

            finalMatches.push({
              round,
              match_number: currentMatchNumber,
              team1,
              team2,
              court: `Court ${courtNumber}`,
              status: 'pending',
            });
            currentMatchNumber += 1;
          }

          break;
        }

        const match = generatedMatches[roundIndex];
        const courtNumber = ((currentMatchNumber - 1) % 4) + 1;

        finalMatches.push({
          round,
          match_number: currentMatchNumber,
          team1: match.team1.map((player: any) => player.name || player),
          team2: match.team2.map((player: any) => player.name || player),
          court: `Court ${courtNumber}`,
          status: 'pending',
        });

        currentMatchNumber += 1;
        roundIndex += 1;
      }
    }

    const maxCourts = 4;
    const baseDate = teamAssignment.assignment_date || '2026-07-01';
    const startTime = '17:30';
    const timeInterval = 10;
    return avoidConsecutiveMatches(finalMatches, maxCourts, baseDate, startTime, timeInterval);
  };

  const createTournamentWithMatches = async (matchesPerPlayer: number, matchType: string) => {
    if (!selectedTeam) {
      alert('팀 구성을 선택해주세요.');
      return;
    }

    try {
      const generatedMatches = await generateMatchesFromTeam(selectedTeam, matchesPerPlayer, matchType);

      if (generatedMatches.length === 0) {
        alert('생성할 경기가 없습니다.');
        return;
      }

      const matchTypeLabel = getMatchTypeLabel(matchType);
      const tournamentTitle = `대회 경기 ${selectedTeam.round_number}회차 ${matchTypeLabel}`;
      const teamCount = getTeamCountFromAssignment(selectedTeam);
      const tournamentPayload = {
        title: tournamentTitle,
        tournament_date: selectedTeam.assignment_date,
        round_number: selectedTeam.round_number || 1,
        match_type: matchType,
        team_assignment_id: selectedTeam.id,
        team_type: selectedTeam.team_type,
        total_teams: teamCount,
        matches_per_player: matchesPerPlayer,
      };

      if (adminMode) {
        const response = await fetch('/api/admin/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournament: tournamentPayload, matches: generatedMatches }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '대회 생성에 실패했습니다.');
        }
      } else {
        const { data: tournamentData, error: tournamentError } = await supabase
          .from('tournaments')
          .insert({ ...tournamentPayload, club_id: (selectedTeam as any).club_id })
          .select()
          .single();

        if (tournamentError) throw tournamentError;

        const matchesToInsert = generatedMatches.map((match) => ({
          ...match,
          tournament_id: tournamentData.id,
          club_id: (selectedTeam as any).club_id,
        }));

        const { error: matchesError } = await supabase.from('tournament_matches').insert(matchesToInsert);
        if (matchesError) throw matchesError;
      }

      alert(`대회가 생성되었습니다! (${generatedMatches.length}개 경기)`);
      await fetchTournaments();
      setSelectedTeam(null);
    } catch (error) {
      console.error('대회 생성 오류:', error);
      alert(getFriendlyErrorMessage(error));
    }
  };

  const updateMatchScore = async (matchId: string, scoreTeam1: number, scoreTeam2: number) => {
    try {
      if (adminMode) {
        const response = await fetch('/api/admin/tournaments', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            match_id: matchId,
            score_team1: scoreTeam1,
            score_team2: scoreTeam2,
          }),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.error || '점수 저장에 실패했습니다.');
        }
      } else {
        const winner = scoreTeam1 > scoreTeam2 ? 'team1' : scoreTeam2 > scoreTeam1 ? 'team2' : 'draw';

        const { error } = await supabase
          .from('tournament_matches')
          .update({
            score_team1: scoreTeam1,
            score_team2: scoreTeam2,
            winner,
            status: 'completed',
          })
          .eq('id', matchId);

        if (error) throw error;
      }

      if (selectedTournament) {
        await fetchMatches(selectedTournament.id, [selectedTournament]);
      }

      alert('점수가 저장되었습니다!');
    } catch (error) {
      console.error('점수 저장 오류:', error);
      alert(getFriendlyErrorMessage(error));
    }
  };

  const getPlayerStats = (sourceMatches: Match[], assignmentsByTournament: TeamAssignmentMap, fallbackTeamAssignment?: TeamAssignment | null) => {
    const playerStats: Record<string, { matches: number; wins: number; losses: number; draws: number; teamLabel: string }> = {};

    sourceMatches.forEach((match) => {
      if (!isResultMatch(match)) return;

      const playerToTeamLabel = new Map<string, string>();
      const teamAssignment =
        (match.tournament_id ? assignmentsByTournament[match.tournament_id] : null) ||
        fallbackTeamAssignment ||
        null;

      if (teamAssignment) {
        getAssignmentTeamGroups(teamAssignment).forEach((group) => {
          group.players.forEach((player) => playerToTeamLabel.set(player.trim(), group.label));
        });
      }

      const resolvedWinner = getResolvedWinner(match);

      match.team1.forEach((player) => {
        if (!playerStats[player]) {
          playerStats[player] = {
            matches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            teamLabel: playerToTeamLabel.get(player.trim()) || '미지정',
          };
        }
        playerStats[player].matches += 1;
        if (resolvedWinner === 'team1') playerStats[player].wins += 1;
        else if (resolvedWinner === 'team2') playerStats[player].losses += 1;
        else playerStats[player].draws += 1;
      });

      match.team2.forEach((player) => {
        if (!playerStats[player]) {
          playerStats[player] = {
            matches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            teamLabel: playerToTeamLabel.get(player.trim()) || '미지정',
          };
        }
        playerStats[player].matches += 1;
        if (resolvedWinner === 'team2') playerStats[player].wins += 1;
        else if (resolvedWinner === 'team1') playerStats[player].losses += 1;
        else playerStats[player].draws += 1;
      });
    });

    return playerStats;
  };

  const getTeamStats = (sourceMatches: Match[], assignmentsByTournament: TeamAssignmentMap, fallbackTeamAssignment?: TeamAssignment | null) => {
    const teamStats: Record<string, { matches: number; wins: number; losses: number; draws: number }> = {};

    sourceMatches.forEach((match) => {
      if (!isResultMatch(match)) return;

      const playerToTeamLabel = new Map<string, string>();
      const teamAssignment =
        (match.tournament_id ? assignmentsByTournament[match.tournament_id] : null) ||
        fallbackTeamAssignment ||
        null;
      const hasOriginalTeamMapping = Boolean(teamAssignment);

      if (teamAssignment) {
        const teamGroups = getAssignmentTeamGroups(teamAssignment);

        teamGroups.forEach((group) => {
          if (!teamStats[group.label]) {
            teamStats[group.label] = { matches: 0, wins: 0, losses: 0, draws: 0 };
          }
          group.players.forEach((player) => playerToTeamLabel.set(player.trim(), group.label));
        });
      }

      const resolvedWinner = getResolvedWinner(match);
      const team1Labels = [...new Set(match.team1.map((player) => playerToTeamLabel.get(player.trim())).filter(Boolean))] as string[];
      const team2Labels = [...new Set(match.team2.map((player) => playerToTeamLabel.get(player.trim())).filter(Boolean))] as string[];

      if (hasOriginalTeamMapping) {
        if (team1Labels.length !== 1 || team2Labels.length !== 1) {
          return;
        }

        team1Labels.forEach((label) => {
          if (!teamStats[label]) {
            teamStats[label] = { matches: 0, wins: 0, losses: 0, draws: 0 };
          }

          teamStats[label].matches += 1;
          if (resolvedWinner === 'team1') teamStats[label].wins += 1;
          else if (resolvedWinner === 'team2') teamStats[label].losses += 1;
          else teamStats[label].draws += 1;
        });

        team2Labels.forEach((label) => {
          if (!teamStats[label]) {
            teamStats[label] = { matches: 0, wins: 0, losses: 0, draws: 0 };
          }

          teamStats[label].matches += 1;
          if (resolvedWinner === 'team2') teamStats[label].wins += 1;
          else if (resolvedWinner === 'team1') teamStats[label].losses += 1;
          else teamStats[label].draws += 1;
        });

        return;
      }

      const team1Key = getTeamKey(match.team1);
      const team2Key = getTeamKey(match.team2);

      if (!teamStats[team1Key]) {
        teamStats[team1Key] = { matches: 0, wins: 0, losses: 0, draws: 0 };
      }

      if (!teamStats[team2Key]) {
        teamStats[team2Key] = { matches: 0, wins: 0, losses: 0, draws: 0 };
      }

      teamStats[team1Key].matches += 1;
      teamStats[team2Key].matches += 1;

      if (resolvedWinner === 'team1') {
        teamStats[team1Key].wins += 1;
        teamStats[team2Key].losses += 1;
      } else if (resolvedWinner === 'team2') {
        teamStats[team2Key].wins += 1;
        teamStats[team1Key].losses += 1;
      } else {
        teamStats[team1Key].draws += 1;
        teamStats[team2Key].draws += 1;
      }
    });

    return teamStats;
  };
  const resultsSourceMatches = matches;
  const resultsTeamAssignment = selectedTournamentAssignment;
  const resultsAssignmentsByTournament = adminMode
    ? (selectedTournament?.id ? { [selectedTournament.id]: selectedTournamentAssignment } : {})
    : teamAssignmentsByTournament;
  const playerStatsEntries = Object.entries(getPlayerStats(resultsSourceMatches, resultsAssignmentsByTournament, resultsTeamAssignment)).sort(([leftName, left], [rightName, right]) => {
    const leftWinRate = left.matches > 0 ? left.wins / left.matches : 0;
    const rightWinRate = right.matches > 0 ? right.wins / right.matches : 0;
    if (rightWinRate !== leftWinRate) {
      return rightWinRate - leftWinRate;
    }

    return leftName.localeCompare(rightName, 'ko-KR');
  });
  const teamStatsEntries = Object.entries(getTeamStats(resultsSourceMatches, resultsAssignmentsByTournament, resultsTeamAssignment)).sort(([, left], [, right]) => {
    const leftWinRate = left.matches > 0 ? left.wins / left.matches : 0;
    const rightWinRate = right.matches > 0 ? right.wins / right.matches : 0;
    return rightWinRate - leftWinRate;
  });

  const pairStats = useMemo(() => {
    return getPairStats(resultsSourceMatches, resultsAssignmentsByTournament, resultsTeamAssignment);
  }, [resultsSourceMatches, resultsAssignmentsByTournament, resultsTeamAssignment]);

  const pairGroupsList = useMemo(() => {
    const groups = new Set<string>();
    Object.values(pairStats).forEach((stat) => {
      if (stat.groupName) groups.add(stat.groupName);
    });
    return Array.from(groups).sort((left, right) => left.localeCompare(right, 'ko-KR'));
  }, [pairStats]);

  const sortedPairStatsEntries = useMemo(() => {
    return Object.entries(pairStats)
      .map(([pairKey, stats]) => ({
        pairKey,
        ...stats,
        winRate: stats.matches > 0 ? stats.wins / stats.matches : 0,
        pointsDiff: stats.pointsWon - stats.pointsLost,
      }))
      .sort((left, right) => {
        for (const criterion of rankingCriteria) {
          if (criterion === 'winRate') {
            if (right.winRate !== left.winRate) return right.winRate - left.winRate;
          } else if (criterion === 'pointsDiff') {
            if (right.pointsDiff !== left.pointsDiff) return right.pointsDiff - left.pointsDiff;
          } else if (criterion === 'h2h') {
            const h2h = getHeadToHeadWinner(left.pairKey, right.pairKey, resultsSourceMatches);
            if (h2h !== 0) return h2h;
          }
        }

        // 경기수가 더 많은 팀 우선
        if (right.matches !== left.matches) return right.matches - left.matches;
        
        return left.pairKey.localeCompare(right.pairKey, 'ko-KR');
      });
  }, [pairStats, resultsSourceMatches, rankingCriteria]);

  const filteredPairStats = useMemo(() => {
    const activeTab = adminMode ? adminActiveTab : userActiveTab;
    if (activeTab.startsWith('group_')) {
      const groupName = activeTab.replace('group_', '');
      return sortedPairStatsEntries.filter((entry) => entry.groupName === groupName);
    }
    return sortedPairStatsEntries;
  }, [sortedPairStatsEntries, adminActiveTab, userActiveTab, adminMode]);

  const normalizedPlayerSearchQuery = submittedPlayerSearchQuery.trim().toLocaleLowerCase('ko-KR');
  const filteredPlayerStatsEntries = normalizedPlayerSearchQuery
    ? playerStatsEntries.filter(([player]) => player.toLocaleLowerCase('ko-KR').includes(normalizedPlayerSearchQuery))
    : [];
  const hasResultData = teamStatsEntries.length > 0 || playerStatsEntries.length > 0;

  const isPairCustomTournament = selectedTournament?.match_type
    ? selectedTournament.match_type.startsWith('pairs_')
    : false;
  const isKnockoutTournament = selectedTournament?.match_type === 'pairs_knockout';

  const currentMatchesForView = useMemo(() => {
    if (!selectedTournament) return [];
    if (viewMode === 'court' || viewMode === 'time') {
      const activeTournamentsForDate = tournaments.filter(
        (t) => t.tournament_date === selectedTournament.tournament_date
      );
      const activeTournamentIds = activeTournamentsForDate.map((t) => t.id);
      return allTournamentsMatches.filter(
        (m) => m.tournament_id && activeTournamentIds.includes(m.tournament_id)
      );
    }
    return matches;
  }, [viewMode, selectedTournament, tournaments, allTournamentsMatches, matches]);

  const uniqueCourts = useMemo(() => {
    if (viewMode !== 'court') return [];
    const courts = currentMatchesForView.map(m => formatCourtLabel(m.court));
    return Array.from(new Set(courts)).sort((a, b) => {
      if (a === '코트 미정') return 1;
      if (b === '코트 미정') return -1;
      return a.localeCompare(b, 'ko', { numeric: true });
    });
  }, [viewMode, currentMatchesForView]);

  const renderMatchSections = useMemo(() => {
    if (viewMode === 'court') {
      const allSections = groupMatchesByCourt(currentMatchesForView);
      if (selectedCourtFilter === 'all') {
        return allSections;
      }
      return allSections.filter(s => s.groupName === selectedCourtFilter);
    }
    if (viewMode === 'time') {
      return groupMatchesByTime(currentMatchesForView);
    }
    return isPairCustomTournament
      ? groupMatchesByPairGroup(currentMatchesForView)
      : [{ groupName: '', matches: currentMatchesForView }];
  }, [viewMode, currentMatchesForView, isPairCustomTournament, selectedCourtFilter]);
  const adminTabs = useMemo(() => {
    const tabs = [{ key: 'overview', label: '대회 관리' }];
    if (selectedTournament) {
      if (isPairCustomTournament) {
        tabs.push({ key: 'results', label: '종합 순위' });
        pairGroupsList.forEach((group) => {
          tabs.push({ key: `group_${group}`, label: `${group} 순위` });
        });
      } else {
        tabs.push({ key: 'results', label: '경기 결과' });
      }
    } else {
      tabs.push({ key: 'results', label: '경기 결과' });
    }
    return tabs;
  }, [selectedTournament, isPairCustomTournament, pairGroupsList]);

  const userTabs = useMemo(() => {
    const tabs = [{ key: 'bracket', label: '대진표' }];
    if (selectedTournament) {
      if (isPairCustomTournament) {
        tabs.push({ key: 'results', label: '종합 순위' });
        pairGroupsList.forEach((group) => {
          tabs.push({ key: `group_${group}`, label: `${group} 순위` });
        });
      } else {
        tabs.push({ key: 'results', label: '경기결과' });
      }
    } else {
      tabs.push({ key: 'results', label: '경기결과' });
    }
    return tabs;
  }, [selectedTournament, isPairCustomTournament, pairGroupsList]);



  const containerClassName = adminMode
    ? 'flex w-full max-w-none flex-col gap-6 px-1 py-2 2xl:px-3'
    : 'mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5';

  const title = adminMode ? '관리자 대진표' : '대회 대진표';
  const homeHref = homeHrefOverride || (adminMode ? '/admin' : '/dashboard');
  const homeLabel = '홈';
  const sameDateMatches = useMemo(() => {
    if (!selectedTournament) return [];
    const sameDateTournaments = tournaments.filter(
      (t) => t.tournament_date === selectedTournament.tournament_date
    );
    const sameDateTournamentIds = new Set(sameDateTournaments.map((t) => t.id));
    return allTournamentsMatches.filter(
      (m) => m.tournament_id && sameDateTournamentIds.has(m.tournament_id)
    );
  }, [selectedTournament, tournaments, allTournamentsMatches]);

  const targetStatsMatches = useMemo(() => {
    return sameDateMatches.length > 0 ? sameDateMatches : matches;
  }, [sameDateMatches, matches]);

  const courtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    targetStatsMatches.forEach((match) => {
      const court = formatCourtLabel(match.court);
      counts[court] = (counts[court] || 0) + 1;
    });
    return counts;
  }, [targetStatsMatches]);

  const myMatchesCount = useMemo(() => {
    const searchNames = [profile?.full_name, profile?.username]
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .map(name => name.trim().toLowerCase());
    if (searchNames.length === 0) return 0;
    return targetStatsMatches.filter(match => {
      const team1 = match.team1 || [];
      const team2 = match.team2 || [];
      const allPlayers = [...team1, ...team2].map(name => name.trim().toLowerCase());
      return searchNames.some(searchName => allPlayers.some(player => player === searchName || player.includes(searchName)));
    }).length;
  }, [targetStatsMatches, profile]);

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      <div className={containerClassName}>
        {adminMode ? (
          <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between px-1">
              <div className="space-y-0.5 pl-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
                  <Trophy className="h-3.5 w-3.5" />
                  대진표
                </span>
                <h1 className="text-xl font-bold tracking-tight">{title}</h1>
                <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">대회 경기 대진표와 실시간 경기결과를 확인하고 관리합니다.</p>
              </div>
              <Link href={homeHref}>
                <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {homeLabel}
                </Button>
              </Link>
            </div>
          </section>
        ) : (
          <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between px-1">
              <div className="space-y-0.5 pl-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
                  <Trophy className="h-3.5 w-3.5" />
                  대진표
                </span>
                <h1 className="text-xl font-bold tracking-tight">대회 대진표</h1>
                <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">대회 경기 대진표와 실시간 경기결과를 확인합니다.</p>
              </div>
              <Link href="/dashboard">
                <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  홈
                </Button>
              </Link>
            </div>

            {/* 통계 부분 추가 */}
            <div className="relative z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-white/10 text-[11px] text-slate-200">
              <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1">
                총게임: <span className="font-semibold text-white">{targetStatsMatches.length}경기</span>
              </span>
              <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1">
                내게임: <span className="font-semibold text-white">{myMatchesCount}경기</span>
              </span>
              <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 inline-flex items-center gap-1.5">
                <span>코트:</span>
                <span className="inline-flex items-center gap-2">
                  {Object.entries(courtCounts).map(([court, count]) => {
                    const digits = court.replace(/[^0-9]/g, '');
                    const label = digits || (court.includes('미정') ? '?' : court);
                    return (
                      <span key={court} className="inline-flex items-center gap-1">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[9px] font-bold text-white">
                          {label}
                        </span>
                        <span className="font-semibold text-white">{count}</span>
                      </span>
                    );
                  })}
                </span>
              </span>
            </div>
          </section>
        )}

        {loadError && (
          <section className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 shadow-sm">
            {loadError}
          </section>
        )}
        {adminMode ? (
          <div className="space-y-6">
            <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
              <div className="flex flex-wrap gap-2">
                {adminTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setAdminActiveTab(tab.key)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      adminActiveTab === tab.key
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </section>

            {adminActiveTab === 'overview' && (
              <div className="space-y-6">
                <section className="rounded-[24px] bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                  <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 ${viewMode === 'round' ? 'border-b border-slate-100 pb-4' : ''}`}>
                    <div className="flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
                      <div className="flex items-center justify-between w-full sm:w-auto gap-2">
                        <h2 className="text-lg font-semibold text-slate-900">
                          <span className="text-slate-400 mr-2">|</span>대회 회차와 대진표
                        </h2>
                        <button
                          onClick={() => {
                            if (selectedTournament) void fetchMatches(selectedTournament.id);
                          }}
                          className="inline-flex sm:hidden items-center justify-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 shadow-sm"
                        >
                          🔁 새로고침
                        </button>
                      </div>
                      
                      <button
                        onClick={() => {
                          if (selectedTournament) void fetchMatches(selectedTournament.id);
                        }}
                        className="hidden sm:inline-block rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 shadow-sm self-end sm:self-auto"
                      >
                        🔁 새로고침
                      </button>

                      {/* 라운드순 / 코트순 / 시간순 Toggle: one step larger (text-sm) and aligned left */}
                      <div className="inline-flex rounded-full bg-slate-100 p-0.5 shadow-sm self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => setViewMode('round')}
                          className={`hidden sm:inline-block rounded-full px-3 py-1 text-sm font-semibold transition ${
                            viewMode === 'round' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          라운드순
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('court')}
                          className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                            viewMode === 'court' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          코트순
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('time')}
                          className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                            viewMode === 'time' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          시간순
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="hidden sm:inline-flex rounded-full bg-slate-100 p-0.5 shadow-sm">
                        <button
                          type="button"
                          onClick={() => setLayoutMode('card')}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                            layoutMode === 'card' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          카드
                        </button>
                        <button
                          type="button"
                          onClick={() => setLayoutMode('table')}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                            layoutMode === 'table' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          테이블
                        </button>
                      </div>
                    </div>
                  </div>
                  {viewMode === 'court' && uniqueCourts.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-1.5 rounded-[20px] border border-slate-200 bg-slate-50/70 p-3">
                      <button
                        type="button"
                        onClick={() => setSelectedCourtFilter('all')}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                          selectedCourtFilter === 'all'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        전체
                      </button>
                      {uniqueCourts.map((courtName) => (
                        <button
                          key={courtName}
                          type="button"
                          onClick={() => setSelectedCourtFilter(courtName)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                            selectedCourtFilter === courtName
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {courtName}
                        </button>
                      ))}
                    </div>
                  )}

                  {viewMode === 'round' && (
                    loading ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4"></div>
                        <p className="text-sm font-medium">대회 정보를 불러오는 중입니다...</p>
                      </div>
                    ) : tournaments.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        저장된 대회가 없습니다.
                      </div>
                    ) : (
                      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
                        {tournaments.map((tournament) => {
                          const rawFormattedTitle = formatTournamentTitle(tournament.title);
                          const formattedTitle = formatGroupLabel(rawFormattedTitle);
                          const groupLabel = getTournamentGroupLabel(tournament.title);
                          const icon = getGroupIcon(groupLabel);
                          const datePrefixMatch = rawFormattedTitle.match(/^(대회\s*경기\s*\d{4}-\d{2}-\d{2})\s*/u);
                          const suffix = formatGroupLabel(datePrefixMatch ? rawFormattedTitle.substring(datePrefixMatch[0].length) : rawFormattedTitle);

                          return (
                            <button
                              key={tournament.id}
                              onClick={() => {
                                void handleSelectTournament(tournament);
                              }}
                              className={`w-full rounded-[18px] border px-3 py-2.5 text-left transition-all ${
                                selectedTournament?.id === tournament.id
                                  ? 'border-blue-500 bg-blue-50 shadow-[0_14px_34px_-18px_rgba(59,130,246,0.45)]'
                                  : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex flex-col items-start gap-1">
                                <div className="w-full">
                                  <div className="hidden md:block whitespace-pre-wrap text-xs font-semibold text-slate-700 leading-relaxed text-left">
                                    {icon} {formattedTitle}
                                  </div>
                                  <div className="block md:hidden whitespace-pre-wrap text-xs font-semibold text-slate-700 leading-relaxed text-left">
                                    {icon} {suffix}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )
                  )}
                </section>

                {selectedTournament ? (
                  <>
                    <section className="rounded-[24px] bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                      {isKnockoutTournament && (
                        <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                          <div className="font-bold">토너먼트 자동 진출 대진표</div>
                          <div className="mt-1 text-xs text-violet-700">경기 결과를 저장하면 승자가 다음 라운드 슬롯으로 자동 배정됩니다. 부전승도 자동 처리됩니다.</div>
                        </div>
                      )}
                      {adminMode && (
                        <div className="mb-6 rounded-[20px] border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
                          <h4 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-1.5">
                            <span>⚡</span> 코트 및 시간 일괄 배정
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                            <div>
                              <label className="block text-xs font-semibold text-slate-600 mb-1.5">코트 수:</label>
                              <div className="flex gap-1">
                                {[1, 2, 3, 4, 5].map((num) => (
                                  <button
                                    key={`batch-court-${num}`}
                                    type="button"
                                    onClick={() => setBatchCourts(num)}
                                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                                      batchCourts === num
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                  >
                                    {num}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-600 mb-1.5">시작시간:</label>
                              <input
                                type="time"
                                value={batchStartTime}
                                onChange={(e) => setBatchStartTime(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 h-[32px] focus:outline-none focus:border-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-600 mb-1.5">간격:</label>
                              <select
                                value={batchInterval}
                                onChange={(e) => setBatchInterval(Number(e.target.value))}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 h-[32px] focus:outline-none focus:border-blue-500"
                              >
                                {[5, 10, 15, 20, 25, 30].map((min) => (
                                  <option key={min} value={min}>
                                    {min}분
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <button
                                type="button"
                                onClick={handleApplyCourtAndTimeBatch}
                                disabled={applyingBatch}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2 px-4 rounded-lg shadow-sm transition h-[32px] disabled:bg-slate-300"
                              >
                                {applyingBatch ? '배정 중...' : '배정 및 저장'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-slate-900">
                          대진표 ({currentMatchesForView.length}경기)
                          {viewMode === 'court' && selectedTournament && (
                            <span className="ml-2 text-sm text-slate-500 font-normal">({selectedTournament.tournament_date} 전체)</span>
                          )}
                        </h3>
                      </div>
                      {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4"></div>
                          <p className="text-sm font-medium">대진표를 구성하는 중입니다...</p>
                        </div>
                      ) : currentMatchesForView.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50/50 py-16 px-4 text-center shadow-inner">
                          <style>{`
                            @keyframes float {
                              0%, 100% { transform: translateY(0px) rotate(0deg); }
                              50% { transform: translateY(-6px) rotate(2deg); }
                            }
                            .animate-float {
                              animation: float 3s ease-in-out infinite;
                            }
                          `}</style>
                          <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-blue-500 ring-8 ring-blue-50/30 animate-float">
                            <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-blue-500">
                              <path d="M28 44 C28 50, 36 50, 36 44 C36 41, 28 41, 28 44 Z" fill="currentColor" className="fill-blue-500/20" />
                              <path d="M22 20 L28 41 M36 41 L42 20" />
                              <path d="M26 20 L29 41" />
                              <path d="M38 20 L35 41" />
                              <path d="M32 20 L32 41" />
                              <path d="M20 20 C20 20, 32 24, 44 20" fill="none" />
                              <path d="M21.5 29 C21.5 29, 32 32, 42.5 29" fill="none" />
                            </svg>
                            <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 animate-ping opacity-75" />
                            <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400" />
                          </div>
                          <h4 className="text-base font-semibold text-slate-800">아직 경기 대진표가 없습니다!</h4>
                          <p className="mt-2 max-w-sm text-sm text-slate-500 leading-relaxed">
                            대진표가 구성되면 이곳에서 경기 대진과 코트 배정, 실시간 스코어 및 경기 결과를 한눈에 확인하실 수 있습니다. 잠시만 기다려주세요!
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3 sm:space-y-6">
                          {renderMatchSections.map((section) => (
                            <section key={section.groupName || 'all-matches'} className="space-y-2 sm:space-y-3">
                              {section.groupName && (
                                <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-amber-900">
                                      {viewMode === 'court' ? '' : getGroupIcon(section.groupName)} {section.groupName}
                                    </span>
                                    <span className="text-xs text-amber-700 font-medium">({section.matches.length}경기)</span>
                                  </div>
                                </div>
                              )}
                              {layoutMode === 'table' ? (
                                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                                  <table className="w-full min-w-[800px] border-collapse text-left text-sm text-slate-600">
                                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-700">
                                      <tr>
                                        <th className="px-4 py-3">회차/경기</th>
                                        {(viewMode === 'court' || viewMode === 'time') && <th className="px-4 py-3">그룹</th>}
                                        {(viewMode === 'round' || viewMode === 'time') && <th className="px-4 py-3">코트</th>}
                                        <th className="px-4 py-3 text-right">팀 1</th>
                                        <th className="px-4 py-3 text-center">점수 입력</th>
                                        <th className="px-4 py-3">팀 2</th>
                                        <th className="px-4 py-3">심판 배정</th>
                                        <th className="px-4 py-3 text-center">점수판</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {section.matches.map((match, index) => {
                                        const isCompleted = match.status === 'completed';
                                        const isPending = match.status === 'pending';
                                        const displayRound = getTournamentDisplayRound(getMatchTournament(match));
                                        const displayMatchNumber = getDisplayMatchNumber(match, index);
                                        const draft = match.id ? scoreDrafts[match.id] : undefined;
                                        const score1Value = draft?.score1 ?? (match.score_team1 != null ? String(match.score_team1) : '');
                                        const score2Value = draft?.score2 ?? (match.score_team2 != null ? String(match.score_team2) : '');
                                        const hasBothScores = score1Value.trim() !== '' && score2Value.trim() !== '';
                                        const parsedScore1 = hasBothScores ? parseInt(score1Value, 10) || 0 : null;
                                        const parsedScore2 = hasBothScores ? parseInt(score2Value, 10) || 0 : null;
                                        const hasScoreChanged =
                                          parsedScore1 !== match.score_team1 ||
                                          parsedScore2 !== match.score_team2 ||
                                          match.status !== 'completed';
                                        const groupLabel = getMatchTournamentGroupLabel(match);

                                        return (
                                          <tr key={match.id || index} className={`${isCompleted ? 'bg-emerald-50/20' : 'bg-white'} hover:bg-slate-50 transition`}>
                                            <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                                              {displayRound}회차 - {displayMatchNumber}경기
                                            </td>
                                            {(viewMode === 'court' || viewMode === 'time') && (
                                              <td className="px-4 py-3 whitespace-nowrap">
                                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                                  {getGroupIcon(groupLabel)} {groupLabel}
                                                </span>
                                              </td>
                                            )}
                                            {(viewMode === 'round' || viewMode === 'time') && (
                                              <td className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">
                                                {adminMode ? (
                                                  editingMatchId === match.id ? (
                                                    <div className="flex flex-col gap-1.5">
                                                      <select
                                                        value={editCourtDraft}
                                                        onChange={(e) => setEditCourtDraft(e.target.value)}
                                                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                                      >
                                                        <option value="">(코트 미배정)</option>
                                                        {[1, 2, 3, 4, 5].map((num) => (
                                                          <option key={num} value={`${num}코트`}>
                                                            {num}코트
                                                          </option>
                                                        ))}
                                                      </select>
                                                      <input
                                                        type="time"
                                                        value={editTimeDraft}
                                                        onChange={(e) => setEditTimeDraft(e.target.value)}
                                                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                                      />
                                                      <div className="flex gap-1 mt-1">
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            if (match.id) void handleUpdateMatchSchedule(match.id, editCourtDraft, editTimeDraft);
                                                          }}
                                                          className="bg-blue-600 text-white rounded px-2 py-0.5 text-[10px] font-bold"
                                                        >
                                                          저장
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() => setEditingMatchId(null)}
                                                          className="bg-slate-200 text-slate-700 rounded px-2 py-0.5 text-[10px] font-bold"
                                                        >
                                                          취소
                                                        </button>
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center gap-2">
                                                      <div>
                                                        <div className="font-semibold text-slate-950">{formatCourtLabel(match.court) || '(코트 미배정)'}</div>
                                                        {match.scheduled_time && (
                                                          <div className="text-[10px] text-emerald-600 font-bold mt-0.5">
                                                            {formatScheduledTime(match.scheduled_time)}
                                                          </div>
                                                        )}
                                                      </div>
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          setEditingMatchId(match.id || null);
                                                          setEditCourtDraft(match.court || '');
                                                          setEditTimeDraft(match.scheduled_time ? (match.scheduled_time.split('T')[1] || '').substring(0, 5) : '');
                                                        }}
                                                        className="text-[10px] text-blue-600 hover:underline font-semibold"
                                                      >
                                                        ✏️ 일정수정
                                                      </button>
                                                    </div>
                                                  )
                                                ) : (
                                                  <div>
                                                    <div className="font-semibold text-slate-950">{formatCourtLabel(match.court) || '(코트 미배정)'}</div>
                                                    {match.scheduled_time && (
                                                      <div className="text-[10px] text-emerald-600 font-bold mt-0.5">
                                                        {formatScheduledTime(match.scheduled_time)}
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </td>
                                            )}
                                            <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                                              {formatBracketTeam(match.team1, match, section.matches, isPairCustomTournament)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              <div className="flex items-center justify-center gap-1">
                                                <input
                                                  type="number"
                                                  min="0"
                                                  value={score1Value}
                                                  onChange={(event) => {
                                                    if (!match.id) return;
                                                    setScoreDrafts((prev) => ({
                                                      ...prev,
                                                      [match.id!]: {
                                                        score1: event.target.value,
                                                        score2: prev[match.id!]?.score2 ?? score2Value,
                                                      },
                                                    }));
                                                  }}
                                                  className="w-10 rounded-lg border border-slate-300 bg-white py-0.5 text-center text-xs font-semibold outline-none focus:border-blue-500"
                                                />
                                                <span className="text-xs font-bold text-slate-400">:</span>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  value={score2Value}
                                                  onChange={(event) => {
                                                    if (!match.id) return;
                                                    setScoreDrafts((prev) => ({
                                                      ...prev,
                                                      [match.id!]: {
                                                        score1: prev[match.id!]?.score1 ?? score1Value,
                                                        score2: event.target.value,
                                                      },
                                                    }));
                                                  }}
                                                  className="w-10 rounded-lg border border-slate-300 bg-white py-0.5 text-center text-xs font-semibold outline-none focus:border-blue-500"
                                                />
                                                <button
                                                  onClick={() => {
                                                    if (!match.id || parsedScore1 == null || parsedScore2 == null) return;
                                                    void updateMatchScore(match.id, parsedScore1, parsedScore2);
                                                  }}
                                                  disabled={!hasBothScores || !hasScoreChanged}
                                                  className={`rounded-lg px-2 py-0.5 text-[10px] font-bold text-white transition-all ${
                                                    !hasBothScores || !hasScoreChanged
                                                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                      : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                                                  }`}
                                                >
                                                  저장
                                                </button>
                                              </div>
                                            </td>
                                            <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">
                                              {formatBracketTeam(match.team2, match, section.matches, isPairCustomTournament)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                              <div className="flex flex-col gap-0.5">
                                                <select
                                                  value={refereeDrafts[match.id!] ?? match.referee_name ?? ''}
                                                  onChange={(e) => {
                                                    const value = e.target.value;
                                                    if (match.id) {
                                                      setRefereeDrafts((prev) => ({ ...prev, [match.id!]: value }));
                                                      void assignReferee(match.id, value);
                                                    }
                                                  }}
                                                  className="w-[120px] rounded-lg border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-800 outline-none"
                                                >
                                                  <option value="">선택 안함</option>
                                                  {getRefereeOptions(match)}
                                                </select>
                                                {!match.referee_name && getDisplayRefereeName(match) && (
                                                  <div className="text-[9px] text-emerald-600 font-semibold">
                                                    자동: {getDisplayRefereeName(match)}
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              {match.id && (
                                                <Link
                                                  href={`/scoreboard/${match.id}`}
                                                  target="_blank"
                                                  className="inline-block rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 whitespace-nowrap"
                                                >
                                                  📋 점수판
                                                </Link>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="grid gap-2 sm:gap-4 xl:grid-cols-4">
                                  {section.matches.map((match, index) => {
                                    const isCompleted = match.status === 'completed';
                                    const isPending = match.status === 'pending';
                                    const displayRound = getTournamentDisplayRound(selectedTournament);
                                    const displayMatchNumber = getDisplayMatchNumber(match, index);
                                    const draft = match.id ? scoreDrafts[match.id] : undefined;
                                    const score1Value = draft?.score1 ?? (match.score_team1 != null ? String(match.score_team1) : '');
                                    const score2Value = draft?.score2 ?? (match.score_team2 != null ? String(match.score_team2) : '');
                                    const hasBothScores = score1Value.trim() !== '' && score2Value.trim() !== '';
                                    const parsedScore1 = hasBothScores ? parseInt(score1Value, 10) || 0 : null;
                                    const parsedScore2 = hasBothScores ? parseInt(score2Value, 10) || 0 : null;
                                    const hasScoreChanged =
                                      parsedScore1 !== match.score_team1 ||
                                      parsedScore2 !== match.score_team2 ||
                                      match.status !== 'completed';
                                    const pairGroupLabel = extractPairGroupLabel(match.court);
                                    const cleanCourtLabel = match.court ? match.court.replace(/^\[.+?\]\s*/i, '').trim() : '';

                                    return (
                                      <article key={match.id || `match-view-${section.groupName || 'all'}-${index}`} className={`rounded-2xl sm:rounded-[24px] border p-2 sm:p-4 ${isCompleted ? 'border-emerald-200 bg-emerald-50/70' : isPending ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/70'}`}>
                                        <div className="flex items-start justify-between gap-2 sm:gap-3">
                                          {adminMode ? (
                                            editingMatchId === match.id ? (
                                              <div className="flex flex-col gap-1.5 w-full">
                                                <div className="flex gap-2">
                                                  <select
                                                    value={editCourtDraft}
                                                    onChange={(e) => setEditCourtDraft(e.target.value)}
                                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs flex-1"
                                                  >
                                                    <option value="">(코트 미배정)</option>
                                                    {[1, 2, 3, 4, 5].map((num) => (
                                                      <option key={num} value={`${num}코트`}>
                                                        {num}코트
                                                      </option>
                                                    ))}
                                                  </select>
                                                  <input
                                                    type="time"
                                                    value={editTimeDraft}
                                                    onChange={(e) => setEditTimeDraft(e.target.value)}
                                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                                  />
                                                </div>
                                                <div className="flex gap-1.5 mt-1 justify-end">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      if (match.id) void handleUpdateMatchSchedule(match.id, editCourtDraft, editTimeDraft);
                                                    }}
                                                    className="bg-blue-600 text-white rounded px-3 py-1 text-xs font-bold shadow-sm"
                                                  >
                                                    저장
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => setEditingMatchId(null)}
                                                    className="bg-slate-200 text-slate-700 rounded px-3 py-1 text-xs font-bold"
                                                  >
                                                    취소
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-xs sm:text-sm font-bold text-slate-950">{cleanCourtLabel || '(코트 미배정)'}</span>
                                                {match.scheduled_time && (
                                                  <span className="text-[10px] sm:text-xs text-slate-500 font-medium">
                                                    ({formatScheduledTime(match.scheduled_time)})
                                                  </span>
                                                )}
                                                {pairGroupLabel && (
                                                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] sm:text-xs font-medium text-amber-800">{pairGroupLabel}</span>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setEditingMatchId(match.id || null);
                                                    setEditCourtDraft(match.court || '');
                                                    setEditTimeDraft(match.scheduled_time ? (match.scheduled_time.split('T')[1] || '').substring(0, 5) : '');
                                                  }}
                                                  className="text-[11px] text-blue-600 hover:underline font-semibold whitespace-nowrap"
                                                >
                                                  ✏️ 일정수정
                                                </button>
                                              </div>
                                            )
                                          ) : (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <span className="text-xs sm:text-sm font-bold text-slate-950">{cleanCourtLabel || '(코트 미배정)'}</span>
                                              {match.scheduled_time && (
                                                <span className="text-[10px] sm:text-xs text-slate-500 font-medium">
                                                  ({formatScheduledTime(match.scheduled_time)})
                                                </span>
                                              )}
                                              {pairGroupLabel && (
                                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] sm:text-xs font-medium text-amber-800">{pairGroupLabel}</span>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        <div className="mt-1.5 sm:mt-2.5 grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] items-stretch gap-1.5 sm:gap-3 text-sm">
                                          <div className="flex min-w-0 flex-col justify-center rounded-xl bg-white px-2 py-1 text-left text-slate-800">
                                            <span className="text-[10px] sm:text-xs font-semibold text-blue-600">팀1</span>
                                            <div className="mt-0.5 whitespace-pre-line text-xs font-bold leading-normal text-slate-800">{formatBracketTeam(match.team1, match, section.matches, isPairCustomTournament)}</div>
                                          </div>

                                          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-50 px-1 py-1 text-center">
                                            <div className="flex items-center gap-0.5">
                                              <input
                                                type="number"
                                                min="0"
                                                value={score1Value}
                                                onChange={(event) => {
                                                  if (!match.id) return;
                                                  setScoreDrafts((prev) => ({
                                                    ...prev,
                                                    [match.id!]: {
                                                      score1: event.target.value,
                                                      score2: prev[match.id!]?.score2 ?? score2Value,
                                                    },
                                                  }));
                                                }}
                                                className="w-9 sm:w-11 rounded-lg border border-slate-300 bg-white py-0.5 text-center text-xs sm:text-sm font-semibold outline-none focus:border-blue-500"
                                              />
                                              <span className="text-xs font-bold text-slate-400">:</span>
                                              <input
                                                type="number"
                                                min="0"
                                                value={score2Value}
                                                onChange={(event) => {
                                                  if (!match.id) return;
                                                  setScoreDrafts((prev) => ({
                                                    ...prev,
                                                    [match.id!]: {
                                                      score1: prev[match.id!]?.score1 ?? score1Value,
                                                      score2: event.target.value,
                                                    },
                                                  }));
                                                }}
                                                className="w-9 sm:w-11 rounded-lg border border-slate-300 bg-white py-0.5 text-center text-xs sm:text-sm font-semibold outline-none focus:border-blue-500"
                                              />
                                            </div>
                                            <button
                                              onClick={() => {
                                                if (!match.id || parsedScore1 == null || parsedScore2 == null) return;
                                                void updateMatchScore(match.id, parsedScore1, parsedScore2);
                                              }}
                                              disabled={!hasBothScores || !hasScoreChanged}
                                              className={`rounded-lg px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-white transition-all ${
                                                !hasBothScores || !hasScoreChanged
                                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                  : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                                              }`}
                                            >
                                              저장
                                            </button>
                                          </div>

                                          <div className="flex min-w-0 flex-col justify-center rounded-xl bg-white px-2 py-1 text-right text-slate-800">
                                            <span className="text-[10px] sm:text-xs font-semibold text-rose-600">팀2</span>
                                            <div className="mt-0.5 whitespace-pre-line text-xs font-bold leading-normal text-slate-800">{formatBracketTeam(match.team2, match, section.matches, isPairCustomTournament)}</div>
                                          </div>
                                        </div>

                                        <div className="mt-1.5 sm:mt-2.5 flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2">
                                          <div className="flex flex-1 items-center gap-0.5 sm:gap-1 min-w-0">
                                            <span className="text-[10px] sm:text-xs font-medium text-slate-500 whitespace-nowrap">심판:</span>
                                            <select
                                              value={refereeDrafts[match.id!] ?? match.referee_name ?? ''}
                                              onChange={(e) => {
                                                const value = e.target.value;
                                                if (match.id) {
                                                  setRefereeDrafts((prev) => ({ ...prev, [match.id!]: value }));
                                                  void assignReferee(match.id, value);
                                                }
                                              }}
                                              className="flex-1 min-w-0 max-w-[120px] rounded-lg border border-slate-300 bg-white px-1 py-0.5 text-[10px] sm:text-xs text-slate-800 outline-none"
                                            >
                                              <option value="">선택 안함</option>
                                              {getRefereeOptions(match)}
                                            </select>
                                          </div>
                                          {match.id && (
                                            <Link
                                              href={`/scoreboard/${match.id}`}
                                              target="_blank"
                                              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
                                            >
                                              📋 점수판
                                            </Link>
                                          )}
                                        </div>
                                        {!match.referee_name && getDisplayRefereeName(match) && (
                                          <div className="mt-1 w-full text-[10px] text-emerald-600 font-semibold">
                                            자동 심판: {getDisplayRefereeName(match)} (이전 경기 승자)
                                          </div>
                                        )}
                                      </article>
                                    );
                                  })}
                                </div>
                              )}
                            </section>
                          ))}
                        </div>
                      )}
                    </section>

                  </>
                ) : (
                  <section className="rounded-[24px] border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm" />
                )}
              </div>
            )}

            {(adminActiveTab === 'results' || adminActiveTab.startsWith('group_')) && (
              <div className="space-y-6">
                {matches.length > 0 ? (
                  <section className="rounded-[24px] bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900">
                        {isPairCustomTournament
                          ? adminActiveTab.startsWith('group_')
                            ? `${adminActiveTab.replace('group_', '')} 순위`
                            : '페어별 종합 순위'
                          : '경기 결과'}
                      </h2>
                      {selectedTournament && (
                        <p className="mt-1 text-sm text-slate-500">{formatTournamentTitle(selectedTournament.title)}</p>
                      )}
                    </div>

                    {isPairCustomTournament ? (
                      <div className="space-y-6">
                        {adminMode && (
                          <div className="hidden md:block rounded-[20px] border border-amber-200 bg-amber-50/50 p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-amber-900">순위 결정 기준 우선순위 설정</p>
                                <p className="text-xs text-amber-700">각 페어들의 최종 순위를 결정할 때 가중치 우선순위를 지정할 수 있습니다.</p>
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-amber-800">1순위</span>
                                  <select
                                    value={rankingCriteria[0]}
                                    onChange={(e) => handleCriteriaChange(0, e.target.value)}
                                    className="rounded-xl border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none"
                                  >
                                    <option value="winRate">승률</option>
                                    <option value="pointsDiff">득실차</option>
                                    <option value="h2h">승자승</option>
                                  </select>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-amber-800">2순위</span>
                                  <select
                                    value={rankingCriteria[1]}
                                    onChange={(e) => handleCriteriaChange(1, e.target.value)}
                                    className="rounded-xl border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none"
                                  >
                                    <option value="winRate">승률</option>
                                    <option value="pointsDiff">득실차</option>
                                    <option value="h2h">승자승</option>
                                  </select>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-amber-800">3순위</span>
                                  <select
                                    value={rankingCriteria[2]}
                                    onChange={(e) => handleCriteriaChange(2, e.target.value)}
                                    className="rounded-xl border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none"
                                  >
                                    <option value="winRate">승률</option>
                                    <option value="pointsDiff">득실차</option>
                                    <option value="h2h">승자승</option>
                                  </select>
                                </div>

                                <button
                                  type="button"
                                  onClick={saveRankingCriteria}
                                  className="rounded-xl bg-amber-600 px-3.5 py-1 text-xs font-bold text-white transition hover:bg-amber-700 shadow-sm"
                                >
                                  기준 저장
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-base font-semibold text-slate-900">
                              {adminActiveTab.startsWith('group_')
                                ? `${adminActiveTab.replace('group_', '')} 결과`
                                : '종합 순위'}
                            </h3>
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                              {filteredPairStats.length}개 페어
                            </span>
                          </div>

                          {filteredPairStats.length === 0 ? (
                            <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                              결과가 등록된 경기가 없습니다.
                            </div>
                          ) : (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                              {filteredPairStats.map((entry, index) => (
                                <article key={entry.pairKey} className="relative rounded-[24px] border border-amber-200 bg-gradient-to-br from-amber-50/40 to-orange-50/40 px-5 py-5 shadow-sm">
                                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white shadow-sm">
                                    {index + 1}
                                  </div>
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-base font-bold text-slate-900 truncate pr-6">{entry.pairKey}</p>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm ring-1 ring-amber-200/50">
                                          {entry.groupName}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-600">
                                          승률 {entry.matches > 0 ? `${((entry.wins / entry.matches) * 100).toFixed(1)}%` : '0%'}
                                        </span>
                                        <span className="text-xs text-slate-300">|</span>
                                        <span className={`text-xs font-bold ${entry.pointsDiff > 0 ? 'text-blue-600' : entry.pointsDiff < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                                          득실차 {entry.pointsDiff > 0 ? `+${entry.pointsDiff}` : entry.pointsDiff}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="mt-4 grid grid-cols-4 gap-1.5 text-center text-xs">
                                    <div className="rounded-xl bg-white/80 px-1 py-2 border border-amber-100">
                                      <p className="text-[10px] text-slate-500">경기</p>
                                      <p className="mt-0.5 font-bold text-slate-700">{entry.matches}</p>
                                    </div>
                                    <div className="rounded-xl bg-emerald-50 px-1 py-2">
                                      <p className="text-[10px] text-emerald-700">승</p>
                                      <p className="mt-0.5 font-bold text-emerald-700">{entry.wins}</p>
                                    </div>
                                    <div className="rounded-xl bg-rose-50 px-1 py-2">
                                      <p className="text-[10px] text-rose-700">패</p>
                                      <p className="mt-0.5 font-bold text-rose-700">{entry.losses}</p>
                                    </div>
                                    <div className="rounded-xl bg-slate-50 px-1 py-2">
                                      <p className="text-[10px] text-slate-500">무</p>
                                      <p className="mt-0.5 font-bold text-slate-700">{entry.draws}</p>
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : teamStatsEntries.length === 0 && playerStatsEntries.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        저장된 경기 결과가 아직 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {teamStatsEntries.length > 0 && (
                          <div>
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h3 className="text-base font-semibold text-slate-900">팀 구성별 결과</h3>
                              <span className="text-xs text-slate-500">{teamStatsEntries.length}개 팀</span>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {teamStatsEntries.map(([teamName, stats]) => (
                                <article key={teamName} className="rounded-[24px] border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 px-5 py-5 shadow-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-lg font-semibold text-slate-900">{teamName}</p>
                                      <p className="mt-1 text-sm text-slate-600">승률 {stats.matches > 0 ? `${((stats.wins / stats.matches) * 100).toFixed(1)}%` : '0%'}</p>
                                    </div>
                                    <div className="rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm">{stats.matches}경기</div>
                                  </div>
                                  <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
                                    <div className="rounded-2xl bg-emerald-50 px-2 py-3">
                                      <p className="text-[11px] text-emerald-700">승</p>
                                      <p className="mt-1 font-semibold text-emerald-700">{stats.wins}</p>
                                    </div>
                                    <div className="rounded-2xl bg-rose-50 px-2 py-3">
                                      <p className="text-[11px] text-rose-700">패</p>
                                      <p className="mt-1 font-semibold text-rose-700">{stats.losses}</p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-2 py-3">
                                      <p className="text-[11px] text-slate-500">무</p>
                                      <p className="mt-1 font-semibold text-slate-700">{stats.draws}</p>
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </div>
                        )}

                        {playerStatsEntries.length > 0 && (
                          <div>
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h3 className="text-base font-semibold text-slate-900">선수별 결과</h3>
                              <span className="text-xs text-slate-500">{playerStatsEntries.length}명</span>
                            </div>
                            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
                              {playerStatsEntries.map(([player, stats]) => (
                                <article key={player} className="rounded-[22px] border border-slate-200 bg-slate-50/60 px-3 py-3 shadow-sm">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <p className="text-base font-semibold text-slate-900">{player}</p>
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm">
                                          {stats.teamLabel}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-xs text-slate-500">승률 {stats.matches > 0 ? `${((stats.wins / stats.matches) * 100).toFixed(1)}%` : '0%'}</p>
                                    </div>
                                    <div className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">{stats.matches}경기</div>
                                  </div>
                                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-sm">
                                    <div className="rounded-2xl bg-emerald-50 px-2 py-3">
                                      <p className="text-[11px] text-emerald-700">승</p>
                                      <p className="mt-1 font-semibold text-emerald-700">{stats.wins}</p>
                                    </div>
                                    <div className="rounded-2xl bg-rose-50 px-2 py-3">
                                      <p className="text-[11px] text-rose-700">패</p>
                                      <p className="mt-1 font-semibold text-rose-700">{stats.losses}</p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-2 py-3">
                                      <p className="text-[11px] text-slate-500">무</p>
                                      <p className="mt-1 font-semibold text-slate-700">{stats.draws}</p>
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-white py-16 px-4 text-center shadow-sm">
                    <style>{`
                      @keyframes float-admin-empty {
                        0%, 100% { transform: translateY(0px) rotate(0deg); }
                        50% { transform: translateY(-6px) rotate(2deg); }
                      }
                      .animate-float-admin-empty {
                        animation: float-admin-empty 3s ease-in-out infinite;
                      }
                    `}</style>
                    <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-blue-500 ring-8 ring-blue-50/30 animate-float-admin-empty">
                      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-blue-500">
                        <path d="M28 44 C28 50, 36 50, 36 44 C36 41, 28 41, 28 44 Z" fill="currentColor" className="fill-blue-500/20" />
                        <path d="M22 20 L28 41 M36 41 L42 20" />
                        <path d="M26 20 L29 41" />
                        <path d="M38 20 L35 41" />
                        <path d="M32 20 L32 41" />
                        <path d="M20 20 C20 20, 32 24, 44 20" fill="none" />
                        <path d="M21.5 29 C21.5 29, 32 32, 42.5 29" fill="none" />
                      </svg>
                      <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 animate-ping opacity-75" />
                      <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400" />
                    </div>
                    <h4 className="text-base font-semibold text-slate-800">아직 등록된 대회가 없습니다!</h4>
                    <p className="mt-2 max-w-sm text-sm text-slate-500 leading-relaxed">
                      우측 상단 탭에서 새로운 대회(대진표)를 생성하고 대진표 구성을 완료하면 실시간 대진표 화면이 활성화됩니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {selectedTournament ? (
              <div className="space-y-6">
                <section className="rounded-[24px] border border-slate-200 bg-white px-3 py-3 sm:px-5 sm:py-5 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    {userTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setUserActiveTab(tab.key)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          userActiveTab === tab.key
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </section>

                {userActiveTab === 'bracket' && (
                  <section className="rounded-[24px] border border-slate-200 bg-white px-3 py-3 sm:px-5 sm:py-5 shadow-sm">
                    <div className="mb-4">
                      <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3">
                        <div className={`mb-3 flex flex-wrap items-center justify-between gap-3 ${viewMode === 'round' ? 'border-b border-slate-200/50 pb-3' : ''}`}>
                          <div className="flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
                            <div className="flex items-center justify-between w-full sm:w-auto gap-2">
                              <div>
                                <p className="text-xs font-medium text-slate-500">대회 선택</p>
                                <h3 className="mt-1 text-base font-semibold text-slate-900">
                                  <span className="text-slate-400 mr-2">|</span>대회 회차와 대진표
                                </h3>
                              </div>
                              <button
                                onClick={() => {
                                  if (selectedTournament) void fetchMatches(selectedTournament.id);
                                }}
                                className="inline-flex sm:hidden items-center justify-center rounded-full bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 shadow-sm"
                              >
                                🔁 새로고침
                              </button>
                            </div>
                            
                            <button
                              onClick={() => {
                                if (selectedTournament) void fetchMatches(selectedTournament.id);
                              }}
                              className="hidden sm:inline-block rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 shadow-sm self-end sm:self-auto"
                            >
                              🔁 새로고침
                            </button>

                            {/* 라운드순 / 코트순 / 시간순 Toggle: one step larger (text-sm) and aligned left */}
                            <div className="inline-flex rounded-full bg-slate-200 p-0.5 shadow-sm self-end sm:self-auto">
                              <button
                                type="button"
                                onClick={() => setViewMode('round')}
                                className={`hidden sm:inline-block rounded-full px-3 py-1 text-sm font-semibold transition ${
                                  viewMode === 'round' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                라운드순
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewMode('court')}
                                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                                  viewMode === 'court' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                코트순
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewMode('time')}
                                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                                  viewMode === 'time' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                시간순
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="hidden sm:inline-flex rounded-full bg-slate-200 p-0.5 shadow-sm">
                              <button
                                type="button"
                                onClick={() => setLayoutMode('card')}
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                  layoutMode === 'card' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                카드
                              </button>
                              <button
                                type="button"
                                onClick={() => setLayoutMode('table')}
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                  layoutMode === 'table' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                              >
                                테이블
                              </button>
                            </div>
                          </div>
                        </div>
                        {viewMode === 'court' && uniqueCourts.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-200/50 pt-3">
                            <button
                              type="button"
                              onClick={() => setSelectedCourtFilter('all')}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                                selectedCourtFilter === 'all'
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              전체
                            </button>
                            {uniqueCourts.map((courtName) => (
                              <button
                                key={courtName}
                                type="button"
                                onClick={() => setSelectedCourtFilter(courtName)}
                                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                                  selectedCourtFilter === courtName
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                {courtName}
                              </button>
                            ))}
                          </div>
                        )}

                        {viewMode === 'round' && (
                          loading ? (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4"></div>
                              <p className="text-sm font-medium">대회 정보를 불러오는 중입니다...</p>
                            </div>
                          ) : tournaments.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                              진행 중인 대회가 없습니다.
                            </div>
                          ) : (
                            <div className="grid gap-2 grid-cols-1 md:grid-cols-3">
                              {tournaments.map((tournament) => {
                                const rawFormattedTitle = formatTournamentTitle(tournament.title);
                                const formattedTitle = formatGroupLabel(rawFormattedTitle);
                                const groupLabel = getTournamentGroupLabel(tournament.title);
                                const icon = getGroupIcon(groupLabel);
                                const datePrefixMatch = rawFormattedTitle.match(/^(대회\s*경기\s*\d{4}-\d{2}-\d{2})\s*/u);
                                const suffix = formatGroupLabel(datePrefixMatch ? rawFormattedTitle.substring(datePrefixMatch[0].length) : rawFormattedTitle);

                                return (
                                  <button
                                    key={tournament.id}
                                    onClick={() => {
                                      void handleSelectTournament(tournament);
                                    }}
                                    className={`w-full rounded-[18px] border px-3 py-3 text-left transition-all ${
                                      selectedTournament?.id === tournament.id
                                        ? 'border-blue-500 bg-blue-50 shadow-[0_14px_34px_-18px_rgba(59,130,246,0.45)]'
                                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="flex flex-col items-start gap-1">
                                      <div className="w-full">
                                        <div className="hidden md:block whitespace-pre-wrap text-xs font-semibold text-slate-700 leading-relaxed text-left">
                                          {icon} {formattedTitle}
                                        </div>
                                        <div className="block md:hidden whitespace-pre-wrap text-xs font-semibold text-slate-700 leading-relaxed text-left">
                                          {icon} {suffix}
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {selectedTournament && (
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-slate-900">
                          대진표 ({currentMatchesForView.length}경기)
                          {viewMode === 'court' && selectedTournament && (
                            <span className="ml-2 text-sm text-slate-500 font-normal">({selectedTournament.tournament_date} 전체)</span>
                          )}
                        </h3>
                      </div>
                    )}

                    {loading ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mb-4"></div>
                        <p className="text-sm font-medium">대진표를 구성하는 중입니다...</p>
                      </div>
                    ) : currentMatchesForView.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50/50 py-16 px-4 text-center shadow-inner">
                        <style>{`
                          @keyframes float-user {
                            0%, 100% { transform: translateY(0px) rotate(0deg); }
                            50% { transform: translateY(-6px) rotate(2deg); }
                          }
                          .animate-float-user {
                            animation: float-user 3s ease-in-out infinite;
                          }
                        `}</style>
                        <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-blue-500 ring-8 ring-blue-50/30 animate-float-user">
                          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-blue-500">
                            <path d="M28 44 C28 50, 36 50, 36 44 C36 41, 28 41, 28 44 Z" fill="currentColor" className="fill-blue-500/20" />
                            <path d="M22 20 L28 41 M36 41 L42 20" />
                            <path d="M26 20 L29 41" />
                            <path d="M38 20 L35 41" />
                            <path d="M32 20 L32 41" />
                            <path d="M20 20 C20 20, 32 24, 44 20" fill="none" />
                            <path d="M21.5 29 C21.5 29, 32 32, 42.5 29" fill="none" />
                          </svg>
                          <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 animate-ping opacity-75" />
                          <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400" />
                        </div>
                        <h4 className="text-base font-semibold text-slate-800">아직 경기 대진표가 없습니다!</h4>
                        <p className="mt-2 max-w-sm text-sm text-slate-500 leading-relaxed">
                          대진표가 구성되면 이곳에서 경기 대진과 코트 배정, 실시간 스코어 및 경기 결과를 한눈에 확인하실 수 있습니다. 잠시만 기다려주세요!
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3 sm:space-y-6">
                        {renderMatchSections.map((section) => (
                          <section key={section.groupName || 'all-user-matches'} className="space-y-2 sm:space-y-3">
                            {section.groupName && (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-amber-900">
                                    {viewMode === 'court' ? '' : getGroupIcon(section.groupName)} {section.groupName}
                                  </span>
                                  <span className="text-xs text-amber-700 font-medium">({section.matches.length}경기)</span>
                                </div>
                              </div>
                            )}
                            {layoutMode === 'table' ? (
                              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <table className="w-full min-w-[700px] border-collapse text-left text-sm text-slate-600">
                                  <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-700">
                                    <tr>
                                      <th className="px-4 py-3">회차/경기</th>
                                      {viewMode === 'court' && <th className="px-4 py-3">그룹</th>}
                                      {viewMode === 'round' && <th className="px-4 py-3">코트</th>}
                                      <th className="px-4 py-3 text-right">팀 1</th>
                                      <th className="px-4 py-3 text-center">점수 / VS</th>
                                      <th className="px-4 py-3">팀 2</th>
                                      <th className="px-4 py-3">심판</th>
                                      <th className="px-4 py-3 text-center">점수판</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-200">
                                    {section.matches.map((match, index) => {
                                      const isCompleted = match.status === 'completed';
                                      const isPending = match.status === 'pending';
                                      const displayRound = getTournamentDisplayRound(getMatchTournament(match));
                                      const displayMatchNumber = getDisplayMatchNumber(match, index);
                                      const groupLabel = getMatchTournamentGroupLabel(match);

                                      return (
                                        <tr key={match.id || index} className={`${isCompleted ? 'bg-emerald-50/20' : 'bg-white'} hover:bg-slate-50 transition`}>
                                          <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                                            {displayRound}회차 - {displayMatchNumber}경기
                                          </td>
                                          {viewMode === 'court' && (
                                            <td className="px-4 py-3 whitespace-nowrap">
                                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                                {getGroupIcon(groupLabel)} {groupLabel}
                                              </span>
                                            </td>
                                          )}
                                          {viewMode === 'round' && (
                                            <td className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">
                                              {formatCourtLabel(match.court)}
                                            </td>
                                          )}
                                          <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                                            {formatBracketTeam(match.team1, match, section.matches, isPairCustomTournament)}
                                          </td>
                                          <td className="px-4 py-3 text-center">
                                            <span className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold whitespace-nowrap ${
                                              isCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'
                                            }`}>
                                              {isCompleted ? `${match.score_team1 ?? 0} : ${match.score_team2 ?? 0}` : 'VS'}
                                            </span>
                                          </td>
                                          <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">
                                            {formatBracketTeam(match.team2, match, section.matches, isPairCustomTournament)}
                                          </td>
                                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                                            {match.referee_name ? (
                                              <span className="font-semibold text-slate-700">{match.referee_name}</span>
                                            ) : getDisplayRefereeName(match) ? (
                                              <span className="font-medium text-emerald-600">
                                                {getDisplayRefereeName(match)} (자동)
                                              </span>
                                            ) : (
                                              <span className="text-slate-400">-</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-3 text-center whitespace-nowrap">
                                            {match.id ? (
                                              <Link
                                                href={`/scoreboard/${match.id}`}
                                                className={`inline-block rounded-lg px-3 py-1 text-xs font-semibold text-white transition ${
                                                  isCompleted
                                                    ? 'bg-slate-600 hover:bg-slate-500'
                                                    : match.status === 'in_progress'
                                                      ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                                                      : 'bg-slate-800 hover:bg-slate-700'
                                                }`}
                                              >
                                                {isCompleted ? '결과' : match.status === 'in_progress' ? 'LIVE' : '점수판'}
                                              </Link>
                                            ) : (
                                              <span className="text-xs text-slate-400">-</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="grid gap-2 sm:gap-4">
                                {section.matches.map((match, index) => {
                                  const isCompleted = match.status === 'completed';
                                  const isPending = match.status === 'pending';
                                  const displayRound = getTournamentDisplayRound(selectedTournament);
                                  const displayMatchNumber = getDisplayMatchNumber(match, index);
                                  const pairGroupLabel = extractPairGroupLabel(match.court);
                                  const cleanCourtLabel = match.court ? match.court.replace(/^\[.+?\]\s*/i, '').trim() : '';

                                  return (
                                    <article key={match.id || `match-view-${section.groupName || 'all'}-${index}`} className={`rounded-2xl sm:rounded-[24px] border p-2 sm:p-4 ${isCompleted ? 'border-emerald-200 bg-emerald-50/70' : isPending ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/70'}`}>
                                      <div className="flex items-start justify-between gap-2 sm:gap-3">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="text-xs sm:text-sm font-bold text-slate-950">{cleanCourtLabel}</span>
                                          {match.scheduled_time && (
                                            <span className="text-[10px] sm:text-xs text-slate-500 font-medium">
                                              ({formatScheduledTime(match.scheduled_time)})
                                            </span>
                                          )}
                                          {pairGroupLabel && (
                                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] sm:text-xs font-medium text-amber-800">{pairGroupLabel}</span>
                                          )}
                                        </div>
                                        <span className={`rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-semibold ${isCompleted ? 'bg-emerald-100 text-emerald-800' : isPending ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>
                                          {isCompleted ? '완료' : isPending ? '대기중' : '진행중'}
                                        </span>
                                      </div>

                                      <div className="mt-1.5 sm:mt-2.5 grid grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] items-stretch gap-1.5 sm:gap-3">
                                        <div className="flex min-w-0 flex-col justify-center rounded-xl sm:rounded-2xl bg-white px-2 py-1 sm:px-3 sm:py-4 text-left text-slate-800">
                                          <span className="text-[10px] sm:text-xs font-semibold text-blue-600">팀1</span>
                                          <div className="mt-0.5 whitespace-pre-line text-xs sm:text-sm font-bold sm:font-medium leading-normal sm:leading-6 sm:text-base text-slate-800">{formatBracketTeam(match.team1, match, section.matches, isPairCustomTournament)}</div>
                                        </div>
                                        <div className="flex flex-col items-center justify-center rounded-xl sm:rounded-2xl bg-slate-900 px-1 py-1 sm:px-2 sm:py-4 text-center text-white">
                                          <div className="text-[9px] sm:text-[11px] font-medium text-slate-300">{isCompleted ? '점수' : '매치'}</div>
                                          <div className="mt-0.5 sm:mt-1 text-xs sm:text-lg font-bold sm:font-semibold sm:text-xl">
                                            {isCompleted ? `${match.score_team1 ?? 0}:${match.score_team2 ?? 0}` : 'VS'}
                                          </div>
                                        </div>
                                        <div className="flex min-w-0 flex-col justify-center rounded-xl sm:rounded-2xl bg-white px-2 py-1 sm:px-3 sm:py-4 text-right text-slate-800">
                                          <span className="text-[10px] sm:text-xs font-semibold text-rose-600">팀2</span>
                                          <div className="mt-0.5 whitespace-pre-line text-xs sm:text-sm font-bold sm:font-medium leading-normal sm:leading-6 sm:text-base text-slate-800">{formatBracketTeam(match.team2, match, section.matches, isPairCustomTournament)}</div>
                                        </div>
                                      </div>

                                      <div className="mt-1.5 sm:mt-2.5 flex justify-end">
                                        {isCompleted ? (
                                          match.id ? (
                                            <Link
                                              href={`/scoreboard/${match.id}`}
                                              className="shrink-0 rounded-lg bg-slate-700 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white transition hover:bg-slate-600"
                                            >
                                              ✔️ 경기완료
                                            </Link>
                                          ) : (
                                            <span className="shrink-0 rounded-lg bg-slate-200 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-medium text-slate-400">
                                              ✔️ 경기완료
                                            </span>
                                          )
                                        ) : (
                                          match.id ? (
                                            <Link
                                              href={`/scoreboard/${match.id}`}
                                              className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white transition hover:bg-slate-700"
                                            >
                                              {match.status === 'in_progress' ? '🔴 LIVE 보기' : '📋 점수판'}
                                            </Link>
                                          ) : (
                                            <span className="shrink-0 rounded-lg bg-slate-300 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-medium text-slate-500 cursor-not-allowed">
                                              📋 점수판
                                            </span>
                                          )
                                        )}
                                      </div>
                                      {(() => {
                                        const displayReferee = getDisplayRefereeName(match);
                                        if (!displayReferee) return null;
                                        return (
                                          <div className="mt-1.5 sm:mt-2 text-[10px] sm:text-xs text-slate-400 text-center">
                                            심판: <span className="font-medium text-slate-600">
                                              {displayReferee} {!match.referee_name && ' (이전 경기 승자)'}
                                            </span>
                                          </div>
                                        );
                                      })()}
                                    </article>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {(userActiveTab === 'results' || userActiveTab.startsWith('group_')) && (
                  <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-slate-900">
                        {isPairCustomTournament
                          ? userActiveTab.startsWith('group_')
                            ? `${userActiveTab.replace('group_', '')} 순위`
                            : '페어별 종합 순위'
                          : '전체 경기결과'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {isPairCustomTournament
                          ? '대회에 등록된 페어별 경기 결과를 순위별로 표시합니다.'
                          : '선택된 회차와 관계없이 등록된 모든 경기 결과를 통합해 표시합니다.'}
                      </p>
                    </div>
                    {!hasResultData ? (
                      <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        입력된 경기 결과가 아직 없습니다.
                      </div>
                    ) : isPairCustomTournament ? (
                      <div className="space-y-6">
                        <div>
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-base font-semibold text-slate-900">
                              {userActiveTab.startsWith('group_')
                                ? `${userActiveTab.replace('group_', '')} 결과`
                                : '종합 순위'}
                            </h3>
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                              {filteredPairStats.length}개 페어
                            </span>
                          </div>

                          {filteredPairStats.length === 0 ? (
                            <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                              결과가 등록된 경기가 없습니다.
                            </div>
                          ) : (
                            <div className="grid gap-4 md:grid-cols-2">
                              {filteredPairStats.map((entry, index) => (
                                <article key={entry.pairKey} className="relative rounded-[24px] border border-amber-200 bg-gradient-to-br from-amber-50/40 to-orange-50/40 px-5 py-5 shadow-sm">
                                  {/* 순위 표시 뱃지 */}
                                  <div className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white shadow-sm">
                                    {index + 1}
                                  </div>
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-base font-bold text-slate-900 truncate pr-6">{entry.pairKey}</p>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm ring-1 ring-amber-200/50">
                                          {entry.groupName}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-600">
                                          승률 {entry.matches > 0 ? `${((entry.wins / entry.matches) * 100).toFixed(1)}%` : '0%'}
                                        </span>
                                        <span className="text-xs text-slate-300">|</span>
                                        <span className={`text-xs font-bold ${entry.pointsDiff > 0 ? 'text-blue-600' : entry.pointsDiff < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                                          득실차 {entry.pointsDiff > 0 ? `+${entry.pointsDiff}` : entry.pointsDiff}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="mt-4 grid grid-cols-4 gap-1.5 text-center text-xs">
                                    <div className="rounded-xl bg-white/80 px-1 py-2 border border-amber-100">
                                      <p className="text-[10px] text-slate-500">경기</p>
                                      <p className="mt-0.5 font-bold text-slate-700">{entry.matches}</p>
                                    </div>
                                    <div className="rounded-xl bg-emerald-50 px-1 py-2">
                                      <p className="text-[10px] text-emerald-700">승</p>
                                      <p className="mt-0.5 font-bold text-emerald-700">{entry.wins}</p>
                                    </div>
                                    <div className="rounded-xl bg-rose-50 px-1 py-2">
                                      <p className="text-[10px] text-rose-700">패</p>
                                      <p className="mt-0.5 font-bold text-rose-700">{entry.losses}</p>
                                    </div>
                                    <div className="rounded-xl bg-slate-50 px-1 py-2">
                                      <p className="text-[10px] text-slate-500">무</p>
                                      <p className="mt-0.5 font-bold text-slate-700">{entry.draws}</p>
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {teamStatsEntries.length > 0 && (
                          <div>
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h3 className="text-base font-semibold text-slate-900">팀별 결과</h3>
                              <span className="text-xs text-slate-500">{teamStatsEntries.length}개 팀</span>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {teamStatsEntries.map(([teamName, stats]) => (
                                <article key={teamName} className="rounded-[24px] border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 px-5 py-5 shadow-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-lg font-semibold text-slate-900">{teamName}</p>
                                      <p className="mt-1 text-sm text-slate-600">승률 {stats.matches > 0 ? `${((stats.wins / stats.matches) * 100).toFixed(1)}%` : '0%'}</p>
                                    </div>
                                    <div className="rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm">{stats.matches}경기</div>
                                  </div>
                                  <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
                                    <div className="rounded-2xl bg-emerald-50 px-2 py-3">
                                      <p className="text-[11px] text-emerald-700">승</p>
                                      <p className="mt-1 font-semibold text-emerald-700">{stats.wins}</p>
                                    </div>
                                    <div className="rounded-2xl bg-rose-50 px-2 py-3">
                                      <p className="text-[11px] text-rose-700">패</p>
                                      <p className="mt-1 font-semibold text-rose-700">{stats.losses}</p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-2 py-3">
                                      <p className="text-[11px] text-slate-500">무</p>
                                      <p className="mt-1 font-semibold text-slate-700">{stats.draws}</p>
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-base font-semibold text-slate-900">선수별 검색</h3>
                            <span className="text-xs text-slate-500">검색으로만 확인</span>
                          </div>
                          <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                type="text"
                                value={playerSearchQuery}
                                onChange={(event) => setPlayerSearchQuery(event.target.value)}
                                placeholder="선수 이름을 입력하세요"
                                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                              />
                              <button
                                type="button"
                                onClick={() => setSubmittedPlayerSearchQuery(playerSearchQuery)}
                                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 sm:min-w-24"
                              >
                                검색
                              </button>
                            </div>
                            {!normalizedPlayerSearchQuery ? (
                              <p className="mt-3 text-sm text-slate-500">선수 이름을 검색하면 개인 경기 결과를 확인할 수 있습니다.</p>
                            ) : filteredPlayerStatsEntries.length === 0 ? (
                              <p className="mt-3 text-sm text-slate-500">검색된 선수가 없습니다.</p>
                            ) : (
                              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {filteredPlayerStatsEntries.map(([player, stats]) => (
                                  <article key={player} className="rounded-[22px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <p className="text-base font-semibold text-slate-900">{player}</p>
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                            {stats.teamLabel}
                                          </span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">승률 {stats.matches > 0 ? `${((stats.wins / stats.matches) * 100).toFixed(1)}%` : '0%'}</p>
                                      </div>
                                      <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{stats.matches}경기</div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-sm">
                                      <div className="rounded-2xl bg-emerald-50 px-2 py-3">
                                        <p className="text-[11px] text-emerald-700">승</p>
                                        <p className="mt-1 font-semibold text-emerald-700">{stats.wins}</p>
                                      </div>
                                      <div className="rounded-2xl bg-rose-50 px-2 py-3">
                                        <p className="text-[11px] text-rose-700">패</p>
                                        <p className="mt-1 font-semibold text-rose-700">{stats.losses}</p>
                                      </div>
                                      <div className="rounded-2xl bg-slate-50 px-2 py-3">
                                        <p className="text-[11px] text-slate-500">무</p>
                                        <p className="mt-1 font-semibold text-slate-700">{stats.draws}</p>
                                      </div>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-white py-16 px-4 text-center shadow-sm">
                <style>{`
                  @keyframes float-user-empty {
                    0%, 100% { transform: translateY(0px) rotate(0deg); }
                    50% { transform: translateY(-6px) rotate(2deg); }
                  }
                  .animate-float-user-empty {
                    animation: float-user-empty 3s ease-in-out infinite;
                  }
                `}</style>
                <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-blue-500 ring-8 ring-blue-50/30 animate-float-user-empty">
                  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10 text-blue-500">
                    <path d="M28 44 C28 50, 36 50, 36 44 C36 41, 28 41, 28 44 Z" fill="currentColor" className="fill-blue-500/20" />
                    <path d="M22 20 L28 41 M36 41 L42 20" />
                    <path d="M26 20 L29 41" />
                    <path d="M38 20 L35 41" />
                    <path d="M32 20 L32 41" />
                    <path d="M20 20 C20 20, 32 24, 44 20" fill="none" />
                    <path d="M21.5 29 C21.5 29, 32 32, 42.5 29" fill="none" />
                  </svg>
                  <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 animate-ping opacity-75" />
                  <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400" />
                </div>
                <h4 className="text-base font-semibold text-slate-800">아직 경기 대진표가 생성되지 않았습니다!</h4>
                <p className="mt-2 max-w-sm text-sm text-slate-500 leading-relaxed">
                  대진표가 구성되면 이곳에서 경기 대진과 코트 배정, 실시간 스코어 및 경기 결과를 한눈에 확인하실 수 있습니다. 잠시만 기다려주세요!
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
