import type { Match, Player, Team } from '@/types';
import { getTeamScore, reorderMatchesToAvoidConsecutive, shuffle } from './match-helpers';
import { getEqualGamesPerPlayer } from './match-random';

const normalizeGender = (gender?: string) => String(gender || '').trim().toUpperCase();
const isMale = (player: Player) => ['M', 'MALE', 'MAN', '남', '남성'].includes(normalizeGender(player.gender));
const isFemale = (player: Player) => ['F', 'FEMALE', 'WOMAN', 'W', '여', '여성'].includes(normalizeGender(player.gender));
const isMixedTeam = (team: Team) =>
  (isMale(team.player1) && isFemale(team.player2)) ||
  (isFemale(team.player1) && isMale(team.player2));

const getPartnerKey = (player1: Player, player2: Player) =>
  [player1.id, player2.id].sort((left, right) => left.localeCompare(right)).join('::');

function pickLowestParticipationPlayers(
  players: Player[],
  count: number,
  remaining: Record<string, number>,
  appearances: Record<string, number>,
  excludedIds: Set<string> = new Set()
): Player[] {
  return shuffle(
    players.filter((player) => remaining[player.id] > 0 && !excludedIds.has(player.id))
  )
    .sort((left, right) => {
      const remainingDiff = remaining[right.id] - remaining[left.id];
      if (remainingDiff !== 0) return remainingDiff;
      return appearances[left.id] - appearances[right.id];
    })
    .slice(0, count);
}

function selectPlayersForMixedMatch(
  players: Player[],
  males: Player[],
  females: Player[],
  remaining: Record<string, number>,
  appearances: Record<string, number>
): Player[] {
  const activeMales = males.filter((player) => remaining[player.id] > 0);
  const activeFemales = females.filter((player) => remaining[player.id] > 0);
  const selected: Player[] = [];
  const selectedIds = new Set<string>();

  const addPlayers = (nextPlayers: Player[]) => {
    nextPlayers.forEach((player) => {
      if (selected.length < 4 && !selectedIds.has(player.id)) {
        selected.push(player);
        selectedIds.add(player.id);
      }
    });
  };

  // 남녀가 각각 2명 이상 남아 있으면 두 팀 모두 혼복이 되도록 2명씩 우선 선택한다.
  if (activeMales.length >= 2 && activeFemales.length >= 2) {
    addPlayers(pickLowestParticipationPlayers(males, 2, remaining, appearances, selectedIds));
    addPlayers(pickLowestParticipationPlayers(females, 2, remaining, appearances, selectedIds));
  } else {
    // 한쪽 성별이 부족하면 가능한 남녀 페어 한 팀을 먼저 확보한다.
    if (activeMales.length >= 1 && activeFemales.length >= 1) {
      addPlayers(pickLowestParticipationPlayers(males, 1, remaining, appearances, selectedIds));
      addPlayers(pickLowestParticipationPlayers(females, 1, remaining, appearances, selectedIds));
    }

    // 남는 자리는 실제 성별 그대로 채워 남남·여여 또는 성별 미지정 페어를 허용한다.
    addPlayers(pickLowestParticipationPlayers(players, 4 - selected.length, remaining, appearances, selectedIds));
  }

  if (selected.length < 4) {
    addPlayers(pickLowestParticipationPlayers(players, 4 - selected.length, remaining, appearances, selectedIds));
  }

  return selected;
}

function chooseTeamsWithMaximumMixedPairs(
  four: Player[],
  partnerCounts: Record<string, number>
): { team1: Team; team2: Team } | null {
  if (four.length !== 4) return null;

  const candidates = [
    {
      team1: { player1: four[0], player2: four[1] },
      team2: { player1: four[2], player2: four[3] },
    },
    {
      team1: { player1: four[0], player2: four[2] },
      team2: { player1: four[1], player2: four[3] },
    },
    {
      team1: { player1: four[0], player2: four[3] },
      team2: { player1: four[1], player2: four[2] },
    },
  ].map((candidate) => ({
    ...candidate,
    mixedTeamCount: Number(isMixedTeam(candidate.team1)) + Number(isMixedTeam(candidate.team2)),
    scoreDiff: Math.abs(getTeamScore(candidate.team1) - getTeamScore(candidate.team2)),
    repeatedPartners:
      (partnerCounts[getPartnerKey(candidate.team1.player1, candidate.team1.player2)] || 0) +
      (partnerCounts[getPartnerKey(candidate.team2.player1, candidate.team2.player2)] || 0),
  }));

  candidates.sort((left, right) =>
    right.mixedTeamCount - left.mixedTeamCount ||
    left.repeatedPartners - right.repeatedPartners ||
    left.scoreDiff - right.scoreDiff
  );

  return candidates[0] ? { team1: candidates[0].team1, team2: candidates[0].team2 } : null;
}

export function createMixedAndSameSexDoublesMatches(playersInput: Player[], minGamesPerPlayer = 1): Match[] {
  if (!Array.isArray(playersInput) || playersInput.length < 4) return [];

  const players = Array.from(new Map(playersInput.map((player) => [player.id, player])).values());
  if (players.length < 4) return [];

  const males = players.filter(isMale);
  const females = players.filter(isFemale);
  const gamesPerPlayer = getEqualGamesPerPlayer(players.length, minGamesPerPlayer);
  const totalMatches = (players.length * gamesPerPlayer) / 4;
  const remaining: Record<string, number> = Object.fromEntries(
    players.map((player) => [player.id, gamesPerPlayer])
  );
  const appearances: Record<string, number> = Object.fromEntries(players.map((player) => [player.id, 0]));
  const partnerCounts: Record<string, number> = {};
  const result: Match[] = [];

  for (let matchIndex = 0; matchIndex < totalMatches; matchIndex += 1) {
    const selectedPlayers = selectPlayersForMixedMatch(players, males, females, remaining, appearances);
    if (selectedPlayers.length !== 4) {
      throw new Error('혼복 경기의 선수별 참가 횟수를 동일하게 배정하지 못했습니다.');
    }

    const teams = chooseTeamsWithMaximumMixedPairs(selectedPlayers, partnerCounts);
    if (!teams) {
      throw new Error('혼복 경기 팀을 구성하지 못했습니다.');
    }

    result.push({
      id: `match-mixed-${Date.now()}-${matchIndex}-${Math.random().toString(36).slice(2, 7)}`,
      team1: teams.team1,
      team2: teams.team2,
    });

    [teams.team1.player1, teams.team1.player2, teams.team2.player1, teams.team2.player2].forEach((player) => {
      remaining[player.id] -= 1;
      appearances[player.id] += 1;
    });
    [teams.team1, teams.team2].forEach((team) => {
      const key = getPartnerKey(team.player1, team.player2);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    });
  }

  if (players.some((player) => appearances[player.id] !== gamesPerPlayer)) {
    throw new Error('혼복 경기의 선수별 참가 횟수가 동일하지 않습니다.');
  }

  const mixedTeams = result.reduce(
    (sum, match) => sum + Number(isMixedTeam(match.team1)) + Number(isMixedTeam(match.team2)),
    0
  );
  const totalTeams = result.length * 2;
  console.log(
    `✅ 혼복 우선 균등 배정: ${players.length}명 모두 ${gamesPerPlayer}경기, 혼복 ${mixedTeams}팀 / 전체 ${totalTeams}팀`
  );

  return reorderMatchesToAvoidConsecutive(result);
}
