import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole, getProfileByUserId } from '@/lib/auth';
import { getActiveClubId } from '@/lib/club';
import { advanceBracketWinner, advanceLeagueFinalists, ensureBracketResultCanChange, type BracketMatch } from '@/lib/tournament-bracket';
import { fetchTournamentDayMatches, getAutomaticRefereeName } from '@/lib/tournament-referee';

type RouteContext = { params: Promise<{ matchId: string }> };

// referee_id / referee_name 은 마이그레이션으로 추가된 컬럼이라
// Supabase 생성 타입에 아직 반영되지 않았을 수 있으므로 확장 타입 사용
type MatchRow = Record<string, unknown>;

// GET: 매치 정보 조회
async function getMatchRefereeInfo(
  adminSupabase: any,
  match: MatchRow,
  currentProfileId: string | null,
  currentUserId: string | null,
  currentUserName: string | null,
  clubId: string
) {
  const refereeId = match.referee_id as string | null;
  let refereeName = match.referee_name as string | null;
  let isReferee = false;

  if (refereeName) {
    const cleanRefereeNames = refereeName
      .split(',')
      .map((name) => name.replace(/\([^)]*\)$/, '').trim().toLowerCase());
    const cleanCurrentUserName = (currentUserName || '')
      .replace(/\([^)]*\)$/, '')
      .trim()
      .toLowerCase();
    const isAssignedReferee =
      refereeId != null &&
      (refereeId === currentProfileId || refereeId === currentUserId);
    const isNamedReferee =
      Boolean(cleanCurrentUserName) && cleanRefereeNames.includes(cleanCurrentUserName);
    isReferee = isAssignedReferee || isNamedReferee;
  } else {
    const tournamentId = typeof match.tournament_id === 'string' ? match.tournament_id : '';
    const dayMatches = tournamentId
      ? await fetchTournamentDayMatches(adminSupabase, tournamentId, clubId)
      : [];
    refereeName = getAutomaticRefereeName(match, dayMatches);

    if (refereeName) {
      const automaticRefereeNames = refereeName
        .split(',')
        .map((name) => name.replace(/\([^)]*\)$/, '').trim());
      const cleanCurrentUserName = (currentUserName || '')
        .replace(/\([^)]*\)$/, '')
        .trim()
        .toLowerCase();
      isReferee = automaticRefereeNames.some(
        (name) => name.toLowerCase() === cleanCurrentUserName
      );

      if (currentProfileId && !isReferee) {
        const { data: winningProfiles } = await adminSupabase
          .from('profiles')
          .select('id')
          .in('full_name', automaticRefereeNames);
        if (winningProfiles) {
          isReferee = winningProfiles.some((profile: { id: string }) => profile.id === currentProfileId);
        }
      }
    }
  }

  return { refereeId, refereeName, isReferee };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { matchId } = await context.params;

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: 'No active club selected' }, { status: 400 });
    }

    const adminSupabase = await getFilteredAdminClient();

    const { data: rawMatch, error } = await adminSupabase
      .from('tournament_matches')
      .select('*')
      .eq('id', matchId)
      .eq('club_id', clubId)
      .single();
    const match = rawMatch as MatchRow | null;

    if (error || !match) {
      return NextResponse.json(
        { error: 'Match not found', details: error?.message },
        { status: 404 }
      );
    }

    // 현재 로그인 사용자 확인
    let currentProfileId: string | null = null;
    let currentUserId: string | null = null;
    let currentUserRole: string | null = null;
    let currentUserName: string | null = null;

    try {
      const serverSupabase = await getSupabaseServerClient();
      const { data: { user } } = await serverSupabase.auth.getUser();

      if (user) {
        currentUserId = user.id;
        currentUserRole = await getUserRole(serverSupabase, user);

        const profile = await getProfileByUserId(serverSupabase, user.id);
        if (profile) {
          currentProfileId = profile.id;
          currentUserName = profile.full_name || null;
        }
      }
    } catch {
      // 비로그인 사용자도 조회 가능
    }

    const { refereeId, refereeName, isReferee } = await getMatchRefereeInfo(
      adminSupabase,
      match,
      currentProfileId,
      currentUserId,
      currentUserName,
      clubId
    );
    const isAdmin = currentUserRole === 'admin' || currentUserRole === 'manager';
    const canEdit = isReferee || isAdmin;

    return NextResponse.json({
      match: {
        id: match.id,
        tournament_id: match.tournament_id,
        round: match.round,
        match_number: match.match_number,
        team1: match.team1,
        team2: match.team2,
        court: match.court,
        status: match.status,
        score_team1: (match.score_team1 as number | null) ?? 0,
        score_team2: (match.score_team2 as number | null) ?? 0,
        winner: match.winner,
        referee_id: refereeId,
        referee_name: refereeName,
      },
      canEdit,
      isReferee,
      isAdmin,
      currentUserName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// PATCH: 점수 업데이트 (심판 또는 관리자만)
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { matchId } = await context.params;

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: 'No active club selected' }, { status: 400 });
    }

    const adminSupabase = await getFilteredAdminClient();

    // 현재 매치 확인 (club_id filtered)
    const { data: rawMatch, error: matchError } = await adminSupabase
      .from('tournament_matches')
      .select('*')
      .eq('id', matchId)
      .eq('club_id', clubId)
      .single();
    const match = rawMatch as MatchRow | null;

    if (matchError || !match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    // 권한 검사 (심판 또는 관리자만)
    try {
      const serverSupabase = await getSupabaseServerClient();
      const { data: { user } } = await serverSupabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const currentUserRole = await getUserRole(serverSupabase, user);
      const profile = await getProfileByUserId(serverSupabase, user.id);
      const currentProfileId = profile?.id || null;
      const currentUserName = profile?.full_name || null;

      const isAdmin = currentUserRole === 'admin' || currentUserRole === 'manager';
      const { isReferee } = await getMatchRefereeInfo(
        adminSupabase,
        match,
        currentProfileId,
        user.id,
        currentUserName,
        clubId
      );

      if (!isReferee && !isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch (authError) {
      return NextResponse.json(
        { error: 'Authentication failed', details: String(authError) },
        { status: 401 }
      );
    }

    if (!Array.isArray(match.team1) || !Array.isArray(match.team2) || match.team1.length === 0 || match.team2.length === 0) {
      return NextResponse.json({ error: '참가 팀이 확정된 뒤에 결과를 저장할 수 있습니다.' }, { status: 409 });
    }

    const payload = await request.json().catch(() => null);
    const scoreTeam1 = typeof payload?.score_team1 === 'number' ? payload.score_team1 : null;
    const scoreTeam2 = typeof payload?.score_team2 === 'number' ? payload.score_team2 : null;

    if (scoreTeam1 == null || scoreTeam2 == null) {
      return NextResponse.json({ error: 'Invalid score payload' }, { status: 400 });
    }

    // 점수 업데이트 (경기 진행 중 상태로)
    const updateData: Record<string, unknown> = {
      score_team1: scoreTeam1,
      score_team2: scoreTeam2,
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    };

    const { data: updatedMatch, error: updateError } = await adminSupabase
      .from('tournament_matches')
      .update(updateData)
      .eq('id', matchId)
      .eq('club_id', clubId)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update score', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, match: updatedMatch });
  } catch (error) {
    return NextResponse.json(
      { error: 'Server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// POST: 경기 완료 처리
export async function POST(request: Request, context: RouteContext) {
  try {
    const { matchId } = await context.params;

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: 'No active club selected' }, { status: 400 });
    }

    const adminSupabase = await getFilteredAdminClient();

    // 현재 매치 확인 (club_id filtered)
    const { data: rawMatch, error: matchError } = await adminSupabase
      .from('tournament_matches')
      .select('*')
      .eq('id', matchId)
      .eq('club_id', clubId)
      .single();
    const match = rawMatch as MatchRow | null;

    if (matchError || !match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    // 권한 검사 (심판 또는 관리자만)
    try {
      const serverSupabase = await getSupabaseServerClient();
      const { data: { user } } = await serverSupabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const currentUserRole = await getUserRole(serverSupabase, user);
      const profile = await getProfileByUserId(serverSupabase, user.id);
      const currentProfileId = profile?.id || null;
      const currentUserName = profile?.full_name || null;

      const isAdmin = currentUserRole === 'admin' || currentUserRole === 'manager';
      const { isReferee } = await getMatchRefereeInfo(
        adminSupabase,
        match,
        currentProfileId,
        user.id,
        currentUserName,
        clubId
      );

      if (!isReferee && !isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch (authError) {
      return NextResponse.json(
        { error: 'Authentication failed', details: String(authError) },
        { status: 401 }
      );
    }

    const payload = await request.json().catch(() => null);
    const finalScore1 = typeof payload?.score_team1 === 'number' ? payload.score_team1 : ((match.score_team1 as number | null) ?? 0);
    const finalScore2 = typeof payload?.score_team2 === 'number' ? payload.score_team2 : ((match.score_team2 as number | null) ?? 0);

    const winner =
      finalScore1 > finalScore2 ? 'team1' : finalScore2 > finalScore1 ? 'team2' : 'draw';

    if ((match.next_match_id || match.competition_phase === 'preliminary' || match.competition_phase === 'ranking_final') && winner === 'draw') {
      return NextResponse.json({ error: '토너먼트 경기는 무승부로 종료할 수 없습니다.' }, { status: 400 });
    }

    try {
      await ensureBracketResultCanChange(adminSupabase, match as BracketMatch);
    } catch (advanceError) {
      return NextResponse.json(
        { error: advanceError instanceof Error ? advanceError.message : '토너먼트 진행 상태를 확인하지 못했습니다.' },
        { status: 409 }
      );
    }

    const { data: updatedMatch, error: updateError } = await adminSupabase
      .from('tournament_matches')
      .update({
        score_team1: finalScore1,
        score_team2: finalScore2,
        winner,
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .eq('club_id', clubId)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to complete match', details: updateError.message },
        { status: 500 }
      );
    }

    try {
      await advanceBracketWinner(adminSupabase, updatedMatch as BracketMatch);
      await advanceLeagueFinalists(adminSupabase, updatedMatch as BracketMatch);
    } catch (advanceError) {
      return NextResponse.json(
        {
          error: advanceError instanceof Error ? advanceError.message : '승자를 다음 라운드에 배정하지 못했습니다.',
          match: updatedMatch,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, match: updatedMatch, winner });
  } catch (error) {
    return NextResponse.json(
      { error: 'Server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
