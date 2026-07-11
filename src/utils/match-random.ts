import { Player, Match, Team } from '@/types';
import { getTeamScore, reorderMatchesToAvoidConsecutive } from './match-helpers';

export function createRandomBalancedDoublesMatches(playersInput: Player[], minGamesPerPlayer = 1): Match[] {
  if (!Array.isArray(playersInput) || playersInput.length < 4) return [];

  const players = [...playersInput].sort((a, b) => a.id.localeCompare(b.id));
  const counts: Record<string, number> = {};
  players.forEach(p => { counts[p.id] = 0; });
  const result: Match[] = [];
  const totalPlayers = players.length;
  let targetMatches = Math.ceil((totalPlayers * minGamesPerPlayer) / 4);
  targetMatches = Math.max(targetMatches, Math.ceil(totalPlayers / 4));
  
  console.log(`🎲 랜덤 경기 생성 시작: ${totalPlayers}명, 최소 ${targetMatches}경기`);

  const bestBalancedPairs = (four: Player[]): { t1: Team; t2: Team } | null => {
    if (four.length !== 4) return null;
    const combos: [Team, Team][] = [
      [ { player1: four[0], player2: four[1] }, { player1: four[2], player2: four[3] } ],
      [ { player1: four[0], player2: four[2] }, { player1: four[1], player2: four[3] } ],
      [ { player1: four[0], player2: four[3] }, { player1: four[1], player2: four[2] } ],
    ];

    let best: { t1: Team; t2: Team } | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const [a, b] of combos) {
      const diff = Math.abs(getTeamScore(a) - getTeamScore(b));
      if (diff < bestDiff) { bestDiff = diff; best = { t1: a, t2: b }; }
    }
    return best;
  };

  let attempts = 0;
  const maxAttempts = targetMatches * 5;
  
  while (result.length < targetMatches && attempts < maxAttempts) {
    const pool = [...players].sort((a, b) => {
      const countDiff = counts[a.id] - counts[b.id];
      if (countDiff !== 0) return countDiff;
      // 난수를 사용하여 셔플 (클릭 시마다 매번 다른 결과 보장)
      return Math.random() - 0.5;
    });

    const minCount = counts[pool[0].id];
    const minCountPlayers = pool.filter(p => counts[p.id] === minCount);

    const numMatchesToGenerate = Math.floor(minCountPlayers.length / 4);

    if (numMatchesToGenerate > 0) {
      let bestSchedule: { t1: Team; t2: Team }[] = [];
      let bestMaxDiff = Number.POSITIVE_INFINITY;
      
      const iterations = 500;
      for (let iter = 0; iter < iterations; iter++) {
        const shuffled = [...minCountPlayers].sort(() => Math.random() - 0.5);
        let maxDiff = 0;
        const currentSchedule: { t1: Team; t2: Team }[] = [];
        
        for (let i = 0; i < numMatchesToGenerate; i++) {
          const four = shuffled.slice(i * 4, i * 4 + 4);
          const pairing = bestBalancedPairs(four);
          if (pairing) {
            const diff = Math.abs(getTeamScore(pairing.t1) - getTeamScore(pairing.t2));
            if (diff > maxDiff) maxDiff = diff;
            currentSchedule.push(pairing);
          }
        }
        
        if (currentSchedule.length === numMatchesToGenerate && maxDiff < bestMaxDiff) {
          bestMaxDiff = maxDiff;
          bestSchedule = currentSchedule;
        }
      }
      
      for (const pairing of bestSchedule) {
        result.push({
          id: `match-rand-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
          team1: pairing.t1,
          team2: pairing.t2
        });
        counts[pairing.t1.player1.id]++;
        counts[pairing.t1.player2.id]++;
        counts[pairing.t2.player1.id]++;
        counts[pairing.t2.player2.id]++;
      }
    } else {
      // 남은 인원이 4명 미만일 때, 경기 수가 약간 더 많은 사람을 끌어와서 1경기 강제 생성
      const candidates = pool.slice(0, 4);
      const pairing = bestBalancedPairs(candidates);
      if (pairing) {
        result.push({
          id: `match-rand-${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 6)}`,
          team1: pairing.t1,
          team2: pairing.t2
        });
        counts[pairing.t1.player1.id]++;
        counts[pairing.t1.player2.id]++;
        counts[pairing.t2.player1.id]++;
        counts[pairing.t2.player2.id]++;
      }
    }
    
    attempts++;
  }

  // 최종 검증 및 상세 로깅
  const finalMissing = players.filter(p => counts[p.id] < minGamesPerPlayer);
  const zeroGames = players.filter(p => counts[p.id] === 0);
  
  console.log('✅ 랜덤 경기 생성 완료:');
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
