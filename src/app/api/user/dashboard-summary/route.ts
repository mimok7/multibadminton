import { NextResponse } from 'next/server';

import { isAdminRole } from '@/lib/auth';
import { getActiveClubId, CLUB_COOKIE_NAME } from '@/lib/club';
import { readCoinSettings } from '@/lib/coin-settings';
import { getKoreaDate } from '@/lib/date';
import { inferScheduleSource } from '@/lib/match-schedule-source';
import { getUnfilteredGlobalAdminClient, getUnfilteredSupabaseServerClient } from '@/lib/supabase-server';
import { cookies } from 'next/headers';

const scheduleSelect =
  'id, generated_match_id, schedule_source, match_date, start_time, end_time, location, max_participants, status, description, current_participants';

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
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getUnfilteredGlobalAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, role')
      .or(`user_id.eq.${user.id},id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    let clubId = await getActiveClubId();
    let club: { id: string; name: string } | null = null;
    let member: { role: string; coin_balance: number; coin_wins: number; coin_losses: number } | null = null;

    if (clubId) {
      const [clubResult, memberResult] = await Promise.all([
        admin.from('clubs').select('id, name').eq('id', clubId).maybeSingle(),
        admin.from('club_members')
          .select('role, coin_balance, coin_wins, coin_losses, status')
          .eq('club_id', clubId)
          .eq('user_id', profile.id)
          .maybeSingle(),
      ]);

      if (clubResult.data && (memberResult.data?.status === 'active' || isAdminRole(profile.role))) {
        club = clubResult.data;
        member = memberResult.data?.status === 'active'
          ? memberResult.data
          : { role: 'admin', coin_balance: 0, coin_wins: 0, coin_losses: 0 };
      }
    }

    // 오래된/없는 클럽 쿠키는 첫 활성 클럽으로 복구합니다.
    if (!club) {
      const { data: memberships } = await admin
        .from('club_members')
        .select('club_id, role, coin_balance, coin_wins, coin_losses, clubs!inner(id, name)')
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .limit(1);
      const first = memberships?.[0] as any;
      if (first?.club_id && first.clubs) {
        const selectedClubId = first.club_id as string;
        clubId = selectedClubId;
        club = Array.isArray(first.clubs) ? first.clubs[0] : first.clubs;
        member = {
          role: first.role,
          coin_balance: first.coin_balance ?? 0,
          coin_wins: first.coin_wins ?? 0,
          coin_losses: first.coin_losses ?? 0,
        };
        (await cookies()).set(CLUB_COOKIE_NAME, selectedClubId, { path: '/', maxAge: 2592000, sameSite: 'lax' });
      }
    }

    if (!club || !clubId || !member) {
      return NextResponse.json({
        club: null,
        member: null,
        isCoinEnabled: false,
        attendanceStatus: null,
        schedules: [],
        registration: null,
      });
    }

    const today = getKoreaDate();
    const [coinSettings, attendanceResult, schedulesResult] = await Promise.all([
      readCoinSettings(),
      admin.from('attendances')
        .select('status')
        .eq('club_id', clubId)
        .eq('user_id', profile.id)
        .eq('attended_at', today)
        .maybeSingle(),
      admin.from('match_schedules')
        .select(scheduleSelect)
        .eq('club_id', clubId)
        .eq('status', 'scheduled')
        .eq('match_date', today)
        .order('start_time', { ascending: true }),
    ]);

    if (schedulesResult.error) throw schedulesResult.error;
    const schedules = (schedulesResult.data || []).filter((schedule: any) => {
      const description = schedule.description || '';
      return schedule.generated_match_id == null
        && inferScheduleSource(schedule) !== 'generated'
        && !description.includes('자동 배정된 경기');
    });

    const scheduleIds = schedules.map((schedule: any) => schedule.id);
    const { data: registrations, error: registrationsError } = scheduleIds.length > 0
      ? await admin.from('match_participants')
        .select('id, user_id, status, registered_at, match_schedule_id')
        .in('match_schedule_id', scheduleIds)
        .or(`user_id.eq.${profile.id},user_id.eq.${user.id}`)
      : { data: [], error: null };
    if (registrationsError) throw registrationsError;

    const registration = (registrations || []).find((item: any) =>
      ['registered', 'waitlisted', 'attended'].includes(item.status)
    ) || null;

    return NextResponse.json({
      club,
      member,
      isCoinEnabled: coinSettings.isCoinEnabled !== false,
      attendanceStatus: attendanceResult.data?.status ?? null,
      schedules,
      registration,
    }, { headers: responseHeaders(startedAt) });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard summary' }, { status: 500 });
  }
}
