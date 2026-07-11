import { Player, Match, Team } from '@/types';
import { getTeamScore, reorderMatchesToAvoidConsecutive } from './match-helpers';

const normalizeGender = (gender?: string) => String(gender || '').trim().toLowerCase();
const isMale = (p: Player) => ['m', 'male', 'man', '남', '남성'].includes(normalizeGender(p.gender));
const isFemale = (p: Player) => ['f', 'female', 'woman', 'w', '여', '여성'].includes(normalizeGender(p.gender));

export function createMixedAndSameSexDoublesMatches(playersInput: Player[], minGamesPerPlayer = 1): Match[] {
  if (!Array.isArray(playersInput) || playersInput.length < 4) return [];

  const players = [...playersInput].sort((a, b) => a.id.localeCompare(b.id));
  const counts: Record<string, number> = {};
  players.forEach(p => { counts[p.id] = 0; });
  const result: Match[] = [];
  const totalPlayers = players.length;
  let targetMatches = Math.ceil((totalPlayers * minGamesPerPlayer) / 4);
  targetMatches = Math.max(targetMatches, Math.ceil(totalPlayers / 4));
  
  console.log(`👫 혼합복식 경기 생성 시작: ${totalPlayers}명, 최소 ${targetMatches}경기`);

  const maxGamesPerPlayer = Math.max(minGamesPerPlayer, 2);
  const isMixedTeam = (team: Team) =>
    (isMale(team.player1) && isFemale(team.player2)) || (isFemale(team.player1) && isMale(team.player2));

  const buildTeamCandidates = (pool: Player[]) => {
    const males = pool.filter(isMale);
    const females = pool.filter(isFemale);
    const unspecified = pool.filter((player) => !isMale(player) && !isFemale(player));
    const candidates: { team: Team; score: number; isMixed: boolean }[] = [];

    if (males.length > 0 && females.length > 0) {
      for (const male of males) {
        for (const female of females) {
          const team: Team = { player1: male, player2: female };
          candidates.push({ team, score: getTeamScore(team), isMixed: true });
        }
      }
    }

    for (const unknown of unspecified) {
      for (const male of males) {
        const team: Team = { player1: unknown, player2: male };
        candidates.push({ team, score: getTeamScore(team), isMixed: false });
      }
      for (const female of females) {
        const team: Team = { player1: unknown, player2: female };
        candidates.push({ team, score: getTeamScore(team), isMixed: false });
      }
    }

    for (let i = 0; i < males.length; i++) {
      for (let j = i + 1; j < males.length; j++) {
        const team: Team = { player1: males[i], player2: males[j] };
        candidates.push({ team, score: getTeamScore(team), isMixed: false });
      }
    }

    for (let i = 0; i < females.length; i++) {
      for (let j = i + 1; j < females.length; j++) {
        const team: Team = { player1: females[i], player2: females[j] };
        candidates.push({ team, score: getTeamScore(team), isMixed: false });
      }
    }

    for (let i = 0; i < unspecified.length; i++) {
      for (let j = i + 1; j < unspecified.length; j++) {
        const team: Team = { player1: unspecified[i], player2: unspecified[j] };
        candidates.push({ team, score: getTeamScore(team), isMixed: false });
      }
    }

    return candidates;
  };

  const pickBestMatch = (pool: Player[], allowSecondGames: boolean): Match | null => {
    const teamCandidates = buildTeamCandidates(pool);
    if (teamCandidates.length === 0) {
      return null;
    }

    const preferMixedTeams = pool.filter(isMale).length >= 2 && pool.filter(isFemale).length >= 2;
    let bestSelection: {
      team1: Team;
      team2: Team;
      diff: number;
      belowTargetCount: number;
      mixedRank: number;
      totalCount: number;
      maxCount: number;
    } | null = null;

    for (let i = 0; i < teamCandidates.length; i++) {
      for (let j = i + 1; j < teamCandidates.length; j++) {
        const team1 = teamCandidates[i].team;
        const team2 = teamCandidates[j].team;
        const selectedPlayers = [team1.player1, team1.player2, team2.player1, team2.player2];
        const uniqueIds = new Set(selectedPlayers.map((player) => player.id));

        if (uniqueIds.size !== 4) {
          continue;
        }

        const selectedCounts = selectedPlayers.map((player) => counts[player.id] || 0);
        if (selectedCounts.some((count) => count >= maxGamesPerPlayer)) {
          continue;
        }

        const belowTargetCount = selectedPlayers.filter((player) => (counts[player.id] || 0) < minGamesPerPlayer).length;
        if (belowTargetCount === 0) {
          continue;
        }

        if (!allowSecondGames && selectedCounts.some((count) => count > 0)) {
          continue;
        }

        const diff = Math.abs(getTeamScore(team1) - getTeamScore(team2));
        const mixedTeamCount = Number(isMixedTeam(team1)) + Number(isMixedTeam(team2));
        const mixedRank = preferMixedTeams ? (mixedTeamCount === 2 ? 0 : mixedTeamCount === 1 ? 1 : 2) : 0;
        const totalCount = selectedCounts.reduce((sum, count) => sum + count, 0);
        const maxCount = Math.max(...selectedCounts);

        const candidate = {
          team1,
          team2,
          diff,
          belowTargetCount,
          mixedRank,
          totalCount,
          maxCount,
        };

        if (
          !bestSelection ||
          candidate.belowTargetCount > bestSelection.belowTargetCount ||
          (candidate.belowTargetCount === bestSelection.belowTargetCount && candidate.mixedRank < bestSelection.mixedRank) ||
          (candidate.belowTargetCount === bestSelection.belowTargetCount && candidate.mixedRank === bestSelection.mixedRank && candidate.diff < bestSelection.diff) ||
          (candidate.belowTargetCount === bestSelection.belowTargetCount && candidate.mixedRank === bestSelection.mixedRank && candidate.diff === bestSelection.diff && candidate.totalCount < bestSelection.totalCount) ||
          (candidate.belowTargetCount === bestSelection.belowTargetCount && candidate.mixedRank === bestSelection.mixedRank && candidate.diff === bestSelection.diff && candidate.totalCount === bestSelection.totalCount && candidate.maxCount < bestSelection.maxCount)
        ) {
          bestSelection = candidate;
        }
      }
    }

    if (!bestSelection) {
      return null;
    }

    return {
      id: `match-mixed-${Date.now()}-${result.length}-${bestSelection.team1.player1.id.slice(0, 4)}`,
      team1: bestSelection.team1,
      team2: bestSelection.team2
    };
  };

  const applyMatch = (match: Match) => {
    result.push(match);
    [match.team1.player1.id, match.team1.player2.id, match.team2.player1.id, match.team2.player2.id].forEach((id) => {
      counts[id] = (counts[id] || 0) + 1;
    });
  };

  let attempts = 0;
  const maxAttempts = targetMatches * 5;
  
  while (result.length < targetMatches && attempts < maxAttempts) {
    const pool = [...players].sort((a, b) => {
      const countDiff = counts[a.id] - counts[b.id];
      if (countDiff !== 0) return countDiff;
      return Math.random() - 0.5;
    });

    const minCount = counts[pool[0].id];
    const minCountPlayers = pool.filter(p => counts[p.id] === minCount);

    const numMatchesToGenerate = Math.floor(minCountPlayers.length / 4);

    if (numMatchesToGenerate > 0) {
      let bestSchedule: Match[] = [];
      let bestMaxDiff = Number.POSITIVE_INFINITY;
      
      const iterations = 500;
      for (let iter = 0; iter < iterations; iter++) {
        const shuffled = [...minCountPlayers].sort(() => Math.random() - 0.5);
        let maxDiff = 0;
        const currentSchedule: Match[] = [];
        
        for (let i = 0; i < numMatchesToGenerate; i++) {
          const four = shuffled.slice(i * 4, i * 4 + 4);
          let match = pickBestMatch(four, true);
          if (!match) {
            match = {
              id: `match-mixed-forced-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
              team1: { player1: four[0], player2: four[1] },
              team2: { player1: four[2], player2: four[3] }
            };
          }
          const diff = Math.abs(getTeamScore(match.team1) - getTeamScore(match.team2));
          if (diff > maxDiff) maxDiff = diff;
          currentSchedule.push(match);
        }
        
        if (currentSchedule.length === numMatchesToGenerate && maxDiff < bestMaxDiff) {
          bestMaxDiff = maxDiff;
          bestSchedule = currentSchedule;
        }
      }
      
      for (const match of bestSchedule) {
        match.id = `match-mixed-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`;
        applyMatch(match);
      }
    } else {
      const candidates = pool.slice(0, 4);
      let nextMatch = pickBestMatch(candidates, true);
      if (!nextMatch) {
        nextMatch = {
          id: `match-mixed-forced-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
          team1: { player1: candidates[0], player2: candidates[1] },
          team2: { player1: candidates[2], player2: candidates[3] }
        };
      } else {
        nextMatch.id = `match-mixed-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`;
      }
      applyMatch(nextMatch);
    }
    
    attempts++;
  }

  // 최종 검증 및 상세 로깅
  const finalMissing = players.filter(p => counts[p.id] < minGamesPerPlayer);
  const zeroGames = players.filter(p => counts[p.id] === 0);
  
  console.log('✅ 혼합복식 경기 생성 완료:');
  console.log(`  - 생성된 경기: ${result.length}개`);
  console.log(`  - 참가한 선수: ${players.filter(p => counts[p.id] > 0).length}명 / ${players.length}명`);
  
  // 경기 수 분포
  const distribution: Record<number, number> = {};
  players.forEach(p => {
    const count = counts[p.id] || 0;
    distribution[count] = (distribution[count] || 0) + 1;
  });
  console.log('  - 경기 수 분포:', distribution);
  
  // 최종 검증
  if (zeroGames.length > 0) {
    console.error(`❌ 치명적: ${zeroGames.length}명이 경기에 한 번도 참여하지 못함!`);
    console.error(`   선수: ${zeroGames.map(p => `${p.name}(${p.skill_level})`).join(', ')}`);
  } else {
    console.log(`✅ 모든 선수 참여 완료!`);
  }
  
  if (finalMissing.length > 0) {
    console.warn(`⚠️ ${finalMissing.length}명이 목표 ${minGamesPerPlayer}회 미달:`);
    finalMissing.forEach(p => {
      console.warn(`   - ${p.name}(${p.skill_level}): ${counts[p.id] || 0}회`);
    });
  }

  return reorderMatchesToAvoidConsecutive(result);
}
