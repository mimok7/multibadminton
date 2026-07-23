import type { Match, Player, Team } from '@/types';
import { getTeamScore, reorderMatchesToAvoidConsecutive, shuffle } from './match-helpers';

export function getEqualGamesPerPlayer(playerCount: number, requestedGames: number): number {
  if (playerCount < 4) return 0;

  let gamesPerPlayer = Math.max(1, Math.floor(requestedGames || 1));
  while ((playerCount * gamesPerPlayer) % 4 !== 0) {
    gamesPerPlayer += 1;
  }
  return gamesPerPlayer;
}

const getPairKey = (player1: Player, player2: Player) =>
  [player1.id, player2.id].sort((left, right) => left.localeCompare(right)).join('::');

function chooseBalancedTeams(
  four: Player[],
  partnerCounts: Record<string, number>
): { team1: Team; team2: Team } | null {
  if (four.length !== 4) return null;

  const candidates: Array<{ team1: Team; team2: Team; scoreDiff: number; repeatedPartners: number }> = [
    {
      team1: { player1: four[0], player2: four[1] },
      team2: { player1: four[2], player2: four[3] },
      scoreDiff: 0,
      repeatedPartners: 0,
    },
    {
      team1: { player1: four[0], player2: four[2] },
      team2: { player1: four[1], player2: four[3] },
      scoreDiff: 0,
      repeatedPartners: 0,
    },
    {
      team1: { player1: four[0], player2: four[3] },
      team2: { player1: four[1], player2: four[2] },
      scoreDiff: 0,
      repeatedPartners: 0,
    },
  ].map((candidate) => ({
    ...candidate,
    scoreDiff: Math.abs(getTeamScore(candidate.team1) - getTeamScore(candidate.team2)),
    repeatedPartners:
      (partnerCounts[getPairKey(candidate.team1.player1, candidate.team1.player2)] || 0) +
      (partnerCounts[getPairKey(candidate.team2.player1, candidate.team2.player2)] || 0),
  }));

  const minimumPartnerRepeats = Math.min(...candidates.map((candidate) => candidate.repeatedPartners));
  const leastRepeated = candidates.filter((candidate) => candidate.repeatedPartners === minimumPartnerRepeats);
  const minimumScoreDiff = Math.min(...leastRepeated.map((candidate) => candidate.scoreDiff));
  const best = leastRepeated.filter((candidate) => candidate.scoreDiff === minimumScoreDiff);
  const selected = best[Math.floor(Math.random() * best.length)];

  return selected ? { team1: selected.team1, team2: selected.team2 } : null;
}

export function createRandomBalancedDoublesMatches(playersInput: Player[], minGamesPerPlayer = 1): Match[] {
  if (!Array.isArray(playersInput) || playersInput.length < 4) return [];

  const uniquePlayers = Array.from(new Map(playersInput.map((player) => [player.id, player])).values());
  if (uniquePlayers.length < 4) return [];

  const gamesPerPlayer = getEqualGamesPerPlayer(uniquePlayers.length, minGamesPerPlayer);
  const totalMatches = (uniquePlayers.length * gamesPerPlayer) / 4;
  const remaining: Record<string, number> = Object.fromEntries(
    uniquePlayers.map((player) => [player.id, gamesPerPlayer])
  );
  const participationCounts: Record<string, number> = Object.fromEntries(
    uniquePlayers.map((player) => [player.id, 0])
  );
  const partnerCounts: Record<string, number> = {};
  const result: Match[] = [];

  for (let matchIndex = 0; matchIndex < totalMatches; matchIndex += 1) {
    const candidates = shuffle(uniquePlayers.filter((player) => remaining[player.id] > 0))
      .sort((left, right) => {
        const remainingDiff = remaining[right.id] - remaining[left.id];
        if (remainingDiff !== 0) return remainingDiff;
        return participationCounts[left.id] - participationCounts[right.id];
      });
    const selectedPlayers = candidates.slice(0, 4);

    if (selectedPlayers.length !== 4) {
      throw new Error('모든 선수의 경기 횟수를 동일하게 배정하지 못했습니다.');
    }

    const teams = chooseBalancedTeams(selectedPlayers, partnerCounts);
    if (!teams) {
      throw new Error('랜덤 복식 팀을 구성하지 못했습니다.');
    }

    result.push({
      id: `match-random-${Date.now()}-${matchIndex}-${Math.random().toString(36).slice(2, 7)}`,
      team1: teams.team1,
      team2: teams.team2,
    });

    [teams.team1.player1, teams.team1.player2, teams.team2.player1, teams.team2.player2].forEach((player) => {
      remaining[player.id] -= 1;
      participationCounts[player.id] += 1;
    });

    [teams.team1, teams.team2].forEach((team) => {
      const key = getPairKey(team.player1, team.player2);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    });
  }

  const actualCounts = uniquePlayers.map((player) => participationCounts[player.id]);
  if (actualCounts.some((count) => count !== gamesPerPlayer)) {
    throw new Error('랜덤 경기의 선수별 참가 횟수가 동일하지 않습니다.');
  }

  console.log(`✅ 랜덤 경기 균등 배정: ${uniquePlayers.length}명 모두 ${gamesPerPlayer}경기, 총 ${result.length}경기`);
  return reorderMatchesToAvoidConsecutive(result);
}
