import { NextResponse } from 'next/server';
import { getProfileByUserId, isAdminRole } from '@/lib/auth';
import { DEFAULT_MATCH_WAGER, MAX_MATCH_WAGER } from '@/lib/coins';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

type MatchRow = {
  id: number;
  status: string;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};

async function getAuthorizedContext(matchId: number) {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getSupabaseAdminClient();
  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);

  if (!currentProfile) {
    return { error: NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 }) };
  }

  const { data: match, error: matchError } = await adminSupabase
    .from('generated_matches')
    .select('id, status, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
    .eq('id', matchId)
    .single<MatchRow>();

  if (matchError || !match) {
    return { error: NextResponse.json({ error: '경기를 찾을 수 없습니다.' }, { status: 404 }) };
  }

  const participantIds = [
    match.team1_player1_id,
    match.team1_player2_id,
    match.team2_player1_id,
    match.team2_player2_id,
  ].filter((value): value is string => Boolean(value));

  const isParticipant = participantIds.includes(currentProfile.id);

  if (!isParticipant && !isAdminRole(currentProfile.role)) {
    return { error: NextResponse.json({ error: '이 경기의 참가자 또는 관리자만 접근할 수 있습니다.' }, { status: 403 }) };
  }

  return {
    adminSupabase,
    currentProfile,
    match,
    participantIds,
  };
}

export async function GET(request: Request) {
  const matchId = Number(new URL(request.url).searchParams.get('match_id'));

  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Missing match_id' }, { status: 400 });
  }

  const context = await getAuthorizedContext(matchId);
  if ('error' in context) return context.error;

  const { adminSupabase, currentProfile, participantIds } = context;

  // Get current individual bets (for fallback if no proposal or rejected)
  const { data: betRows } = await adminSupabase
    .from('match_coin_bets')
    .select('profile_id, wager_amount')
    .eq('match_id', matchId);

  const bets = participantIds.map((profileId) => {
    const row = (betRows || []).find((item) => item.profile_id === profileId);
    return {
      profile_id: profileId,
      wager_amount: row?.wager_amount ?? DEFAULT_MATCH_WAGER,
    };
  });

  // Get current proposal
  const { data: proposalRow } = await adminSupabase
    .from('match_wager_proposals' as any)
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle(); // Use maybeSingle to avoid throw on no row

  let proposal = null;
  if (proposalRow) {
    const row = proposalRow as any;
    const responses = (row.responses as Record<string, string>) || {};
    proposal = {
      proposed_by: row.proposed_by,
      proposed_by_name: '누군가',
      wager_amount: row.wager_amount,
      status: row.status,
      my_response: responses[currentProfile.id] || null,
    };
  }

  return NextResponse.json({
    match_id: matchId,
    my_profile_id: currentProfile.id,
    defaultWager: DEFAULT_MATCH_WAGER,
    maxWager: MAX_MATCH_WAGER,
    bets,
    proposal,
  });
}

export async function POST(request: Request) {
  const clubId = await getActiveClubId();
  if (!clubId) {
    return NextResponse.json({ error: '선택된 클럽이 없습니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const matchId = Number(body?.match_id);
  const action = body?.action || 'propose'; // 'propose' or 'respond'

  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid input data' }, { status: 400 });
  }

  const context = await getAuthorizedContext(matchId);
  if ('error' in context) return context.error;

  const { adminSupabase, currentProfile, match, participantIds } = context;

  if (match.status === 'in_progress' || match.status === 'completed' || match.status === 'cancelled') {
    return NextResponse.json({ error: '진행중이거나 완료된 경기에는 배팅을 변경할 수 없습니다.' }, { status: 400 });
  }

  if (action === 'propose') {
    const wagerAmount = Number(body?.wager_amount);
    if (!Number.isInteger(wagerAmount)) {
      return NextResponse.json({ error: 'Invalid wager_amount' }, { status: 400 });
    }
    if (wagerAmount < DEFAULT_MATCH_WAGER || wagerAmount > MAX_MATCH_WAGER) {
      return NextResponse.json({ error: `배팅 코인은 ${DEFAULT_MATCH_WAGER}~${MAX_MATCH_WAGER}개만 가능합니다.` }, { status: 400 });
    }
    if ((currentProfile.coin_balance ?? 0) < wagerAmount) {
      return NextResponse.json({ error: '보유 코인보다 큰 배팅은 설정할 수 없습니다.' }, { status: 400 });
    }

    // Insert or update proposal
    const { error } = await adminSupabase
      .from('match_wager_proposals' as any)
      .upsert(
        {
          match_id: matchId,
          proposed_by: currentProfile.id,
          wager_amount: wagerAmount,
          status: 'pending',
          responses: {}, // clear responses
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id' }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reset everyone's actual bet to 1 while pending
    await adminSupabase.from('match_coin_bets').delete().eq('match_id', matchId);

    return NextResponse.json({ success: true, status: 'pending' });
  } 
  else if (action === 'respond') {
    const responseStr = body?.response;
    if (responseStr !== 'accept' && responseStr !== 'reject') {
      return NextResponse.json({ error: 'Invalid response' }, { status: 400 });
    }

    const { data: proposal } = await adminSupabase
      .from('match_wager_proposals' as any)
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();

    if (!proposal || (proposal as any).status !== 'pending') {
      return NextResponse.json({ error: '유효한 대기 중인 제안이 없습니다.' }, { status: 400 });
    }

    const propAny = proposal as any;
    if (propAny.proposed_by === currentProfile.id) {
      return NextResponse.json({ error: '제안자는 응답할 수 없습니다.' }, { status: 400 });
    }

    let newStatus = propAny.status;
    const responses = (propAny.responses as Record<string, string>) || {};
    
    responses[currentProfile.id] = responseStr;

    if (responseStr === 'reject') {
      newStatus = 'rejected';
      // Rest of the match_coin_bets are already default 1
    } else {
      // Check if everyone has accepted
      // Proposer is implicitly accepted. The other 3 must accept.
      const acceptCount = Object.values(responses).filter((r) => r === 'accept').length;
      if (acceptCount >= participantIds.length - 1) {
        newStatus = 'accepted';
        
        // Update all participants to the new wager
        const betUpserts = participantIds.map(pid => ({
          match_id: matchId,
          profile_id: pid,
          wager_amount: propAny.wager_amount,
          updated_at: new Date().toISOString(),
          club_id: clubId,
        }));

        await adminSupabase.from('match_coin_bets').upsert(betUpserts, { onConflict: 'match_id,profile_id' });
      }
    }

    const { error } = await adminSupabase
      .from('match_wager_proposals' as any)
      .update({
        status: newStatus,
        responses: responses,
        updated_at: new Date().toISOString(),
      })
      .eq('match_id', matchId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: newStatus });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
