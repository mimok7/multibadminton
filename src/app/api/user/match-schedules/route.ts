import { NextResponse } from 'next/server';

import { getActiveClubId } from '@/lib/club';
import { getKoreaDate } from '@/lib/date';
import { inferScheduleSource } from '@/lib/match-schedule-source';
import { getClubScopedAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

const scheduleSelect =
  'id, generated_match_id, schedule_source, match_date, start_time, end_time, location, max_participants, status, description, current_participants';

type ScheduleRow = {
  id: string;
  generated_match_id: number | null;
  schedule_source?: string | null;
  match_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  max_participants: number;
  status: string | null;
  description: string | null;
  current_participants: number;
};

export async function GET(request: Request) {
  try {
    const serverSupabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ schedules: [], clubId: null });
    }

    const adminSupabase = await getClubScopedAdminClient(clubId);
    const today = getKoreaDate();
    const requestedDate = new URL(request.url).searchParams.get('date');

    const buildQuery = (includeSource: boolean) => {
      let query = adminSupabase
        .from('match_schedules')
        .select(includeSource ? scheduleSelect : scheduleSelect.replace('schedule_source, ', ''))
        .eq('club_id', clubId)
        .eq('status', 'scheduled')
        .order('match_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(100);

      return requestedDate
        ? query.eq('match_date', requestedDate)
        : query.gte('match_date', today);
    };

    let { data, error } = await buildQuery(true);
    if (error?.code === '42703') {
      ({ data, error } = await buildQuery(false));
    }

    if (error) {
      console.error('User match schedules query error:', error);
      return NextResponse.json({ error: 'Failed to load match schedules' }, { status: 500 });
    }

    const schedules = ((data || []) as unknown as ScheduleRow[])
      .filter((schedule) => {
        const description = schedule.description || '';
        return (
          schedule.generated_match_id == null &&
          inferScheduleSource(schedule) !== 'generated' &&
          !description.includes('자동 배정된 경기')
        );
      })
      .map((schedule) => ({
        ...schedule,
        status: schedule.status || 'scheduled',
      }));

    return NextResponse.json({ schedules, clubId });
  } catch (error) {
    console.error('User match schedules API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
