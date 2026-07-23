import type { Match, Player, Team } from '@/types';
import { getTeamScore, reorderMatchesToAvoidConsecutive, shuffle } from './match-helpers';

export type TeamLockedPlayerGroup = {
  name: string;
  players: Player[];
};

export type TeamLockedGenerationMode = 'level_based' | 'random' | 'mixed_doubles';

export type TeamLockedGenerationOptions = {
  maxScoreDiff?: number;
  avoidRepeatPlayerIds?: string[];
};

type PairCandidate = {
  team: Team;
  coveredDeficit: number;
  totalAppearances: number;
  maxAppearances: number;
  mixed: boolean;
  partnerRepeats: number;
};

type PairMatchCandidate = {
  left: PairCandidate;
  right: PairCandidate;
  coveredDeficit: number;
  maxAppearances: number;
  totalAppearances: number;
  mixedTeams: number;
  partnerRepeats: number;
  scoreDiff: number;
  randomOrder: number;
};

type ScheduleCandidate = {
  matches: Match[];
  appearances: Record<string, number>;
  partnerCounts: Record<string, number>;
};

type ScheduleQuality = {
  extraAppearances: number;
  maxAppearances: number;
  mixedTeams: number;
  maxScoreDiff: number;
  squaredScoreDiff: number;
  totalScoreDiff: number;
  repeatedPartners: number;
};

const normalizeGender = (gender?: string) => String(gender || '').trim().toUpperCase();
const isMale = (player: Player) => ['M', 'MALE', 'MAN', '남', '남성'].includes(normalizeGender(player.gender));
const isFemale = (player: Player) => ['F', 'FEMALE', 'WOMAN', 'W', '여', '여성'].includes(normalizeGender(player.gender));
const isMixedTeam = (team: Team) =>
  (isMale(team.player1) && isFemale(team.player2)) ||
  (isFemale(team.player1) && isMale(team.player2));

const getPairKey = (player1: Player, player2: Player) =>
  [player1.id, player2.id].sort((left, right) => left.localeCompare(right)).join('::');

function getGroupDeficit(
  group: TeamLockedPlayerGroup,
  appearances: Record<string, number>,
  targetGames: number
) {
  return group.players.reduce(
    (sum, player) => sum + Math.max(0, targetGames - (appearances[player.id] || 0)),
    0
  );
}

function buildPairCandidates(
  group: TeamLockedPlayerGroup,
  appearances: Record<string, number>,
  partnerCounts: Record<string, number>,
  targetGames: number
): PairCandidate[] {
  const candidates: PairCandidate[] = [];

  for (let firstIndex = 0; firstIndex < group.players.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < group.players.length; secondIndex += 1) {
      const player1 = group.players[firstIndex];
      const player2 = group.players[secondIndex];
      if (player1.id === player2.id) continue;

      const player1Appearances = appearances[player1.id] || 0;
      const player2Appearances = appearances[player2.id] || 0;
      const team: Team = { player1, player2 };

      candidates.push({
        team,
        coveredDeficit:
          Number(player1Appearances < targetGames) + Number(player2Appearances < targetGames),
        totalAppearances: player1Appearances + player2Appearances,
        maxAppearances: Math.max(player1Appearances, player2Appearances),
        mixed: isMixedTeam(team),
        partnerRepeats: partnerCounts[getPairKey(player1, player2)] || 0,
      });
    }
  }

  return candidates;
}

function choosePairMatch(
  leftGroup: TeamLockedPlayerGroup,
  rightGroup: TeamLockedPlayerGroup,
  appearances: Record<string, number>,
  partnerCounts: Record<string, number>,
  targetGames: number,
  mode: TeamLockedGenerationMode,
  explore: boolean
): { left: PairCandidate; right: PairCandidate } | null {
  const leftCandidates = buildPairCandidates(leftGroup, appearances, partnerCounts, targetGames);
  const rightCandidates = buildPairCandidates(rightGroup, appearances, partnerCounts, targetGames);
  const combinations: PairMatchCandidate[] = [];

  leftCandidates.forEach((left) => {
    rightCandidates.forEach((right) => {
      const playerIds = [
        left.team.player1.id,
        left.team.player2.id,
        right.team.player1.id,
        right.team.player2.id,
      ];
      if (new Set(playerIds).size !== 4) return;

      combinations.push({
        left,
        right,
        coveredDeficit: left.coveredDeficit + right.coveredDeficit,
        maxAppearances: Math.max(left.maxAppearances, right.maxAppearances),
        totalAppearances: left.totalAppearances + right.totalAppearances,
        mixedTeams: Number(left.mixed) + Number(right.mixed),
        partnerRepeats: left.partnerRepeats + right.partnerRepeats,
        scoreDiff: Math.abs(getTeamScore(left.team) - getTeamScore(right.team)),
        randomOrder: Math.random(),
      });
    });
  });

  combinations.sort((left, right) =>
    right.coveredDeficit - left.coveredDeficit ||
    left.maxAppearances - right.maxAppearances ||
    left.totalAppearances - right.totalAppearances ||
    (mode === 'mixed_doubles' ? right.mixedTeams - left.mixedTeams : 0) ||
    left.scoreDiff - right.scoreDiff ||
    left.partnerRepeats - right.partnerRepeats ||
    left.randomOrder - right.randomOrder
  );

  const hardBest = combinations[0];
  if (!hardBest) return null;

  const eligible = combinations
    .filter((candidate) =>
      candidate.coveredDeficit === hardBest.coveredDeficit &&
      candidate.maxAppearances === hardBest.maxAppearances &&
      candidate.totalAppearances === hardBest.totalAppearances &&
      (mode !== 'mixed_doubles' || candidate.mixedTeams === hardBest.mixedTeams)
    )
    .sort((left, right) =>
      left.scoreDiff - right.scoreDiff ||
      left.partnerRepeats - right.partnerRepeats ||
      left.randomOrder - right.randomOrder
    );

  // 첫 시도는 탐욕 최적값을 사용하고, 이후 시도는 상위 후보를 탐색하여
  // 마지막 경기에 큰 점수 차이가 몰리는 현상을 피한다.
  const pool = eligible.slice(0, Math.min(24, eligible.length));
  const selectedIndex = explore && pool.length > 1
    ? Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 2) * pool.length))
    : 0;
  const selected = pool[selectedIndex];

  return selected ? { left: selected.left, right: selected.right } : null;
}

function createAppearanceQuotas(players: Player[], totalSlots: number, targetGames: number) {
  const quotas: Record<string, number> = Object.fromEntries(
    players.map((player) => [player.id, targetGames])
  );
  let extraSlots = totalSlots - players.length * targetGames;

  while (extraSlots > 0) {
    const minimumQuota = Math.min(...players.map((player) => quotas[player.id]));
    const candidates = players.filter((player) => quotas[player.id] === minimumQuota);
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    quotas[selected.id] += 1;
    extraSlots -= 1;
  }

  return quotas;
}

function pairCopiesWithoutSamePlayer(copies: Player[]): Team[] | null {
  if (copies.length % 2 !== 0) return null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const remaining = shuffle(copies);
    const pairs: Team[] = [];
    let failed = false;

    while (remaining.length >= 2) {
      const player1 = remaining.shift()!;
      const partnerIndexes = remaining
        .map((player, index) => ({ player, index }))
        .filter(({ player }) => player.id !== player1.id)
        .map(({ index }) => index);

      if (partnerIndexes.length === 0) {
        failed = true;
        break;
      }

      const partnerIndex = partnerIndexes[Math.floor(Math.random() * partnerIndexes.length)];
      const [player2] = remaining.splice(partnerIndex, 1);
      pairs.push({ player1, player2 });
    }

    if (!failed && pairs.length * 2 === copies.length) return pairs;
  }

  return null;
}

function buildPairsFromQuotas(
  players: Player[],
  quotas: Record<string, number>,
  mode: TeamLockedGenerationMode
): Team[] | null {
  const copies = players.flatMap((player) =>
    Array.from({ length: quotas[player.id] || 0 }, () => player)
  );

  if (mode !== 'mixed_doubles') {
    return pairCopiesWithoutSamePlayer(copies);
  }

  const maleCopies = shuffle(copies.filter(isMale));
  const femaleCopies = shuffle(copies.filter(isFemale));
  const unknownCopies = shuffle(copies.filter((player) => !isMale(player) && !isFemale(player)));
  const mixedPairs: Team[] = [];

  while (maleCopies.length > 0 && femaleCopies.length > 0) {
    mixedPairs.push({ player1: maleCopies.shift()!, player2: femaleCopies.shift()! });
  }

  const remainingPairs = pairCopiesWithoutSamePlayer([
    ...maleCopies,
    ...femaleCopies,
    ...unknownCopies,
  ]);
  if (!remainingPairs) return null;

  return [...mixedPairs, ...remainingPairs];
}

type PairAssignmentState = {
  maxScoreDiff: number;
  squaredScoreDiff: number;
  totalScoreDiff: number;
  opponentIndexes: number[];
};

function comparePairAssignment(left: PairAssignmentState, right: PairAssignmentState) {
  return (
    left.maxScoreDiff - right.maxScoreDiff ||
    left.squaredScoreDiff - right.squaredScoreDiff ||
    left.totalScoreDiff - right.totalScoreDiff
  );
}

function matchPairListsGlobally(leftPairs: Team[], rightPairs: Team[]): Array<{ team1: Team; team2: Team }> | null {
  if (leftPairs.length !== rightPairs.length || leftPairs.length === 0) return null;
  const pairCount = leftPairs.length;

  if (pairCount > 15) {
    const remaining = [...rightPairs];
    return leftPairs.map((team1) => {
      remaining.sort((left, right) =>
        Math.abs(getTeamScore(team1) - getTeamScore(left)) -
        Math.abs(getTeamScore(team1) - getTeamScore(right))
      );
      return { team1, team2: remaining.shift()! };
    });
  }

  let states = new Map<number, PairAssignmentState>();
  states.set(0, { maxScoreDiff: 0, squaredScoreDiff: 0, totalScoreDiff: 0, opponentIndexes: [] });

  for (let leftIndex = 0; leftIndex < pairCount; leftIndex += 1) {
    const nextStates = new Map<number, PairAssignmentState>();

    states.forEach((state, mask) => {
      for (let rightIndex = 0; rightIndex < pairCount; rightIndex += 1) {
        if ((mask & (1 << rightIndex)) !== 0) continue;

        const scoreDiff = Math.abs(
          getTeamScore(leftPairs[leftIndex]) - getTeamScore(rightPairs[rightIndex])
        );
        const nextMask = mask | (1 << rightIndex);
        const candidate: PairAssignmentState = {
          maxScoreDiff: Math.max(state.maxScoreDiff, scoreDiff),
          squaredScoreDiff: state.squaredScoreDiff + scoreDiff * scoreDiff,
          totalScoreDiff: state.totalScoreDiff + scoreDiff,
          opponentIndexes: [...state.opponentIndexes, rightIndex],
        };
        const current = nextStates.get(nextMask);

        if (!current || comparePairAssignment(candidate, current) < 0 ||
          (comparePairAssignment(candidate, current) === 0 && Math.random() < 0.35)) {
          nextStates.set(nextMask, candidate);
        }
      }
    });

    states = nextStates;
  }

  const finalState = states.get((1 << pairCount) - 1);
  if (!finalState) return null;

  return leftPairs.map((team1, index) => ({
    team1,
    team2: rightPairs[finalState.opponentIndexes[index]],
  }));
}

function generateTwoGroupScheduleCandidate(
  groups: [TeamLockedPlayerGroup, TeamLockedPlayerGroup],
  allPlayers: Player[],
  targetGames: number,
  mode: TeamLockedGenerationMode,
  matchCount: number,
  requiredMaxScoreDiff?: number
): ScheduleCandidate | null {
  const slotsPerGroup = matchCount * 2;
  const leftQuotas = createAppearanceQuotas(groups[0].players, slotsPerGroup, targetGames);
  const rightQuotas = createAppearanceQuotas(groups[1].players, slotsPerGroup, targetGames);
  if (requiredMaxScoreDiff !== undefined) {
    const getQuotaTotalScore = (players: Player[], quotas: Record<string, number>) =>
      players.reduce(
        (sum, player) => sum + Number(player.score || 0) * (quotas[player.id] || 0),
        0
      );
    const totalScoreDifference = Math.abs(
      getQuotaTotalScore(groups[0].players, leftQuotas) -
      getQuotaTotalScore(groups[1].players, rightQuotas)
    );

    // 모든 경기 점수 차이가 기준 이하라면 두 팀의 전체 출전 점수 합도
    // 반드시 (경기 수 × 기준 점수) 이하여야 한다.
    if (totalScoreDifference > matchCount * requiredMaxScoreDiff) return null;
  }
  const leftPairs = buildPairsFromQuotas(groups[0].players, leftQuotas, mode);
  const rightPairs = buildPairsFromQuotas(groups[1].players, rightQuotas, mode);
  if (!leftPairs || !rightPairs) return null;

  const pairedMatches = matchPairListsGlobally(leftPairs, rightPairs);
  if (!pairedMatches) return null;

  const appearances: Record<string, number> = Object.fromEntries(allPlayers.map((player) => [player.id, 0]));
  const partnerCounts: Record<string, number> = {};
  const matches: Match[] = pairedMatches.map(({ team1, team2 }, index) => {
    [team1.player1, team1.player2, team2.player1, team2.player2].forEach((player) => {
      appearances[player.id] = (appearances[player.id] || 0) + 1;
    });
    [team1, team2].forEach((team) => {
      const key = getPairKey(team.player1, team.player2);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    });

    return {
      id: `match-team-locked-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      team1,
      team2,
    };
  });

  return { matches, appearances, partnerCounts };
}

function generateScheduleCandidate(
  groups: TeamLockedPlayerGroup[],
  allPlayers: Player[],
  targetGames: number,
  mode: TeamLockedGenerationMode,
  explore: boolean,
  twoGroupMatchCount?: number,
  requiredMaxScoreDiff?: number
): ScheduleCandidate | null {
  if (groups.length === 2) {
    return generateTwoGroupScheduleCandidate(
      [groups[0], groups[1]],
      allPlayers,
      targetGames,
      mode,
      twoGroupMatchCount ?? Math.max(
        Math.ceil((groups[0].players.length * targetGames) / 2),
        Math.ceil((groups[1].players.length * targetGames) / 2)
      ),
      requiredMaxScoreDiff
    );
  }

  const appearances: Record<string, number> = Object.fromEntries(allPlayers.map((player) => [player.id, 0]));
  const partnerCounts: Record<string, number> = {};
  const groupIndex = new Map(groups.map((group, index) => [group.name, index]));
  const matches: Match[] = [];
  const maximumMatches = allPlayers.length * targetGames + groups.length * 4;

  while (matches.length < maximumMatches) {
    const rankedGroups = groups
      .map((group) => ({
        group,
        deficit: getGroupDeficit(group, appearances, targetGames),
        averageAppearances:
          group.players.reduce((sum, player) => sum + (appearances[player.id] || 0), 0) / group.players.length,
        randomOrder: Math.random(),
      }))
      .sort((left, right) =>
        right.deficit - left.deficit ||
        left.averageAppearances - right.averageAppearances ||
        (explore ? left.randomOrder - right.randomOrder : 0)
      );

    const leftInfo = rankedGroups.find((entry) => entry.deficit > 0);
    if (!leftInfo) break;

    const rightInfo = rankedGroups
      .filter((entry) => entry.group.name !== leftInfo.group.name)
      .sort((left, right) =>
        right.deficit - left.deficit ||
        left.averageAppearances - right.averageAppearances ||
        (explore ? left.randomOrder - right.randomOrder : 0)
      )[0];
    if (!rightInfo) return null;

    const selection = choosePairMatch(
      leftInfo.group,
      rightInfo.group,
      appearances,
      partnerCounts,
      targetGames,
      mode,
      explore
    );
    if (!selection || selection.left.coveredDeficit + selection.right.coveredDeficit === 0) return null;

    const leftIndex = groupIndex.get(leftInfo.group.name) || 0;
    const rightIndex = groupIndex.get(rightInfo.group.name) || 0;
    const team1 = leftIndex <= rightIndex ? selection.left.team : selection.right.team;
    const team2 = leftIndex <= rightIndex ? selection.right.team : selection.left.team;

    matches.push({
      id: `match-team-locked-${Date.now()}-${matches.length}-${Math.random().toString(36).slice(2, 7)}`,
      team1,
      team2,
    });

    [team1.player1, team1.player2, team2.player1, team2.player2].forEach((player) => {
      appearances[player.id] = (appearances[player.id] || 0) + 1;
    });
    [team1, team2].forEach((team) => {
      const key = getPairKey(team.player1, team.player2);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    });
  }

  if (allPlayers.some((player) => (appearances[player.id] || 0) < targetGames)) return null;
  return { matches, appearances, partnerCounts };
}

function getScheduleQuality(
  candidate: ScheduleCandidate,
  allPlayers: Player[],
  targetGames: number
): ScheduleQuality {
  const scoreDiffs = candidate.matches.map((match) =>
    Math.abs(getTeamScore(match.team1) - getTeamScore(match.team2))
  );
  const appearanceValues = allPlayers.map((player) => candidate.appearances[player.id] || 0);

  return {
    extraAppearances: appearanceValues.reduce((sum, count) => sum + Math.max(0, count - targetGames), 0),
    maxAppearances: Math.max(...appearanceValues),
    mixedTeams: candidate.matches.reduce(
      (sum, match) => sum + Number(isMixedTeam(match.team1)) + Number(isMixedTeam(match.team2)),
      0
    ),
    maxScoreDiff: Math.max(...scoreDiffs),
    squaredScoreDiff: scoreDiffs.reduce((sum, diff) => sum + diff * diff, 0),
    totalScoreDiff: scoreDiffs.reduce((sum, diff) => sum + diff, 0),
    repeatedPartners: Object.values(candidate.partnerCounts).reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0
    ),
  };
}

function compareScheduleQuality(
  left: ScheduleQuality,
  right: ScheduleQuality,
  mode: TeamLockedGenerationMode
) {
  return (
    left.extraAppearances - right.extraAppearances ||
    left.maxAppearances - right.maxAppearances ||
    (mode === 'mixed_doubles' ? right.mixedTeams - left.mixedTeams : 0) ||
    left.maxScoreDiff - right.maxScoreDiff ||
    left.squaredScoreDiff - right.squaredScoreDiff ||
    left.totalScoreDiff - right.totalScoreDiff ||
    left.repeatedPartners - right.repeatedPartners
  );
}

export function createTeamLockedDoublesMatches(
  groupsInput: TeamLockedPlayerGroup[],
  minGamesPerPlayer = 1,
  mode: TeamLockedGenerationMode = 'random',
  options: TeamLockedGenerationOptions = {}
): Match[] {
  const groups = groupsInput
    .map((group) => ({
      ...group,
      players: Array.from(new Map(group.players.map((player) => [player.id, player])).values()),
    }))
    .filter((group) => group.players.length >= 2);

  if (groups.length < 2) return [];

  const targetGames = Math.max(1, Math.floor(minGamesPerPlayer || 1));
  const allPlayers = Array.from(new Map(groups.flatMap((group) => group.players).map((player) => [player.id, player])).values());
  const maxAllowedScoreDiff = Math.max(0, options.maxScoreDiff ?? 9);
  const avoidedRepeatPlayerIds = new Set(options.avoidRepeatPlayerIds || []);
  let bestCandidate: ScheduleCandidate | null = null;
  let bestQuality: ScheduleQuality | null = null;
  let bestRepeatOverlap = Number.POSITIVE_INFINITY;
  let fallbackCandidate: ScheduleCandidate | null = null;
  let fallbackQuality: ScheduleQuality | null = null;
  let fallbackRepeatOverlap = Number.POSITIVE_INFINITY;

  const getRepeatOverlap = (candidate: ScheduleCandidate) => allPlayers.reduce(
    (count, player) => count + Number(
      (candidate.appearances[player.id] || 0) > targetGames &&
      avoidedRepeatPlayerIds.has(player.id)
    ),
    0
  );

  const considerCandidate = (
    candidate: ScheduleCandidate,
    currentBest: {
      candidate: ScheduleCandidate | null;
      quality: ScheduleQuality | null;
      repeatOverlap: number;
      unchangedRepeatSet: boolean;
    }
  ) => {
    const quality = getScheduleQuality(candidate, allPlayers, targetGames);
    const repeatOverlap = getRepeatOverlap(candidate);
    const repeatPlayerCount = allPlayers.filter(
      (player) => (candidate.appearances[player.id] || 0) > targetGames
    ).length;
    const unchangedRepeatSet = avoidedRepeatPlayerIds.size > 0 &&
      repeatPlayerCount === avoidedRepeatPlayerIds.size &&
      repeatOverlap === avoidedRepeatPlayerIds.size;
    const validComparison = currentBest.quality
      ? Number(unchangedRepeatSet) - Number(currentBest.unchangedRepeatSet) ||
        compareScheduleQuality(quality, currentBest.quality, mode) ||
        repeatOverlap - currentBest.repeatOverlap
      : -1;

    if (
      quality.maxScoreDiff <= maxAllowedScoreDiff &&
      (!currentBest.candidate || !currentBest.quality || validComparison < 0 ||
        (validComparison === 0 && Math.random() < 0.35))
    ) {
      currentBest.candidate = candidate;
      currentBest.quality = quality;
      currentBest.repeatOverlap = repeatOverlap;
      currentBest.unchangedRepeatSet = unchangedRepeatSet;
    }

    const fallbackComparison = fallbackQuality
      ? quality.maxScoreDiff - fallbackQuality.maxScoreDiff ||
        repeatOverlap - fallbackRepeatOverlap ||
        quality.squaredScoreDiff - fallbackQuality.squaredScoreDiff ||
        quality.totalScoreDiff - fallbackQuality.totalScoreDiff ||
        quality.extraAppearances - fallbackQuality.extraAppearances ||
        quality.repeatedPartners - fallbackQuality.repeatedPartners
      : -1;
    if (
      !fallbackCandidate || !fallbackQuality || fallbackComparison < 0 ||
      (fallbackComparison === 0 && Math.random() < 0.2)
    ) {
      fallbackCandidate = candidate;
      fallbackQuality = quality;
      fallbackRepeatOverlap = repeatOverlap;
    }
  };

  if (groups.length === 2) {
    const minimumMatchCount = Math.max(
      Math.ceil((groups[0].players.length * targetGames) / 2),
      Math.ceil((groups[1].players.length * targetGames) / 2)
    );
    const maximumAdditionalMatches = Math.min(
      8,
      Math.max(4, Math.ceil(allPlayers.length / 3))
    );
    const attemptsPerMatchCount = allPlayers.length <= 24 ? 1200 : 400;

    // 최소 경기 수에서 시작하고, 9점 이하 대진이 없을 때만 경기 수와
    // 추가 출전자를 바꿔 다시 탐색한다.
    for (
      let matchCount = minimumMatchCount;
      matchCount <= minimumMatchCount + maximumAdditionalMatches;
      matchCount += 1
    ) {
      const bestAtMatchCount = {
        candidate: null as ScheduleCandidate | null,
        quality: null as ScheduleQuality | null,
        repeatOverlap: Number.POSITIVE_INFINITY,
        unchangedRepeatSet: false,
      };

      for (let attempt = 0; attempt < attemptsPerMatchCount; attempt += 1) {
        const candidate = generateScheduleCandidate(
          groups,
          allPlayers,
          targetGames,
          mode,
          attempt > 0,
          matchCount,
          maxAllowedScoreDiff
        );
        if (!candidate) continue;
        considerCandidate(candidate, bestAtMatchCount);

        // 기존 추가 출전자와 겹치지 않으면서 점수 차이가 매우 작은
        // 후보를 찾으면 화면을 오래 막지 않고 해당 후보를 사용한다.
        if (
          bestAtMatchCount.quality &&
          bestAtMatchCount.repeatOverlap === 0 &&
          bestAtMatchCount.quality.maxScoreDiff <= 3
        ) {
          break;
        }
      }

      if (bestAtMatchCount.candidate && bestAtMatchCount.quality) {
        bestCandidate = bestAtMatchCount.candidate;
        bestQuality = bestAtMatchCount.quality;
        bestRepeatOverlap = bestAtMatchCount.repeatOverlap;
        break;
      }
    }
  } else {
    const searchAttempts = allPlayers.length <= 24 ? 1200 : 500;
    const bestForMultipleGroups = {
      candidate: null as ScheduleCandidate | null,
      quality: null as ScheduleQuality | null,
      repeatOverlap: Number.POSITIVE_INFINITY,
      unchangedRepeatSet: false,
    };
    for (let attempt = 0; attempt < searchAttempts; attempt += 1) {
      const candidate = generateScheduleCandidate(groups, allPlayers, targetGames, mode, attempt > 0);
      if (!candidate) continue;
      considerCandidate(candidate, bestForMultipleGroups);
    }
    bestCandidate = bestForMultipleGroups.candidate;
    bestQuality = bestForMultipleGroups.quality;
    bestRepeatOverlap = bestForMultipleGroups.repeatOverlap;
  }

  // 팀 구성상 9점 이하가 불가능해도 생성을 중단하지 않고,
  // 전체 탐색 결과 중 최대 점수 차이가 가장 작은 대진을 사용한다.
  if (!bestCandidate || !bestQuality) {
    bestCandidate = fallbackCandidate;
    bestQuality = fallbackQuality;
    bestRepeatOverlap = fallbackRepeatOverlap;
  }

  // 제한 점수 후보가 전혀 없는 특수 구성에서도 화면에는 대진을 만든다.
  // 이 마지막 탐색만 총점 사전 제한 없이 실행해 가장 가까운 후보를 구한다.
  if ((!bestCandidate || !bestQuality) && groups.length === 2) {
    const emergencyMatchCount = Math.max(
      Math.ceil((groups[0].players.length * targetGames) / 2),
      Math.ceil((groups[1].players.length * targetGames) / 2)
    );
    const emergencyBest = {
      candidate: null as ScheduleCandidate | null,
      quality: null as ScheduleQuality | null,
      repeatOverlap: Number.POSITIVE_INFINITY,
      unchangedRepeatSet: false,
    };
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const candidate = generateScheduleCandidate(
        groups,
        allPlayers,
        targetGames,
        mode,
        true,
        emergencyMatchCount
      );
      if (!candidate) continue;
      considerCandidate(candidate, emergencyBest);
    }
    bestCandidate = fallbackCandidate;
    bestQuality = fallbackQuality;
    bestRepeatOverlap = fallbackRepeatOverlap;
  }

  if (!bestCandidate || !bestQuality) {
    throw new Error('소속팀을 유지하면서 목표 경기 횟수를 배정하지 못했습니다.');
  }

  if (bestQuality.maxScoreDiff > maxAllowedScoreDiff) {
    console.warn(
      `⚠️ ${maxAllowedScoreDiff}점 이하 대진을 만들 수 없어 가능한 최소 점수차 ` +
      `${bestQuality.maxScoreDiff}점으로 생성했습니다.`
    );
  }

  if (avoidedRepeatPlayerIds.size > 0) {
    console.log(
      `🔄 기존 추가 출전자와 겹치는 선수: ${Number.isFinite(bestRepeatOverlap) ? bestRepeatOverlap : 0}명`
    );
  }

  console.log(
    `✅ 소속팀 고정 ${mode === 'mixed_doubles' ? '혼복 우선' : mode === 'level_based' ? '레벨' : '랜덤'} 배정: ` +
    `${allPlayers.length}명, ${bestCandidate.matches.length}경기, 최대 점수차 ${bestQuality.maxScoreDiff}점`
  );
  return reorderMatchesToAvoidConsecutive(bestCandidate.matches);
}
