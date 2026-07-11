import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';
import { getLevelScoreFromCode, type LevelInfoMap } from '@/lib/level-info';

async function requireAdmin() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { sessionId } = await params;

    const { data: matches, error } = await adminContext.adminSupabase
      .from('generated_matches')
      .select('id, session_id, match_number, status, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
      .eq('session_id', sessionId)
      .order('match_number', { ascending: true });

    if (error) {
      console.error('Admin generated matches GET error:', error);
      return NextResponse.json({ error: 'Failed to load generated matches' }, { status: 500 });
    }

    const rows = matches || [];
    const { data: clubMembers, error: membersError } = await adminContext.adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('status', 'active');

    if (membersError) {
      console.error('Admin session players lookup error:', membersError);
      return NextResponse.json({ error: 'Failed to load club players' }, { status: 500 });
    }

    const clubPlayerIds = (clubMembers || []).map((member) => member.user_id).filter(Boolean);
    const { data: clubProfiles, error: clubProfilesError } = clubPlayerIds.length > 0
      ? await adminContext.adminSupabase
        .from('profiles')
        .select('id, username, full_name, skill_level')
        .in('id', clubPlayerIds)
      : { data: [], error: null };

    if (clubProfilesError) {
      console.error('Admin session club profiles lookup error:', clubProfilesError);
      return NextResponse.json({ error: 'Failed to load club players' }, { status: 500 });
    }

    const availablePlayers = (clubProfiles || []).map((profile) => ({
      id: profile.id,
      name: profile.full_name || profile.username || '선수',
      skill_level: profile.skill_level || 'E2',
    }));

    if (rows.length === 0) {
      return NextResponse.json({ matches: [], players: availablePlayers });
    }

    const profileIds = Array.from(
      new Set(
        rows.flatMap((match) => [
          match.team1_player1_id,
          match.team1_player2_id,
          match.team2_player1_id,
          match.team2_player2_id,
        ]).filter((id): id is string => Boolean(id))
      )
    );

    const { data: profiles, error: profilesError } = await adminContext.adminSupabase
      .from('profiles')
      .select('id, username, full_name, skill_level')
      .in('id', profileIds);

    if (profilesError) {
      console.error('Admin profiles for generated matches GET error:', profilesError);
      return NextResponse.json({ error: 'Failed to load player profiles' }, { status: 500 });
    }

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

    const { data: levelRows, error: levelError } = await adminContext.adminSupabase
      .from('level_info')
      .select('code, name, score');

    if (levelError) {
      console.error('Admin level info for generated matches GET error:', levelError);
      return NextResponse.json({ error: 'Failed to load level info' }, { status: 500 });
    }

    const levelInfoMap = (levelRows || []).reduce<LevelInfoMap>((acc, row: any) => {
      if (row.code) {
        acc[String(row.code).trim().toLowerCase()] = {
          name: row.name || row.code,
          score: Number(row.score ?? 0),
        };
      }
      return acc;
    }, {});

    const { data: schedules, error: schedulesError } = await adminContext.adminSupabase
      .from('match_schedules')
      .select('generated_match_id')
      .in('generated_match_id', rows.map((match) => match.id));

    if (schedulesError) {
      console.error('Admin match schedules for generated matches GET error:', schedulesError);
      return NextResponse.json({ error: 'Failed to load schedule info' }, { status: 500 });
    }

    const scheduledIds = new Set(
      (schedules || [])
        .map((schedule) => schedule.generated_match_id)
        .filter((id): id is number => typeof id === 'number')
    );

    const getProfileName = (
      profile?: { username: string | null; full_name: string | null } | null,
      fallback = '선수'
    ) => profile?.full_name || profile?.username || fallback;

    const normalizedMatches = rows.map((match) => ({
      id: match.id,
      session_id: match.session_id,
      match_number: match.match_number,
      status: match.status || 'scheduled',
      team1_player1: {
        id: match.team1_player1_id,
        name: getProfileName(profileMap.get(match.team1_player1_id || '') || null, '선수1'),
        skill_level: profileMap.get(match.team1_player1_id || '')?.skill_level || 'E2',
        score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team1_player1_id || '')?.skill_level, 0),
      },
      team1_player2: {
        id: match.team1_player2_id,
        name: getProfileName(profileMap.get(match.team1_player2_id || '') || null, '선수2'),
        skill_level: profileMap.get(match.team1_player2_id || '')?.skill_level || 'E2',
        score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team1_player2_id || '')?.skill_level, 0),
      },
      team2_player1: {
        id: match.team2_player1_id,
        name: getProfileName(profileMap.get(match.team2_player1_id || '') || null, '선수3'),
        skill_level: profileMap.get(match.team2_player1_id || '')?.skill_level || 'E2',
        score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team2_player1_id || '')?.skill_level, 0),
      },
      team2_player2: {
        id: match.team2_player2_id,
        name: getProfileName(profileMap.get(match.team2_player2_id || '') || null, '선수4'),
        skill_level: profileMap.get(match.team2_player2_id || '')?.skill_level || 'E2',
        score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team2_player2_id || '')?.skill_level, 0),
      },
      is_scheduled: scheduledIds.has(match.id),
    }));

    return NextResponse.json({ matches: normalizedMatches, players: availablePlayers });
  } catch (error) {
    console.error('Admin generated matches GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) return adminContext.error;

    const { sessionId } = await params;
    const body = await request.json().catch(() => null);
    const matchId = Number(body?.matchId);
    const playerIds = [
      body?.team1_player1_id,
      body?.team1_player2_id,
      body?.team2_player1_id,
      body?.team2_player2_id,
    ].map((id) => typeof id === 'string' && id.trim() ? id.trim() : null);

    if (!Number.isInteger(matchId) || playerIds.some((id) => !id)) {
      return NextResponse.json({ error: '경기와 선수 4명을 모두 선택해 주세요.' }, { status: 400 });
    }

    const uniquePlayerIds = Array.from(new Set(playerIds)) as string[];
    if (uniquePlayerIds.length !== 4) {
      return NextResponse.json({ error: '한 경기에서 같은 선수를 중복 배정할 수 없습니다.' }, { status: 400 });
    }

    const { data: activeMembers, error: membersError } = await adminContext.adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('status', 'active')
      .in('user_id', uniquePlayerIds);

    if (membersError || (activeMembers || []).length !== uniquePlayerIds.length) {
      return NextResponse.json({ error: '현재 클럽에 소속된 선수만 배정할 수 있습니다.' }, { status: 400 });
    }

    const { data, error } = await adminContext.adminSupabase
      .from('generated_matches')
      .update({
        team1_player1_id: playerIds[0],
        team1_player2_id: playerIds[1],
        team2_player1_id: playerIds[2],
        team2_player2_id: playerIds[3],
      })
      .eq('id', matchId)
      .eq('session_id', sessionId)
      .select('id')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || '경기 배정 저장에 실패했습니다.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, matchId });
  } catch (error) {
    console.error('Admin generated match PUT unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { sessionId } = await params;
    const body = await request.json().catch(() => null);
    const matchId = typeof body?.matchId === 'string' ? body.matchId : '';

    if (!matchId) {
      return NextResponse.json({ error: 'Match id is required' }, { status: 400 });
    }

    const { error: scheduleDeleteError } = await adminContext.adminSupabase
      .from('match_schedules')
      .delete()
      .eq('generated_match_id', matchId);

    if (scheduleDeleteError) {
      console.error('Admin generated match schedule delete error:', scheduleDeleteError);
      return NextResponse.json({ error: 'Failed to delete linked schedule' }, { status: 500 });
    }

    const { error: matchDeleteError } = await adminContext.adminSupabase
      .from('generated_matches')
      .delete()
      .eq('id', matchId)
      .eq('session_id', sessionId);

    if (matchDeleteError) {
      console.error('Admin generated match delete error:', matchDeleteError);
      return NextResponse.json({ error: 'Failed to delete generated match' }, { status: 500 });
    }

    const { data: remainingMatches, error: remainingMatchesError } = await adminContext.adminSupabase
      .from('generated_matches')
      .select('id')
      .eq('session_id', sessionId)
      .order('match_number', { ascending: true });

    if (remainingMatchesError) {
      console.error('Admin generated match remaining lookup error:', remainingMatchesError);
      return NextResponse.json({ error: 'Failed to refresh session counts' }, { status: 500 });
    }

    const remainingCount = remainingMatches?.length || 0;

    await adminContext.adminSupabase
      .from('match_sessions')
      .update({
        total_matches: remainingCount,
        assigned_matches: remainingCount,
      })
      .eq('id', sessionId);

    return NextResponse.json({ success: true, remainingMatches: remainingCount });
  } catch (error) {
    console.error('Admin generated match DELETE unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
