import { NextResponse } from 'next/server';
import { getProfileByUserId } from '@/lib/auth';
import { readCoinSettings } from '@/lib/coin-settings';
import { DEFAULT_MATCH_WAGER, MAX_MATCH_WAGER, type CoinSettlementMode } from '@/lib/coins';
import { notifyWaitingMatchesForSession } from '@/lib/match-preparation-notifications';
import { syncSessionMatchFlow } from '@/lib/match-session-flow';
import { getFilteredAdminClient } from '@/lib/supabase-server';
import { getClubManagerContext } from '@/lib/manager-access';

type MatchParticipantRow = {
  id: number;
  session_id?: string | null;
  match_number?: number | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  match_result: unknown;
};

type CoinTransactionRow = {
  profile_id: string;
  delta: number;
  transaction_type: string;
  wager_amount: number;
};

function getFriendlyErrorMessage(message: string): string {
  if (message.includes('score_limit')) {
    return '점수는 25점을 초과할 수 없습니다.';
  }
  return message;
}

function allocateWinningPool(winningWagers: number[], losingTotal: number) {
  const winningTotal = winningWagers.reduce((sum, wager) => sum + wager, 0);

  if (winningTotal <= 0) {
    throw new Error('배팅 코인 합계가 올바르지 않습니다.');
  }

  const gains: number[] = [];
  let allocated = 0;

  winningWagers.forEach((wager) => {
    const gain = Math.floor((losingTotal * wager) / winningTotal);
    gains.push(gain);
    allocated += gain;
  });

  let remainder = losingTotal - allocated;
  let index = 0;
  while (remainder > 0 && gains.length > 0) {
    gains[index] += 1;
    remainder -= 1;
    index = (index + 1) % gains.length;
  }

  return gains;
}

function buildCoinDeltas(params: {
  mode: CoinSettlementMode;
  winnerTeam1: boolean;
  team1Wagers: number[];
  team2Wagers: number[];
  fixedWinnerReward: number;
}) {
  const { mode, winnerTeam1, team1Wagers, team2Wagers, fixedWinnerReward } = params;
  const losingWagers = winnerTeam1 ? team2Wagers : team1Wagers;
  const losingTotal = losingWagers.reduce((sum, wager) => sum + wager, 0);
  const winningWagers = winnerTeam1 ? team1Wagers : team2Wagers;

  const zeroSumWinningGains = allocateWinningPool(winningWagers, losingTotal);

  if (mode === 'zero_sum') {
    return {
      team1: winnerTeam1 ? zeroSumWinningGains : team1Wagers.map((wager) => -wager),
      team2: winnerTeam1 ? team2Wagers.map((wager) => -wager) : zeroSumWinningGains,
      totalLosingPool: losingTotal,
    };
  }

  if (mode === 'winner_only_pool') {
    return {
      team1: winnerTeam1 ? zeroSumWinningGains : team1Wagers.map(() => 0),
      team2: winnerTeam1 ? team2Wagers.map(() => 0) : zeroSumWinningGains,
      totalLosingPool: losingTotal,
    };
  }

  return {
    team1: winnerTeam1 ? team1Wagers.map(() => fixedWinnerReward) : team1Wagers.map(() => 0),
    team2: winnerTeam1 ? team2Wagers.map(() => 0) : team2Wagers.map(() => fixedWinnerReward),
    totalLosingPool: losingTotal,
  };
}

export async function POST(request: Request) {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status });
  }

  const adminSupabase = context.adminSupabase;
  const activeClubId = context.clubId;
  const user = context.user;

  const body = await request.json().catch(() => null);
  const normalizedMatchId = Number(body?.match_id);
  const normalizedTeam1Score = Number(body?.team1_score);
  const normalizedTeam2Score = Number(body?.team2_score);
  const winnerTeam1 = body?.winner_team1;

  if (
    !Number.isFinite(normalizedMatchId) ||
    typeof winnerTeam1 !== 'boolean' ||
    !Number.isFinite(normalizedTeam1Score) ||
    !Number.isFinite(normalizedTeam2Score)
  ) {
    return NextResponse.json({ error: 'Invalid input data' }, { status: 400 });
  }

  if (normalizedTeam1Score < 0 || normalizedTeam2Score < 0) {
    return NextResponse.json({ error: '점수는 0 이상이어야 합니다.' }, { status: 400 });
  }

  if (normalizedTeam1Score === normalizedTeam2Score) {
    return NextResponse.json({ error: '무승부 결과는 저장할 수 없습니다.' }, { status: 400 });
  }

  if ((normalizedTeam1Score > normalizedTeam2Score) !== winnerTeam1) {
    return NextResponse.json({ error: '승리 팀과 점수가 일치하지 않습니다.' }, { status: 400 });
  }

  // 1. 프로필 정보 및 코인 세팅 병렬 조회
  const [currentProfile, coinSettings] = await Promise.all([
    getProfileByUserId(adminSupabase, user.id),
    readCoinSettings(),
  ]);

  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 2. 매치 데이터 및 기존 결과 테이블(최초 입력자 확인용) 병렬 조회
  const [matchRowResult, existingMatchResultResult] = await Promise.all([
    adminSupabase
      .from('generated_matches')
      .select('id, session_id, match_number, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, match_result, status')
      .eq('id', normalizedMatchId)
      .single<MatchParticipantRow & { status: string; match_result: any }>(),
    (adminSupabase
      .from('match_results') as any)
      .select('created_by')
      .eq('match_id', normalizedMatchId)
      .maybeSingle()
  ]);

  const matchRow = matchRowResult.data;
  const matchError = matchRowResult.error;
  const existingMatchResult = existingMatchResultResult.data as any;

  if (matchError || !matchRow) {
    return NextResponse.json({ error: '경기 정보를 찾을 수 없습니다.' }, { status: 404 });
  }

  const team1Ids = [matchRow.team1_player1_id, matchRow.team1_player2_id].filter((value): value is string => Boolean(value));
  const team2Ids = [matchRow.team2_player1_id, matchRow.team2_player2_id].filter((value): value is string => Boolean(value));
  const allParticipantIds = [...team1Ids, ...team2Ids];

  // 3. 매치 배팅 정보, 기존 코인 트랜잭션 정보, 선수 프로필 정보를 병렬 조회
  const [betsResult, transactionsResult, profilesResult] = await Promise.all([
    adminSupabase
      .from('match_coin_bets')
      .select('profile_id, wager_amount')
      .eq('match_id', normalizedMatchId),
    adminSupabase
      .from('profile_coin_transactions')
      .select('profile_id, delta, transaction_type, wager_amount')
      .eq('match_id', normalizedMatchId),
    adminSupabase
      .from('profiles')
      .select('id, coin_balance, coin_wins, coin_losses, full_name, username')
      .in('id', allParticipantIds),
  ]);

  if (betsResult.error) {
    return NextResponse.json({ error: betsResult.error.message }, { status: 500 });
  }

  if (profilesResult.error || !profilesResult.data) {
    return NextResponse.json({ error: '참여 선수의 코인 정보를 조회할 수 없습니다.' }, { status: 500 });
  }

  const betRows = betsResult.data;
  const participantProfiles = profilesResult.data;

  const team1Bets = [matchRow.team1_player1_id, matchRow.team1_player2_id]
    .filter((value): value is string => Boolean(value))
    .map((profileId) => (betRows || []).find((row) => row.profile_id === profileId)?.wager_amount ?? DEFAULT_MATCH_WAGER);
  const team2Bets = [matchRow.team2_player1_id, matchRow.team2_player2_id]
    .filter((value): value is string => Boolean(value))
    .map((profileId) => (betRows || []).find((row) => row.profile_id === profileId)?.wager_amount ?? DEFAULT_MATCH_WAGER);

  const hasRaisedBet = [...team1Bets, ...team2Bets].some((wager) => wager > DEFAULT_MATCH_WAGER);
  const symmetricRaisedBet =
    team1Bets.length > 0 &&
    team2Bets.length > 0 &&
    team1Bets.every((wager) => wager === team1Bets[0]) &&
    team2Bets.every((wager) => wager === team2Bets[0]) &&
    team1Bets[0] === team2Bets[0];

  if (hasRaisedBet && !symmetricRaisedBet) {
    return NextResponse.json(
      { error: '한 팀이 1코인 이상 올렸다면 상대팀도 동일한 코인으로 배팅해야 경기를 시작할 수 있습니다.' },
      { status: 400 }
    );
  }

  const existingTransactions = new Map<string, CoinTransactionRow>(
    (transactionsResult.data || []).map((row) => [row.profile_id, row as CoinTransactionRow])
  );

  const deltas = buildCoinDeltas({
    mode: coinSettings.settlementMode,
    winnerTeam1,
    team1Wagers: team1Bets,
    team2Wagers: team2Bets,
    fixedWinnerReward: coinSettings.fixedWinnerReward,
  });

  const profileRowMap = new Map(
    participantProfiles.map((row: any) => [row.id, row])
  );

  if (coinSettings.settlementMode === 'zero_sum') {
    const losingIds = winnerTeam1 ? team2Ids : team1Ids;
    const losingWagers = winnerTeam1 ? team2Bets : team1Bets;

    for (let index = 0; index < losingIds.length; index += 1) {
      const profileId = losingIds[index];
      const profileRow = profileRowMap.get(profileId);

      if (!profileRow) {
        return NextResponse.json({ error: '정산할 사용자 코인을 찾을 수 없습니다.' }, { status: 500 });
      }

      const priorDelta = existingTransactions.get(profileId)?.delta ?? 0;
      const nextBalance = (profileRow.coin_balance ?? 0) + priorDelta - losingWagers[index];
      if (nextBalance < 0) {
        return NextResponse.json({ error: '패배 팀 선수의 코인이 부족하여 정산할 수 없습니다.' }, { status: 400 });
      }
    }
  }

  const createdBy = existingMatchResult?.created_by || (matchRow.match_result as any)?.created_by || currentProfile.id;
  const updatedBy = currentProfile.id;

  const getProfileName = (id: string, allProfiles: any[], curProfile: any) => {
    if (id === curProfile.id) {
      return curProfile.full_name || curProfile.username || '선수';
    }
    const found = allProfiles.find(p => p.id === id);
    return found ? (found.full_name || found.username) : '선수';
  };

  const createdByName = getProfileName(createdBy, participantProfiles, currentProfile);
  const updatedByName = currentProfile.full_name || currentProfile.username || '선수';

  const matchResultPayload = {
    winner: winnerTeam1 ? 'team1' : 'team2',
    score: `${normalizedTeam1Score}:${normalizedTeam2Score}`,
    team1_score: normalizedTeam1Score,
    team2_score: normalizedTeam2Score,
    total_losing_pool: deltas.totalLosingPool,
    team1_bets: team1Bets,
    team2_bets: team2Bets,
    settlement_mode: coinSettings.settlementMode,
    fixed_winner_reward: coinSettings.fixedWinnerReward,
    completed_at: new Date().toISOString(),
    created_by: createdBy,
    created_by_name: createdByName,
    recorded_by: updatedBy,
    updated_by: updatedBy,
    updated_by_name: updatedByName,
  };

  const teamUpdates = [
    { ids: team1Ids, wagers: team1Bets, deltas: deltas.team1, teamSide: 'team1' as const },
    { ids: team2Ids, wagers: team2Bets, deltas: deltas.team2, teamSide: 'team2' as const },
  ];

  const updateProfilePromises = [];
  const transactionsToInsert = [];

  for (const team of teamUpdates) {
    for (let index = 0; index < team.ids.length; index += 1) {
      const profileId = team.ids[index];
      const nextDelta = team.deltas[index] ?? 0;
      const transactionType = nextDelta > 0 ? 'win' : 'loss';
      const previousTransaction = existingTransactions.get(profileId);
      const profileRow = profileRowMap.get(profileId);

      if (!profileRow) {
        return NextResponse.json({ error: '사용자 코인 정보를 찾을 수 없습니다.' }, { status: 500 });
      }

      const nextCoinBalance = coinSettings.isCoinEnabled
        ? Math.max(0, (profileRow.coin_balance ?? 0) + nextDelta - (previousTransaction?.delta ?? 0))
        : (profileRow.coin_balance ?? 0);
      const nextWins =
        (profileRow.coin_wins ?? 0)
        + (transactionType === 'win' ? 1 : 0)
        - (previousTransaction?.transaction_type === 'win' ? 1 : 0);
      const nextLosses =
        (profileRow.coin_losses ?? 0)
        + (transactionType === 'loss' ? 1 : 0)
        - (previousTransaction?.transaction_type === 'loss' ? 1 : 0);

      updateProfilePromises.push(
        adminSupabase
          .from('profiles')
          .update({
            coin_balance: nextCoinBalance,
            coin_wins: nextWins,
            coin_losses: nextLosses,
            coin_updated_at: new Date().toISOString(),
          })
          .eq('id', profileId)
      );

      if (coinSettings.isCoinEnabled) {
        transactionsToInsert.push({
          profile_id: profileId,
          match_id: normalizedMatchId,
          transaction_type: transactionType,
          delta: nextDelta,
          wager_amount: team.wagers[index] ?? DEFAULT_MATCH_WAGER,
          team_side: team.teamSide,
          team1_score: normalizedTeam1Score,
          team2_score: normalizedTeam2Score,
          recorded_by: currentProfile.id,
          updated_at: new Date().toISOString(),
          club_id: activeClubId
        });
      }
    }
  }

  // --- DB WRITE 쿼리 병렬 일괄 실행 (성능 극대화) ---
  const writePromises = [
    // 1. match_results upsert 시도 (created_by, updated_by, updated_at 컬럼 포함)
    adminSupabase
      .from('match_results')
      .upsert({
        match_id: normalizedMatchId,
        winner_team1: winnerTeam1,
        team1_score: normalizedTeam1Score,
        team2_score: normalizedTeam2Score,
        created_by: createdBy,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
        club_id: activeClubId
      }, { onConflict: 'match_id' })
      .then(async (res) => {
        // 만약 컬럼이 없어서 에러가 발생한 경우 (PGRST204 등), 기존 컬럼만으로 재시도 (fallback)
        if (res.error && (res.error.message.includes('column') || res.error.code === '42703')) {
          console.warn('⚠️ match_results 테이블에 created_by/updated_by 컬럼이 없음. 기존 컬럼으로 fallback 진행...');
          return adminSupabase
            .from('match_results')
            .upsert({
              match_id: normalizedMatchId,
              winner_team1: winnerTeam1,
              team1_score: normalizedTeam1Score,
              team2_score: normalizedTeam2Score,
              club_id: activeClubId
            }, { onConflict: 'match_id' });
        }
        return res;
      }),

    // 2. profile_coin_transactions 일괄 upsert (코인 기능 활성화 시에만 실행)
    ...(coinSettings.isCoinEnabled
      ? [
          adminSupabase
            .from('profile_coin_transactions')
            .upsert(transactionsToInsert, { onConflict: 'match_id,profile_id' })
        ]
      : []),

    // 3. generated_matches 업데이트
    adminSupabase
      .from('generated_matches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        match_result: matchResultPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedMatchId),

    // 4. match_schedules 업데이트
    adminSupabase
      .from('match_schedules')
      .update({
        status: 'completed',
        match_result: matchResultPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('generated_match_id', normalizedMatchId),

    // 5. 선수들의 코인/승패 프로필 업데이트
    ...updateProfilePromises
  ];

  const writeResults = await Promise.all(writePromises);
  
  // 에러 발생 여부 검사
  const failedWrite = writeResults.find((r) => r.error);
  if (failedWrite) {
    return NextResponse.json({ error: getFriendlyErrorMessage(failedWrite.error?.message || 'DB 저장 실패') }, { status: 500 });
  }

  let autoStartedMatchIds: number[] = [];
  let waitingMatchIds: number[] = [];

  if (matchRow.session_id) {
    try {
      const flowResult = await syncSessionMatchFlow(adminSupabase, matchRow.session_id, {
        completedMatchId: normalizedMatchId,
      });
      autoStartedMatchIds = flowResult.activatedMatchIds;
      const notificationResult = await notifyWaitingMatchesForSession(adminSupabase, matchRow.session_id);
      waitingMatchIds = notificationResult.waitingMatchIds;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '다음 경기 진행 처리에 실패했습니다.' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      data: matchResultPayload,
      auto_started_match_ids: autoStartedMatchIds,
      waiting_match_ids: waitingMatchIds,
      coinRules: {
        defaultWager: DEFAULT_MATCH_WAGER,
        maxWager: MAX_MATCH_WAGER,
        settlementMode: coinSettings.settlementMode,
        fixedWinnerReward: coinSettings.fixedWinnerReward,
        initialCoinBalance: coinSettings.initialCoinBalance,
      },
    },
    { status: 200 }
  );
}

export async function GET(request: Request) {
  const adminSupabase = await getFilteredAdminClient();
  const { searchParams } = new URL(request.url);
  const matchId = Number(searchParams.get('match_id'));

  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Missing match_id' }, { status: 400 });
  }

  const [{ data: resultRow, error: resultError }, { data: generatedMatch, error: generatedError }] = await Promise.all([
    adminSupabase
      .from('match_results')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle(),
    adminSupabase
      .from('generated_matches')
      .select('status, match_result, completed_at')
      .eq('id', matchId)
      .maybeSingle(),
  ]);

  if (resultError || generatedError) {
    return NextResponse.json(
      { error: resultError?.message || generatedError?.message || 'Failed to load match result' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      match_result: generatedMatch?.match_result || null,
      status: generatedMatch?.status || null,
      completed_at: generatedMatch?.completed_at || null,
      row: resultRow || null,
    },
    coinRules: {
      defaultWager: DEFAULT_MATCH_WAGER,
      maxWager: MAX_MATCH_WAGER,
    },
  });
}
