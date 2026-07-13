import { NextResponse } from 'next/server';

import { isAdminRole } from '@/lib/auth';
import { getActiveClubId } from '@/lib/club';
import { getKoreaDate } from '@/lib/date';
import { inferScheduleSource } from '@/lib/match-schedule-source';
import { getUnfilteredGlobalAdminClient, getUnfilteredSupabaseServerClient } from '@/lib/supabase-server';

const scheduleSelect =
  'id, generated_match_id, schedule_source, match_date, start_time, end_time, location, max_participants, status, description, current_participants';
const activeParticipantStatuses = ['registered', 'attended', 'waitlisted'];

function responseHeaders(startedAt: number) {
  return {
    'Cache-Control': 'private, no-store',
    'Server-Timing': `app;dur=${(performance.now() - startedAt).toFixed(1)}`,
  };
}

export async function GET() {
  const startedAt = performance.now();
  try {
    const sessionClient = await getUnfilteredSupabaseServerClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clubId = await getActiveClubId();
    if (!clubId) return NextResponse.json({ schedules: [], participants: [], profiles: [] });

    const admin = getUnfilteredGlobalAdminClient();
    const { data: requester } = await admin
      .from('profiles')
      .select('id, user_id, role')
      .or(`user_id.eq.${user.id},id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();
    if (!requester) return NextResponse.json({ error: 'Profile not found' }, { status: 403 });

    if (!isAdminRole(requester.role)) {
      const { data: membership } = await admin
        .from('club_members')
        .select('user_id')
        .eq('club_id', clubId)
        .eq('user_id', requester.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!membership) return NextResponse.json({ error: '클럽 회원만 참가자 정보를 볼 수 있습니다.' }, { status: 403 });
    }

    const today = getKoreaDate();
    const buildSchedulesQuery = (includeSource: boolean) => admin
      .from('match_schedules')
      .select(includeSource ? scheduleSelect : scheduleSelect.replace('schedule_source, ', ''))
      .eq('club_id', clubId)
      .eq('status', 'scheduled')
      .gte('match_date', today)
      .order('match_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(100);

    let { data: rawSchedules, error: schedulesError } = await buildSchedulesQuery(true);
    if (schedulesError?.code === '42703') {
      ({ data: rawSchedules, error: schedulesError } = await buildSchedulesQuery(false));
    }
    if (schedulesError) throw schedulesError;

    let recurringCount = 0;
    const schedules = (rawSchedules || []).filter((schedule: any) => {
      const source = inferScheduleSource(schedule);
      if (source === 'recurring' && recurringCount < 10) {
        recurringCount += 1;
        return true;
      }
      return source === 'tournament';
    });
    const scheduleIds = schedules.map((schedule: any) => schedule.id);
    if (scheduleIds.length === 0) {
      return NextResponse.json({ schedules, participants: [], profiles: [] }, { headers: responseHeaders(startedAt) });
    }

    const { data: participants, error: participantsError } = await admin
      .from('match_participants')
      .select('id, user_id, status, registered_at, match_schedule_id')
      .in('match_schedule_id', scheduleIds)
      .in('status', activeParticipantStatuses);
    if (participantsError) throw participantsError;

    const participantIds = Array.from(new Set((participants || []).map((participant) => participant.user_id).filter(Boolean)));
    const [profilesByUserId, profilesById] = participantIds.length > 0
      ? await Promise.all([
        admin.from('profiles').select('id, user_id, username, full_name, skill_level').in('user_id', participantIds),
        admin.from('profiles').select('id, user_id, username, full_name, skill_level').in('id', participantIds),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (profilesByUserId.error || profilesById.error) throw profilesByUserId.error || profilesById.error;

    const profiles = [...(profilesByUserId.data || []), ...(profilesById.data || [])]
      .filter((profile, index, all) => all.findIndex((item) => item.id === profile.id) === index);

    return NextResponse.json({ schedules, participants: participants || [], profiles }, { headers: responseHeaders(startedAt) });
  } catch (error) {
    console.error('Match registration summary error:', error);
    return NextResponse.json({ error: '참가 신청 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
