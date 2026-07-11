'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trophy } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import { fetchLevelInfoMap, getLevelScoreFromCode, type LevelInfoMap } from '@/lib/level-info';
import { formatKSTDate } from '@/lib/date';

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

type PairTournamentFormat = 'round_robin' | 'knockout' | 'round_robin_knockout';

type PairGroupSetting = {
  groupName: string;
  pairNames: string[];
  format: PairTournamentFormat;
  roundRobinRepeats: number;
  knockoutQualifiers: number;
};

const isValidTeamType = (value: string): value is TeamAssignment['team_type'] => {
  return value === '2teams' || value === '3teams' || value === '4teams' || value === 'pairs';
};

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
    team_type: isValidTeamType(assignment.team_type) ? assignment.team_type : '2teams',
    racket_team: toStringArray(assignment.racket_team),
    shuttle_team: toStringArray(assignment.shuttle_team),
    team1: toStringArray(assignment.team1),
    team2: toStringArray(assignment.team2),
    team3: toStringArray(assignment.team3),
    team4: toStringArray(assignment.team4),
    pairs_data: parsedPairs.pairsData,
    pair_groups: parsedPairs.pairGroups,
  };
};

interface Match {
  id?: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[];
  team2: string[];
  team1_levels?: number[];  // 각 선수의 레벨
  team2_levels?: number[];  // 각 선수의 레벨
  court: string;
  scheduled_time?: string;
  status: 'pending' | 'in_progress' | 'completed';
  score_team1?: number;
  score_team2?: number;
  winner?: 'team1' | 'team2' | 'draw';
  next_match_number?: number;
  next_match_slot?: 1 | 2;
  is_bracket_slot?: boolean;
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
  matches?: Match[];
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

type PlayerGenderMap = Record<string, string>;
type GenerationNotice = {
  type: 'success' | 'error';
  text: string;
} | null;

type TeamLockedPlayer = {
  name: string;
  score: number;
  gender: string;
};

type TeamLockedPair = {
  sourceTeam: string;
  players: [TeamLockedPlayer, TeamLockedPlayer];
  totalScore: number;
};

export default function TournamentMatchesPage() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<string | null>(null);
  const [isManualEditing, setIsManualEditing] = useState(false);

  // level_info.score 기준으로 레벨 점수 조회
  const getLevelScore = (levelStr: string | undefined): number => {
    return getLevelScoreFromCode(levelInfoMap, levelStr, 0);
  };

  // 선수 이름에서 레벨 추출 (예: "김민정(E2)" → "e2")
  const extractLevelFromName = (nameWithLevel: string): string => {
    // 마지막 괄호에서 레벨 코드 추출
    const match = nameWithLevel.match(/\(([^)]+)\)(?!.*\()$/);
    if (match) {
      return match[1].toLowerCase().trim();
    }
    return 'e2'; // 기본값
  };

  // 선수 이름에서 레벨 제거 (예: "김민정(E2)" → "김민정")
  const getPlayerName = (nameWithLevel: string): string => {
    // 마지막 괄호 부분만 제거
    return nameWithLevel.replace(/\s*\([^)]*\)\s*$/, '').trim();
  };

  // 선수 문자열에 포함된 레벨 코드를 level_info.score에 매핑
  const getPlayerScore = (playerName: string): number => {
    return getLevelScore(extractLevelFromName(playerName));
  };

  const getPlayerTeamName = (playerName: string): string => {
    if (!selectedAssignment) return '';
    const cleanName = getPlayerName(playerName);
    
    if (selectedAssignment.team_type === '2teams') {
      const isRacket = selectedAssignment.racket_team?.some(p => getPlayerName(p) === cleanName);
      if (isRacket) return '라켓팀';
      const isShuttle = selectedAssignment.shuttle_team?.some(p => getPlayerName(p) === cleanName);
      if (isShuttle) return '셔틀팀';
    } else if (selectedAssignment.team_type === '3teams') {
      if (selectedAssignment.team1?.some(p => getPlayerName(p) === cleanName)) return '1팀';
      if (selectedAssignment.team2?.some(p => getPlayerName(p) === cleanName)) return '2팀';
      if (selectedAssignment.team3?.some(p => getPlayerName(p) === cleanName)) return '3팀';
    } else if (selectedAssignment.team_type === '4teams') {
      if (selectedAssignment.team1?.some(p => getPlayerName(p) === cleanName)) return '1팀';
      if (selectedAssignment.team2?.some(p => getPlayerName(p) === cleanName)) return '2팀';
      if (selectedAssignment.team3?.some(p => getPlayerName(p) === cleanName)) return '3팀';
      if (selectedAssignment.team4?.some(p => getPlayerName(p) === cleanName)) return '4팀';
    }
    
    return '';
  };

  const renderTeamBadge = (playerName: string) => {
    const teamName = getPlayerTeamName(playerName);
    if (!teamName) return null;
    const shortName = teamName.replace('팀', '');
    const colorClass = teamName === '라켓팀' 
      ? 'bg-blue-100 text-blue-800' 
      : teamName === '셔틀팀' 
      ? 'bg-red-100 text-red-800' 
      : 'bg-slate-100 text-slate-800';
    return (
      <span className={`ml-1 inline-flex items-center rounded px-1 py-0.2 text-[8px] font-bold ${colorClass}`}>
        {shortName}
      </span>
    );
  };

  const getPlayerTeamNameForAssignment = (playerName: string, assignment: TeamAssignment | null | undefined): string => {
    if (!assignment) return '';
    const cleanName = getPlayerName(playerName);
    
    if (assignment.team_type === '2teams') {
      const isRacket = assignment.racket_team?.some(p => getPlayerName(p) === cleanName);
      if (isRacket) return '라켓팀';
      const isShuttle = assignment.shuttle_team?.some(p => getPlayerName(p) === cleanName);
      if (isShuttle) return '셔틀팀';
    } else if (assignment.team_type === '3teams') {
      if (assignment.team1?.some(p => getPlayerName(p) === cleanName)) return '1팀';
      if (assignment.team2?.some(p => getPlayerName(p) === cleanName)) return '2팀';
      if (assignment.team3?.some(p => getPlayerName(p) === cleanName)) return '3팀';
    } else if (assignment.team_type === '4teams') {
      if (assignment.team1?.some(p => getPlayerName(p) === cleanName)) return '1팀';
      if (assignment.team2?.some(p => getPlayerName(p) === cleanName)) return '2팀';
      if (assignment.team3?.some(p => getPlayerName(p) === cleanName)) return '3팀';
      if (assignment.team4?.some(p => getPlayerName(p) === cleanName)) return '4팀';
    }
    
    return '';
  };

  const renderTeamBadgeForAssignment = (playerName: string, assignment: TeamAssignment | null | undefined) => {
    const teamName = getPlayerTeamNameForAssignment(playerName, assignment);
    if (!teamName) return null;
    const shortName = teamName.replace('팀', '');
    const colorClass = teamName === '라켓팀' 
      ? 'bg-blue-100 text-blue-800' 
      : teamName === '셔틀팀' 
      ? 'bg-red-100 text-red-800' 
      : 'bg-slate-100 text-slate-800';
    return (
      <span className={`ml-1 inline-flex items-center rounded px-1 py-0.2 text-[8px] font-bold ${colorClass}`}>
        {shortName}
      </span>
    );
  };

  const normalizePlayerLookupKey = (value: string | undefined | null): string =>
    String(value || '').trim();

  const normalizeGender = (value?: string | null): string =>
    String(value || '').trim().toUpperCase();

  const getPlayerGender = (playerName: string): string => {
    const normalizedName = normalizePlayerLookupKey(getPlayerName(playerName));
    return playerGenderMap[normalizedName] || '';
  };

  const getPlayerGenderLabel = (playerName: string): string => {
    const normalized = normalizeGender(getPlayerGender(playerName));

    if (['M', 'MALE', 'MAN', '남', '남성'].includes(normalized)) {
      return '남';
    }

    if (['F', 'FEMALE', 'WOMAN', 'W', '여', '여성'].includes(normalized)) {
      return '여';
    }

    return '미지정';
  };

  const getUniquePlayersFromAssignment = (assignment: TeamAssignment | null): string[] => {
    if (!assignment) {
      return [];
    }

    return [...new Set(getTeamsFromAssignment(assignment).flatMap((team) => team.players))]
      .filter(Boolean)
      .sort((left, right) => {
        const scoreDiff = getPlayerScore(right) - getPlayerScore(left);
        if (Math.abs(scoreDiff) > 0.0001) {
          return scoreDiff;
        }

        const nameDiff = getPlayerName(left).localeCompare(getPlayerName(right), 'ko', { sensitivity: 'base' });
        if (nameDiff !== 0) {
          return nameDiff;
        }

        return left.localeCompare(right, 'ko', { sensitivity: 'base' });
      });
  };

  const getManualPlayerOptions = (match: Match, currentPlayer?: string) => {
    const selectedPlayers = new Set([...match.team1, ...match.team2].filter(Boolean));
    if (currentPlayer) {
      selectedPlayers.delete(currentPlayer);
    }

    return getUniquePlayersFromAssignment(selectedAssignment).filter(
      (player) => !selectedPlayers.has(player) || player === currentPlayer
    );
  };

  const getGeneratedPlayerGameCounts = (matches: Match[]) => {
    const counts: Record<string, number> = {};

    matches.forEach((match) => {
      [...match.team1, ...match.team2].forEach((player) => {
        const normalizedPlayerName = getPlayerName(player);
        counts[normalizedPlayerName] = (counts[normalizedPlayerName] || 0) + 1;
      });
    });

    return counts;
  };

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

  const buildTeamLockedPairsForRound = (
    teams: { name: string; players: string[] }[],
    playerPool: Map<string, TeamLockedPlayer>,
    playerMatchCount: Record<string, number>,
    pairMatchCount: Record<string, number>,
    mode: 'level_based' | 'random' | 'mixed_doubles'
  ): TeamLockedPair[] => {
    const roundPairs: TeamLockedPair[] = [];

    teams.forEach((team) => {
      const uniqueTeamPlayers = [...new Set(team.players)]
        .map((name) => playerPool.get(name))
        .filter((player): player is TeamLockedPlayer => Boolean(player));

      if (uniqueTeamPlayers.length < 2) {
        return;
      }

      const sortedPlayers = [...uniqueTeamPlayers].sort((left, right) => {
        const matchDiff = (playerMatchCount[left.name] || 0) - (playerMatchCount[right.name] || 0);
        if (matchDiff !== 0) {
          return matchDiff;
        }

        if (mode === 'random') {
          return Math.random() < 0.5 ? -1 : 1;
        }

        const scoreDiff = right.score - left.score;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        // Same score: add random tiebreaker for varied regeneration
        return Math.random() < 0.5 ? -1 : 1;
      });

      const available = [...sortedPlayers];

      const takePreferredPartnerIndex = (anchor: TeamLockedPlayer, pool: TeamLockedPlayer[]) => {
        if (pool.length === 0) {
          return -1;
        }

        if (mode === 'mixed_doubles') {
          const anchorGender = normalizeGender(anchor.gender);
          // Collect all opposite-gender candidates and pick randomly for varied regeneration
          const mixedCandidates: number[] = [];
          pool.forEach((candidate, idx) => {
            const candidateGender = normalizeGender(candidate.gender);
            if (anchorGender && candidateGender && anchorGender !== candidateGender) {
              mixedCandidates.push(idx);
            }
          });

          if (mixedCandidates.length > 0) {
            return mixedCandidates[Math.floor(Math.random() * mixedCandidates.length)];
          }
        }

        let bestIndex = 0;
        let bestValue = Number.POSITIVE_INFINITY;

        // Collect candidates with their values, then pick randomly among equally-good options
        const candidateValues: { index: number; value: number }[] = [];
        pool.forEach((candidate, index) => {
          const nextPairScore = anchor.score + candidate.score;
          const pairKey = [anchor.name, candidate.name].sort((a, b) => a.localeCompare(b, 'ko')).join('::');
          const pairUsed = pairMatchCount[pairKey] || 0;
          const scoreGap = mode === 'level_based'
            ? Math.abs(anchor.score - candidate.score)
            : Math.abs(nextPairScore - anchor.score);
          const value = pairUsed * 1000 + scoreGap;
          candidateValues.push({ index, value });
        });

        // Find the minimum value
        const minValue = Math.min(...candidateValues.map(c => c.value));
        // Collect all candidates with the minimum value
        const bestCandidates = candidateValues.filter(c => c.value === minValue);
        // Pick randomly among the best candidates for varied regeneration
        bestIndex = bestCandidates[Math.floor(Math.random() * bestCandidates.length)].index;
        bestValue = minValue;

        return bestIndex;
      };

      while (available.length >= 2) {
        const anchor = mode === 'level_based' ? available.shift()! : available.pop()!;
        const partnerIndex = takePreferredPartnerIndex(anchor, available);

        if (partnerIndex < 0) {
          break;
        }

        const [partner] = available.splice(partnerIndex, 1);

        roundPairs.push({
          sourceTeam: team.name,
          players: [anchor, partner],
          totalScore: anchor.score + partner.score,
        });
      }
    });

    return roundPairs;
  };

  const matchTeamLockedPairs = (
    pairs: TeamLockedPair[],
    numberOfCourts: number
  ) => {
    const matches: Array<{ left: TeamLockedPair; right: TeamLockedPair }> = [];
    const used = new Set<number>();

    const uniqueTeams = new Set(pairs.map(p => p.sourceTeam).filter(Boolean));
    const isMultiTeam = uniqueTeams.size > 1;

    const sortedPairs = [...pairs].sort((left, right) => right.totalScore - left.totalScore);

    for (let index = 0; index < sortedPairs.length; index += 1) {
      if (used.has(index)) {
        continue;
      }

      const current = sortedPairs[index];
      let bestOpponentIndex = -1;
      let bestDiff = Number.POSITIVE_INFINITY;

      // Collect all valid opponents, then pick randomly among equally-good ones
      const opponentOptions: { opponentIndex: number; diff: number }[] = [];
      for (let opponentIndex = index + 1; opponentIndex < sortedPairs.length; opponentIndex += 1) {
        if (used.has(opponentIndex)) {
          continue;
        }

        const opponent = sortedPairs[opponentIndex];
        if (isMultiTeam && opponent.sourceTeam === current.sourceTeam) {
          continue;
        }

        const diff = Math.abs(current.totalScore - opponent.totalScore);
        opponentOptions.push({ opponentIndex, diff });
      }

      if (opponentOptions.length > 0) {
        const minDiff = Math.min(...opponentOptions.map(o => o.diff));
        const bestOptions = opponentOptions.filter(o => o.diff === minDiff);
        const picked = bestOptions[Math.floor(Math.random() * bestOptions.length)];
        bestOpponentIndex = picked.opponentIndex;
        bestDiff = picked.diff;
      }

      if (bestOpponentIndex < 0) {
        continue;
      }

      used.add(index);
      used.add(bestOpponentIndex);
      matches.push({
        left: current,
        right: sortedPairs[bestOpponentIndex],
      });
    }

    return matches;
  };

  const handleManualPlayerChange = (
    matchIndex: number,
    teamKey: 'team1' | 'team2',
    playerIndex: number,
    nextPlayerName: string
  ) => {
    setGeneratedMatches((prev) =>
      prev.map((match, index) => {
        if (index !== matchIndex) {
          return match;
        }

        const nextTeam = [...match[teamKey]];
        nextTeam[playerIndex] = nextPlayerName;

        const nextMatch: Match = {
          ...match,
          [teamKey]: nextTeam,
        };

        nextMatch.team1_levels = nextMatch.team1.map((name) => getPlayerScore(name));
        nextMatch.team2_levels = nextMatch.team2.map((name) => getPlayerScore(name));

        return nextMatch;
      })
    );
  };

  // 경기 점수 차이 최소화를 위한 팀 재배치 함수 (모든 경기가 1점 이하가 될 때까지 반복)
  const optimizeMatchBalancing = (matches: Match[]): Match[] => {
    const MAX_ITERATIONS = 100000; // 최대 반복 횟수 (충분히 큼)
    let currentMatches = JSON.parse(JSON.stringify(matches));
    let bestMatches = JSON.parse(JSON.stringify(matches));
    let bestScore = calculateMaxScoreDifference(currentMatches);
    const initialScore = bestScore;

    console.log(`🔄 최적화 시작: 초기 최대 차이 = ${bestScore}점, 경기 수 = ${matches.length}개`);
    console.log(`🎯 목표: 모든 경기의 팀 점수 차이를 1점 이하로 만들기`);

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // 모든 경기의 팀 점수 차이 확인
      const matchDifferences = currentMatches.map((match: Match, idx: number) => {
        const team1Score = (match.team1_levels || []).reduce((sum: number, l: number) => sum + l, 0);
        const team2Score = (match.team2_levels || []).reduce((sum: number, l: number) => sum + l, 0);
        return { idx, diff: Math.abs(team1Score - team2Score) };
      });

      // 2점 이상 차이가 있는 경기들 찾기
      const badMatches = matchDifferences.filter((m: any) => m.diff >= 2);
      const onePointMatches = matchDifferences.filter((m: any) => m.diff === 1);

      // 목표 달성 확인: 모든 경기가 1점 이하
      if (badMatches.length === 0) {
        console.log(`✅ 목표 달성: 모든 경기의 팀 점수 차이가 1점 이하 (${iteration}회차 반복)`);
        break;
      }

      // 2점 이상 차이 경기 우선 처리
      if (badMatches.length > 0) {
        // 차이가 가장 큰 경기 선택 (100% 확률)
        const sortedBadMatches = badMatches.sort((a: any, b: any) => b.diff - a.diff);
        const targetMatch = sortedBadMatches[0];
        const matchToFix = currentMatches[targetMatch.idx];

        // 같은 경기 내에서 최적의 팀 조합 찾기
        const players = [...matchToFix.team1, ...matchToFix.team2];
        let bestCombination = null;
        let bestDiff = targetMatch.diff;

        // 모든 가능한 2대2 조합 시도
        for (let i = 0; i < players.length; i++) {
          for (let j = i + 1; j < players.length; j++) {
            const team1Candidates = [players[i], players[j]];
            const team2Candidates = players.filter((_, idx: number) => idx !== i && idx !== j);

            const team1Score = team1Candidates.reduce((sum: number, name: string) =>
              sum + getLevelScore(extractLevelFromName(name)), 0);
            const team2Score = team2Candidates.reduce((sum: number, name: string) =>
              sum + getLevelScore(extractLevelFromName(name)), 0);
            const diff = Math.abs(team1Score - team2Score);

            if (diff < bestDiff) {
              bestDiff = diff;
              bestCombination = { team1: team1Candidates, team2: team2Candidates };
            }
          }
        }

        // 최적 조합이 있으면 적용
        if (bestCombination && bestDiff < targetMatch.diff) {
          matchToFix.team1 = bestCombination.team1;
          matchToFix.team2 = bestCombination.team2;
          matchToFix.team1_levels = matchToFix.team1.map((name: string) =>
            getLevelScore(extractLevelFromName(name))
          );
          matchToFix.team2_levels = matchToFix.team2.map((name: string) =>
            getLevelScore(extractLevelFromName(name))
          );
        }
      }

      // 2점 이상 차이가 없을 때만 1점 차이 경기 개선 시도 (경기 간 교환)
      if (badMatches.length === 0 && onePointMatches.length > 0 && matchDifferences.length >= 2) {
        // 1점 차이 경기 중 2개 선택하여 선수 교환 시도
        const match1Idx = onePointMatches[Math.floor(Math.random() * onePointMatches.length)].idx;
        let match2Idx = onePointMatches[Math.floor(Math.random() * onePointMatches.length)].idx;

        while (match2Idx === match1Idx && onePointMatches.length > 1) {
          match2Idx = onePointMatches[Math.floor(Math.random() * onePointMatches.length)].idx;
        }

        if (match1Idx !== match2Idx) {
          const match1 = currentMatches[match1Idx];
          const match2 = currentMatches[match2Idx];

          // 각 경기에서 무작위로 한 명씩 선택하여 교환
          const team1Or2_m1 = Math.random() < 0.5 ? 'team1' : 'team2';
          const team1Or2_m2 = Math.random() < 0.5 ? 'team1' : 'team2';
          const playerIdx1 = Math.floor(Math.random() * 2);
          const playerIdx2 = Math.floor(Math.random() * 2);

          const player1 = match1[team1Or2_m1][playerIdx1];
          const player2 = match2[team1Or2_m2][playerIdx2];

          // 교환 수행
          match1[team1Or2_m1][playerIdx1] = player2;
          match1[team1Or2_m1 === 'team1' ? 'team1_levels' : 'team2_levels']![playerIdx1] =
            getLevelScore(extractLevelFromName(player2));

          match2[team1Or2_m2][playerIdx2] = player1;
          match2[team1Or2_m2 === 'team1' ? 'team1_levels' : 'team2_levels']![playerIdx2] =
            getLevelScore(extractLevelFromName(player1));
        }
      }

      // 현재 최고 점수차이 계산
      const currentMaxDiff = calculateMaxScoreDifference(currentMatches);

      // 더 나은 배치면 유지
      if (currentMaxDiff < bestScore) {
        bestScore = currentMaxDiff;
        bestMatches = JSON.parse(JSON.stringify(currentMatches));
      }

      // 진행 상황 로깅 (매 1000회차마다)
      if ((iteration + 1) % 1000 === 0) {
        console.log(`🔄 최적화 진행중: ${iteration + 1}/${MAX_ITERATIONS}, 현재 최대 차이 = ${bestScore}점`);
      }

      // 300회 이상 동안 개선이 없으면 현재 상태가 최고이므로 종료
      if (iteration > 300 && calculateMaxScoreDifference(currentMatches) === calculateMaxScoreDifference(bestMatches)) {
        const stagnationCheck = matchDifferences.every((m: any) => m.diff <= 1);
        if (stagnationCheck) {
          console.log(`✅ 모든 경기가 1점 이하로 유지됨 (${iteration}회차에서 종료)`);
          break;
        }
      }
    }

    // 최종 결과 로깅
    const finalMaxDiff = calculateMaxScoreDifference(bestMatches);
    const finalAvgDiff = calculateAverageScoreDifference(bestMatches);
    console.log(`📊 최적화 완료: 최대 차이 = ${finalMaxDiff}점, 평균 차이 = ${finalAvgDiff.toFixed(1)}점`);
    console.log(`📈 개선율: ${initialScore}점 → ${finalMaxDiff}점`);

    return bestMatches;
  };

  // 평균 팀 점수 차이 계산
  const calculateAverageScoreDifference = (matches: Match[]): number => {
    let totalDifference = 0;

    matches.forEach(match => {
      const team1Score = (match.team1_levels || []).reduce((sum: number, l: number) => sum + l, 0);
      const team2Score = (match.team2_levels || []).reduce((sum: number, l: number) => sum + l, 0);
      totalDifference += Math.abs(team1Score - team2Score);
    });

    return matches.length > 0 ? totalDifference / matches.length : 0;
  };

  // 최대 팀 점수 차이 계산 (가장 큰 차이)
  const calculateMaxScoreDifference = (matches: Match[]): number => {
    let maxDifference = 0;

    matches.forEach(match => {
      const team1Score = (match.team1_levels || []).reduce((sum: number, l: number) => sum + l, 0);
      const team2Score = (match.team2_levels || []).reduce((sum: number, l: number) => sum + l, 0);
      maxDifference = Math.max(maxDifference, Math.abs(team1Score - team2Score));
    });

    return maxDifference;
  };

  const avoidConsecutiveMatches = (
    matches: Match[],
    courtCount: number,
    baseDate: string,
    sTime: string,
    interval: number
  ): Match[] => {
    if (matches.length <= 1) return matches;
    const C = courtCount > 0 ? courtCount : 4;

    const remaining = [...matches];
    const scheduled: Match[] = [];
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
  };

  const formatScheduledTime = (timeStr: string | undefined | null) => {
    if (!timeStr) return '';
    try {
      const timePart = timeStr.split('T')[1] || '';
      const [h, m] = timePart.split(':');
      if (h && m) {
        return `${h}:${m}`;
      }
    } catch (e) {
      // fallback
    }
    return '';
  };

  const [loading, setLoading] = useState(true);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<TeamAssignment | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [generatedMatches, setGeneratedMatches] = useState<Match[]>([]);
  const [tournamentMatches, setTournamentMatches] = useState<Match[]>([]);
  const [matchesPerPlayer, setMatchesPerPlayer] = useState(1);
  const [startTime, setStartTime] = useState('17:30');
  const [timeInterval, setTimeInterval] = useState(10);
  const [viewType, setViewType] = useState<'card' | 'table'>('table');
  const [tournamentDate, setTournamentDate] = useState('');
  const [roundNumber, setRoundNumber] = useState(1);
  const [matchType, setMatchType] = useState<'level_based' | 'random' | 'mixed_doubles'>('random');
  const [numberOfCourts, setNumberOfCourts] = useState(4);
  const [pairGroupSettings, setPairGroupSettings] = useState<PairGroupSetting[]>([]);
  const [teamParticipantsModal, setTeamParticipantsModal] = useState<TeamParticipantsModalState>(null);
  const [tournamentMatchesModal, setTournamentMatchesModal] = useState<{
    title: string;
    subtitle?: string;
    teamType: string;
    matches: Match[];
    selectedTeamAssignment?: TeamAssignment | null;
  } | null>(null);
  const [levelInfoMap, setLevelInfoMap] = useState<LevelInfoMap>({});
  const [playerGenderMap, setPlayerGenderMap] = useState<PlayerGenderMap>({});
  const [generationNotice, setGenerationNotice] = useState<GenerationNotice>(null);
  const autoGenerationContextRef = useRef<{
    initialized: boolean;
    lastSignature: string;
    lastAssignmentId: string | null;
  }>({
    initialized: false,
    lastSignature: '',
    lastAssignmentId: null,
  });
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchTeamAssignments();
    fetchTournaments();
    fetchLevelMap();
    fetchPlayerGenderMap();

    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const showGenerationNotice = (type: 'success' | 'error', text: string) => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    setGenerationNotice({ type, text });
    noticeTimerRef.current = setTimeout(() => {
      setGenerationNotice(null);
      noticeTimerRef.current = null;
    }, 4000);
  };

  const formatSupabaseError = (error: any) => {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return [
      error.message,
      error.code ? `code=${error.code}` : null,
      error.details ? `details=${error.details}` : null,
      error.hint ? `hint=${error.hint}` : null,
    ].filter(Boolean).join(' | ') || JSON.stringify(error);
  };

  // DB에서 레벨 정보 조회
  const fetchLevelMap = async () => {
    try {
      const map = await fetchLevelInfoMap(supabase);
      setLevelInfoMap(map);
      console.log(
        '✅ 레벨 정보 로드 (level_info.score 기준):',
        Object.fromEntries(Object.entries(map).map(([code, meta]) => [code, meta.score]))
      );
    } catch (error) {
      console.error('❌ 레벨 정보 로드 중 오류:', formatSupabaseError(error));
      setLevelInfoMap({});
    }
  };

  const fetchPlayerGenderMap = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, full_name, gender');

      if (error) {
        throw error;
      }

      const nextMap: PlayerGenderMap = {};

      (data || []).forEach((profile: any) => {
        const candidates = [profile?.full_name, profile?.username]
          .map((value: unknown) => normalizePlayerLookupKey(String(value || '')))
          .filter(Boolean);

        candidates.forEach((candidate) => {
          if (!nextMap[candidate] && profile?.gender) {
            nextMap[candidate] = String(profile.gender);
          }
        });
      });

      setPlayerGenderMap(nextMap);
    } catch (error) {
      console.error('❌ 선수 성별 정보 로드 중 오류:', formatSupabaseError(error));
      setPlayerGenderMap({});
    }
  };

  // 팀 구성 데이터 가져오기
  const fetchTeamAssignments = async () => {
    try {
      setLoading(true);
      console.log('📋 팀 구성 데이터 로드 시작...');

      const response = await fetch('/api/admin/team-assignments', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || '팀 구성 조회에 실패했습니다.');
      }

      const payload = await response.json();
      const data = Array.isArray(payload?.teamAssignments) ? payload.teamAssignments : [];

      console.log('✅ 팀 구성 데이터 로드 완료:', data);
      console.log('📊 로드된 팀 구성 개수:', data?.length || 0);
      
      // 각 팀 구성의 상세 정보 출력
      data?.forEach((assignment: TeamAssignment, idx: number) => {
        const teams = getTeamsFromAssignment(assignment as TeamAssignment);
        console.log(`🏆 팀 구성 ${idx + 1}:`, {
          title: assignment.title,
          type: assignment.team_type,
          date: assignment.assignment_date,
          teams: teams.length,
          totalPlayers: teams.reduce((sum, t) => sum + t.players.length, 0)
        });
      });

      setTeamAssignments((data || []).map(normalizeTeamAssignment));
    } catch (error) {
      console.error('팀 구성 조회 중 오류:', error);
      setTeamAssignments([]);
    } finally {
      setLoading(false);
    }
  };

  // 대회 목록 가져오기
  const fetchTournaments = async () => {
    try {
      const response = await fetch('/api/admin/tournaments', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || '게임 조회에 실패했습니다.');
      }

      const payload = await response.json();
      setTournaments(Array.isArray(payload?.tournaments) ? payload.tournaments : []);
    } catch (error) {
      console.error('대회 조회 오류:', error);
      setTournaments([]);
    }
  };

  // 팀 목록 추출
  const getTeamsFromAssignment = (assignment: TeamAssignment): { name: string; players: string[] }[] => {
    const teams: { name: string; players: string[] }[] = [];

    if (assignment.team_type === '2teams') {
      if (assignment.racket_team && assignment.racket_team.length > 0) {
        teams.push({ name: '라켓팀', players: assignment.racket_team });
      }
      if (assignment.shuttle_team && assignment.shuttle_team.length > 0) {
        teams.push({ name: '셔틀팀', players: assignment.shuttle_team });
      }
    } else if (assignment.team_type === '3teams') {
      if (assignment.team1 && assignment.team1.length > 0) {
        teams.push({ name: '팀1', players: assignment.team1 });
      }
      if (assignment.team2 && assignment.team2.length > 0) {
        teams.push({ name: '팀2', players: assignment.team2 });
      }
      if (assignment.team3 && assignment.team3.length > 0) {
        teams.push({ name: '팀3', players: assignment.team3 });
      }
    } else if (assignment.team_type === '4teams') {
      if (assignment.team1 && assignment.team1.length > 0) {
        teams.push({ name: '팀1', players: assignment.team1 });
      }
      if (assignment.team2 && assignment.team2.length > 0) {
        teams.push({ name: '팀2', players: assignment.team2 });
      }
      if (assignment.team3 && assignment.team3.length > 0) {
        teams.push({ name: '팀3', players: assignment.team3 });
      }
      if (assignment.team4 && assignment.team4.length > 0) {
        teams.push({ name: '팀4', players: assignment.team4 });
      }
    } else if (assignment.team_type === 'pairs' && assignment.pairs_data) {
      Object.entries(assignment.pairs_data).forEach(([pairName, players]) => {
        if (players && players.length > 0) {
          teams.push({ name: pairName, players });
        }
      });
    }

    return teams;
  };

  const getTeamTypeLabel = (teamType: TeamAssignment['team_type'] | string) => (
    {
      '2teams': '2팀전',
      '3teams': '3팀전',
      '4teams': '4팀전',
      'pairs': '페어전',
    }[teamType] || teamType
  );

  const openAssignmentParticipantsModal = (assignment: TeamAssignment) => {
    const teams = getTeamsFromAssignment(assignment);
    setTeamParticipantsModal({
      title: `${assignment.title} 참가자`,
      subtitle: `${assignment.assignment_date} · ${getTeamTypeLabel(assignment.team_type)}`,
      teams,
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
        selectedTeamAssignment: data.selectedTeamAssignment ? normalizeTeamAssignment(data.selectedTeamAssignment) : null,
      });
    } catch (error) {
      console.error(error);
      alert('대진표 조회에 실패했습니다.');
    }
  };

  // 경기 일정 생성 (1인당 경기수 기반) - 4명씩 나누어 생성
  const generateMatches = (teams: { name: string; players: string[] }[], teamType: string, matchesPerPlayer: number) => {
    const matches: Match[] = [];
    let matchNumber = 1;

    // 모든 선수를 추출
    const allPlayers = teams.flatMap(team => team.players);
    
    if (allPlayers.length < 4) {
      console.warn('최소 4명의 선수가 필요합니다.');
      return [];
    }

    // 4명씩 그룹화하여 경기 생성
    const playerMatchCount: Record<string, number> = {};
    allPlayers.forEach(p => playerMatchCount[p] = 0);

    // 목표 경기 수: (선수 수 * 1인당 경기수) / 4
    const targetMatches = Math.ceil((allPlayers.length * matchesPerPlayer) / 4);
    let attempts = 0;
    const maxAttempts = 100;

    // 모든 선수가 최소 경기를 할 때까지 반복
    while (attempts < maxAttempts) {
      const needsMore = allPlayers.some(p => (playerMatchCount[p] || 0) < matchesPerPlayer);
      if (!needsMore) break;

      // 선수 목록을 섞고 4명씩 그룹화
      const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);

      for (let i = 0; i < shuffled.length - 3; i += 4) {
        const group = shuffled.slice(i, i + 4);
        if (group.length !== 4) continue;

        // 앞 2명 vs 뒤 2명으로 팀 구성
        const team1 = [group[0], group[1]];
        const team2 = [group[2], group[3]];

        const courtNumber = ((matchNumber - 1) % 4) + 1;
        matches.push({
          tournament_id: '',
          round: 1,
          match_number: matchNumber++,
          team1,
          team2,
          court: `Court ${courtNumber}`,
          status: 'pending'
        });

        // 경기 수 업데이트
        team1.forEach(p => playerMatchCount[p]++);
        team2.forEach(p => playerMatchCount[p]++);
      }

      attempts++;
    }

    // 0회 경기한 선수 처리 (강제 포함)
    let zeroAttempts = 0;
    const maxZeroAttempts = 50;

    while (zeroAttempts < maxZeroAttempts) {
      const zeroPlayers = allPlayers.filter(p => (playerMatchCount[p] || 0) === 0);
      if (zeroPlayers.length === 0) break;

      const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);
      for (let i = 0; i <= shuffled.length - 4; i += 4) {
        const group = shuffled.slice(i, i + 4);
        if (group.length !== 4) continue;

        // 0회 선수가 포함되었는지 확인
        const hasZeroPlayer = group.some(p => (playerMatchCount[p] || 0) === 0);
        if (!hasZeroPlayer) continue;

        const team1 = [group[0], group[1]];
        const team2 = [group[2], group[3]];

        const courtNumber = ((matchNumber - 1) % 4) + 1;
        matches.push({
          tournament_id: '',
          round: 1,
          match_number: matchNumber++,
          team1,
          team2,
          court: `Court ${courtNumber}`,
          status: 'pending'
        });

        team1.forEach(p => playerMatchCount[p]++);
        team2.forEach(p => playerMatchCount[p]++);
      }

      zeroAttempts++;
    }

    return matches;
  };

  const createPairMatch = (
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
    court: `Court ${courtNumber}`,
    status: 'pending',
  });

  const createRoundRobinMatchesForPairs = (
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
          matches.push(
            createPairMatch(
              pairs[leftIndex],
              pairs[rightIndex],
              nextMatchNumber++,
              nextRound,
              ((nextMatchNumber - 2) % courtCount) + 1
            )
          );
        }
      }
      nextRound += 1;
    }

    return matches;
  };

  const createKnockoutBracketMatchesForPairs = (
    pairs: PairEntry[],
    roundOffset: number,
    matchNumberOffset: number,
    courtCount: number,
    groupName: string,
    emptyInitialRound = false
  ) => {
    const seededPairs = [...pairs].sort((left, right) => right.totalScore - left.totalScore);
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
      const playInMatch = createPairMatch(
        seededPairs[directEntryCount + index],
        seededPairs[seededPairs.length - 1 - index],
        nextMatchNumber++,
        roundOffset,
        (index % courtCount) + 1
      );
      playInMatch.court = `[${groupName}] ${playInMatch.court}`;
      playInMatches.push(playInMatch);
      mainEntries.push({ playInMatch });
    }

    const mainRoundCount = Math.log2(mainBracketSize);
    for (let roundIndex = 0; roundIndex < mainRoundCount; roundIndex += 1) {
      const matchCount = mainBracketSize / 2 ** (roundIndex + 1);
      const roundMatches: Match[] = [];

      for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
        const team1Entry = !emptyInitialRound && roundIndex === 0 ? mainEntries[matchIndex * 2] : null;
        const team2Entry = !emptyInitialRound && roundIndex === 0 ? mainEntries[matchIndex * 2 + 1] : null;
        const courtNumber = (matchIndex % courtCount) + 1;

        roundMatches.push({
          tournament_id: '',
          round: roundOffset + (playInCount > 0 ? roundIndex + 1 : roundIndex),
          match_number: nextMatchNumber++,
          team1: team1Entry?.pair?.players || [],
          team2: team2Entry?.pair?.players || [],
          team1_levels: team1Entry?.pair ? [team1Entry.pair.totalScore] : [],
          team2_levels: team2Entry?.pair ? [team2Entry.pair.totalScore] : [],
          court: `[${groupName}] ${courtNumber}코트`,
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

  const buildPairTournamentMatches = (assignment: TeamAssignment) => {
    const pairGroups = getPairGroupsFromAssignment(assignment);
    const courtCount = Math.max(1, numberOfCourts);
    const configuredGroups =
      pairGroupSettings.length > 0
        ? pairGroupSettings
        : pairGroups.map((group) => ({
            groupName: group.groupName,
            pairNames: group.pairs.map((pair) => pair.name),
            format: 'round_robin' as const,
            roundRobinRepeats: 1,
            knockoutQualifiers: Math.min(4, Math.max(2, group.pairs.length >= 4 ? 4 : group.pairs.length)),
          }));

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

      if (groupConfig.format === 'round_robin') {
        const roundRobinMatches = createRoundRobinMatchesForPairs(
          configuredPairs,
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
          configuredPairs,
          roundCursor,
          matchNumberCursor,
          courtCount,
          groupConfig.groupName
        );
        matches.push(...knockoutMatches);
        const mainBracketSize = 2 ** Math.floor(Math.log2(Math.max(2, configuredPairs.length)));
        roundCursor += Math.log2(mainBracketSize) + (configuredPairs.length > mainBracketSize ? 1 : 0);
        matchNumberCursor += knockoutMatches.length;
        return;
      }

      const roundRobinMatches = createRoundRobinMatchesForPairs(
        configuredPairs,
        Math.max(1, groupConfig.roundRobinRepeats),
        roundCursor,
        matchNumberCursor,
        courtCount
      );
      matches.push(...roundRobinMatches);
      roundCursor += Math.max(1, groupConfig.roundRobinRepeats);
      matchNumberCursor += roundRobinMatches.length;

      const qualifiers = [...configuredPairs]
        .sort((left, right) => right.totalScore - left.totalScore)
        .slice(0, Math.max(2, Math.min(groupConfig.knockoutQualifiers, configuredPairs.length)));

      const knockoutMatches = createKnockoutBracketMatchesForPairs(
        qualifiers,
        roundCursor,
        matchNumberCursor,
        courtCount,
        groupConfig.groupName,
        true
      );
      matches.push(...knockoutMatches);
      const mainBracketSize = 2 ** Math.floor(Math.log2(Math.max(2, qualifiers.length)));
      roundCursor += Math.log2(mainBracketSize) + (qualifiers.length > mainBracketSize ? 1 : 0);
      matchNumberCursor += knockoutMatches.length;
    });

    return matches;
  };

  const getPairFormatLabel = (format: PairTournamentFormat) => {
    if (format === 'knockout') return '토너먼트';
    if (format === 'round_robin_knockout') return '리그후 토너먼트';
    return '풀리그';
  };

  const getPairSettingsSummary = () =>
    pairGroupSettings
      .map((group) => {
        const base = `${group.groupName}:${getPairFormatLabel(group.format)}`;
        if (group.format === 'round_robin') {
          return `${base} ${group.roundRobinRepeats}회`;
        }
        if (group.format === 'round_robin_knockout') {
          return `${base} 리그 ${group.roundRobinRepeats}회 + ${group.knockoutQualifiers}강`;
        }
        return base;
      })
      .join(' / ');

  // 대회 생성 및 경기 저장
  const createTournament = async () => {
    if (!selectedAssignment) {
      alert('팀 구성을 선택해주세요.');
      return;
    }

    try {
      const teams = getTeamsFromAssignment(selectedAssignment);
      if (teams.length === 0) {
        alert('선택한 구성에 팀이 없습니다.');
        return;
      }

      const matches = generatedMatches.length > 0
        ? generatedMatches
        : await buildGeneratedMatches(selectedAssignment);

      if (matches.length === 0) {
        alert('생성된 대진표가 없습니다.');
        return;
      }
      
      // 경기 타입에 따른 대회 제목 생성
      let tournamentTitle = '';
      const dateParts = (tournamentDate || '').split('-');
      const mmdd = dateParts.length === 3 ? `${dateParts[1]}-${dateParts[2]}` : (tournamentDate || '');

      if (selectedAssignment.team_type === 'pairs') {
        const pairGroups = getPairGroupsFromAssignment(selectedAssignment);
        const configuredGroups = pairGroupSettings.length > 0 ? pairGroupSettings : pairGroups.map((g) => ({
          groupName: g.groupName,
          pairNames: g.pairs.map((p) => p.name),
          format: 'round_robin' as const,
          roundRobinRepeats: 1,
          knockoutQualifiers: Math.min(4, Math.max(2, g.pairs.length >= 4 ? 4 : g.pairs.length)),
        }));

        const groupsLabel = configuredGroups.map((g) => g.groupName).join(', ');
        const formatLabel = configuredGroups.map(group => {
          const fmt = getPairFormatLabel(group.format);
          if (group.format === 'round_robin' && group.roundRobinRepeats > 1) {
            return `${fmt} ${group.roundRobinRepeats}회`;
          }
          return fmt;
        }).join('/');
        tournamentTitle = `${mmdd} 게임 ${roundNumber}회차 페어 (${groupsLabel} - ${formatLabel})`;
      } else {
        const typeLabel =
          matchType === 'level_based'
            ? '레벨'
            : matchType === 'mixed_doubles'
            ? '혼복'
            : '랜덤';
        tournamentTitle = `${mmdd} 게임 ${roundNumber}회차 ${typeLabel}`;
      }

      const response = await fetch('/api/admin/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tournament: {
            title: tournamentTitle,
            tournament_date: tournamentDate,
            round_number: roundNumber,
            match_type:
              selectedAssignment.team_type === 'pairs' && pairGroupSettings.every((group) => group.format === 'knockout')
                ? 'pairs_knockout'
                : selectedAssignment.team_type === 'pairs'
                  ? 'pairs_custom'
                  : matchType,
            team_assignment_id: selectedAssignment.id,
            team_type: selectedAssignment.team_type,
            total_teams: teams.length,
            matches_per_player: selectedAssignment.team_type === 'pairs' ? 1 : matchesPerPlayer,
          },
          matches,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || '게임 생성에 실패했습니다.');
      }

      alert('게임이 생성되었습니다!');
      setShowCreateModal(false);
      setSelectedAssignment(null);
      setIsManualEditing(false);
      fetchTournaments();
    } catch (error: any) {
      console.error('대회 생성 오류:', error);
      if (error?.code === '42P01' || String(error?.message || '').includes('42P01')) {
        alert('tournaments 또는 tournament_matches 테이블이 없습니다. 데이터베이스 스키마를 확인해주세요.');
      } else {
        alert('게임 생성 중 오류가 발생했습니다: ' + error.message);
      }
    }
  };

  // 경기 미리보기
  const handlePreviewMatches = (assignment: TeamAssignment) => {
    setSelectedAssignment(assignment);
    // 팀 구성의 날짜를 자동으로 설정
    setTournamentDate(assignment.assignment_date || '');
    setMatchesPerPlayer(1);
    
    // 이 팀 구성으로 이미 생성된 대회의 회차 중 가장 높은 회차 + 1로 자동 설정
    const existingTournaments = tournaments.filter(t => t.team_assignment_id === assignment.id);
    const maxRound = existingTournaments.reduce((max, t) => t.round_number > max ? t.round_number : max, 0);
    setRoundNumber(maxRound + 1);

    setMatchType('random');
    setNumberOfCourts(4); // 기본 코트 개수
    setGeneratedMatches([]);
    setIsManualEditing(false);
    setGenerationNotice(null);
    initializePairGroupSettings(assignment);
    autoGenerationContextRef.current = {
      initialized: false,
      lastSignature: '',
      lastAssignmentId: assignment.id,
    };
    setShowCreateModal(true);
  };

  const handleDeleteAssignment = async (assignment: TeamAssignment) => {
    if (!confirm(`"${assignment.title}" 팀 구성을 삭제할까요?`)) {
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
        throw new Error(payload?.message || payload?.error || '팀 구성 삭제에 실패했습니다.');
      }

      if (selectedAssignment?.id === assignment.id) {
        setSelectedAssignment(null);
        setShowCreateModal(false);
        setGeneratedMatches([]);
        setIsManualEditing(false);
      }

      await fetchTeamAssignments();
      alert('팀 구성이 삭제되었습니다.');
    } catch (error) {
      console.error('팀 구성 삭제 오류:', error);
      alert(error instanceof Error ? error.message : '팀 구성 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingAssignmentId(null);
    }
  };

  const buildGeneratedMatches = async (assignment: TeamAssignment): Promise<Match[]> => {
      if (assignment.team_type === 'pairs') {
        return buildPairTournamentMatches(assignment);
      }

      const teams = getTeamsFromAssignment(assignment);
      const allPlayerNames = teams.flatMap(team => team.players);

      if (allPlayerNames.length < 4) {
        throw new Error('최소 4명의 선수가 필요합니다.');
      }

      const playersWithScores = [...new Set(allPlayerNames)].map(name => ({
        name,
        score: getPlayerScore(name),
        gender: getPlayerGender(name),
      })).sort((a, b) => b.score - a.score);

      const playerPool = new Map<string, TeamLockedPlayer>(
        playersWithScores.map((player) => [player.name, player])
      );

      console.log('📈 선수 점수 순위:');
      playersWithScores.forEach((p, idx) => {
        console.log(`${idx + 1}. ${p.name}: ${p.score}점`);
      });

      const effectiveMatchesPerPlayer = matchesPerPlayer;
      const maxTotalMatches = Math.ceil((playersWithScores.length * effectiveMatchesPerPlayer) / 4);

      const maxCourts = numberOfCourts > 0 ? numberOfCourts : Math.max(4, Math.ceil(playersWithScores.length / 4));
      const playerMatchCount: Record<string, number> = Object.fromEntries(
        playersWithScores.map((player) => [player.name, 0])
      );
      const pairMatchCount: Record<string, number> = {};
      const convertedMatches: Match[] = [];

      if (matchType === 'mixed_doubles' && teams.length <= 1) {
        const playersWithoutGender = playersWithScores.filter((player) => !normalizeGender(player.gender));
        if (playersWithoutGender.length > 0) {
          console.warn(
            '혼복 성별 미지정 선수:',
            playersWithoutGender.map((player) => getPlayerName(player.name)).join(', ')
          );
        }

        // 1. 성별에 따른 선수 분류
        const males: typeof playersWithScores = [];
        const females: typeof playersWithScores = [];
        const genderLabelMap: Record<string, string> = {};

        playersWithScores.forEach((player) => {
          const gender = getPlayerGenderLabel(player.name);
          genderLabelMap[player.name] = gender;
          if (gender === '남') {
            males.push(player);
          } else if (gender === '여') {
            females.push(player);
          }
        });

        // 남성 또는 여성 선수 수가 부족한 경우, 미지정 선수를 균등하게 나눕니다.
        playersWithScores.forEach((player) => {
          const gender = genderLabelMap[player.name];
          if (gender !== '남' && gender !== '여') {
            if (males.length <= females.length) {
              males.push(player);
              genderLabelMap[player.name] = '남';
            } else {
              females.push(player);
              genderLabelMap[player.name] = '여';
            }
          }
        });

        // 그래도 부족할 시(모두 한쪽 성별이거나 선수풀이 부족할 때) 절반씩 강제 분배하여 생성합니다.
        if (males.length < 2 || females.length < 2) {
          males.length = 0;
          females.length = 0;
          playersWithScores.forEach((player, idx) => {
            if (idx % 2 === 0) {
              males.push(player);
              genderLabelMap[player.name] = '남';
            } else {
              females.push(player);
              genderLabelMap[player.name] = '여';
            }
          });
        }

        // 각 선수의 소속 팀 매핑
        const playerTeamMap: Record<string, string> = {};
        teams.forEach((t) => {
          t.players.forEach((pName) => {
            playerTeamMap[pName] = t.name;
          });
        });

        let matchNumber = 1;

        while (true) {
          // 목표 경기수 미달 남성/여성 목록
          const unplayedMales = males.filter((p) => (playerMatchCount[p.name] || 0) < effectiveMatchesPerPlayer);
          const unplayedFemales = females.filter((p) => (playerMatchCount[p.name] || 0) < effectiveMatchesPerPlayer);

          // 더 이상 미달인 선수가 없으면 종료
          if (unplayedMales.length === 0 && unplayedFemales.length === 0) {
            break;
          }

          if (convertedMatches.length >= maxTotalMatches) {
            break;
          }

          // 이번 경기에 투입할 남성 2명 선택
          const selectedMales: typeof playersWithScores = [];
          const malePool0 = [...unplayedMales];
          malePool0.sort(() => Math.random() - 0.5);

          while (selectedMales.length < 2 && malePool0.length > 0) {
            selectedMales.push(malePool0.pop()!);
          }

          // 부족하면 참여 횟수가 적은 남성 순으로 투입
          if (selectedMales.length < 2) {
            const playedMales = males
              .filter((p) => !selectedMales.some((sm) => sm.name === p.name))
              .sort((a, b) => {
                const countDiff = (playerMatchCount[a.name] || 0) - (playerMatchCount[b.name] || 0);
                if (countDiff !== 0) return countDiff;
                return Math.random() - 0.5;
              });

            while (selectedMales.length < 2 && playedMales.length > 0) {
              selectedMales.push(playedMales.shift()!);
            }
          }

          // 이번 경기에 투입할 여성 2명 선택
          const selectedFemales: typeof playersWithScores = [];
          const femalePool0 = [...unplayedFemales];
          femalePool0.sort(() => Math.random() - 0.5);

          while (selectedFemales.length < 2 && femalePool0.length > 0) {
            selectedFemales.push(femalePool0.pop()!);
          }

          // 부족하면 참여 횟수가 적은 여성 순으로 투입
          if (selectedFemales.length < 2) {
            const playedFemales = females
              .filter((p) => !selectedFemales.some((sf) => sf.name === p.name))
              .sort((a, b) => {
                const countDiff = (playerMatchCount[a.name] || 0) - (playerMatchCount[b.name] || 0);
                if (countDiff !== 0) return countDiff;
                return Math.random() - 0.5;
              });

            while (selectedFemales.length < 2 && playedFemales.length > 0) {
              selectedFemales.push(playedFemales.shift()!);
            }
          }

          // 남성 2명, 여성 2명이 갖춰졌는지 확인
          if (selectedMales.length < 2 || selectedFemales.length < 2) {
            break;
          }

          const [m1, m2] = selectedMales;
          const [f1, f2] = selectedFemales;

          // 소속 팀(sourceTeam) 충돌 확인 함수
          const getConflictScore = (team1: typeof playersWithScores, team2: typeof playersWithScores) => {
            let conflict = 0;
            if (playerTeamMap[team1[0].name] && playerTeamMap[team1[0].name] === playerTeamMap[team1[1].name]) {
              conflict += 10;
            }
            if (playerTeamMap[team2[0].name] && playerTeamMap[team2[0].name] === playerTeamMap[team2[1].name]) {
              conflict += 10;
            }
            const team1Sources = team1.map(p => playerTeamMap[p.name]).filter(Boolean);
            const team2Sources = team2.map(p => playerTeamMap[p.name]).filter(Boolean);
            team1Sources.forEach(s => {
              if (team2Sources.includes(s)) {
                conflict += 2;
              }
            });
            return conflict;
          };

          const diffA = Math.abs((m1.score + f1.score) - (m2.score + f2.score));
          const conflictA = getConflictScore([m1, f1], [m2, f2]);
          const scoreA = diffA + conflictA;

          const diffB = Math.abs((m1.score + f2.score) - (m2.score + f1.score));
          const conflictB = getConflictScore([m1, f2], [m2, f1]);
          const scoreB = diffB + conflictB;

          let team1: typeof playersWithScores;
          let team2: typeof playersWithScores;

          if (scoreA <= scoreB) {
            team1 = [m1, f1];
            team2 = [m2, f2];
          } else {
            team1 = [m1, f2];
            team2 = [m2, f1];
          }

          convertedMatches.push({
            tournament_id: '',
            round: 1,
            match_number: matchNumber,
            team1: team1.map((p) => p.name),
            team2: team2.map((p) => p.name),
            team1_levels: team1.map((p) => p.score),
            team2_levels: team2.map((p) => p.score),
            court: `Court ${((matchNumber - 1) % maxCourts) + 1}`,
            status: 'pending' as const,
          });

          [...team1, ...team2].forEach((p) => {
            playerMatchCount[p.name] = (playerMatchCount[p.name] || 0) + 1;
          });

          matchNumber += 1;
        }
      } else {
        const totalRounds = Math.max(1, effectiveMatchesPerPlayer);

        for (let round = 1; round <= totalRounds; round += 1) {
          const pairsForRound = buildTeamLockedPairsForRound(
            teams,
            playerPool,
            playerMatchCount,
            pairMatchCount,
            matchType
          );
          const matchedPairs = matchTeamLockedPairs(pairsForRound, maxCourts);

          for (const { left, right } of matchedPairs) {
            if (convertedMatches.length >= maxTotalMatches) {
              break;
            }

            const isLeftFirstTeam = teams[0] && left.sourceTeam === teams[0].name;
            const team1Players = isLeftFirstTeam ? left.players.map((player) => player.name) : right.players.map((player) => player.name);
            const team2Players = isLeftFirstTeam ? right.players.map((player) => player.name) : left.players.map((player) => player.name);
            const team1Levels = isLeftFirstTeam ? left.players.map((player) => player.score) : right.players.map((player) => player.score);
            const team2Levels = isLeftFirstTeam ? right.players.map((player) => player.score) : left.players.map((player) => player.score);

            convertedMatches.push({
              tournament_id: '',
              round,
              match_number: convertedMatches.length + 1,
              team1: team1Players,
              team2: team2Players,
              team1_levels: team1Levels,
              team2_levels: team2Levels,
              court: `Court ${((convertedMatches.length) % maxCourts) + 1}`,
              status: 'pending' as const,
            });

            [...left.players, ...right.players].forEach((player) => {
              playerMatchCount[player.name] = (playerMatchCount[player.name] || 0) + 1;
            });

            const leftKey = left.players.map((player) => player.name).sort((a, b) => a.localeCompare(b, 'ko')).join('::');
            const rightKey = right.players.map((player) => player.name).sort((a, b) => a.localeCompare(b, 'ko')).join('::');
            pairMatchCount[leftKey] = (pairMatchCount[leftKey] || 0) + 1;
            pairMatchCount[rightKey] = (pairMatchCount[rightKey] || 0) + 1;
          }
        }
      }

      // 목표 경기수 보완 로직 (레벨/랜덤 모드 전용)
      if (matchType !== 'mixed_doubles') {
        const isMultiTeam = teams.length > 1;

        if (isMultiTeam) {
          while (true) {
            const unplayed = playersWithScores.filter((p) => (playerMatchCount[p.name] || 0) < effectiveMatchesPerPlayer);
            if (unplayed.length === 0) {
              break;
            }

            if (convertedMatches.length >= maxTotalMatches) {
              break;
            }

            const teamsWithUnplayed = teams.filter((t) =>
              t.players.some((pName) => (playerMatchCount[pName] || 0) < effectiveMatchesPerPlayer)
            );

            if (teamsWithUnplayed.length === 0) {
              break;
            }

            const teamA = teamsWithUnplayed[0];
            const otherTeams = teams.filter((t) => t.name !== teamA.name);
            if (otherTeams.length === 0) {
              break;
            }

            otherTeams.sort((a, b) => {
              const aUnplayed = a.players.filter((pName) => (playerMatchCount[pName] || 0) < effectiveMatchesPerPlayer).length;
              const bUnplayed = b.players.filter((pName) => (playerMatchCount[pName] || 0) < effectiveMatchesPerPlayer).length;
              return bUnplayed - aUnplayed;
            });
            const teamB = otherTeams[0];

            const selectPairFromTeam = (teamInfo: { name: string; players: string[] }) => {
              const teamPlayers = teamInfo.players;
              const sorted = [...teamPlayers].sort((a, b) => {
                const aCount = playerMatchCount[a] || 0;
                const bCount = playerMatchCount[b] || 0;
                const aIsUnplayed = aCount < effectiveMatchesPerPlayer ? 1 : 0;
                const bIsUnplayed = bCount < effectiveMatchesPerPlayer ? 1 : 0;
                if (aIsUnplayed !== bIsUnplayed) {
                  return bIsUnplayed - aIsUnplayed;
                }
                return aCount - bCount;
              });

              return sorted.slice(0, 2);
            };

            const team1PlayersRaw = selectPairFromTeam(teamA);
            const team2PlayersRaw = selectPairFromTeam(teamB);

            if (team1PlayersRaw.length < 2 || team2PlayersRaw.length < 2) {
              break;
            }

            const isTeamAFirst = teams[0] && teamA.name === teams[0].name;
            const team1Players = isTeamAFirst ? team1PlayersRaw : team2PlayersRaw;
            const team2Players = isTeamAFirst ? team2PlayersRaw : team1PlayersRaw;

            const team1Levels = team1Players.map((name) => getPlayerScore(name));
            const team2Levels = team2Players.map((name) => getPlayerScore(name));

            convertedMatches.push({
              tournament_id: '',
              round: effectiveMatchesPerPlayer + 1,
              match_number: convertedMatches.length + 1,
              team1: team1Players,
              team2: team2Players,
              team1_levels: team1Levels,
              team2_levels: team2Levels,
              court: `Court ${((convertedMatches.length) % maxCourts) + 1}`,
              status: 'pending' as const,
            });

            [...team1Players, ...team2Players].forEach((pName) => {
              playerMatchCount[pName] = (playerMatchCount[pName] || 0) + 1;
            });
          }
        } else {
          while (true) {
            const unplayed = playersWithScores.filter((p) => (playerMatchCount[p.name] || 0) < effectiveMatchesPerPlayer);
            if (unplayed.length === 0) {
              break;
            }

            if (convertedMatches.length >= maxTotalMatches) {
              break;
            }

            const selected: typeof playersWithScores = [];
            const unplayedPool = [...unplayed];
            unplayedPool.sort(() => Math.random() - 0.5);

            // 우선 미달인 선수들로 4명까지 채움
            while (selected.length < 4 && unplayedPool.length > 0) {
              selected.push(unplayedPool.pop()!);
            }

            // 부족하면 참여 횟수가 적은 선수들로 채움
            if (selected.length < 4) {
              const played = playersWithScores
                .filter((p) => !selected.some((s) => s.name === p.name))
                .sort((a, b) => {
                  const countDiff = (playerMatchCount[a.name] || 0) - (playerMatchCount[b.name] || 0);
                  if (countDiff !== 0) return countDiff;
                  return Math.random() - 0.5;
                });

              while (selected.length < 4 && played.length > 0) {
                selected.push(played.shift()!);
              }
            }

            if (selected.length < 4) {
              break;
            }

            const sortedSelected = [...selected].sort((a, b) => b.score - a.score);
            const team1 = [sortedSelected[0], sortedSelected[3]];
            const team2 = [sortedSelected[1], sortedSelected[2]];

            convertedMatches.push({
              tournament_id: '',
              round: effectiveMatchesPerPlayer + 1,
              match_number: convertedMatches.length + 1,
              team1: team1.map((p) => p.name),
              team2: team2.map((p) => p.name),
              team1_levels: team1.map((p) => p.score),
              team2_levels: team2.map((p) => p.score),
              court: `Court ${((convertedMatches.length) % maxCourts) + 1}`,
              status: 'pending' as const,
            });

            selected.forEach((p) => {
              playerMatchCount[p.name] = (playerMatchCount[p.name] || 0) + 1;
            });
          }
        }
      }

      const stillMissing = playersWithScores.filter((player) => (playerMatchCount[player.name] || 0) < effectiveMatchesPerPlayer);

      if (stillMissing.length > 0) {
        console.warn(
          `⚠️ ${stillMissing.length}명의 선수가 목표 경기수에 도달하지 못했습니다:`,
          stillMissing.map((player) => player.name).join(', ')
        );
      }

      const optimizedMatches: Match[] = avoidConsecutiveMatches(convertedMatches, maxCourts, tournamentDate, startTime, timeInterval).map(m => ({
        ...m,
        court: '',
        scheduled_time: undefined
      }));
      
      // 최종 점수 차이 분석
      const avgDiffAfter = calculateAverageScoreDifference(optimizedMatches);
      console.log(`✅ 경기 생성 완료: 평균 점수차이 ${avgDiffAfter.toFixed(1)}점`);

      // 팀 점수 기반 균등 배정 검증 및 로깅
      const teamScores: Record<string, { players: string[], totalScore: number }> = {};
      optimizedMatches.forEach((match) => {
        const team1Key = `Team1-${match.team1.join(',')}`;
        const team2Key = `Team2-${match.team2.join(',')}`;
        
        if (!teamScores[team1Key]) {
          const score = (match.team1_levels || []).reduce((sum, s) => sum + s, 0);
          teamScores[team1Key] = { players: match.team1, totalScore: score };
        }
        if (!teamScores[team2Key]) {
          const score = (match.team2_levels || []).reduce((sum, s) => sum + s, 0);
          teamScores[team2Key] = { players: match.team2, totalScore: score };
        }
      });

      // 팀 점수 분포 분석
      const allTeamScores = Object.values(teamScores).map(t => t.totalScore);
      const maxScore = Math.max(...allTeamScores);
      const minScore = Math.min(...allTeamScores);
            const avgScore = allTeamScores.reduce((a, b) => a + b, 0) / allTeamScores.length;

      // 경기별 점수 차이 분석
      const matchScoreDifferences = optimizedMatches.map((match, idx) => {
        const team1Score = (match.team1_levels || []).reduce((sum: number, l: number) => sum + l, 0);
        const team2Score = (match.team2_levels || []).reduce((sum: number, l: number) => sum + l, 0);
        return {
          matchNum: idx + 1,
          team1: team1Score,
          team2: team2Score,
          diff: Math.abs(team1Score - team2Score)
        };
      });

      const avgMatchDiff = calculateAverageScoreDifference(optimizedMatches);
      const maxMatchDiff = calculateMaxScoreDifference(optimizedMatches);
      const badMatchesCount = matchScoreDifferences.filter((m: any) => m.diff >= 2).length;
      const perfectMatchCount = matchScoreDifferences.filter((m: any) => m.diff === 0).length;

      // 전체 참가자 통계 출력
      console.log('📊 경기 생성 완료:');
      console.log(`- 타입: ${matchType}`);
      console.log(`- 총 선수: ${playersWithScores.length}명`);
      console.log(`- 생성된 경기: ${optimizedMatches.length}개`);
      console.log(`- 1인당 목표: ${effectiveMatchesPerPlayer}경기`);
      
      // 경기 수 분포 출력
      const distribution: Record<number, number> = {};
      Object.values(playerMatchCount).forEach((count: number) => {
        distribution[count] = (distribution[count] || 0) + 1;
      });
      console.log('- 경기 수 분포:', distribution);
      
      // 팀 점수 분포 출력
      console.log('📈 팀 점수 분석:');
      console.log(`- 평균 팀 점수: ${avgScore.toFixed(1)}점`);
      console.log(`- 최고 팀 점수: ${maxScore}점`);
      console.log(`- 최저 팀 점수: ${minScore}점`);
      console.log(`- 팀 점수 범위: ${(maxScore - minScore).toFixed(1)}점`);
      console.log(`- 점수 차이 비율: ${((maxScore - minScore) / avgScore * 100).toFixed(1)}%`);

      // 경기별 점수 차이 분석 출력
      console.log('⚖️ 경기별 점수 차이 분석:');
      console.log(`- 평균 경기 점수차: ${avgMatchDiff.toFixed(1)}점`);
      console.log(`- 최대 경기 점수차: ${maxMatchDiff}점`);
      console.log(`- 차이 0점 경기: ${perfectMatchCount}개`);
      console.log(`- 차이 1점 경기: ${matchScoreDifferences.filter((m: any) => m.diff === 1).length}개`);
      console.log(`- 차이 2점 이상 경기: ${badMatchesCount}개 ${badMatchesCount > 0 ? '⚠️' : '✅'}`);
      
      if (badMatchesCount > 0) {
        const badMatches = matchScoreDifferences.filter((m: any) => m.diff >= 2);
        console.warn(`⚠️ 경기 점수 차이 2점 이상인 경기들:`, badMatches);
      }

      return optimizedMatches;
  };

  // 경기 재생성 (값 변경 후) - match-utils 함수 사용 + matchType 지원
  const handleRegenerateMatches = async () => {
    if (!selectedAssignment) return;

    try {
      const optimizedMatches = await buildGeneratedMatches(selectedAssignment);
      setGeneratedMatches(optimizedMatches);
      setIsManualEditing(false);
      showGenerationNotice('success', `대진표를 다시 생성했습니다. ${optimizedMatches.length}경기를 배정했습니다. 코트와 시간을 일괄 배정하려면 아래 버튼을 눌러주세요.`);
    } catch (error: any) {
      console.error('경기 생성 오류:', error);
      showGenerationNotice('error', error?.message || '경기 생성 중 오류가 발생했습니다.');
      alert(error?.message || '경기 생성 중 오류가 발생했습니다.');
    }
  };

  const handleApplyCourtAndTime = () => {
    if (generatedMatches.length === 0) return;
    const C = numberOfCourts > 0 ? numberOfCourts : 4;
    const baseDate = tournamentDate || '2026-07-01';
    const sTime = startTime || '17:30';
    const interval = timeInterval || 10;

    const remaining = [...generatedMatches];
    const scheduled: any[] = [];
    
    const slotPlayers: Set<string>[] = [];
    const matchSlots = new Map<any, number>();
    const matchCourts = new Map<any, number>();

    const cleanNameForCheck = (name: string): string => {
      return name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    };

    let currentSlotIndex = 0;
    
    while (remaining.length > 0) {
      if (!slotPlayers[currentSlotIndex]) {
        slotPlayers[currentSlotIndex] = new Set<string>();
      }

      let matchesInCurrentSlot = 0;
      for (const m of scheduled) {
        if (matchSlots.get(m) === currentSlotIndex) {
          matchesInCurrentSlot++;
        }
      }

      if (matchesInCurrentSlot >= C) {
        currentSlotIndex++;
        continue;
      }

      const prevSlotPlayers = currentSlotIndex > 0 ? slotPlayers[currentSlotIndex - 1] : new Set<string>();
      const currentSlotPlayers = slotPlayers[currentSlotIndex];

      let bestIndex = -1;
      let bestPenalty = Number.POSITIVE_INFINITY;

      for (let i = 0; i < remaining.length; i++) {
        const match = remaining[i];
        const matchPlayers = [...match.team1, ...match.team2].map(cleanNameForCheck);
        
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
        currentSlotIndex++;
        continue;
      }

      const [selectedMatch] = remaining.splice(bestIndex, 1);
      scheduled.push(selectedMatch);
      matchSlots.set(selectedMatch, currentSlotIndex);
      matchCourts.set(selectedMatch, matchesInCurrentSlot);

      const matchPlayers = [...selectedMatch.team1, ...selectedMatch.team2].map(cleanNameForCheck);
      matchPlayers.forEach(p => {
        slotPlayers[currentSlotIndex].add(p);
      });
    }

    const updated = scheduled.map((match, idx) => {
      const slotIdx = matchSlots.get(match) ?? 0;
      const courtIdx = matchCourts.get(match) ?? 0;
      
      const round = slotIdx + 1;
      const courtNum = courtIdx + 1;
      const matchNumber = idx + 1;

      const [startHour, startMin] = sTime.split(':').map(Number);
      const totalMins = startHour * 60 + startMin + slotIdx * interval;
      const hour = Math.floor(totalMins / 60);
      const min = totalMins % 60;
      const hourStr = String(hour).padStart(2, '0');
      const minStr = String(min).padStart(2, '0');
      const scheduledTime = `${baseDate}T${hourStr}:${minStr}:00`;

      return {
        ...match,
        match_number: matchNumber,
        court: `${courtNum}코트`,
        round: 1,
        scheduled_time: scheduledTime,
      };
    });

    setGeneratedMatches(updated);
    showGenerationNotice('success', '코트와 시간을 일괄 배정했습니다.');
  };

  useEffect(() => {
    if (!showCreateModal || !selectedAssignment) return;

    const signature = JSON.stringify({
      assignmentId: selectedAssignment.id,
      matchType,
      numberOfCourts,
      roundNumber,
      matchesPerPlayer,
      pairGroupSettings,
    });

    const assignmentChanged = autoGenerationContextRef.current.lastAssignmentId !== selectedAssignment.id;
    const settingsChanged =
      autoGenerationContextRef.current.initialized &&
      autoGenerationContextRef.current.lastSignature !== signature;

    buildGeneratedMatches(selectedAssignment)
      .then((matches) => {
        setGeneratedMatches(matches);
        setIsManualEditing(false);

        if (settingsChanged) {
          showGenerationNotice(
            'success',
            `설정 변경으로 대진표를 새로 배정했습니다. 경기방식 ${matchType === 'level_based' ? '레벨' : matchType === 'mixed_doubles' ? '혼복' : '랜덤'}, 회차 ${roundNumber}, 코트 ${numberOfCourts}개, 총 ${matches.length}경기입니다.`
          );
        }

        autoGenerationContextRef.current = {
          initialized: true,
          lastSignature: signature,
          lastAssignmentId: selectedAssignment.id,
        };
      })
      .catch((error) => {
        console.error('자동 경기 생성 오류:', error);
        setGeneratedMatches([]);
        if (settingsChanged || assignmentChanged) {
          showGenerationNotice('error', error?.message || '설정 변경 후 자동 배정 중 오류가 발생했습니다.');
        }
      });
  }, [showCreateModal, selectedAssignment, matchType, numberOfCourts, roundNumber, matchesPerPlayer, pairGroupSettings]);

  // 경기 관리 - 대진표 페이지로 이동
  const handleManageMatches = async (tournament: Tournament) => {
    // 대진표 페이지로 이동하면서 tournament ID를 전달
    router.push(`/admin/tournament-bracket?tournament=${tournament.id}`);
  };

  // 경기 삭제
  const deleteTournament = async (tournamentId: string) => {
    if (!confirm('이 게임을 삭제하시겠습니까? 모든 경기 정보가 함께 삭제됩니다.')) {
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
        throw new Error(payload?.message || payload?.error || '게임 삭제에 실패했습니다.');
      }

      alert('게임이 삭제되었습니다.');
      fetchTournaments();
    } catch (error) {
      console.error('대회 삭제 오류:', error);
      alert('게임 삭제 중 오류가 발생했습니다.');
    }
  };

  const standardTeamAssignments = teamAssignments.filter((assignment) => assignment.team_type !== 'pairs');
  const pairTeamAssignments = teamAssignments.filter((assignment) => assignment.team_type === 'pairs');
  const standardTournaments = tournaments.filter((tournament) => tournament.team_type !== 'pairs');

  return (
    <div className="w-full px-2 py-2 sm:p-6">
      <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between px-1">
          <div className="space-y-0.5 pl-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
              <Trophy className="h-3.5 w-3.5" />
              대회경기
            </span>
            <h1 className="text-xl font-bold tracking-tight">게임 경기 관리</h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">팀 구성을 선택하여 게임 경기 일정을 생성하고 관리합니다.</p>
          </div>
          <Link href="/manager">
            <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              홈
            </Button>
          </Link>
        </div>
      </section>

      {/* 팀 구성 선택 섹션 */}
      <div className="mb-4 rounded-lg bg-white p-3 shadow-md sm:mb-8 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
          <h2 className="text-base font-semibold sm:text-xl">📋 팀 구성 선택</h2>
          <button
            onClick={() => fetchTeamAssignments()}
            className="flex items-center gap-1 rounded-lg bg-gray-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700 sm:gap-2 sm:px-3 sm:text-sm"
          >
            <span>🔄</span>
            <span>새로고침</span>
          </button>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">데이터 로딩 중...</span>
          </div>
        ) : standardTeamAssignments.length === 0 ? (
          <div className="text-center py-8 bg-yellow-50 border-2 border-yellow-200 rounded-lg">
            <p className="mb-3 font-semibold text-yellow-900 text-lg">⚠️ 일반 팀전 구성이 없습니다</p>
            <p className="text-sm text-yellow-800 mb-4">일반 팀전은 이 페이지에서, 페어전은 전용 페이지에서 생성합니다.</p>
            {pairTeamAssignments.length > 0 && (
              <button
                type="button"
                onClick={() => router.push('/admin/pair-tournament-settings')}
                className="mb-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                페어 게임 페이지로 이동
              </button>
            )}
            <details className="text-left inline-block text-sm text-gray-700 bg-white p-3 rounded border border-gray-300">
              <summary className="cursor-pointer font-semibold mb-2">📱 확인 사항</summary>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>/team-management 페이지에서 팀 구성 후 저장</li>
                <li>Supabase team_assignments 테이블 데이터 확인</li>
                <li>브라우저 콘솔(F12)에서 로그 확인</li>
              </ul>
            </details>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {standardTeamAssignments.map((assignment) => {
              const teams = getTeamsFromAssignment(assignment);
              const teamTypeLabel = getTeamTypeLabel(assignment.team_type);

              return (
                <div
                  key={assignment.id}
                  className="rounded-lg border-2 border-gray-200 p-3 transition-colors hover:border-blue-400 sm:p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-2 sm:mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 sm:text-base">{assignment.title}</h3>
                      <p className="text-xs text-gray-600 sm:text-sm">{assignment.assignment_date}</p>
                    </div>
                    <span className="rounded bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-800 sm:text-xs">
                      {teamTypeLabel}
                    </span>
                  </div>
                  
                  <div className="mb-3 text-xs text-gray-600 sm:text-sm">
                    <div>👥 총 {teams.length}팀</div>
                    <div>🎯 예상 경기: {Math.ceil((teams.reduce((sum, t) => sum + t.players.length, 0) * matchesPerPlayer) / 4)}경기</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openAssignmentParticipantsModal(assignment)}
                      className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      참가자
                    </button>
                    <button
                      onClick={() => handlePreviewMatches(assignment)}
                      className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      게임 생성
                    </button>
                    <button
                      onClick={() => handleDeleteAssignment(assignment)}
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
        {pairTeamAssignments.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            페어전 팀 구성 {pairTeamAssignments.length}건은 전용 페이지에서 관리합니다.
            <button
              type="button"
              onClick={() => router.push('/admin/pair-tournament-settings')}
              className="ml-3 rounded-lg bg-amber-600 px-3 py-2 font-medium text-white transition-colors hover:bg-amber-700"
            >
              페어 게임 페이지
            </button>
          </div>
        )}
      </div>

      {/* 대회 생성 폼 (모달 제거, 페이지에 표시) */}
      {showCreateModal && selectedAssignment && (
        <div className="mb-4 rounded-lg border-2 border-blue-300 bg-white p-3 shadow-md sm:mb-6 sm:p-6">
          <div className="mb-4 border-b border-gray-200 pb-4 sm:mb-6 sm:pb-6">
            <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">게임 생성</h2>
            <p className="mt-1 text-sm text-gray-600">{selectedAssignment.title}</p>
          </div>

          {generationNotice && (
            <div
              className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
                generationNotice.type === 'success'
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {generationNotice.text}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mt-4">
            {/* 좌측 설정창 영역 */}
            <div className="lg:col-span-5 space-y-4">
              {/* 대회 정보 입력 */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 sm:p-4 shadow-sm">
                <h3 className="mb-3 text-base font-semibold text-blue-900 sm:text-lg">📋 게임 정보</h3>
                
                {/* 안내 메시지 */}
                <div className="space-y-2 mb-3">
                  <div className="rounded border border-yellow-300 bg-yellow-50 p-2.5 text-xs text-yellow-800">
                    ⚠️ 팀을 선택한 뒤 <strong>경기 방식만 바꾸면</strong> 대진표가 자동으로 다시 생성됩니다. 게임 날짜는 팀 구성 날짜를 자동 사용합니다.
                  </div>
                </div>

                {/* 회차, 코트, 경기수 선택 */}
                <div className="space-y-3">
                  {/* 회차 표시 (자동 배정되므로 수정 불가) */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap w-24">회차:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-900 bg-slate-100 px-3 py-1 rounded border border-slate-200">
                        {roundNumber}회차
                      </span>
                      <span className="text-xs text-gray-500">(자동 배정)</span>
                    </div>
                  </div>



                  {/* 선수당 경기수 선택 */}
                  {selectedAssignment.team_type !== 'pairs' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap w-24">1인당 게임수:</span>
                      <div className="flex gap-1">
                        {[1, 2, 3].map(num => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => setMatchesPerPlayer(num)}
                            className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                              matchesPerPlayer === num
                                ? 'bg-purple-600 text-white'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}



                  {selectedAssignment.team_type === 'pairs' && (
                    <div className="text-xs text-purple-800 bg-purple-50 border border-purple-200 rounded px-2.5 py-1.5 mt-2">
                      페어전은 그룹별 경기 방식으로 경기 수가 결정됩니다.
                    </div>
                  )}
                </div>

                <div className="mt-3 text-xs text-blue-800 sm:text-sm">
                  {(() => {
                    const dateParts = (tournamentDate || '').split('-');
                    const mmdd = dateParts.length === 3 ? `${dateParts[1]}-${dateParts[2]}` : (tournamentDate || '(미설정)');
                    const typeLabel = matchType === 'level_based' ? '레벨' : matchType === 'mixed_doubles' ? '혼복' : '랜덤';
                    const titleText = selectedAssignment.team_type === 'pairs'
                      ? `${mmdd} 게임 ${roundNumber}회차 페어 (${getPairSettingsSummary() || '풀리그'})`
                      : `${mmdd} 게임 ${roundNumber}회차 ${typeLabel}`;
                    return <>💡 게임명: <strong>{titleText}</strong></>;
                  })()}
                </div>
              </div>

              {/* 경기 타입 */}
              {selectedAssignment.team_type === 'pairs' ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4 shadow-sm text-xs">
                  <label className="mb-2 block text-sm font-semibold text-gray-700">
                    그룹별 경기 방식
                  </label>
                  <div className="space-y-3">
                    <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                      모든 그룹을 토너먼트로 선택하면 모든 라운드를 생성하고 경기 결과에 따라 승자를 다음 라운드에 자동 배정합니다. 리그+토너 방식은 리그 결과 확정 후 토너먼트를 생성하세요.
                    </div>
                    {pairGroupSettings.map((group) => (
                      <div key={group.groupName} className="rounded border border-slate-200 bg-white p-3 text-xs">
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-900">{group.groupName}</div>
                            <div className="text-slate-500">{group.pairNames.length}개 페어</div>
                          </div>
                          <div className="flex gap-1">
                            {([
                              ['round_robin', '리그'],
                              ['knockout', '토너'],
                              ['round_robin_knockout', '리그+토너'],
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
                                className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                                  group.format === format
                                    ? 'bg-indigo-600 text-white'
                                    : 'border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4 shadow-sm">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    경기 타입
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className={`flex flex-col items-center justify-center p-2 border rounded-lg cursor-pointer transition-all ${
                      matchType === 'level_based'
                        ? 'border-blue-500 bg-blue-100 font-bold'
                        : 'border-gray-300 hover:border-gray-400 bg-white'
                    }`}>
                      <input
                        type="radio"
                        name="matchType"
                        value="level_based"
                        checked={matchType === 'level_based'}
                        onChange={(e) => setMatchType(e.target.value as any)}
                        className="sr-only"
                      />
                      <span className="text-base mb-0.5">🎯</span>
                      <span className="text-xs text-gray-900">레벨</span>
                    </label>

                    <label className={`flex flex-col items-center justify-center p-2 border rounded-lg cursor-pointer transition-all ${
                      matchType === 'random'
                        ? 'border-green-500 bg-green-100 font-bold'
                        : 'border-gray-300 hover:border-gray-400 bg-white'
                    }`}>
                      <input
                        type="radio"
                        name="matchType"
                        value="random"
                        checked={matchType === 'random'}
                        onChange={(e) => setMatchType(e.target.value as any)}
                        className="sr-only"
                      />
                      <span className="text-base mb-0.5">🎲</span>
                      <span className="text-xs text-gray-900">랜덤</span>
                    </label>

                    <label className={`flex flex-col items-center justify-center p-2 border rounded-lg cursor-pointer transition-all ${
                      matchType === 'mixed_doubles'
                        ? 'border-pink-500 bg-pink-100 font-bold'
                        : 'border-gray-300 hover:border-gray-400 bg-white'
                    }`}>
                      <input
                        type="radio"
                        name="matchType"
                        value="mixed_doubles"
                        checked={matchType === 'mixed_doubles'}
                        onChange={(e) => setMatchType(e.target.value as any)}
                        className="sr-only"
                      />
                      <span className="text-base mb-0.5">💑</span>
                      <span className="text-xs text-gray-900">혼복</span>
                    </label>
                  </div>
                </div>
              )}

              {/* 제어 버튼 영역 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4 shadow-sm">
                <div className="mb-3 rounded bg-white p-2 text-[11px] text-gray-500 border border-slate-100">
                  선수당목표: {matchesPerPlayer}경기 | 생성된대진: {generatedMatches.length}경기
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleRegenerateMatches}
                    className="w-full py-2 rounded-lg font-semibold transition-colors bg-purple-600 hover:bg-purple-700 text-white text-sm shadow-sm flex items-center justify-center gap-1.5"
                  >
                    🔄 대진표 다시 생성
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsManualEditing((prev) => !prev)}
                    disabled={generatedMatches.length === 0}
                    className={`w-full py-2 rounded-lg font-semibold transition-colors text-sm shadow-sm flex items-center justify-center gap-1.5 ${
                      isManualEditing
                        ? 'bg-amber-600 hover:bg-amber-700 text-white'
                        : 'bg-slate-700 hover:bg-slate-800 text-white'
                    } disabled:bg-gray-300 disabled:text-gray-500`}
                  >
                    {isManualEditing ? '⏹️ 수동배정 종료' : '✏️ 수동배정 모드'}
                  </button>

                  <div className="flex flex-row gap-2 mt-2 pt-2 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                      }}
                      className="flex-1 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg font-semibold text-sm transition-colors text-center"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={createTournament}
                      disabled={generatedMatches.length === 0}
                      className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-colors text-center ${
                        generatedMatches.length === 0
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      게임 생성
                    </button>
                  </div>
                </div>
              </div>

              {/* 참가 팀 목록 */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4 shadow-sm max-h-[300px] overflow-y-auto">
                <h3 className="mb-2 text-sm font-semibold text-gray-800">참가 팀</h3>
                <div className="space-y-1.5">
                  {(() => {
                    const participantGameCounts = getGeneratedPlayerGameCounts(generatedMatches);
                    const participantGameCountValues = Object.values(participantGameCounts);
                    const participantAverageGameCount =
                      participantGameCountValues.length > 0
                        ? participantGameCountValues.reduce((sum, count) => sum + count, 0) / participantGameCountValues.length
                        : 0;

                    return getTeamsFromAssignment(selectedAssignment).map((team, idx) => (
                      <div key={idx} className="border border-gray-100 rounded p-2 bg-slate-50">
                        <div className="font-semibold text-gray-900 text-xs mb-1">{team.name}</div>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-600">
                          {team.players.map((player) => {
                            const playerName = getPlayerName(player);
                            const gameCount = participantGameCounts[playerName] || 0;
                            const isAboveAverage = gameCount > participantAverageGameCount;
                            const genderLabel = getPlayerGenderLabel(player);

                            return (
                              <span key={`${team.name}-${player}`} className="inline-flex items-center gap-0.5 whitespace-nowrap">
                                <span>{playerName}({genderLabel})</span>
                                <span className={`font-semibold ${isAboveAverage ? 'text-red-600' : 'text-blue-600'}`}>
                                  [{gameCount}]
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* 우측 생성될 경기 결과 영역 */}
            <div className="lg:col-span-7 space-y-4 border border-slate-200 rounded-xl bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-2 sm:mb-4">
                  <h3 className="text-base font-semibold sm:text-lg">생성될 경기 ({generatedMatches.length}경기)</h3>
                  {generatedMatches.length > 0 && (
                    <div className="flex rounded-lg bg-gray-100 p-0.5">
                      <button
                        type="button"
                        onClick={() => setViewType('card')}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                          viewType === 'card'
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        🎴 카드 보기
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewType('table')}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                          viewType === 'table'
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        📋 테이블 보기
                      </button>
                    </div>
                  )}
                </div>
                {generatedMatches.length === 0 ? (
                  <div className="border border-yellow-300 bg-yellow-50 rounded-lg p-4 text-center">
                    <p className="text-sm text-yellow-800">대진표를 자동 생성하지 못했습니다. 코트 수를 조정하거나 다시 생성 버튼을 눌러주세요.</p>
                  </div>
                ) : (
                <>
                  {/* 팀 점수 통계 요약 */}
                  {generatedMatches.length > 0 && (() => {
                    const allTeamScores: number[] = [];
                    generatedMatches.forEach(match => {
                      const team1Score = (match.team1_levels || []).reduce((sum, l) => sum + l, 0);
                      const team2Score = (match.team2_levels || []).reduce((sum, l) => sum + l, 0);
                      allTeamScores.push(team1Score, team2Score);
                    });
                    
                    const avgScore = allTeamScores.reduce((a, b) => a + b, 0) / allTeamScores.length;
                    const maxScore = Math.max(...allTeamScores);
                    const minScore = Math.min(...allTeamScores);
                    const scoreDiff = maxScore - minScore;
                    const scoreDiffPercent = (scoreDiff / avgScore * 100).toFixed(1);

                    // 차이 2점 이상인 경기 찾기
                    const badMatches: number[] = [];
                    generatedMatches.forEach((match, idx) => {
                      const team1Score = (match.team1_levels || []).reduce((sum: number, l: number) => sum + l, 0);
                      const team2Score = (match.team2_levels || []).reduce((sum: number, l: number) => sum + l, 0);
                      const diff = Math.abs(team1Score - team2Score);
                      if (diff >= 2) {
                        badMatches.push(idx + 1);
                      }
                    });

                    return (
                      <div className="mb-3 rounded-lg border border-purple-300 bg-purple-50 p-2.5 text-xs text-purple-900 sm:mb-4 sm:p-3 sm:text-sm">
                        <div className="font-semibold mb-2">⚖️ 팀 점수 균등 배정 분석</div>
                        <div className="text-xs space-x-8">
                          {(() => {
                            // 점수 차이별 경기 개수 계산
                            const diffDistribution: Record<number, number> = {};
                            generatedMatches.forEach((match) => {
                              const team1Score = (match.team1_levels || []).reduce((sum: number, l: number) => sum + l, 0);
                              const team2Score = (match.team2_levels || []).reduce((sum: number, l: number) => sum + l, 0);
                              const diff = Math.abs(team1Score - team2Score);
                              diffDistribution[diff] = (diffDistribution[diff] || 0) + 1;
                            });

                            // 점수 분포를 색상별로 구분하여 표시
                            return Object.keys(diffDistribution)
                              .sort((a, b) => parseInt(a) - parseInt(b))
                              .map(diff => {
                                const count = diffDistribution[parseInt(diff)];
                                const diffNum = parseInt(diff);
                                let statusIcon = '';
                                let colorClass = '';
                                
                                if (diffNum === 0) {
                                  statusIcon = '✅';
                                  colorClass = 'text-green-600 font-semibold';
                                } else if (diffNum === 1) {
                                  statusIcon = '🟡';
                                  colorClass = 'text-yellow-600 font-semibold';
                                } else if (diffNum === 2) {
                                  statusIcon = '⚠️';
                                  colorClass = 'text-orange-600 font-semibold';
                                } else {
                                  statusIcon = '🔴';
                                  colorClass = 'text-red-600 font-semibold';
                                }
                                
                                return (
                                  <span key={diff} className={colorClass}>
                                    {statusIcon} {diff}점: {count}경기
                                  </span>
                                );
                              });
                          })()}
                        </div>
                      </div>
                    );
                  })()}

                <div className="space-y-6">
                  {(() => {
                    const playerGameCounts = getGeneratedPlayerGameCounts(generatedMatches);
                    const averageGameCount = Object.keys(playerGameCounts).length > 0
                      ? Object.values(playerGameCounts).reduce((sum, count) => sum + count, 0) / Object.keys(playerGameCounts).length
                      : 0;

                    if (viewType === 'card') {
                      const roundsMap = new Map<number, Match[]>();
                      generatedMatches.forEach((match) => {
                        const r = match.round || 1;
                        const current = roundsMap.get(r) || [];
                        current.push(match);
                        roundsMap.set(r, current);
                      });

                      const sortedRounds = Array.from(roundsMap.entries()).sort((a, b) => a[0] - b[0]);

                      return (
                        <div className="space-y-6">
                          {/* 배정된 선수당 경기수 요약 */}
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                            <h4 className="mb-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
                              선수별 배정 경기수
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(playerGameCounts)
                                .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
                                .map(([pName, count]) => (
                                  <span
                                    key={`game-count-${pName}`}
                                    className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${
                                      count === matchesPerPlayer
                                        ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20'
                                        : count > matchesPerPlayer
                                        ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
                                        : 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20'
                                    }`}
                                  >
                                    {pName}: {count}경기
                                  </span>
                                ))}
                            </div>
                          </div>

                          {sortedRounds.map(([roundNum, roundMatches]) => (
                            <div key={`round-group-${roundNum}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <h4 className="mb-3 text-sm font-bold text-slate-800 flex items-center gap-2">
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                  {roundNum}회차
                                </span>
                                <span>({roundMatches.length}경기)</span>
                              </h4>
                              
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                                {roundMatches.map((match) => {
                                  const team1Score = (match.team1_levels || []).reduce((sum, score) => sum + score, 0);
                                  const team2Score = (match.team2_levels || []).reduce((sum, score) => sum + score, 0);
                                  const scoreDifference = Math.abs(team1Score - team2Score);
                                  const differenceColor = 
                                    scoreDifference === 0 ? 'bg-green-100 text-green-800' :
                                    scoreDifference <= 1 ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-orange-100 text-orange-800';

                                  const matchIndexInGenerated = generatedMatches.findIndex((m) => m === match);

                                  return (
                                    <div key={`match-preview-${match.match_number}`} className="rounded-lg border border-slate-200 bg-white p-2 text-center shadow-sm relative group hover:shadow-md transition-shadow">
                                      <div className="mb-1 text-[10px] font-bold text-blue-900 border-b border-slate-200 pb-1 flex justify-between items-center px-1">
                                        <span>{match.court}</span>
                                        {match.scheduled_time && (
                                          <span className="text-emerald-700 bg-emerald-50 px-1 rounded text-[8px] font-medium">
                                            {formatScheduledTime(match.scheduled_time)}
                                          </span>
                                        )}
                                      </div>
                                      
                                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 mt-1.5">
                                        {/* 팀 1 */}
                                        <div className="rounded bg-slate-50 p-1 border border-slate-100 shadow-sm min-w-0 flex flex-col justify-center items-center gap-0.5 w-full">
                                          {isManualEditing ? (
                                            <div className="w-full flex flex-col gap-1">
                                              {match.team1.map((name, pIdx) => (
                                                <select
                                                  key={`team1-edit-${match.match_number}-${pIdx}`}
                                                  value={name}
                                                  onChange={(e) =>
                                                    handleManualPlayerChange(matchIndexInGenerated, 'team1', pIdx, e.target.value)
                                                  }
                                                  className="w-full rounded border border-blue-200 px-1 py-0.5 text-[10px] bg-white"
                                                >
                                                  {getManualPlayerOptions(match, name).map((player) => (
                                                    <option key={player} value={player}>
                                                      {getPlayerName(player)}
                                                    </option>
                                                  ))}
                                                </select>
                                              ))}
                                            </div>
                                          ) : (
                                            <>
                                              <div className="text-[11px] font-semibold text-slate-900 truncate w-full flex items-center justify-center gap-0.5" title={getPlayerName(match.team1[0])}>
                                                <span>{getPlayerName(match.team1[0])}</span>
                                                {renderTeamBadge(match.team1[0])}
                                              </div>
                                              {match.team1[1] && (
                                                <div className="text-[11px] font-semibold text-slate-900 truncate w-full flex items-center justify-center gap-0.5" title={getPlayerName(match.team1[1])}>
                                                  <span>{getPlayerName(match.team1[1])}</span>
                                                  {renderTeamBadge(match.team1[1])}
                                                </div>
                                              )}
                                            </>
                                          )}
                                          <div className="text-[9px] text-slate-400 border-t border-slate-100 mt-0.5 pt-0.5 w-full text-center">
                                            {team1Score.toFixed(0)}
                                          </div>
                                        </div>

                                        <div className="text-[9px] font-bold text-slate-400 px-0.5 flex flex-col items-center">
                                          <span>VS</span>
                                          <span className={`text-[8px] px-1 rounded mt-0.5 ${differenceColor}`} title="팀점수 차이">
                                            {scoreDifference}
                                          </span>
                                        </div>

                                        {/* 팀 2 */}
                                        <div className="rounded bg-slate-50 p-1 border border-slate-100 shadow-sm min-w-0 flex flex-col justify-center items-center gap-0.5 w-full">
                                          {isManualEditing ? (
                                            <div className="w-full flex flex-col gap-1">
                                              {match.team2.map((name, pIdx) => (
                                                <select
                                                  key={`team2-edit-${match.match_number}-${pIdx}`}
                                                  value={name}
                                                  onChange={(e) =>
                                                    handleManualPlayerChange(matchIndexInGenerated, 'team2', pIdx, e.target.value)
                                                  }
                                                  className="w-full rounded border border-red-200 px-1 py-0.5 text-[10px] bg-white"
                                                >
                                                  {getManualPlayerOptions(match, name).map((player) => (
                                                    <option key={player} value={player}>
                                                      {getPlayerName(player)}
                                                    </option>
                                                  ))}
                                                </select>
                                              ))}
                                            </div>
                                          ) : (
                                            <>
                                              <div className="text-[11px] font-semibold text-slate-900 truncate w-full flex items-center justify-center gap-0.5" title={getPlayerName(match.team2[0])}>
                                                <span>{getPlayerName(match.team2[0])}</span>
                                                {renderTeamBadge(match.team2[0])}
                                              </div>
                                              {match.team2[1] && (
                                                <div className="text-[11px] font-semibold text-slate-900 truncate w-full flex items-center justify-center gap-0.5" title={getPlayerName(match.team2[1])}>
                                                  <span>{getPlayerName(match.team2[1])}</span>
                                                  {renderTeamBadge(match.team2[1])}
                                                </div>
                                              )}
                                            </>
                                          )}
                                          <div className="text-[9px] text-slate-400 border-t border-slate-100 mt-0.5 pt-0.5 w-full text-center">
                                            {team2Score.toFixed(0)}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    const assignmentTeams = getTeamsFromAssignment(selectedAssignment);
                    const team1Label = assignmentTeams[0]?.name || '팀1';
                    const team2Label = assignmentTeams[1]?.name || '팀2';

                    // 테이블 보기 뷰 반환
                    return (
                      <div className="space-y-6">
                        {/* 배정된 선수당 경기수 요약 */}
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                          <h4 className="mb-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
                            선수별 배정 경기수
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(playerGameCounts)
                              .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
                              .map(([pName, count]) => (
                                <span
                                  key={`game-count-${pName}`}
                                  className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${
                                    count === matchesPerPlayer
                                      ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20'
                                      : count > matchesPerPlayer
                                      ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
                                      : 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20'
                                  }`}
                                >
                                  {pName}: {count}경기
                                </span>
                              ))}
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse border border-gray-300 bg-white text-sm">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">경기</th>
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">코트</th>
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">{team1Label}</th>
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">{team1Label} 점수</th>
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">{team2Label}</th>
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">{team2Label} 점수</th>
                                <th className="border border-gray-300 px-3 py-2 text-center font-semibold">차이</th>
                              </tr>
                            </thead>
                            <tbody>
                              {generatedMatches.map((match, idx) => {
                                const team1Score = (match.team1_levels || []).reduce((sum, l) => sum + l, 0);
                                const team2Score = (match.team2_levels || []).reduce((sum, l) => sum + l, 0);
                                const scoreDifference = Math.abs(team1Score - team2Score);
                                const differenceColor = 
                                  scoreDifference === 0 ? 'bg-green-100 text-green-800' :
                                  scoreDifference <= 1 ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-orange-100 text-orange-800';
                                return (
                                  <tr key={idx} className="hover:bg-blue-50">
                                    <td className="border border-gray-300 px-3 py-2 text-center font-medium">{match.match_number}</td>
                                    <td className="border border-gray-300 px-3 py-2 text-center text-xs">
                                      <div className="font-semibold">{match.court}</div>
                                      {match.scheduled_time && (
                                        <div className="text-[10px] text-emerald-600 font-bold mt-0.5">
                                          {formatScheduledTime(match.scheduled_time)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="border border-gray-300 px-3 py-2 text-left text-xs">
                                      {isManualEditing ? (
                                        <div className="grid gap-2">
                                          {match.team1.map((name, playerIndex) => (
                                            <select
                                              key={`team1-${idx}-${playerIndex}`}
                                              value={name}
                                              onChange={(event) =>
                                                handleManualPlayerChange(idx, 'team1', playerIndex, event.target.value)
                                              }
                                              className="w-full rounded border border-blue-200 px-2 py-1 text-xs"
                                            >
                                              {getManualPlayerOptions(match, name).map((player) => (
                                                <option key={player} value={player}>
                                                  {getPlayerName(player)} ({getPlayerGenderLabel(player)}/{extractLevelFromName(player).toUpperCase()}) {getPlayerScore(player)}점
                                                </option>
                                              ))}
                                            </select>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="space-y-1 font-medium text-blue-700">
                                          {match.team1.map((name) => {
                                            const playerName = getPlayerName(name);
                                            const level = extractLevelFromName(name);
                                            const gameCount = playerGameCounts[playerName] || 0;
                                            const isOverAverage = gameCount > averageGameCount;
                                            const genderLabel = getPlayerGenderLabel(name);

                                            return (
                                              <div key={`team1-display-${idx}-${name}`} className="flex flex-wrap items-center gap-1">
                                                <span>{playerName}({genderLabel}/{level.toUpperCase()})</span>
                                                {renderTeamBadge(name)}
                                                <span className={`font-bold ${isOverAverage ? 'text-red-600 text-sm' : 'text-blue-500'}`}>
                                                  [{gameCount}]
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </td>
                                    <td className="border border-gray-300 px-3 py-2 text-center text-xs">
                                      <span className="inline-block px-2 py-1 bg-blue-100 rounded font-semibold text-blue-800">{team1Score}</span>
                                    </td>
                                    <td className="border border-gray-300 px-3 py-2 text-left text-xs">
                                      {isManualEditing ? (
                                        <div className="grid gap-2">
                                          {match.team2.map((name, playerIndex) => (
                                            <select
                                              key={`team2-${idx}-${playerIndex}`}
                                              value={name}
                                              onChange={(event) =>
                                                handleManualPlayerChange(idx, 'team2', playerIndex, event.target.value)
                                              }
                                              className="w-full rounded border border-red-200 px-2 py-1 text-xs"
                                            >
                                              {getManualPlayerOptions(match, name).map((player) => (
                                                <option key={player} value={player}>
                                                  {getPlayerName(player)} ({getPlayerGenderLabel(player)}/{extractLevelFromName(player).toUpperCase()}) {getPlayerScore(player)}점
                                                </option>
                                              ))}
                                            </select>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="space-y-1 font-medium text-purple-700">
                                          {match.team2.map((name) => {
                                            const playerName = getPlayerName(name);
                                            const level = extractLevelFromName(name);
                                            const gameCount = playerGameCounts[playerName] || 0;
                                            const isOverAverage = gameCount > averageGameCount;
                                            const genderLabel = getPlayerGenderLabel(name);

                                            return (
                                              <div key={`team2-display-${idx}-${name}`} className="flex flex-wrap items-center gap-1">
                                                <span>{playerName}({genderLabel}/{level.toUpperCase()})</span>
                                                {renderTeamBadge(name)}
                                                <span className={`font-bold ${isOverAverage ? 'text-red-600 text-sm' : 'text-purple-400'}`}>
                                                  [{gameCount}]
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </td>
                                    <td className="border border-gray-300 px-3 py-2 text-center text-xs">
                                      <span className="inline-block px-2 py-1 bg-red-100 rounded font-semibold text-red-800">{team2Score}</span>
                                    </td>
                                    <td className="border border-gray-300 px-3 py-2 text-center text-xs">
                                      <span className={`inline-block px-2 py-1 rounded font-semibold ${differenceColor}`}>
                                        {scoreDifference}점
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </>
                )}
              </div>

            </div>
        </div>
      )}

      {/* 생성된 대회 목록 */}
      <div className="rounded-lg bg-white p-3 shadow-md sm:p-6">
        <h2 className="mb-3 text-base font-semibold sm:mb-4 sm:text-xl">📊 생성된 게임</h2>
        
        {standardTournaments.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-5xl mb-4">🏆</div>
            <p>아직 생성된 게임이 없습니다.</p>
            <p className="text-sm mt-2">위에서 팀 구성을 선택하여 게임을 생성하세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {standardTournaments.map((tournament) => (
              <div
                key={tournament.id}
                className="flex flex-col justify-between rounded-lg border border-gray-200 p-3 transition-shadow hover:shadow-md sm:p-4"
              >
                <div>
                  <h3 className="text-base font-semibold text-gray-900 sm:text-lg">{tournament.title}</h3>
                  <div className="mt-1 space-y-1 text-xs text-gray-600 sm:text-sm">
                    <div>📅 {formatKSTDate(tournament.created_at)}</div>
                    <div>👥 {tournament.total_teams}팀 참가</div>
                    <div>🎯 {tournament.team_type}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => openTournamentAssignmentModal(tournament)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                  >
                    배정현황
                  </button>
                  <button
                    onClick={() => handleManageMatches(tournament)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                  >
                    경기 관리
                  </button>
                  <button
                    onClick={() => deleteTournament(tournament.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors text-center"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {teamParticipantsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-2 sm:p-4">
          <div className="max-h-[95vh] w-full max-w-3xl overflow-hidden rounded-[16px] sm:rounded-[24px] bg-white shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 sm:px-5 sm:py-4">
              <div>
                <h3 className="text-sm sm:text-lg font-bold text-slate-900">{teamParticipantsModal.title}</h3>
                {teamParticipantsModal.subtitle && (
                  <p className="mt-0.5 text-xs sm:text-sm text-slate-500">{teamParticipantsModal.subtitle}</p>
                )}
              </div>
              <button
                onClick={() => setTeamParticipantsModal(null)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs sm:rounded-lg sm:px-3 sm:py-1.5 sm:text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 shrink-0"
              >
                닫기
              </button>
            </div>

            <div className="max-h-[calc(95vh-70px)] overflow-y-auto p-3 sm:p-5">
              {teamParticipantsModal.teams.length === 0 ? (
                <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-5 text-sm text-yellow-800">
                  표시할 배정 팀 정보가 없습니다.
                </div>
              ) : (
                <div className={`grid gap-1.5 sm:gap-4 ${
                  teamParticipantsModal.teams.length === 2 
                    ? 'grid-cols-2' 
                    : teamParticipantsModal.teams.length === 3 
                    ? 'grid-cols-3' 
                    : teamParticipantsModal.teams.length === 4 
                    ? 'grid-cols-2 md:grid-cols-4' 
                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
                }`}>
                  {teamParticipantsModal.teams.map((team) => (
                    <div key={team.name} className="rounded-xl border border-slate-200 bg-slate-50 p-1.5 sm:p-4">
                      <div className="mb-1.5 sm:mb-3 flex items-center justify-between gap-1">
                        <div className="text-xs sm:text-base font-bold text-slate-900 truncate">{team.name}</div>
                        <div className="rounded bg-white px-1 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-xs font-medium text-slate-500 shrink-0">
                          {team.players.length}명
                        </div>
                      </div>
                      <div className="space-y-1 sm:space-y-2">
                        {team.players.map((player) => (
                          <div
                            key={`${team.name}-${player}`}
                            className="rounded-lg bg-white px-1.5 py-1 text-xs sm:px-3 sm:py-2 sm:text-sm text-slate-800 shadow-sm text-center font-medium truncate"
                          >
                            {player}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tournamentMatchesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-[24px] bg-white shadow-2xl p-6">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white pb-4 mb-4 z-10">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{tournamentMatchesModal.title}</h3>
                {tournamentMatchesModal.subtitle && (
                  <p className="mt-1 text-sm text-slate-500">{tournamentMatchesModal.subtitle}</p>
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
                  if (tournamentMatchesModal.teamType === 'pairs') {
                    const grouped = new Map<string, Match[]>();
                    tournamentMatchesModal.matches.forEach((match) => {
                      const matchLabel = match.court.trim().match(/^\[(.+?)\]\s*Court\s*(.+)$/i);
                      const groupName = matchLabel?.[1]?.trim() || '일반';
                      const current = grouped.get(groupName) || [];
                      current.push(match);
                      grouped.set(groupName, current);
                    });
                    return Array.from(grouped.entries()).map(([groupName, groupedMatches]) => (
                      <div key={groupName} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <h4 className="mb-3 text-base font-semibold text-slate-900">{groupName} ({groupedMatches.length}경기)</h4>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                          {groupedMatches.map((match) => {
                            const team1Score = (match.team1_levels && match.team1_levels.length > 0)
                              ? match.team1_levels.reduce((sum, score) => sum + score, 0)
                              : match.team1.reduce((sum, p) => sum + getPlayerScore(p), 0);
                            const team2Score = (match.team2_levels && match.team2_levels.length > 0)
                              ? match.team2_levels.reduce((sum, score) => sum + score, 0)
                              : match.team2.reduce((sum, p) => sum + getPlayerScore(p), 0);
                            const hasResult = match.score_team1 != null && match.score_team2 != null;

                            return (
                              <div key={match.id || `match-${match.match_number}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                                <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                                  <span>라운드 {match.round}</span>
                                  <span>{match.court}</span>
                                  <span>경기 #{match.match_number}</span>
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center w-full">
                                  <div className={`rounded-lg p-2.5 flex items-center justify-between text-left ${
                                    hasResult && match.winner === 'team1' ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'
                                  }`}>
                                    <div className="flex flex-col items-start gap-1 w-full">
                                      {match.team1.map(p => (
                                        <div key={p} className="inline-flex items-center">
                                          <span className="text-sm font-semibold text-slate-900">{getPlayerName(p)}</span>
                                          {renderTeamBadgeForAssignment(p, tournamentMatchesModal.selectedTeamAssignment)}
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-center justify-center min-w-[2.5rem] px-2 py-1 bg-slate-100 rounded-lg shadow-inner">
                                    {hasResult ? (
                                      <div className="flex flex-col items-center font-bold text-sm leading-none gap-1">
                                        <span className="text-blue-600">{match.score_team1}</span>
                                        <span className="text-[9px] text-slate-400 font-semibold">VS</span>
                                        <span className="text-red-600">{match.score_team2}</span>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center font-bold text-sm leading-none gap-1">
                                        <span className="text-blue-600">{team1Score.toFixed(0)}</span>
                                        <span className="text-[9px] text-slate-400 font-semibold">VS</span>
                                        <span className="text-red-600">{team2Score.toFixed(0)}</span>
                                      </div>
                                    )}
                                  </div>
                                  
                                  <div className={`rounded-lg p-2.5 flex items-center justify-between text-right flex-row-reverse ${
                                    hasResult && match.winner === 'team2' ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'
                                  }`}>
                                    <div className="flex flex-col items-end gap-1 w-full">
                                      {match.team2.map(p => (
                                        <div key={p} className="inline-flex items-center flex-row-reverse">
                                          <span className="text-sm font-semibold text-slate-900">{getPlayerName(p)}</span>
                                          {renderTeamBadgeForAssignment(p, tournamentMatchesModal.selectedTeamAssignment)}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                                {hasResult && (
                                  <div className="mt-2 text-center text-xs font-semibold text-emerald-600 bg-emerald-50 py-1 rounded">
                                    경기 종료 (우승: {match.winner === 'team1' ? '팀1' : match.winner === 'team2' ? '팀2' : '무승부'})
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  } else {
                    const grouped = new Map<number, Match[]>();
                    tournamentMatchesModal.matches.forEach((match) => {
                      const round = match.round || 1;
                      const current = grouped.get(round) || [];
                      current.push(match);
                      grouped.set(round, current);
                    });
                    return Array.from(grouped.entries())
                      .sort(([r1], [r2]) => r1 - r2)
                      .map(([round, groupedMatches]) => (
                        <div key={`modal-round-${round}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <h4 className="mb-3 text-base font-semibold text-slate-900">라운드 {round} ({groupedMatches.length}경기)</h4>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {groupedMatches.map((match) => {
                              const hasResult = match.score_team1 != null && match.score_team2 != null;

                              return (
                                <div key={match.id || `match-${match.match_number}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                                  <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                                    <span>{match.court}</span>
                                    <span>경기 #{match.match_number}</span>
                                  </div>
                                  <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center w-full">
                                    {(() => {
                                      const team1Score = (match.team1_levels && match.team1_levels.length > 0)
                                        ? match.team1_levels.reduce((sum, score) => sum + score, 0)
                                        : match.team1.reduce((sum, p) => sum + getPlayerScore(p), 0);
                                      const team2Score = (match.team2_levels && match.team2_levels.length > 0)
                                        ? match.team2_levels.reduce((sum, score) => sum + score, 0)
                                        : match.team2.reduce((sum, p) => sum + getPlayerScore(p), 0);

                                      return (
                                        <>
                                          <div className={`rounded-lg p-2.5 flex items-center justify-between text-left ${
                                            hasResult && match.winner === 'team1' ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'
                                          }`}>
                                            <div className="flex flex-col items-start gap-1 w-full">
                                              {match.team1.map(p => (
                                                <div key={p} className="inline-flex items-center">
                                                  <span className="text-sm font-semibold text-slate-900">{getPlayerName(p)}</span>
                                                  {renderTeamBadgeForAssignment(p, tournamentMatchesModal.selectedTeamAssignment)}
                                                </div>
                                              ))}
                                            </div>
                                          </div>

                                          <div className="flex flex-col items-center justify-center min-w-[2.5rem] px-2 py-1 bg-slate-100 rounded-lg shadow-inner">
                                            {hasResult ? (
                                              <div className="flex flex-col items-center font-bold text-sm leading-none gap-1">
                                                <span className="text-blue-600">{match.score_team1}</span>
                                                <span className="text-[9px] text-slate-400 font-semibold">VS</span>
                                                <span className="text-red-600">{match.score_team2}</span>
                                              </div>
                                            ) : (
                                              <div className="flex flex-col items-center font-bold text-sm leading-none gap-1">
                                                <span className="text-blue-600">{team1Score.toFixed(0)}</span>
                                                <span className="text-[9px] text-slate-400 font-semibold">VS</span>
                                                <span className="text-red-600">{team2Score.toFixed(0)}</span>
                                              </div>
                                            )}
                                          </div>
                                          
                                          <div className={`rounded-lg p-2.5 flex items-center justify-between text-right flex-row-reverse ${
                                            hasResult && match.winner === 'team2' ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'
                                          }`}>
                                            <div className="flex flex-col items-end gap-1 w-full">
                                              {match.team2.map(p => (
                                                <div key={p} className="inline-flex items-center flex-row-reverse">
                                                  <span className="text-sm font-semibold text-slate-900">{getPlayerName(p)}</span>
                                                  {renderTeamBadgeForAssignment(p, tournamentMatchesModal.selectedTeamAssignment)}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                  {hasResult && (
                                    <div className="mt-2 text-center text-xs font-semibold text-emerald-600 bg-emerald-50 py-1 rounded">
                                      경기 종료 (우승: {match.winner === 'team1' ? '팀1' : match.winner === 'team2' ? '팀2' : '무승부'})
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ));
                  }
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 안내 */}
      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:mt-8 sm:p-6">
        <h3 className="mb-2 text-sm font-semibold text-blue-900 sm:text-base">💡 사용 방법</h3>
        <ul className="space-y-1 text-xs text-blue-800 sm:text-sm">
          <li>1. 팀 관리 메뉴에서 팀을 구성합니다</li>
          <li>2. 위 목록에서 원하는 팀 구성을 선택하고 "게임 생성" 버튼을 클릭합니다</li>
          <li>3. 생성될 경기를 미리보기로 확인한 후 게임을 생성합니다</li>
          <li>4. 생성된 게임의 "경기 관리" 버튼을 클릭하면 대진표 페이지로 이동합니다</li>
          <li>5. 대진표에서 경기 결과를 입력하고 관리할 수 있습니다</li>
        </ul>
      </div>
    </div>
  );
}
