import { NextResponse } from 'next/server';
import { getProfileByUserId, isAdminOrManagerRole } from '@/lib/auth';
import { DEFAULT_MATCH_WAGER } from '@/lib/coins';
import { notifyWaitingMatchesForSession } from '@/lib/match-preparation-notifications';
import { syncSessionMatchFlow } from '@/lib/match-session-flow';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

type MatchRow = {
  id: number;
  status: string | null;
  session_id?: string | null;
  match_number?: number | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};

export async function POST(request: Request) {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const matchId = Number(body?.match_id);
  const capacity = typeof body?.capacity === 'number' && body.capacity > 0 ? body.capacity : null;

  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match_id' }, { status: 400 });
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);
  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  const { data: matchRow, error: matchError } = await adminSupabase
    .from('generated_matches')
    .select('id, status, session_id, match_number, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
    .eq('id', matchId)
    .single<MatchRow>();

  if (matchError || !matchRow) {
    return NextResponse.json({ error: '경기 정보를 찾을 수 없습니다.' }, { status: 404 });
  }

  const participantIds = [
    matchRow.team1_player1_id,
    matchRow.team1_player2_id,
    matchRow.team2_player1_id,
    matchRow.team2_player2_id,
  ].filter((value): value is string => Boolean(value));

  const canManage = isAdminOrManagerRole(currentProfile.role) || participantIds.includes(currentProfile.id);
  if (!canManage) {
    return NextResponse.json({ error: '이 경기의 참가자 또는 관리자/매니저만 경기를 시작할 수 있습니다.' }, { status: 403 });
  }

  if (matchRow.status === 'completed' || matchRow.status === 'cancelled') {
    return NextResponse.json({ error: '완료되었거나 취소된 경기는 시작할 수 없습니다.' }, { status: 400 });
  }

  const { data: betRows, error: betError } = await adminSupabase
    .from('match_coin_bets')
    .select('profile_id, wager_amount')
    .eq('match_id', matchId);

  if (betError) {
    return NextResponse.json({ error: betError.message }, { status: 500 });
  }

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
      { status: 400 },
    );
  }

  if (matchRow.status === 'in_progress') {
    if (matchRow.session_id) {
      const { data: activeSessionMatches, error: activeSessionMatchesError } = await adminSupabase
        .from('generated_matches')
        .select('id')
        .eq('session_id', matchRow.session_id)
        .eq('status', 'in_progress');

      if (activeSessionMatchesError) {
        return NextResponse.json({ error: activeSessionMatchesError.message }, { status: 500 });
      }

      const activeIds = (activeSessionMatches || []).map((match) => match.id);
      if (activeIds.length > 0) {
        await adminSupabase
          .from('generated_matches')
          .update({ status: 'scheduled', updated_at: new Date().toISOString() })
          .in('id', activeIds);

        await adminSupabase
          .from('match_schedules')
          .update({ status: 'scheduled', updated_at: new Date().toISOString() })
          .in('generated_match_id', activeIds);
      }
    } else {
      const { error: generatedUpdateError } = await adminSupabase
        .from('generated_matches')
        .update({ status: 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', matchId);

      if (generatedUpdateError) {
        return NextResponse.json({ error: generatedUpdateError.message }, { status: 500 });
      }

      const { error: scheduleUpdateError } = await adminSupabase
        .from('match_schedules')
        .update({ status: 'scheduled', updated_at: new Date().toISOString() })
        .eq('generated_match_id', matchId);

      if (scheduleUpdateError) {
        return NextResponse.json({ error: scheduleUpdateError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      data: {
        match_id: matchId,
        status: 'scheduled',
        active_match_ids: [],
      },
    });
  }

  let activeMatchIds = [matchId];
  let waitingMatchIds: number[] = [];

  if (matchRow.session_id) {
    try {
      const flowResult = await syncSessionMatchFlow(adminSupabase, matchRow.session_id, {
        initialize: true,
        capacityOverride: capacity,
      });
      activeMatchIds = flowResult.activeMatchIds.length > 0 ? flowResult.activeMatchIds : activeMatchIds;
      const notificationResult = await notifyWaitingMatchesForSession(adminSupabase, matchRow.session_id);
      waitingMatchIds = notificationResult.waitingMatchIds;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '세션 경기 시작 처리에 실패했습니다.' },
        { status: 500 }
      );
    }
  } else {
    const { error: generatedUpdateError } = await adminSupabase
      .from('generated_matches')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', matchId);

    if (generatedUpdateError) {
      return NextResponse.json({ error: generatedUpdateError.message }, { status: 500 });
    }

    const { error: scheduleUpdateError } = await adminSupabase
      .from('match_schedules')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('generated_match_id', matchId);

    if (scheduleUpdateError) {
      return NextResponse.json({ error: scheduleUpdateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    data: {
      match_id: matchId,
      status: 'in_progress',
      active_match_ids: activeMatchIds,
      waiting_match_ids: waitingMatchIds,
    },
  });
}
