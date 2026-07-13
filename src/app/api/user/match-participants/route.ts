import { NextRequest, NextResponse } from 'next/server';

import { getProfileByUserId, isAdminRole } from '@/lib/auth';
import { getActiveClubId } from '@/lib/club';
import { getUnfilteredGlobalAdminClient, getUnfilteredSupabaseServerClient } from '@/lib/supabase-server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const scheduleIds = Array.from(new Set(request.nextUrl.searchParams.getAll('scheduleId')))
    .filter((id) => UUID_PATTERN.test(id));

  if (scheduleIds.length === 0 || scheduleIds.length > 100) {
    return NextResponse.json({ error: '유효한 경기 일정이 필요합니다.' }, { status: 400 });
  }

  const supabase = await getUnfilteredSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const clubId = await getActiveClubId();

  if (!user || !clubId) {
    return NextResponse.json({ error: '인증 또는 활성 클럽 정보가 없습니다.' }, { status: 401 });
  }

  const adminSupabase = getUnfilteredGlobalAdminClient();
  const requester = await getProfileByUserId(adminSupabase, user.id);

  if (!requester) {
    return NextResponse.json({ error: '회원 프로필을 찾을 수 없습니다.' }, { status: 403 });
  }

  if (!isAdminRole(requester.role)) {
    const { data: membership } = await adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('club_id', clubId)
      .eq('user_id', requester.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: '클럽 회원만 참가자 정보를 볼 수 있습니다.' }, { status: 403 });
    }
  }

  const { data: schedules, error: schedulesError } = await adminSupabase
    .from('match_schedules')
    .select('id')
    .eq('club_id', clubId)
    .in('id', scheduleIds);

  if (schedulesError) {
    console.error('참가자 일정 확인 오류:', schedulesError);
    return NextResponse.json({ error: '경기 일정을 확인하지 못했습니다.' }, { status: 500 });
  }

  const allowedScheduleIds = (schedules || []).map((schedule) => schedule.id);
  if (allowedScheduleIds.length === 0) {
    return NextResponse.json({ profiles: [], participants: [] });
  }

  const { data: participants, error: participantsError } = await adminSupabase
    .from('match_participants')
    .select('id, user_id, status, registered_at, match_schedule_id')
    .in('match_schedule_id', allowedScheduleIds);

  if (participantsError) {
    console.error('참가자 조회 오류:', participantsError);
    return NextResponse.json({ error: '참가자 정보를 조회하지 못했습니다.' }, { status: 500 });
  }

  const participantIds = Array.from(new Set((participants || []).map((participant) => participant.user_id).filter(Boolean)));
  if (participantIds.length === 0) {
    return NextResponse.json({ profiles: [], participants: participants || [] });
  }

  const [profilesByUserId, profilesById] = await Promise.all([
    adminSupabase.from('profiles').select('id, user_id, username, full_name, skill_level').in('user_id', participantIds),
    adminSupabase.from('profiles').select('id, user_id, username, full_name, skill_level').in('id', participantIds),
  ]);
  const profilesError = profilesByUserId.error || profilesById.error;
  const profiles = [...(profilesByUserId.data || []), ...(profilesById.data || [])]
    .filter((profile, index, all) => all.findIndex((item) => item.id === profile.id) === index);

  if (profilesError) {
    console.error('참가자 프로필 조회 오류:', profilesError);
    return NextResponse.json({ error: '참가자 이름을 조회하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ profiles, participants: participants || [] });
}
