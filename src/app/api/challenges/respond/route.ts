import { NextResponse } from 'next/server';
import { getProfileByUserId } from '@/lib/auth';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';

type ChallengeRow = {
  id: string;
  challenger_id: string;
  partner_id: string;
  opponent1_id: string;
  opponent2_id: string;
  status: string;
  partner_response: string;
  opponent1_response: string;
  opponent2_response: string;
  club_id: string;
};

export async function POST(request: Request) {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getSupabaseAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);

  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const challengeId = String(body?.challenge_id || '').trim();
  const responseStatus = String(body?.response || '').trim();

  if (!challengeId || !['accepted', 'held'].includes(responseStatus)) {
    return NextResponse.json({ error: '응답 값이 올바르지 않습니다.' }, { status: 400 });
  }

  const { data: challenge, error: challengeError } = await adminSupabase
    .from('challenge_requests')
    .select('*')
    .eq('id', challengeId)
    .single<ChallengeRow>();

  if (challengeError || !challenge) {
    return NextResponse.json({ error: '도전 요청을 찾을 수 없습니다.' }, { status: 404 });
  }

  let updateField: 'partner_response' | 'opponent1_response' | 'opponent2_response' | null = null;

  if (challenge.partner_id === currentProfile.id) updateField = 'partner_response';
  if (challenge.opponent1_id === currentProfile.id) updateField = 'opponent1_response';
  if (challenge.opponent2_id === currentProfile.id) updateField = 'opponent2_response';

  if (!updateField) {
    return NextResponse.json({ error: '이 도전 요청에 응답할 권한이 없습니다.' }, { status: 403 });
  }

  const nextResponses = {
    partner_response: updateField === 'partner_response' ? responseStatus : challenge.partner_response,
    opponent1_response: updateField === 'opponent1_response' ? responseStatus : challenge.opponent1_response,
    opponent2_response: updateField === 'opponent2_response' ? responseStatus : challenge.opponent2_response,
  };

  const allAccepted = Object.values(nextResponses).every((value) => value === 'accepted');
  const anyHeld = Object.values(nextResponses).some((value) => value === 'held');
  const overallStatus = allAccepted ? 'accepted' : anyHeld ? 'held' : 'pending';

  const { error: updateError } = await adminSupabase
    .from('challenge_requests')
    .update({
      ...nextResponses,
      status: overallStatus,
      responded_at: overallStatus === 'pending' ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', challengeId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (overallStatus === 'accepted') {
    const today = getKoreaDate();
    
    let { data: session } = await adminSupabase
      .from('match_sessions')
      .select('id')
      .eq('session_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      const { data: newSession, error: sessionError } = await adminSupabase
        .from('match_sessions')
        .insert({
          session_name: '오늘의 게임',
          session_date: today,
          total_matches: 0,
          assigned_matches: 0,
          club_id: challenge.club_id,
        })
        .select('id')
        .single();
      if (!sessionError && newSession) {
        session = newSession;
      }
    }

    if (session) {
      const { data: maxMatchResult } = await adminSupabase
        .from('generated_matches')
        .select('match_number')
        .eq('session_id', session.id)
        .order('match_number', { ascending: false })
        .limit(1)
        .maybeSingle();
        
      const nextMatchNumber = (maxMatchResult?.match_number || 0) + 1;

      const { data: generatedMatch, error: matchInsertError } = await adminSupabase
        .from('generated_matches')
        .insert({
          session_id: session.id,
          match_number: nextMatchNumber,
          team1_player1_id: challenge.challenger_id,
          team1_player2_id: challenge.partner_id,
          team2_player1_id: challenge.opponent1_id,
          team2_player2_id: challenge.opponent2_id,
          status: 'scheduled',
          club_id: challenge.club_id,
        })
        .select('id')
        .single();

      if (matchInsertError) {
        console.error('Failed to create generated match for challenge:', matchInsertError);
      } else if (generatedMatch) {
        await adminSupabase.from('match_schedules').insert({
          generated_match_id: generatedMatch.id,
          match_date: today,
          scheduled_date: today,
          description: '[일반 경기] 제안 게임',
          status: 'scheduled',
          club_id: challenge.club_id,
        });
      }
    }
  }

  const responderName = currentProfile.full_name || currentProfile.username || '회원';
  const statusLabel = responseStatus === 'accepted' ? '수락' : '보류';

  await adminSupabase.from('notifications').insert({
    user_id: challenge.challenger_id,
    title: '도전 응답 도착',
    message: `${responderName}님이 도전 요청에 ${statusLabel} 응답을 남겼습니다.`,
    type: 'general',
    is_read: false,
    club_id: challenge.club_id,
  });

  return NextResponse.json({
    success: true,
    status: overallStatus,
  });
}
