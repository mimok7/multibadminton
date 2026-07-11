import { Player, Match, Team } from '@/types';
import { getTeamScore, getTeamFairnessScore, reorderMatchesToAvoidConsecutive } from './match-helpers';

export function createBalancedDoublesMatches(playersInput: Player[], minGamesPerPlayer = 1): Match[] {
  if (!Array.isArray(playersInput) || playersInput.length < 4) return [];

  const players = [...playersInput].sort((a, b) => a.id.localeCompare(b.id));
  const normalized = players.map(p => ({ ...p, skill_level: (p.skill_level || 'E2').toUpperCase() }));

  // 레벨(점수) 높은 순서로 정렬 - 고수부터 배정
  const getPlayerScore = (p: Player) => getTeamScore({ player1: p, player2: p });
  const sortedBySkill = [...normalized].sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
  
  console.log('📊 레벨별 경기 생성 시작:');
  console.log(`  - 총 선수: ${normalized.length}명`);
  console.log(`  - 목표 최소 경기: ${minGamesPerPlayer}회/인`);
  console.log(`  - 레벨 순서: ${sortedBySkill.slice(0, 5).map(p => `${p.name}(${p.skill_level})`).join(', ')}...`);

  // 파트너 매핑 구성 (서로 지정했거나, 한쪽이 지정하고 상대가 참석 중인 경우)
  const partnerMap = new Map<string, string>();
  const designated = new Map<string, string>();
  normalized.forEach(p => {
    if (p.partner_user_id) {
      designated.set(p.id, p.partner_user_id);
    }
  });

  // 1순위: 상호 지정 (A -> B 및 B -> A)
  designated.forEach((partnerId, playerId) => {
    if (designated.get(partnerId) === playerId) {
      partnerMap.set(playerId, partnerId);
      partnerMap.set(partnerId, playerId);
    }
  });

  // 2순위: 일방 지정이되, 상대방이 이미 다른 파트너와 매핑되지 않은 경우
  designated.forEach((partnerId, playerId) => {
    if (!partnerMap.has(playerId) && !partnerMap.has(partnerId)) {
      const partnerExists = normalized.some(p => p.id === partnerId);
      if (partnerExists) {
        partnerMap.set(playerId, partnerId);
        partnerMap.set(partnerId, playerId);
      }
    }
  });

  if (partnerMap.size > 0) {
    const loggedPairs = new Set<string>();
    console.log('🏆 대회 준비 지정 파트너 감지:');
    partnerMap.forEach((partnerId, playerId) => {
      const pairKey = [playerId, partnerId].sort().join('-');
      if (!loggedPairs.has(pairKey)) {
        loggedPairs.add(pairKey);
        const p1Name = normalized.find(p => p.id === playerId)?.name || playerId;
        const p2Name = normalized.find(p => p.id === partnerId)?.name || partnerId;
        console.log(`  - 파트너 쌍 고정: ${p1Name} & ${p2Name}`);
      }
    });
  }

  const buildPossibleTeams = (pool: Player[], pMap?: Map<string, string>): { team: Team; score: number; fairness: number }[] => {
    const teams: { team: Team; score: number; fairness: number }[] = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const p1 = pool[i];
        const p2 = pool[j];
        if (pMap) {
          const p1Partner = pMap.get(p1.id);
          const p2Partner = pMap.get(p2.id);
          if (p1Partner && p1Partner !== p2.id) continue;
          if (p2Partner && p2Partner !== p1.id) continue;
        }
        const team: Team = { player1: p1, player2: p2 };
        teams.push({ team, score: getTeamScore(team), fairness: getTeamFairnessScore(team) });
      }
    }
    // 결정론적 정렬을 통해 동일한 조건에서 항상 일관성 있는 팀 선택 보장
    teams.sort((a, b) => {
      if (b.fairness !== a.fairness) return b.fairness - a.fairness;
      if (b.score !== a.score) return b.score - a.score;
      const idA = [a.team.player1.id, a.team.player2.id].sort().join('-');
      const idB = [b.team.player1.id, b.team.player2.id].sort().join('-');
      return idA.localeCompare(idB);
    });
    return teams;
  };

  const createRound = (pool: Player[], pMap?: Map<string, string>): { matches: Match[]; used: Set<string> } => {
    const used = new Set<string>();
    const matches: Match[] = [];
    
    // 레벨(점수) 높은 순서로 정렬된 풀 사용
    const sortedPool = [...pool].sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
    const possible = buildPossibleTeams(sortedPool, pMap);

    for (let i = 0; i < possible.length; i++) {
      const t1 = possible[i];
      const p1 = t1.team.player1.id; const p2 = t1.team.player2.id;
      if (used.has(p1) || used.has(p2)) continue;

      const candidates: { team: Team; score: number; diff: number; index: number }[] = [];
      for (let j = i + 1; j < possible.length; j++) {
        const t2 = possible[j];
        const q1 = t2.team.player1.id; const q2 = t2.team.player2.id;
        if (used.has(q1) || used.has(q2)) continue;
        if (p1 === q1 || p1 === q2 || p2 === q1 || p2 === q2) continue;
        const diff = Math.abs(t1.score - t2.score);
        // enforce tight balance: team scores must be tied or differ by at most 1
        if (diff > 1) continue;
        candidates.push({ team: t2.team, score: t2.score, diff, index: j });
      }
      if (candidates.length > 0) {
        // 결정론적 tie-breaking 정렬
        candidates.sort((a, b) => {
          if (a.diff !== b.diff) return a.diff - b.diff;
          const idA = [a.team.player1.id, a.team.player2.id].sort().join('-');
          const idB = [b.team.player1.id, b.team.player2.id].sort().join('-');
          return idA.localeCompare(idB);
        });
        const picked = candidates[0]; // 가장 균형이 잘 맞는 상대를 고정 선택
        
        const matchId = `match-balanced-d-${Date.now()}-${t1.team.player1.id.slice(0, 4)}-${picked.team.player1.id.slice(0, 4)}-${Math.random().toString(36).slice(2, 6)}`;
        matches.push({ id: matchId, team1: t1.team, team2: picked.team });
        used.add(p1); used.add(p2); used.add(picked.team.player1.id); used.add(picked.team.player2.id);
      }
    }
    return { matches, used };
  };

  const result: Match[] = [];
  const counts: Record<string, number> = {};
  normalized.forEach(p => { counts[p.id] = 0; });

  // helper to pick the best pairing among 4 players such that team score diff is minimized
  const bestBalancedPairs = (four: Player[], pMap?: Map<string, string>): { t1: Team; t2: Team } | null => {
    if (four.length !== 4) return null;
    const combos: [Team, Team][] = [
      [ { player1: four[0], player2: four[1] }, { player1: four[2], player2: four[3] } ],
      [ { player1: four[0], player2: four[2] }, { player1: four[1], player2: four[3] } ],
      [ { player1: four[0], player2: four[3] }, { player1: four[1], player2: four[2] } ],
    ];

    const isValidTeam = (t: Team) => {
      if (!pMap) return true;
      const p1Partner = pMap.get(t.player1.id);
      const p2Partner = pMap.get(t.player2.id);
      if (p1Partner && p1Partner !== t.player2.id) return false;
      if (p2Partner && p2Partner !== t.player1.id) return false;
      return true;
    };

    let best: { t1: Team; t2: Team } | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const [a, b] of combos) {
      if (!isValidTeam(a) || !isValidTeam(b)) continue;
      const diff = Math.abs(getTeamScore(a) - getTeamScore(b));
      if (diff < bestDiff) { bestDiff = diff; best = { t1: a, t2: b }; }
    }
    return best;
  };

  // Determine how many matches we should aim to create so distribution is even
  // 모든 선수가 최소 경기에 참여할 수 있도록 계산
  const totalPlayers = normalized.length;
  let targetMatches = Math.ceil((totalPlayers * minGamesPerPlayer) / 4);
  
  // 실제로는 선수들이 자동으로 여러 경기에 참여할 수 있으므로, 모든 선수가 참여하기 위한 최소 경기 수
  // 최악의 경우 일부 선수가 여러 경기에 참여해야 할 수도 있음을 감안
  const estimatedMatches = Math.ceil(totalPlayers * minGamesPerPlayer / 4);
  targetMatches = Math.max(estimatedMatches, Math.ceil(totalPlayers / 4));

  console.log(`  - 목표 경기수: 최소 ${targetMatches}개 (${totalPlayers}명 × ${minGamesPerPlayer}회 ÷ 4)`);

  const groupIntoFours = (pool: Player[], pMap: Map<string, string>): Player[][] => {
    const visited = new Set<string>();
    const units: Player[][] = [];
    for (const p of pool) {
      if (visited.has(p.id)) continue;
      visited.add(p.id);
      const partnerId = pMap.get(p.id);
      if (partnerId && !visited.has(partnerId)) {
        const partner = pool.find(x => x.id === partnerId);
        if (partner) {
          visited.add(partner.id);
          units.push([p, partner]);
          continue;
        }
      }
      units.push([p]);
    }

    const groups: Player[][] = [];
    const rem = [...units];

    while (rem.length > 0) {
      let foundIndices: number[] | null = null;
      
      const findCombo = (startIdx: number, currentIndices: number[], currentCount: number): boolean => {
        if (currentCount === 4) {
          foundIndices = [...currentIndices];
          return true;
        }
        for (let j = startIdx; j < rem.length; j++) {
          if (currentCount + rem[j].length <= 4) {
            currentIndices.push(j);
            if (findCombo(j + 1, currentIndices, currentCount + rem[j].length)) return true;
            currentIndices.pop();
          }
        }
        return false;
      };

      findCombo(0, [], 0);

      if (foundIndices) {
        const group: Player[] = [];
        const sortedIndices = (foundIndices as number[]).sort((a, b) => b - a);
        for (const idx of sortedIndices) {
          group.push(...rem[idx]);
          rem.splice(idx, 1);
        }
        groups.push(group);
      } else {
        break;
      }
    }

    return groups;
  };

  let attempts = 0;
  const maxAttempts = targetMatches * 5;
  
  while (result.length < targetMatches && attempts < maxAttempts) {
    const pool = [...normalized].sort((a, b) => {
      const countDiff = counts[a.id] - counts[b.id];
      if (countDiff !== 0) return countDiff;
      // 난수를 약간 섞어 매 클릭마다 다른 결과가 나오되 레벨이 비슷한 선수들끼리 묶이도록 함
      const scoreA = getPlayerScore(a) + (Math.random() * 2 - 1);
      const scoreB = getPlayerScore(b) + (Math.random() * 2 - 1);
      return scoreB - scoreA;
    });

    const minCount = counts[pool[0].id];
    const minCountPlayers = pool.filter(p => counts[p.id] === minCount);

    const numMatchesToGenerate = Math.floor(minCountPlayers.length / 4);
    let generatedThisTurn = false;

    if (numMatchesToGenerate > 0) {
      let bestSchedule: Match[] = [];
      let bestMaxDiff = Number.POSITIVE_INFINITY;
      
      const iterations = 500;
      for (let iter = 0; iter < iterations; iter++) {
        // 레벨순 기반이되 약간의 랜덤성을 크게 주어 다양한 조합 탐색
        const shuffled = [...minCountPlayers].sort((a, b) => {
           const scoreA = getPlayerScore(a) + (Math.random() * 6 - 3);
           const scoreB = getPlayerScore(b) + (Math.random() * 6 - 3);
           return scoreB - scoreA;
        });

        const fourGroups = groupIntoFours(shuffled, partnerMap);
        const limit = Math.min(numMatchesToGenerate, fourGroups.length);

        let maxDiff = 0;
        const currentSchedule: Match[] = [];
        
        for (let i = 0; i < limit; i++) {
          const four = fourGroups[i];
          const { matches: round } = createRound(four, partnerMap);
          if (round && round.length > 0) {
            const m = round[0];
            const diff = Math.abs(getTeamScore(m.team1) - getTeamScore(m.team2));
            if (diff > maxDiff) maxDiff = diff;
            currentSchedule.push(m);
          } else {
            const pairing = bestBalancedPairs(four, partnerMap);
            if (pairing) {
              const diff = Math.abs(getTeamScore(pairing.t1) - getTeamScore(pairing.t2));
              if (diff > maxDiff) maxDiff = diff;
              currentSchedule.push({
                id: `match-forced-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
                team1: pairing.t1,
                team2: pairing.t2
              });
            }
          }
        }
        
        if (currentSchedule.length > 0 && currentSchedule.length === limit && maxDiff < bestMaxDiff) {
          bestMaxDiff = maxDiff;
          bestSchedule = currentSchedule;
        }
      }
      
      if (bestSchedule.length > 0) {
        for (const m of bestSchedule) {
          result.push(m);
          counts[m.team1.player1.id]++;
          counts[m.team1.player2.id]++;
          counts[m.team2.player1.id]++;
          counts[m.team2.player2.id]++;
        }
        generatedThisTurn = true;
      }
    }
    
    if (!generatedThisTurn) {
      const fourGroups = groupIntoFours(pool, partnerMap);
      if (fourGroups.length > 0) {
        const candidates = fourGroups[0];
        const { matches: round } = createRound(candidates, partnerMap);
        if (round && round.length > 0) {
          const m = round[0];
          result.push(m);
          counts[m.team1.player1.id]++;
          counts[m.team1.player2.id]++;
          counts[m.team2.player1.id]++;
          counts[m.team2.player2.id]++;
        } else {
          const pairing = bestBalancedPairs(candidates, partnerMap);
          if (pairing) {
            result.push({
              id: `match-forced-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
              team1: pairing.t1,
              team2: pairing.t2
            });
            counts[pairing.t1.player1.id]++;
            counts[pairing.t1.player2.id]++;
            counts[pairing.t2.player1.id]++;
            counts[pairing.t2.player2.id]++;
          }
        }
      } else {
        const candidates = pool.slice(0, 4);
        const { matches: round } = createRound(candidates, partnerMap);
        if (round && round.length > 0) {
          const m = round[0];
          result.push(m);
          counts[m.team1.player1.id]++;
          counts[m.team1.player2.id]++;
          counts[m.team2.player1.id]++;
          counts[m.team2.player2.id]++;
        } else {
          const pairing = bestBalancedPairs(candidates, partnerMap);
          if (pairing) {
            result.push({
              id: `match-forced-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
              team1: pairing.t1,
              team2: pairing.t2
            });
            counts[pairing.t1.player1.id]++;
            counts[pairing.t1.player2.id]++;
            counts[pairing.t2.player1.id]++;
            counts[pairing.t2.player2.id]++;
          }
        }
      }
    }
    attempts++;
  }

  // 최종 검증 및 상세 로깅
  const finalMissing = normalized.filter(p => counts[p.id] < minGamesPerPlayer);
  const zeroGames = normalized.filter(p => counts[p.id] === 0);
  
  console.log('✅ 레벨별 경기 생성 완료:');
  console.log(`  - 생성된 경기: ${result.length}개`);
  console.log(`  - 참가한 선수: ${normalized.filter(p => counts[p.id] > 0).length}명 / ${normalized.length}명`);
  
  // 경기 수 분포
  const distribution: Record<number, number> = {};
  normalized.forEach(p => {
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
  
  // 전체 참가 현황 (상위 10명만 샘플 출력)
  const participationStatus = normalized
    .map(p => ({
      name: p.name,
      level: p.skill_level,
      games: counts[p.id] || 0,
      status: (counts[p.id] || 0) >= minGamesPerPlayer ? '✓' : '✗'
    }))
    .sort((a, b) => b.games - a.games);
  
  console.log('  - 참가 현황 (상위 10명):');
  participationStatus.slice(0, 10).forEach(p => {
    console.log(`    ${p.status} ${p.name}(${p.level}): ${p.games}회`);
  });

  return reorderMatchesToAvoidConsecutive(result);
}
