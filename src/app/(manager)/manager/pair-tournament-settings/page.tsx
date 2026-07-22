'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { fetchLevelInfoMap, getLevelScoreFromCode, type LevelInfoMap } from '@/lib/level-info';

type PairGroupDefinition = {
  groupName: string;
  pairNames: string[];
};

type PairTournamentFormat = 'round_robin' | 'knockout' | 'round_robin_knockout' | 'knockout_round_robin';
type ByeProgressionMode = 'league_ranking' | 'league_final';

type PairGroupSetting = {
  groupName: string;
  pairNames: string[];
  format: PairTournamentFormat;
  roundRobinRepeats: number;
  knockoutQualifiers: number;
  byeProgressionMode: ByeProgressionMode;
};

interface TeamAssignment {
  id: string;
  round_number: number;
  assignment_date: string;
  title: string;
  team_type: 'pairs';
  pairs_data?: Record<string, string[]>;
  pair_groups?: PairGroupDefinition[];
}

interface Match {
  id?: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[];
  team2: string[];
  team1_levels?: number[];
  team2_levels?: number[];
  court: string;
  scheduled_time?: string;
  status: 'pending' | 'in_progress' | 'completed';
  score_team1?: number;
  score_team2?: number;
  winner?: 'team1' | 'team2' | 'draw';
  next_match_number?: number;
  next_match_slot?: 1 | 2;
  is_bracket_slot?: boolean;
  competition_phase?: 'preliminary' | 'ranking_league' | 'ranking_final';
  competition_group_key?: string;
  team1_source_match_number?: number;
  team2_source_match_number?: number;
}

interface Tournament {
  id: string;
  title: string;
  tournament_date: string;
  round_number: number;
  match_type: string;
  team_assignment_id: string;
  team_type: string;
  total_teams: number;
  matches_per_player: number;
  created_at: string;
}

type PairEntry = {
  name: string;
  players: string[];
  totalScore: number;
};

type TeamParticipantsModalState = {
  title: string;
  subtitle?: string;
  teams: { name: string; players: string[] }[];
} | null;

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const toPairsData = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const raw = (value as { pairs?: unknown }).pairs;
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : (value as Record<string, unknown>);

  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => /^pair\d+$/i.test(key))
      .map(([key, players]) => [key, toStringArray(players)])
      .filter(([, players]) => players.length > 0)
  );
};

const toPairGroupDefinitions = (value: unknown): PairGroupDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const group = item as { groupName?: unknown; pairNames?: unknown };
      const groupName = String(group.groupName || '').trim();
      const pairNames = toStringArray(group.pairNames)
        .map((pairName) => pairName.trim())
        .filter((pairName) => /^pair\d+$/i.test(pairName));

      if (!groupName || pairNames.length === 0) {
        return null;
      }

      return {
        groupName,
        pairNames: Array.from(new Set(pairNames)),
      };
    })
    .filter((group): group is PairGroupDefinition => Boolean(group));
};

const parsePairsPayload = (value: unknown): { pairsData: Record<string, string[]>; pairGroups: PairGroupDefinition[] } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      pairsData: toPairsData(value),
      pairGroups: [],
    };
  }

  const raw = value as { pairs?: unknown; groups?: unknown };

  return {
    pairsData: toPairsData(raw.pairs ?? value),
    pairGroups: toPairGroupDefinitions(raw.groups),
  };
};

const normalizeTeamAssignment = (assignment: any): TeamAssignment => {
  const parsedPairs = parsePairsPayload(assignment.pairs_data);

  return {
    id: assignment.id,
    round_number: assignment.round_number,
    assignment_date: assignment.assignment_date,
    title: assignment.title,
    team_type: 'pairs',
    pairs_data: parsedPairs.pairsData,
    pair_groups: parsedPairs.pairGroups,
  };
};

const formatTournamentTitle = (title: string) => {
  const match = title.match(/^(대회 경기 \d{4}-\d{2}-\d{2})\s*(?:라운드\d+)?\s*(.+?)(?:\s*-\s*\d+회차)?$/);
  if (match) {
    return {
      main: match[1],
      sub: match[2],
    };
  }
  return { main: title, sub: '' };
};

const formatDateDot = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[0]}. ${parseInt(parts[1], 10)}. ${parseInt(parts[2], 10)}.`;
  }
  return dateStr;
};

const getPairFormatLabel = (format: PairTournamentFormat) => {
  if (format === 'knockout') return '토너먼트';
  if (format === 'round_robin_knockout') return '리그후 토너먼트';
  if (format === 'knockout_round_robin') return '토너먼트후 풀리그';
  return '풀리그';
};

const extractGroupLabelFromCourt = (court: string | undefined | null) => {
  if (!court) return '';
  const match = court.trim().match(/^\[(.+?)\]\s*(.+)$/i);
  return match?.[1]?.trim() || '';
};

const formatCourtNameOnly = (court: string | undefined | null) => {
  if (!court) return '';
  const match = court.trim().match(/^\[(.+?)\]\s*(.+)$/i);
  const courtLabel = match?.[2]?.trim() || court;
  return courtLabel.replace(/\bCourt\s*(\d+)/i, '$1코트');
};

const formatScheduledTime = (timeStr: string | undefined | null) => {
  if (!timeStr) return '';
  try {
    const timePart = timeStr.split('T')[1] || '';
    const [h, m] = timePart.split(':');
    if (h && m) {
      return `${h}:${m}`;
    }
  } catch {
    // fallback
  }
  return '';
};

const getPairDisplayLabel = (pairName: string, groupName?: string, allGroups?: string[]): string => {
  const pairNumberMatch = String(pairName).match(/(\d+)/);
  const pairNumber = pairNumberMatch ? pairNumberMatch[1] : String(pairName);
  const normalizedGroupName = String(groupName || '').trim().toUpperCase();

  let groupPrefix = '';
  if (normalizedGroupName.includes('A') || normalizedGroupName.includes('상위')) {
    groupPrefix = 'A';
  } else if (normalizedGroupName.includes('B') || normalizedGroupName.includes('중상') || normalizedGroupName.includes('중위')) {
    groupPrefix = 'B';
  } else if (normalizedGroupName.includes('C') || normalizedGroupName.includes('중하') || normalizedGroupName.includes('하위')) {
    const hasD = Array.isArray(allGroups) && allGroups.some(g => g.toUpperCase().includes('D') || g.includes('중상') || g.includes('중하'));
    if (normalizedGroupName.includes('하위') && hasD) {
      groupPrefix = 'D';
    } else {
      groupPrefix = 'C';
    }
  } else if (normalizedGroupName.includes('D')) {
    groupPrefix = 'D';
  } else if (normalizedGroupName.includes('기타')) {
    groupPrefix = '기타';
  }

  return groupPrefix ? `${groupPrefix}-페어-${pairNumber}` : `페어-${pairNumber}`;
};

const getConvertedGroupName = (name: string, allGroups?: string[]) => {
  const trimmed = name.trim();
  if (trimmed.includes('상위')) return 'A';
  if (trimmed.includes('중상')) return 'B';
  if (trimmed.includes('중위')) return 'B';
  if (trimmed.includes('중하')) return 'C';
  if (trimmed.includes('하위')) {
    const has4Groups = Array.isArray(allGroups) && allGroups.some(g => g.includes('중상') || g.includes('중하'));
    return has4Groups ? 'D' : 'C';
  }
  return trimmed.replace(' 그룹', '');
};

const convertedGroupNameOnly = (name: string, allGroups?: string[]) => {
  const converted = getConvertedGroupName(name, allGroups);
  return converted.endsWith('그룹') ? converted : `${converted} 그룹`;
};

const getPairFormatTitleLabel = (format: PairTournamentFormat) => {
  switch (format) {
    case 'round_robin':
      return '풀리그';
    case 'knockout':
      return '토너먼트';
    case 'round_robin_knockout':
      return '리그-토너';
    case 'knockout_round_robin':
      return '토너-리그';
    default:
      return format;
  }
};

function PairTournamentSettingsContent() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({});
  const [selectedAssignment, setSelectedAssignment] = useState<TeamAssignment | null>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [generatedMatches, setGeneratedMatches] = useState<Match[]>([]);
  const [pairGroupSettings, setPairGroupSettings] = useState<PairGroupSetting[]>([]);
  const [roundNumber, setRoundNumber] = useState(1);
  const [numberOfCourts, setNumberOfCourts] = useState(4);
  const [startTime, setStartTime] = useState('17:30');
  const [timeInterval, setTimeInterval] = useState(10);
  const [viewType, setViewType] = useState<'card' | 'table'>('table');
  const [tournamentDate, setTournamentDate] = useState('');
  const [levelInfoMap, setLevelInfoMap] = useState<LevelInfoMap>({});
  const [teamParticipantsModal, setTeamParticipantsModal] = useState<TeamParticipantsModalState>(null);
  const [tournamentMatchesModal, setTournamentMatchesModal] = useState<{
    title: string;
    subtitle?: string;
    teamType: string;
    matches: Match[];
  } | null>(null);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<string | null>(null);

  const assignmentIdQuery = searchParams.get('assignmentId');

  const getPlayerName = (nameWithLevel: string) =>
    nameWithLevel.replace(/\s*\([^)]*\)\s*$/, '').trim();

  const getPairTeamLabel = (players: string[], opposingPlayers: string[] = [], stageLabel = '') => {
    if (players.length > 0) return players.map(getPlayerName).join(' / ');
    return opposingPlayers.length > 0 ? '부전승' : stageLabel ? `${stageLabel} 진출팀` : '대진 미정';
  };

  const getPairSlotLabel = (players: string[], opposingPlayers: string[], index: number, stageLabel = '') =>
    players[index] ? getPlayerName(players[index]) : index === 0 ? getPairTeamLabel(players, opposingPlayers, stageLabel) : '';

  const getKnockoutStageLabel = (match: Match, matches: Match[]) => {
    if (match.competition_phase === 'preliminary') return '예선';
    if (match.competition_phase === 'ranking_league') return '풀리그';
    if (match.competition_phase === 'ranking_final') return '결승';
    const finalRound = Math.max(...matches.map((item) => item.round));
    const roundsUntilFinal = finalRound - match.round;
    if (roundsUntilFinal === 0) return '결승';
    if (roundsUntilFinal === 1) return '4강';
    if (roundsUntilFinal === 2) return '예선';
    return '예선';
  };

  const isKnockoutBracketMatch = (match: Match, matches: Match[], format: PairTournamentFormat) => {
    if (format === 'knockout_round_robin') return true;
    if (format === 'knockout') return true;
    if (format !== 'round_robin_knockout') return false;

    return Boolean(match.next_match_number) || matches.some(
      (candidate) => candidate.next_match_number === match.match_number
    );
  };

  const shufflePairs = (pairs: PairEntry[]) => {
    const shuffled = [...pairs];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    return shuffled;
  };

  const extractLevelFromName = (nameWithLevel: string): string => {
    const match = nameWithLevel.match(/\(([^)]+)\)(?!.*\()$/);
    return match ? match[1].toLowerCase().trim() : 'e2';
  };

  const getPlayerScore = (playerName: string): number =>
    getLevelScoreFromCode(levelInfoMap, extractLevelFromName(playerName), 0);

  const getPairEntriesFromAssignment = (assignment: TeamAssignment | null): PairEntry[] => {
    if (!assignment?.pairs_data) {
      return [];
    }

    return Object.entries(assignment.pairs_data)
      .map(([pairName, players]) => ({
        name: pairName,
        players,
        totalScore: players.reduce((sum, player) => sum + getPlayerScore(player), 0),
      }))
      .filter((pair) => pair.players.length > 0)
      .sort((left, right) => {
        const scoreDiff = right.totalScore - left.totalScore;
        if (Math.abs(scoreDiff) > 0.0001) {
          return scoreDiff;
        }

        return left.name.localeCompare(right.name, 'ko', { sensitivity: 'base' });
      });
  };

  const getPairGroupsFromAssignment = (assignment: TeamAssignment | null) => {
    const pairEntries = getPairEntriesFromAssignment(assignment);
    const pairMap = new Map(pairEntries.map((pair) => [pair.name, pair]));

    if (!assignment || pairEntries.length === 0) {
      return [];
    }

    if (assignment.pair_groups && assignment.pair_groups.length > 0) {
      return assignment.pair_groups
        .map((group) => ({
          groupName: group.groupName,
          pairs: group.pairNames
            .map((pairName) => pairMap.get(pairName))
            .filter((pair): pair is PairEntry => Boolean(pair)),
        }))
        .filter((group) => group.pairs.length > 0);
    }

    return [
      {
        groupName: '페어 그룹',
        pairs: pairEntries,
      },
    ];
  };

  const initializePairGroupSettings = (assignment: TeamAssignment | null) => {
    const groups = getPairGroupsFromAssignment(assignment);

    setPairGroupSettings(
      groups.map((group) => ({
        groupName: group.groupName,
        pairNames: group.pairs.map((pair) => pair.name),
        format: 'round_robin',
        roundRobinRepeats: 1,
        knockoutQualifiers: Math.min(4, Math.max(2, group.pairs.length >= 4 ? 4 : group.pairs.length)),
        byeProgressionMode: 'league_ranking',
      }))
    );
  };

  const updatePairGroupSetting = (
    groupName: string,
    updater: (current: PairGroupSetting) => PairGroupSetting
  ) => {
    setPairGroupSettings((prev) =>
      prev.map((group) => (group.groupName === groupName ? updater(group) : group))
    );
  };

  const createPairMatch = (
    groupName: string,
    team1Pair: PairEntry,
    team2Pair: PairEntry,
    matchNumber: number,
    round: number,
    courtNumber: number
  ): Match => ({
    tournament_id: '',
    round,
    match_number: matchNumber,
    team1: team1Pair.players,
    team2: team2Pair.players,
    team1_levels: [team1Pair.totalScore],
    team2_levels: [team2Pair.totalScore],
    court: `[${groupName}] ${courtNumber}코트`,
    status: 'pending',
  });

  const createRoundRobinMatchesForPairs = (
    groupName: string,
    pairs: PairEntry[],
    repeatCount: number,
    roundOffset: number,
    matchNumberOffset: number,
    courtCount: number
  ) => {
    const matches: Match[] = [];
    let nextMatchNumber = matchNumberOffset;
    let nextRound = roundOffset;

    for (let repeat = 0; repeat < repeatCount; repeat += 1) {
      for (let leftIndex = 0; leftIndex < pairs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < pairs.length; rightIndex += 1) {
          const matchNumber = nextMatchNumber++;
          matches.push(
            createPairMatch(
              groupName,
              pairs[leftIndex],
              pairs[rightIndex],
              matchNumber,
              nextRound,
              ((matchNumber - 1) % courtCount) + 1
            )
          );
        }
      }
      nextRound += 1;
    }

    return matches;
  };

  const createKnockoutBracketMatchesForPairs = (
    groupName: string,
    pairs: PairEntry[],
    roundOffset: number,
    matchNumberOffset: number,
    courtCount: number,
    randomizeSeeds = false,
    emptyInitialRound = false
  ) => {
    const seededPairs = randomizeSeeds
      ? shufflePairs(pairs)
      : [...pairs].sort((left, right) => right.totalScore - left.totalScore);
    const mainBracketSize = 2 ** Math.floor(Math.log2(Math.max(2, seededPairs.length)));
    const playInCount = seededPairs.length - mainBracketSize;
    const directEntryCount = mainBracketSize - playInCount;
    const rounds: Match[][] = [];
    let nextMatchNumber = matchNumberOffset;

    const playInMatches: Match[] = [];
    const mainEntries: Array<{ pair?: PairEntry; playInMatch?: Match }> = seededPairs
      .slice(0, directEntryCount)
      .map((pair) => ({ pair }));

    for (let index = 0; index < playInCount; index += 1) {
      const team1Pair = seededPairs[directEntryCount + index];
      const team2Pair = seededPairs[seededPairs.length - 1 - index];
      const match = createPairMatch(
        groupName,
        team1Pair,
        team2Pair,
        nextMatchNumber++,
        roundOffset,
        (index % courtCount) + 1
      );
      playInMatches.push(match);
      mainEntries.push({ playInMatch: match });
    }

    const mainRoundCount = Math.log2(mainBracketSize);
    for (let roundIndex = 0; roundIndex < mainRoundCount; roundIndex += 1) {
      const matchCount = mainBracketSize / 2 ** (roundIndex + 1);
      const roundMatches: Match[] = [];

      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
        const team1Entry = !emptyInitialRound && roundIndex === 0 ? mainEntries[matchIndex * 2] : null;
        const team2Entry = !emptyInitialRound && roundIndex === 0 ? mainEntries[matchIndex * 2 + 1] : null;

        roundMatches.push({
          tournament_id: '',
          round: roundOffset + (playInCount > 0 ? roundIndex + 1 : roundIndex),
          match_number: nextMatchNumber++,
          team1: team1Entry?.pair?.players || [],
          team2: team2Entry?.pair?.players || [],
          team1_levels: team1Entry?.pair ? [team1Entry.pair.totalScore] : [],
          team2_levels: team2Entry?.pair ? [team2Entry.pair.totalScore] : [],
          court: `[${groupName}] ${((matchIndex % courtCount) + 1)}코트`,
          status: 'pending',
          is_bracket_slot: true,
        });
      }

      rounds.push(roundMatches);
    }

    if (playInMatches.length > 0) {
      const openingRound = rounds[0];
      mainEntries.forEach((entry, index) => {
        if (!entry.playInMatch) return;
        entry.playInMatch.next_match_number = openingRound[Math.floor(index / 2)].match_number;
        entry.playInMatch.next_match_slot = index % 2 === 0 ? 1 : 2;
      });
    }

    rounds.slice(0, -1).forEach((roundMatches, roundIndex) => {
      roundMatches.forEach((match, matchIndex) => {
        const nextMatch = rounds[roundIndex + 1][Math.floor(matchIndex / 2)];
        match.next_match_number = nextMatch.match_number;
        match.next_match_slot = matchIndex % 2 === 0 ? 1 : 2;
      });
    });

    return [...playInMatches, ...rounds.flat()];
  };

  const createKnockoutThenLeagueMatchesForPairs = (
    groupName: string,
    pairs: PairEntry[],
    roundOffset: number,
    matchNumberOffset: number,
    courtCount: number,
    progressionMode: ByeProgressionMode
  ) => {
    const groupKey = `${groupName}:knockout_then_league`;
    const preliminarySize = 2 ** Math.floor(Math.log2(Math.max(2, pairs.length)));
    const byeCount = pairs.length - preliminarySize;
    const pairsByAscendingScore = [...pairs].sort((left, right) =>
      left.totalScore - right.totalScore || left.name.localeCompare(right.name, 'ko-KR')
    );
    const byePairs = pairsByAscendingScore.slice(0, byeCount);
    const preliminaryPairs = pairsByAscendingScore.slice(byeCount).reverse();
    const preliminaryMatches: Match[] = [];
    let nextMatchNumber = matchNumberOffset;

    for (let index = 0; index < preliminaryPairs.length / 2; index += 1) {
      const match = createPairMatch(
        groupName,
        preliminaryPairs[index],
        preliminaryPairs[preliminaryPairs.length - 1 - index],
        nextMatchNumber++,
        roundOffset,
        (index % courtCount) + 1
      );
      match.competition_phase = 'preliminary';
      match.competition_group_key = groupKey;
      preliminaryMatches.push(match);
    }

    const leagueEntries: Array<{ pair?: PairEntry; sourceMatchNumber?: number }> = [
      ...byePairs.map((pair) => ({ pair })),
      ...preliminaryMatches.map((match) => ({ sourceMatchNumber: match.match_number })),
    ];
    const leagueMatches: Match[] = [];
    for (let leftIndex = 0; leftIndex < leagueEntries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < leagueEntries.length; rightIndex += 1) {
        const team1Entry = leagueEntries[leftIndex];
        const team2Entry = leagueEntries[rightIndex];
        leagueMatches.push({
          tournament_id: '',
          round: roundOffset + 1,
          match_number: nextMatchNumber++,
          team1: team1Entry.pair?.players || [],
          team2: team2Entry.pair?.players || [],
          team1_levels: team1Entry.pair ? [team1Entry.pair.totalScore] : [],
          team2_levels: team2Entry.pair ? [team2Entry.pair.totalScore] : [],
          team1_source_match_number: team1Entry.sourceMatchNumber,
          team2_source_match_number: team2Entry.sourceMatchNumber,
          court: `[${groupName}] ${((leagueMatches.length % courtCount) + 1)}코트`,
          status: 'pending',
          is_bracket_slot: true,
          competition_phase: 'ranking_league',
          competition_group_key: groupKey,
        });
      }
    }

    const finalMatches: Match[] = progressionMode === 'league_final'
      ? [{
          tournament_id: '',
          round: roundOffset + 2,
          match_number: nextMatchNumber++,
          team1: [],
          team2: [],
          team1_levels: [],
          team2_levels: [],
          court: `[${groupName}] 1코트`,
          status: 'pending',
          is_bracket_slot: true,
          competition_phase: 'ranking_final',
          competition_group_key: groupKey,
        }]
      : [];

    return [...preliminaryMatches, ...leagueMatches, ...finalMatches];
  };

  const scheduleMatchesOptimally = (
    rawMatches: Match[],
    courtCount: number,
    baseDate: string,
    sTime: string,
    interval: number
  ): Match[] => {
    const unscheduled = [...rawMatches];
    const scheduled: Match[] = [];
    const lastRoundForPlayer = new Map<string, number>();
    const totalMatches = rawMatches.length;
    const totalRounds = Math.ceil(totalMatches / courtCount);

    for (let r = 1; r <= totalRounds; r += 1) {
      const currentRoundGroups: string[] = [];
      const currentRoundPlayers = new Set<string>();

      for (let c = 1; c <= courtCount; c += 1) {
        if (unscheduled.length === 0) break;

        let bestIndex = -1;
        let minPenalty = Infinity;

        for (let i = 0; i < unscheduled.length; i += 1) {
          const match = unscheduled[i];
          const matchPlayers = [...match.team1, ...match.team2].map(getPlayerName);
          const groupName = extractGroupLabelFromCourt(match.court);

          let penalty = 0;
          let isForbidden = false;

          // 1. 동일 라운드 중복 출전 방지
          for (let pIdx = 0; pIdx < matchPlayers.length; pIdx += 1) {
            if (currentRoundPlayers.has(matchPlayers[pIdx])) {
              isForbidden = true;
              break;
            }
          }
          if (isForbidden) {
            continue;
          }

          // 2. 대기 시간(쉬는 라운드 수)에 따른 페널티 계산
          for (let pIdx = 0; pIdx < matchPlayers.length; pIdx += 1) {
            const player = matchPlayers[pIdx];
            const lastR = lastRoundForPlayer.get(player);
            if (lastR !== undefined) {
              const gap = r - lastR;
              if (gap <= 0) {
                penalty += 10000000;
              } else if (gap === 1) {
                penalty += 1000000; // 연속 경기 페널티
              } else if (gap === 2) {
                penalty += 100000;  // 1경기 쉬고 경기
              } else if (gap === 3) {
                penalty += 10000;   // 2경기 쉬고 경기
              } else if (gap === 4) {
                penalty += 1000;    // 3경기 쉬고 경기
              }
            }
          }

          // 3. 한 라운드 내 코트별 그룹 섞기
          const groupCountInCurrentRound = currentRoundGroups.filter((g) => g === groupName).length;
          penalty += groupCountInCurrentRound * 50000;

          // 직전 라운드 동일 코트의 그룹 비교
          const prevMatchOnSameCourt = scheduled.find(
            (m) => m.round === r - 1 && m.court.endsWith(`${c}코트`)
          );
          if (prevMatchOnSameCourt) {
            const prevGroupName = extractGroupLabelFromCourt(prevMatchOnSameCourt.court);
            if (prevGroupName === groupName) {
              penalty += 5000;
            }
          }

          // 4. 타이 브레이크 (매치 목록의 원래 인덱스 순서 유지)
          penalty += i * 0.1;

          if (penalty < minPenalty) {
            minPenalty = penalty;
            bestIndex = i;
          }
        }

        // 예외 대응: 모든 경기가 동일 라운드 중복 출전 규칙에 막힌 경우
        if (bestIndex === -1) {
          let fallbackBestIndex = -1;
          let fallbackMinPenalty = Infinity;
          for (let i = 0; i < unscheduled.length; i += 1) {
            const match = unscheduled[i];
            const matchPlayers = [...match.team1, ...match.team2].map(getPlayerName);
            const groupName = extractGroupLabelFromCourt(match.court);

            let penalty = 10000000; // 기본적으로 중복 출전 패널티

            for (let pIdx = 0; pIdx < matchPlayers.length; pIdx += 1) {
              const player = matchPlayers[pIdx];
              const lastR = lastRoundForPlayer.get(player);
              if (lastR !== undefined) {
                const gap = r - lastR;
                if (gap <= 1) penalty += 1000000;
                else if (gap === 2) penalty += 100000;
              }
            }

            const groupCountInCurrentRound = currentRoundGroups.filter((g) => g === groupName).length;
            penalty += groupCountInCurrentRound * 50000;
            penalty += i * 0.1;

            if (penalty < fallbackMinPenalty) {
              fallbackMinPenalty = penalty;
              fallbackBestIndex = i;
            }
          }
          bestIndex = fallbackBestIndex;
        }

        if (bestIndex !== -1) {
          const selectedMatch = unscheduled.splice(bestIndex, 1)[0];
          const selectedPlayers = [...selectedMatch.team1, ...selectedMatch.team2].map(getPlayerName);

          selectedPlayers.forEach((player) => {
            lastRoundForPlayer.set(player, r);
            currentRoundPlayers.add(player);
          });

          const groupName = extractGroupLabelFromCourt(selectedMatch.court);
          currentRoundGroups.push(groupName);

          const matchNumber = (r - 1) * courtCount + c;
          const [startHour, startMin] = (sTime || '09:00').split(':').map(Number);
          const totalMins = startHour * 60 + startMin + (r - 1) * (interval || 10);
          const hour = Math.floor(totalMins / 60);
          const min = totalMins % 60;
          const hourStr = String(hour).padStart(2, '0');
          const minStr = String(min).padStart(2, '0');
          const scheduledTime = `${baseDate || '2026-07-01'}T${hourStr}:${minStr}:00`;

          scheduled.push({
            ...selectedMatch,
            match_number: matchNumber,
            round: r,
            court: `[${groupName}] 경기-${getConvertedGroupName(groupName)}-${matchNumber}_${c}코트`,
            scheduled_time: scheduledTime,
          });
        }
      }
    }

    return scheduled;
  };

  const buildPairTournamentMatches = (
    assignment: TeamAssignment,
    settingsOverride?: PairGroupSetting[],
    randomizeGroupName?: string
  ) => {
    const pairGroups = getPairGroupsFromAssignment(assignment);
    const courtCount = Math.max(1, numberOfCourts);
    const configuredGroups =
      settingsOverride && settingsOverride.length > 0
        ? settingsOverride
        : pairGroupSettings;

    const matches: Match[] = [];
    let roundCursor = 1;
    let matchNumberCursor = 1;

    configuredGroups.forEach((groupConfig) => {
      const sourceGroup = pairGroups.find((group) => group.groupName === groupConfig.groupName);
      if (!sourceGroup) {
        return;
      }

      const configuredPairs = sourceGroup.pairs.filter((pair) => groupConfig.pairNames.includes(pair.name));
      if (configuredPairs.length < 2) {
        return;
      }
      const shouldRandomize = groupConfig.groupName === randomizeGroupName;
      const generationPairs = shouldRandomize ? shufflePairs(configuredPairs) : configuredPairs;

      if (groupConfig.format === 'round_robin') {
        const roundRobinMatches = createRoundRobinMatchesForPairs(
          groupConfig.groupName,
          generationPairs,
          Math.max(1, groupConfig.roundRobinRepeats),
          roundCursor,
          matchNumberCursor,
          courtCount
        );
        matches.push(...roundRobinMatches);
        roundCursor += Math.max(1, groupConfig.roundRobinRepeats);
        matchNumberCursor += roundRobinMatches.length;
        return;
      }

      if (groupConfig.format === 'knockout') {
        const knockoutMatches = createKnockoutBracketMatchesForPairs(
          groupConfig.groupName,
          configuredPairs,
          roundCursor,
          matchNumberCursor,
          courtCount,
          shouldRandomize
        );
        matches.push(...knockoutMatches);
        const mainBracketSize = 2 ** Math.floor(Math.log2(Math.max(2, configuredPairs.length)));
        const hasPlayIn = configuredPairs.length > mainBracketSize;
        roundCursor += Math.log2(mainBracketSize) + (hasPlayIn ? 1 : 0);
        matchNumberCursor += knockoutMatches.length;
        return;
      }

      if (groupConfig.format === 'knockout_round_robin') {
        const knockoutThenLeagueMatches = createKnockoutThenLeagueMatchesForPairs(
          groupConfig.groupName,
          configuredPairs,
          roundCursor,
          matchNumberCursor,
          courtCount,
          groupConfig.byeProgressionMode
        );
        matches.push(...knockoutThenLeagueMatches);
        roundCursor += groupConfig.byeProgressionMode === 'league_final' ? 3 : 2;
        matchNumberCursor += knockoutThenLeagueMatches.length;
        return;
      }

      const roundRobinMatches = createRoundRobinMatchesForPairs(
        groupConfig.groupName,
        generationPairs,
        Math.max(1, groupConfig.roundRobinRepeats),
        roundCursor,
        matchNumberCursor,
        courtCount
      );
      matches.push(...roundRobinMatches);
      roundCursor += Math.max(1, groupConfig.roundRobinRepeats);
      matchNumberCursor += roundRobinMatches.length;

      const qualifiers = (shouldRandomize
        ? shufflePairs(configuredPairs)
        : [...configuredPairs].sort((left, right) => right.totalScore - left.totalScore))
        .slice(0, Math.max(2, Math.min(groupConfig.knockoutQualifiers, configuredPairs.length)));

      const knockoutMatches = createKnockoutBracketMatchesForPairs(
        groupConfig.groupName,
        qualifiers,
        roundCursor,
        matchNumberCursor,
        courtCount,
        shouldRandomize,
        true
      );
      matches.push(...knockoutMatches);
      const mainBracketSize = 2 ** Math.floor(Math.log2(Math.max(2, qualifiers.length)));
      roundCursor += Math.log2(mainBracketSize) + (qualifiers.length > mainBracketSize ? 1 : 0);
      matchNumberCursor += knockoutMatches.length;
    });

    // Bracket match numbers and rounds are progression keys, so do not re-order them.
    return matches.some((match) => match.next_match_number || match.team1_source_match_number || match.team2_source_match_number)
      ? matches
      : scheduleMatchesOptimally(matches, courtCount, assignment.assignment_date, startTime, timeInterval);
  };

  const pairAssignments = useMemo(
    () => teamAssignments.filter(
      (assignment) =>
        assignment.team_type === 'pairs' &&
        assignment.pairs_data &&
        Object.keys(assignment.pairs_data).length > 0
    ),
    [teamAssignments]
  );
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [assignmentsResponse, tournamentsResponse, levelMap] = await Promise.all([
          fetch('/api/admin/team-assignments'),
          fetch('/api/admin/tournaments'),
          fetchLevelInfoMap(supabase),
        ]);

        if (!assignmentsResponse.ok) {
          const payload = await assignmentsResponse.json().catch(() => ({}));
          throw new Error(payload?.error || '페어 팀 구성을 불러오지 못했습니다.');
        }

        if (!tournamentsResponse.ok) {
          const payload = await tournamentsResponse.json().catch(() => ({}));
          throw new Error(payload?.error || '게임 목록을 불러오지 못했습니다.');
        }

        const assignmentsPayload = await assignmentsResponse.json();
        const tournamentsPayload = await tournamentsResponse.json();

        setLevelInfoMap(levelMap);
        setTeamAssignments(
          (Array.isArray(assignmentsPayload?.teamAssignments) ? assignmentsPayload.teamAssignments : [])
            .map(normalizeTeamAssignment)
            .filter((assignment: TeamAssignment) => assignment.team_type === 'pairs')
        );
        const loadedTournaments = (Array.isArray(tournamentsPayload?.tournaments) ? tournamentsPayload.tournaments : []).filter(
            (tournament: Tournament) => tournament.team_type === 'pairs'
          );
        setTournaments(loadedTournaments);

        if (loadedTournaments.length > 0) {
          const tournamentIds = loadedTournaments.map((t: Tournament) => t.id);
          const { data: countsData, error: countsError } = await supabase
            .from('tournament_matches')
            .select('tournament_id')
            .in('tournament_id', tournamentIds);

          if (!countsError && countsData) {
            const counts: Record<string, number> = {};
            countsData.forEach((row: any) => {
              counts[row.tournament_id] = (counts[row.tournament_id] || 0) + 1;
            });
            setMatchCounts(counts);
          }
        }
      } catch (error) {
        console.error('페어 대회 페이지 로딩 오류:', error);
        setTeamAssignments([]);
        setTournaments([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [supabase]);

  useEffect(() => {
    if (!assignmentIdQuery || pairAssignments.length === 0 || selectedAssignment) {
      return;
    }

    const matchedAssignment = pairAssignments.find((assignment) => assignment.id === assignmentIdQuery);
    if (!matchedAssignment) {
      return;
    }

    setSelectedAssignment(matchedAssignment);
    setTournamentDate(matchedAssignment.assignment_date || '');
    setRoundNumber(1);
    setNumberOfCourts(4);
    setShowCreatePanel(true);
    initializePairGroupSettings(matchedAssignment);
  }, [assignmentIdQuery, pairAssignments, selectedAssignment]);

  useEffect(() => {
    if (!showCreatePanel || !selectedAssignment || pairGroupSettings.length === 0) {
      return;
    }

    setGeneratedMatches(buildPairTournamentMatches(selectedAssignment));
  }, [showCreatePanel, selectedAssignment, pairGroupSettings, numberOfCourts]);

  const openParticipantsModal = (assignment: TeamAssignment) => {
    const groups = getPairGroupsFromAssignment(assignment).map((group) => ({
      name: group.groupName,
      players: group.pairs.flatMap((pair) => pair.players),
    }));

    setTeamParticipantsModal({
      title: `${assignment.title} 참가자`,
      subtitle: `${assignment.assignment_date} · 페어전`,
      teams: groups,
    });
  };

  const openTournamentAssignmentModal = async (tournament: Tournament) => {
    try {
      const response = await fetch(`/api/admin/tournaments?include_matches=1&tournament_id=${tournament.id}`);
      if (!response.ok) throw new Error('대진 정보를 가져오지 못했습니다.');
      const data = await response.json();

      setTournamentMatchesModal({
        title: `${tournament.title} 배정현황`,
        subtitle: `${tournament.tournament_date} · ${tournament.round_number}회차 · 총 ${data.matches?.length || 0}경기`,
        teamType: tournament.team_type,
        matches: data.matches || [],
      });
    } catch (error) {
      console.error(error);
      alert('대진표 조회에 실패했습니다.');
    }
  };

  const handlePreviewMatches = (assignment: TeamAssignment) => {
    setSelectedAssignment(assignment);
    setTournamentDate(assignment.assignment_date || '');
    
    // 이 페어 구성으로 이미 생성된 대회의 회차 중 가장 높은 회차 + 1로 자동 설정
    const existingTournaments = tournaments.filter(t => t.team_assignment_id === assignment.id);
    const maxRound = existingTournaments.reduce((max, t) => t.round_number > max ? t.round_number : max, 0);
    setRoundNumber(maxRound + 1);

    setNumberOfCourts(4);
    setShowCreatePanel(true);
    initializePairGroupSettings(assignment);
  };

  const handleRegenerateMatches = () => {
    if (!selectedAssignment) {
      return;
    }

    setGeneratedMatches(buildPairTournamentMatches(selectedAssignment));
  };

  const handleRegenerateGroupMatches = (groupName: string) => {
    if (!selectedAssignment) return;

    const groupSetting = pairGroupSettings.find((group) => group.groupName === groupName);
    if (!groupSetting) return;

    const regeneratedGroup = buildPairTournamentMatches(selectedAssignment, [groupSetting], groupName);
    const otherGroups = generatedMatches.filter(
      (match) => extractGroupLabelFromCourt(match.court) !== groupName
    );
    const nextMatchNumber = otherGroups.reduce(
      (max, match) => Math.max(max, match.match_number),
      0
    ) + 1;

    const renumberedGroup = regeneratedGroup.map((match, index) => {
      const matchNumber = nextMatchNumber + index;
      const offset = matchNumber - match.match_number;
      return {
        ...match,
        match_number: matchNumber,
        next_match_number: match.next_match_number ? match.next_match_number + offset : undefined,
      };
    });

    setGeneratedMatches([...otherGroups, ...renumberedGroup]);
  };

  const createTournament = async (targetGroupName?: string) => {
    try {
      if (!selectedAssignment) {
        alert('페어 구성을 선택해주세요.');
        return;
      }

      const matchesToCreate = targetGroupName
        ? generatedMatches.filter((match) => extractGroupLabelFromCourt(match.court) === targetGroupName)
        : generatedMatches;

      if (matchesToCreate.length === 0) {
        alert(targetGroupName ? `${targetGroupName} 경기가 없습니다.` : '생성된 경기가 없습니다.');
        return;
      }

      const activeSettings = targetGroupName
        ? pairGroupSettings.filter((group) => group.groupName === targetGroupName)
        : pairGroupSettings;

      // 1. 날짜 포맷팅 (YYYY-MM-DD -> MM-DD)
      const formattedDate = tournamentDate && tournamentDate.includes('-')
        ? tournamentDate.split('-').slice(1).join('-')
        : tournamentDate;

      // 2. 그룹명 변환 (상위 -> A 그룹, 중위/중상 -> B 그룹, 중하 -> C 그룹, 하위 -> C 그룹 또는 D 그룹)
      const allGroupNames = pairGroupSettings.map((g) => g.groupName);
      const convertedGroupsLabel = targetGroupName
        ? convertedGroupNameOnly(targetGroupName, allGroupNames)
        : activeSettings.map((g) => convertedGroupNameOnly(g.groupName, allGroupNames)).join(', ');

      // 3. 경기방식 포맷팅 (round_robin -> 풀리그, knockout -> 토너먼트, round_robin_knockout -> 리그-토너)
      const formatLabel = activeSettings.map(group => {
        const fmt = getPairFormatTitleLabel(group.format);
        if (group.format === 'round_robin' && group.roundRobinRepeats > 1) {
          return `${fmt} ${group.roundRobinRepeats}회`;
        }
        return fmt;
      }).join(', ');

      // 4. 최종 대회명 조립
      const title = `${formattedDate} ${roundNumber}회차 ${convertedGroupsLabel} ${formatLabel}`;
      const totalPairs = targetGroupName
        ? getPairGroupsFromAssignment(selectedAssignment).find((group) => group.groupName === targetGroupName)?.pairs.length || 0
        : getPairEntriesFromAssignment(selectedAssignment).length;

      const response = await fetch('/api/admin/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tournament: {
            title,
            tournament_date: tournamentDate,
            round_number: roundNumber,
            match_type: activeSettings.every((group) => group.format === 'knockout')
              ? 'pairs_knockout'
              : 'pairs_custom',
            team_assignment_id: selectedAssignment.id,
            team_type: 'pairs',
            total_teams: totalPairs,
            matches_per_player: 1,
          },
          matches: matchesToCreate,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || '페어 게임 생성에 실패했습니다.');
      }

      const tournamentsResponse = await fetch('/api/admin/tournaments');
      const tournamentsPayload = await tournamentsResponse.json().catch(() => ({}));
      const nextTournaments = (Array.isArray(tournamentsPayload?.tournaments) ? tournamentsPayload.tournaments : []).filter(
        (tournament: Tournament) => tournament.team_type === 'pairs'
      );
      setTournaments(nextTournaments);

      if (nextTournaments.length > 0) {
        const { data: countsData, error: countsError } = await supabase
          .from('tournament_matches')
          .select('tournament_id')
          .in('tournament_id', nextTournaments.map((t: Tournament) => t.id));

        if (!countsError && countsData) {
          const counts: Record<string, number> = {};
          countsData.forEach((row: any) => {
            counts[row.tournament_id] = (counts[row.tournament_id] || 0) + 1;
          });
          setMatchCounts(counts);
        }
      }

      setShowCreatePanel(false);
      setSelectedAssignment(null);
      setGeneratedMatches([]);
      alert(targetGroupName ? `${targetGroupName} 게임이 생성되었습니다.` : '페어 게임이 생성되었습니다.');
    } catch (error) {
      console.error('페어 대회 생성 오류:', error);
      alert(error instanceof Error ? error.message : '페어 게임 생성 중 오류가 발생했습니다.');
    }
  };

  const deleteTournament = async (tournamentId: string) => {
    if (!confirm('이 페어 게임을 삭제하시겠습니까? 모든 경기 정보가 함께 삭제됩니다.')) {
      return;
    }

    try {
      const response = await fetch('/api/admin/tournaments', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tournamentId }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || '페어 대회 삭제에 실패했습니다.');
      }

      setTournaments((prev) => prev.filter((tournament) => tournament.id !== tournamentId));
    } catch (error) {
      console.error('페어 대회 삭제 오류:', error);
      alert(error instanceof Error ? error.message : '페어 대회 삭제 중 오류가 발생했습니다.');
    }
  };

  const deleteAssignment = async (assignment: TeamAssignment) => {
    if (!confirm(`"${assignment.title}" 페어 구성을 삭제할까요?`)) {
      return;
    }

    try {
      setDeletingAssignmentId(assignment.id);

      const response = await fetch('/api/admin/team-assignments', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assignmentId: assignment.id }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || '페어 구성 삭제에 실패했습니다.');
      }

      setTeamAssignments((prev) => prev.filter((item) => item.id !== assignment.id));
      if (selectedAssignment?.id === assignment.id) {
        setSelectedAssignment(null);
        setShowCreatePanel(false);
        setGeneratedMatches([]);
      }
    } catch (error) {
      console.error('페어 구성 삭제 오류:', error);
      alert(error instanceof Error ? error.message : '페어 구성 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingAssignmentId(null);
    }
  };

  const handleManageMatches = (tournament: Tournament) => {
    router.push(`/manager/tournament-bracket?tournament=${tournament.id}`);
  };

  return (
    <div className="w-full px-2 py-2 sm:p-6">
      <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between px-1">
          <div className="space-y-0.5 pl-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
              <Users className="h-3.5 w-3.5" />
              페어대회
            </span>
            <h1 className="text-xl font-bold tracking-tight">페어 게임 관리</h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">페어 구성별로 그룹 경기 방식을 따로 설정하고 페어 게임을 생성합니다.</p>
          </div>
          <Link href="/manager">
            <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              홈
            </Button>
          </Link>
        </div>
      </section>

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:mb-6">
        일반 팀전은{' '}
        <Link href="/admin/tournament-matches" className="font-semibold underline">
          게임 경기
        </Link>
        {' '}페이지에서 계속 관리하고, 페어전만 이 페이지에서 별도로 생성합니다.
      </div>

      <div className="mb-6 rounded-lg bg-white p-4 shadow-md sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">페어 구성 선택</h2>
            <p className="mt-1 text-sm text-gray-500">team-management에서 만든 페어 구성을 기준으로 게임을 만듭니다.</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/team-management')}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            팀 관리
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-500">데이터를 불러오는 중입니다.</div>
        ) : pairAssignments.length === 0 ? (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center text-yellow-900">
            등록된 페어 구성이 없습니다. 먼저 팀 관리에서 2명 팀 구성을 저장해주세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pairAssignments.map((assignment) => {
              const pairGroups = getPairGroupsFromAssignment(assignment);
              const pairCount = pairGroups.reduce((sum, group) => sum + group.pairs.length, 0);

              return (
                <div key={assignment.id} className="rounded-xl border border-gray-200 p-4 shadow-sm transition-colors hover:border-amber-400">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{assignment.title}</h3>
                      <p className="text-sm text-gray-500">{assignment.assignment_date}</p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      페어전
                    </span>
                  </div>
                  <div className="mb-4 space-y-1 text-sm text-gray-600">
                    <div>그룹 수: {pairGroups.length}</div>
                    <div>페어 수: {pairCount}</div>
                    <div>예상 참가 인원: {pairCount * 2}명</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openParticipantsModal(assignment)}
                      className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      참가자
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePreviewMatches(assignment)}
                      className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
                    >
                      페어 게임 생성
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAssignment(assignment)}
                      disabled={deletingAssignmentId === assignment.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:bg-red-300"
                    >
                      {deletingAssignmentId === assignment.id ? '삭제중' : '삭제'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreatePanel && selectedAssignment && (
        <div className="mb-6 rounded-lg border-2 border-amber-300 bg-white p-4 shadow-md sm:p-6">
          <div className="mb-5 border-b border-gray-200 pb-4">
            <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">페어 게임 생성</h2>
            <p className="mt-1 text-sm text-gray-600">{selectedAssignment.title}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 items-start lg:grid-cols-12">
            {/* 좌측 설정창 영역 */}
            <div className="space-y-4 lg:col-span-5">
              {/* 게임 정보 */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
                <h3 className="mb-3 text-base font-semibold text-blue-900">📋 게임 정보</h3>
                <div className="flex flex-col gap-4">
                  {/* 회차 표시 (자동 배정되므로 수정 불가) */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 w-20">회차</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-900 bg-slate-100 px-3 py-1 rounded border border-slate-200">
                        {roundNumber}회차
                      </span>
                      <span className="text-xs text-gray-500">(자동 배정)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 w-20">코트</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((num) => (
                        <button
                          key={`pair-court-${num}`}
                          type="button"
                          onClick={() => setNumberOfCourts(num)}
                          className={`h-8 w-8 rounded text-sm font-semibold transition-colors ${
                            numberOfCourts === num ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 w-20">시작시간</span>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-700 bg-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 w-20">간격</span>
                    <select
                      value={timeInterval}
                      onChange={(e) => setTimeInterval(Number(e.target.value))}
                      className="rounded border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-700 bg-white h-[32px]"
                    >
                      {[5, 10, 15, 20, 25, 30].map((min) => (
                        <option key={min} value={min}>
                          {min}분
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 border-t border-blue-200 pt-3 text-xs text-blue-800">
                  게임명 예시: <strong>{(() => {
                    const dateParts = (tournamentDate || '').split('-');
                    const mmdd = dateParts.length === 3 ? `${dateParts[1]}-${dateParts[2]}` : (tournamentDate || '(미설정)');
                    const allGNames = pairGroupSettings.map(x => x.groupName);
                    const groupsLabel = pairGroupSettings.map(g => convertedGroupNameOnly(g.groupName, allGNames)).join(', ');
                    const formatLabel = pairGroupSettings.map(g => {
                      const fmt = getPairFormatTitleLabel ? getPairFormatTitleLabel(g.format) : getPairFormatLabel(g.format);
                      if (g.format === 'round_robin' && g.roundRobinRepeats > 1) {
                        return `${fmt} ${g.roundRobinRepeats}회`;
                      }
                      return fmt;
                    }).join(', ');
                    return `${mmdd} ${roundNumber}회차 ${groupsLabel} - 페어 - ${formatLabel}`;
                  })()}</strong>
                </div>
              </div>

              {/* 게임 생성 버튼 모음 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-700">게임 생성 일괄/개별 처리</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleRegenerateMatches}
                    className="py-2 rounded-lg font-semibold transition-colors bg-purple-600 hover:bg-purple-700 text-white text-sm shadow-sm flex items-center justify-center gap-1.5 text-center"
                  >
                    대진표 다시 생성
                  </button>
                  <button
                    type="button"
                    onClick={() => void createTournament()}
                    disabled={generatedMatches.length === 0}
                    className="py-2 rounded-lg font-semibold transition-colors bg-amber-600 hover:bg-amber-700 text-white text-sm shadow-sm flex items-center justify-center gap-1.5 disabled:bg-amber-200 disabled:cursor-not-allowed text-center"
                  >
                    전체 게임 생성
                  </button>
                  {pairGroupSettings.map((group) => (
                    <button
                      key={`btn-gen-${group.groupName}`}
                      type="button"
                      onClick={() => void createTournament(group.groupName)}
                      disabled={!generatedMatches.some((match) => extractGroupLabelFromCourt(match.court) === group.groupName)}
                      className="py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-800 border border-amber-200 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-center"
                    >
                      {convertedGroupNameOnly(group.groupName, pairGroupSettings.map((g) => g.groupName))} 생성
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 우측 미리보기 영역 */}
            <div className="space-y-4 lg:col-span-7">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                토너먼트와 리그후 토너먼트는 본선의 빈 다음 라운드 경기까지 미리 생성합니다. 빈 슬롯은 선수명 대신 4강 진출팀·결승 진출팀으로 표시되며, 결과 저장 시 실제 승자 선수명으로 자동 배정됩니다.
                <div className="mt-2 rounded border border-yellow-300 bg-yellow-100 px-2 py-1.5 font-semibold text-yellow-900">
                  부전승은 팀 점수가 가장 낮은 팀을 추천합니다.
                </div>
              </div>
              {pairGroupSettings.map((group) => {
              const groupMatches = generatedMatches.filter(
                (match) => extractGroupLabelFromCourt(match.court) === group.groupName
              );
              const times = groupMatches
                .map((m) => m.scheduled_time)
                .filter(Boolean)
                .map((t) => new Date(t as string).getTime());

              let timeRangeText = '';
              if (times.length > 0) {
                const minTime = new Date(Math.min(...times));
                const maxTime = new Date(Math.max(...times));
                const gameInterval = timeInterval || 10;
                const endTime = new Date(maxTime.getTime() + gameInterval * 60 * 1000);

                const formatTimeOnly = (d: Date) => {
                  let hr = d.getHours();
                  const mn = String(d.getMinutes()).padStart(2, '0');
                  const ampm = hr >= 12 ? '오후' : '오전';
                  if (hr > 12) hr -= 12;
                  if (hr === 0) hr = 12;
                  const hrStr = String(hr).padStart(2, '0');
                  return `${ampm} ${hrStr}:${mn}`;
                };

                timeRangeText = `${formatTimeOnly(minTime)} ~ ${formatTimeOnly(endTime)}`;
              }

              return (
                <div key={group.groupName} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{convertedGroupNameOnly(group.groupName, pairGroupSettings.map((g) => g.groupName))}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>{group.pairNames.length}개 페어</span>
                        {timeRangeText && (
                          <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-blue-100">
                            ⏱️ {timeRangeText}
                          </span>
                        )}
                      </div>
                    </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['round_robin', '풀리그'],
                      ['knockout', '토너먼트'],
                      ['round_robin_knockout', '리그후 토너먼트'],
                      ['knockout_round_robin', '토너먼트후 풀리그'],
                    ] as Array<[PairTournamentFormat, string]>).map(([format, label]) => (
                      <button
                        key={`${group.groupName}-${format}`}
                        type="button"
                        onClick={() =>
                          updatePairGroupSetting(group.groupName, (current) => ({
                            ...current,
                            format,
                          }))
                        }
                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:text-sm ${
                          group.format === format
                            ? 'bg-indigo-600 text-white'
                            : 'border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleRegenerateGroupMatches(group.groupName)}
                      className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 transition-colors hover:bg-violet-100 sm:text-sm"
                    >
                      🔄 그룹 재배정
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {group.format === 'round_robin' || group.format === 'round_robin_knockout' ? (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">풀리그 반복 횟수</label>
                      <div className="flex gap-2">
                        {[1, 2, 3].map((repeat) => (
                          <button
                            key={`${group.groupName}-repeat-${repeat}`}
                            type="button"
                            onClick={() =>
                              updatePairGroupSetting(group.groupName, (current) => ({
                                ...current,
                                roundRobinRepeats: repeat,
                              }))
                            }
                            className={`h-9 w-9 rounded text-sm font-semibold ${
                              group.roundRobinRepeats === repeat
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                            }`}
                          >
                            {repeat}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {group.format === 'knockout_round_robin' && group.pairNames.length > 2 && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">부전승 포함 풀리그 결과</label>
                      <div className="flex flex-wrap gap-2">
                        {([
                          ['league_ranking', '순위 확정'],
                          ['league_final', '상위 2팀 결승'],
                        ] as Array<[ByeProgressionMode, string]>).map(([mode, label]) => (
                          <button
                            key={`${group.groupName}-bye-mode-${mode}`}
                            type="button"
                            onClick={() => updatePairGroupSetting(group.groupName, (current) => ({ ...current, byeProgressionMode: mode }))}
                            className={`rounded px-3 py-2 text-sm font-semibold ${
                              group.byeProgressionMode === mode
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">부전승 팀과 예선 승자가 풀리그를 하고, 동률은 승수·득실차·다득점·승자승 순으로 처리합니다.</p>
                    </div>
                  )}
                  {group.format === 'round_robin_knockout' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">본선 진출 페어 수</label>
                      <div className="flex gap-2">
                        {[2, 4, 8]
                          .filter((value) => value <= group.pairNames.length)
                          .map((qualifiers) => (
                            <button
                              key={`${group.groupName}-qualifier-${qualifiers}`}
                              type="button"
                              onClick={() =>
                                updatePairGroupSetting(group.groupName, (current) => ({
                                  ...current,
                                  knockoutQualifiers: qualifiers,
                                }))
                              }
                              className={`rounded px-3 py-2 text-sm font-semibold ${
                                group.knockoutQualifiers === qualifiers
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                              }`}
                            >
                              {qualifiers}강
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {(() => {
                  const groupMatches = generatedMatches.filter(
                    (match) => extractGroupLabelFromCourt(match.court) === group.groupName
                  );
                  if (groupMatches.length === 0) return null;
                  const scoreDifferenceCounts = groupMatches.reduce<Record<number, number>>((counts, match) => {
                    if (match.team1.length === 0 || match.team2.length === 0) return counts;

                    const team1Score = (match.team1_levels || []).reduce((sum, score) => sum + score, 0);
                    const team2Score = (match.team2_levels || []).reduce((sum, score) => sum + score, 0);
                    const difference = Math.abs(team1Score - team2Score);
                    counts[difference] = (counts[difference] || 0) + 1;
                    return counts;
                  }, {});
                  const scoreDifferenceEntries = Object.entries(scoreDifferenceCounts)
                    .map(([difference, count]) => ({ difference: Number(difference), count }))
                    .sort((left, right) => left.difference - right.difference);

                  return (
                    <div className="mt-6 border-t border-slate-200 pt-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-3">
                          <h4 className="text-sm font-bold text-slate-800">
                            {group.format === 'knockout' || group.format === 'round_robin_knockout'
                              ? `생성될 대진 슬롯 (${groupMatches.length}개 · 실제 경기 최대 ${Math.max(0, group.pairNames.length - 1)}경기)`
                              : `생성될 경기 (${groupMatches.length}경기)`}
                          </h4>
                          <div className="flex rounded-lg bg-gray-100 p-0.5">
                            <button
                              type="button"
                              onClick={() => setViewType('card')}
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                viewType === 'card'
                                  ? 'bg-white text-slate-800 shadow-sm'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              🎴 카드
                            </button>
                            <button
                              type="button"
                              onClick={() => setViewType('table')}
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                viewType === 'table'
                                  ? 'bg-white text-slate-800 shadow-sm'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              📋 테이블
                            </button>
                          </div>
                        </div>
                        {(() => {
                          const pairCounts: Record<string, number> = {};
                          groupMatches.forEach((match) => {
                            if (match.team1.length > 0) {
                              const p1 = match.team1.map(getPlayerName).join('/');
                              pairCounts[p1] = (pairCounts[p1] || 0) + 1;
                            }
                            if (match.team2.length > 0) {
                              const p2 = match.team2.map(getPlayerName).join('/');
                              pairCounts[p2] = (pairCounts[p2] || 0) + 1;
                            }
                          });
                          return (
                            <div className="flex flex-wrap gap-1 text-[10px] text-slate-600 bg-slate-100 p-1.5 rounded-lg max-h-24 overflow-y-auto">
                              <span className="font-semibold mr-1">팀당 경기수:</span>
                              {Object.entries(pairCounts).map(([pairName, count]) => (
                                <span key={pairName} className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-700">
                                  {getPairDisplayLabel(pairName, group.groupName, pairGroupSettings.map((g) => g.groupName))} ({count}게임)
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {scoreDifferenceEntries.length > 0 && (
                        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-2 text-[11px] text-indigo-900">
                          <span className="mr-1 font-semibold">점수차 분포:</span>
                          {scoreDifferenceEntries.map(({ difference, count }) => (
                            <span key={`${group.groupName}-difference-${difference}`} className="rounded bg-white px-1.5 py-0.5 font-semibold text-indigo-700 shadow-sm">
                              {difference}점 {count}경기
                            </span>
                          ))}
                        </div>
                      )}

                      {viewType === 'card' ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                          {groupMatches.map((match) => {
                            const team1Score = (match.team1_levels || []).reduce((sum, score) => sum + score, 0);
                            const team2Score = (match.team2_levels || []).reduce((sum, score) => sum + score, 0);
                            const bracketMatches = groupMatches.filter((item) => isKnockoutBracketMatch(item, groupMatches, group.format));
                            const stageLabel = isKnockoutBracketMatch(match, groupMatches, group.format)
                              ? getKnockoutStageLabel(match, bracketMatches)
                              : '';
                            return (
                              <div key={`pair-match-${group.groupName}-${match.match_number}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center shadow-sm">
                                <div className="mb-1 text-[10px] font-bold text-blue-900 border-b border-slate-200 pb-1 flex justify-between items-center px-1">
                                  <span>{stageLabel || formatCourtNameOnly(match.court)}</span>
                                  {match.scheduled_time && (
                                    <span className="text-emerald-700 bg-emerald-50 px-1 rounded text-[8px] font-medium">
                                      {formatScheduledTime(match.scheduled_time)}
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 mt-1.5">
                                  {/* 팀 1 (파트너 세로 표시) */}
                                  <div className="rounded bg-white p-1 border border-slate-100 shadow-sm min-w-0 flex flex-col justify-center items-center gap-0.5 w-full">
                                    <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPairSlotLabel(match.team1, match.team2, 0, stageLabel)}>
                                      {getPairSlotLabel(match.team1, match.team2, 0, stageLabel)}
                                    </div>
                                    {match.team1[1] && (
                                      <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPlayerName(match.team1[1])}>
                                        {getPlayerName(match.team1[1])}
                                      </div>
                                    )}
                                    <div className="text-[9px] text-slate-400 border-t border-slate-50 mt-0.5 pt-0.5 w-full text-center">
                                      {team1Score.toFixed(0)}
                                    </div>
                                  </div>
                                  
                                  <div className="text-[9px] font-bold text-slate-400 px-0.5">VS</div>
                                  
                                  {/* 팀 2 (파트너 세로 표시) */}
                                  <div className="rounded bg-white p-1 border border-slate-100 shadow-sm min-w-0 flex flex-col justify-center items-center gap-0.5 w-full">
                                    <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPairSlotLabel(match.team2, match.team1, 0, stageLabel)}>
                                      {getPairSlotLabel(match.team2, match.team1, 0, stageLabel)}
                                    </div>
                                    {match.team2[1] && (
                                      <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPlayerName(match.team2[1])}>
                                        {getPlayerName(match.team2[1])}
                                      </div>
                                    )}
                                    <div className="text-[9px] text-slate-400 border-t border-slate-50 mt-0.5 pt-0.5 w-full text-center">
                                      {team2Score.toFixed(0)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse border border-gray-300 bg-white text-xs">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">경기</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">라운드</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">코트</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">팀1 (파트너)</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">팀1 점수</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">팀2 (파트너)</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">팀2 점수</th>
                                <th className="border border-gray-300 px-2 py-1.5 text-center font-semibold">점수차</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupMatches.map((match) => {
                                const team1Score = (match.team1_levels || []).reduce((sum, score) => sum + score, 0);
                                const team2Score = (match.team2_levels || []).reduce((sum, score) => sum + score, 0);
                                const scoreDifference = Math.abs(team1Score - team2Score);
                                const bracketMatches = groupMatches.filter((item) => isKnockoutBracketMatch(item, groupMatches, group.format));
                                const stageLabel = isKnockoutBracketMatch(match, groupMatches, group.format)
                                  ? getKnockoutStageLabel(match, bracketMatches)
                                  : '';
                                const differenceColor = 
                                  scoreDifference === 0 ? 'bg-green-100 text-green-800' :
                                  scoreDifference <= 1 ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-orange-100 text-orange-800';

                                return (
                                  <tr key={`pair-match-table-${group.groupName}-${match.match_number}`} className="hover:bg-blue-50">
                                    <td className="border border-gray-300 px-2 py-1.5 text-center font-medium">{match.match_number}</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center font-semibold text-indigo-700">{stageLabel || `${match.round}라운드`}</td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center">
                                      <div className="font-semibold">{formatCourtNameOnly(match.court)}</div>
                                      {match.scheduled_time && (
                                        <div className="text-[9px] text-emerald-600 font-bold mt-0.5">
                                          {formatScheduledTime(match.scheduled_time)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-left font-medium text-blue-700">
                                      {getPairTeamLabel(match.team1, match.team2, stageLabel)}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center">
                                      <span className="inline-block px-1.5 py-0.5 bg-blue-100 rounded font-semibold text-blue-800">{match.team1.length > 0 ? team1Score : '-'}</span>
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-left font-medium text-purple-700">
                                      {getPairTeamLabel(match.team2, match.team1, stageLabel)}
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center">
                                      <span className="inline-block px-1.5 py-0.5 bg-red-100 rounded font-semibold text-red-800">{match.team2.length > 0 ? team2Score : '-'}</span>
                                    </td>
                                    <td className="border border-gray-300 px-2 py-1.5 text-center">
                                      {match.team1.length > 0 && match.team2.length > 0 ? (
                                        <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${differenceColor}`}>
                                          {scoreDifference}점
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">대기</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-white p-4 shadow-md sm:p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 sm:text-xl">생성된 페어 게임</h2>
        {tournaments.length === 0 ? (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center text-yellow-900">
            아직 생성된 페어 게임이 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tournaments.map((tournament) => {
              const { main, sub } = formatTournamentTitle(tournament.title);
              return (
                <div key={tournament.id} className="flex flex-col justify-between h-full rounded-xl border border-gray-200 p-4 shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-base font-bold text-gray-900 leading-tight">
                      <div className="text-sm font-normal text-gray-500">{main}</div>
                      {sub && <div className="mt-1 text-base font-bold text-gray-900">{sub}</div>}
                    </h3>
                    <div className="mt-2 space-y-1 text-sm text-gray-600 border-t border-gray-100 pt-2">
                      <div>{formatDateDot(tournament.tournament_date)}</div>
                      <div>{tournament.round_number}회차</div>
                      <div>{matchCounts[tournament.id] || 0}경기</div>
                      <div className="text-xs font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded inline-block mt-1">
                        페어전
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => openTournamentAssignmentModal(tournament)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                    >
                      배정현황
                    </button>
                    <button
                      type="button"
                      onClick={() => handleManageMatches(tournament)}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                    >
                      경기 관리
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTournament(tournament.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {teamParticipantsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{teamParticipantsModal.title}</h3>
                {teamParticipantsModal.subtitle && (
                  <p className="mt-1 text-sm text-gray-500">{teamParticipantsModal.subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTeamParticipantsModal(null)}
                className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                닫기
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              {teamParticipantsModal.teams.map((team) => (
                <div key={team.name} className="rounded-lg border border-gray-200 p-4">
                  <h4 className="mb-3 text-base font-semibold text-gray-900">{team.name}</h4>
                  <div className="space-y-2">
                    {team.players.map((player) => (
                      <div key={`${team.name}-${player}`} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tournamentMatchesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl p-6">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white pb-4 mb-4 z-10">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{tournamentMatchesModal.title}</h3>
                {tournamentMatchesModal.subtitle && (
                  <p className="mt-1 text-sm text-gray-500">{tournamentMatchesModal.subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTournamentMatchesModal(null)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                닫기
              </button>
            </div>
            
            {tournamentMatchesModal.matches.length === 0 ? (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-5 text-center text-sm text-yellow-800">
                등록된 대진표가 없습니다.
              </div>
            ) : (
              <div className="space-y-6">
                {(() => {
                  const grouped = new Map<string, Match[]>();
                  tournamentMatchesModal.matches.forEach((match) => {
                    const courtStr = match.court || '';
                    const matchLabel = courtStr.trim().match(/^\[(.+?)\]\s*(?:Court\s*)?(.+)$/i);
                    const groupName = matchLabel?.[1]?.trim() || '일반';
                    const current = grouped.get(groupName) || [];
                    current.push(match);
                    grouped.set(groupName, current);
                  });
                  return Array.from(grouped.entries()).map(([groupName, groupedMatches]) => (
                    <div key={groupName} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <h4 className="text-base font-semibold text-slate-900">{groupName} ({groupedMatches.length}경기)</h4>
                        {(() => {
                          const pairCounts: Record<string, number> = {};
                          groupedMatches.forEach((match) => {
                            if (match.team1.length > 0) {
                              const p1 = match.team1.map(getPlayerName).join('/');
                              pairCounts[p1] = (pairCounts[p1] || 0) + 1;
                            }
                            if (match.team2.length > 0) {
                              const p2 = match.team2.map(getPlayerName).join('/');
                              pairCounts[p2] = (pairCounts[p2] || 0) + 1;
                            }
                          });
                          return (
                            <div className="flex flex-wrap gap-1 text-[10px] text-slate-600 bg-slate-100 p-1.5 rounded-lg max-h-24 overflow-y-auto">
                              <span className="font-semibold mr-1">팀당 경기수:</span>
                              {Object.entries(pairCounts).map(([pairName, count]) => (
                                <span key={pairName} className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-700">
                                  {getPairDisplayLabel(pairName, groupName, pairGroupSettings.map((g) => g.groupName))} ({count}게임)
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                        {groupedMatches.map((match) => {
                          const team1Score = (match.team1_levels || []).reduce((sum, score) => sum + score, 0);
                          const team2Score = (match.team2_levels || []).reduce((sum, score) => sum + score, 0);
                          const hasResult = match.score_team1 != null && match.score_team2 != null;

                          return (
                            <div key={match.id || `match-${match.match_number}`} className="rounded-lg border border-slate-200 bg-white p-2 text-center shadow-sm">
                              <div className="mb-1 text-[10px] font-bold text-blue-900 border-b border-slate-200 pb-1">
                                {formatCourtNameOnly(match.court)}
                              </div>
                              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 mt-1.5">
                                {/* 팀 1 (파트너 세로 표시) */}
                                <div className="rounded bg-white p-1 border border-slate-100 shadow-sm min-w-0 flex flex-col justify-center items-center gap-0.5">
                                  <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPairSlotLabel(match.team1, match.team2, 0)}>
                                    {getPairSlotLabel(match.team1, match.team2, 0)}
                                  </div>
                                  {match.team1[1] && (
                                    <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPlayerName(match.team1[1])}>
                                      {getPlayerName(match.team1[1])}
                                    </div>
                                  )}
                                  <div className="text-[9px] text-slate-400 border-t border-slate-50 mt-0.5 pt-0.5 w-full text-center">
                                    {team1Score.toFixed(0)}
                                  </div>
                                </div>
                                
                                <div className="text-[9px] font-bold text-slate-400 px-0.5 flex flex-col items-center justify-center shrink-0">
                                  {hasResult ? (
                                    <div className="flex flex-col items-center">
                                      <span className={`text-[10px] font-bold ${match.winner === 'team1' ? 'text-amber-700' : 'text-gray-500'}`}>{match.score_team1}</span>
                                      <span className="text-[8px] font-bold text-gray-400">:</span>
                                      <span className={`text-[10px] font-bold ${match.winner === 'team2' ? 'text-amber-700' : 'text-gray-500'}`}>{match.score_team2}</span>
                                    </div>
                                  ) : (
                                    <span>VS</span>
                                  )}
                                </div>
                                
                                {/* 팀 2 (파트너 세로 표시) */}
                                <div className="rounded bg-white p-1 border border-slate-100 shadow-sm min-w-0 flex flex-col justify-center items-center gap-0.5">
                                  <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPairSlotLabel(match.team2, match.team1, 0)}>
                                    {getPairSlotLabel(match.team2, match.team1, 0)}
                                  </div>
                                  {match.team2[1] && (
                                    <div className="text-[11px] font-semibold text-slate-900 truncate w-full" title={getPlayerName(match.team2[1])}>
                                      {getPlayerName(match.team2[1])}
                                    </div>
                                  )}
                                  <div className="text-[9px] text-slate-400 border-t border-slate-50 mt-0.5 pt-0.5 w-full text-center">
                                    {team2Score.toFixed(0)}
                                  </div>
                                </div>
                              </div>
                              
                              {hasResult && match.winner && (
                                <div className="mt-1 text-[8px] text-emerald-600 font-semibold">
                                  종료 ({match.winner === 'team1' ? '팀1' : match.winner === 'team2' ? '팀2' : '무승부'})
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PairTournamentSettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[400px] items-center justify-center bg-gray-50 rounded-xl border border-gray-100 p-8 shadow-sm">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 text-sm font-medium">설정 페이지를 불러오는 중입니다...</p>
        </div>
      </div>
    }>
      <PairTournamentSettingsContent />
    </Suspense>
  );
}
