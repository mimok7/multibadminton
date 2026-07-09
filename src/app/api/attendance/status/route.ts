import { NextResponse } from 'next/server';

import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { readCoinSettings } from '@/lib/coin-settings';
import { getActiveClubId } from '@/lib/club';

type AttendanceStatus = 'present' | 'lesson' | 'absent';

function getTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === 'present' || value === 'lesson' || value === 'absent';
}

async function resolveProfileId() {
  const [serverSupabase, adminSupabase] = await Promise.all([
    getSupabaseServerClient(),
    Promise.resolve(await getFilteredAdminClient()),
  ]);

  const {
    data: { user },
    error: userError,
  } = await serverSupabase.auth.getUser();

  if (userError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await adminSupabase
    .from('profiles')
    .select('id, user_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (profileError || !profile?.id) {
    return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) };
  }

  return {
    user,
    profileId: profile.id,
    authUserId: user.id,
    adminSupabase,
  };
}

export async function GET(request: Request) {
  try {
    const resolved = await resolveProfileId();
    if ('error' in resolved) {
      // 401 에러를 콘솔에 뿜지 않도록 GET 요청에서는 조용히 null 리턴
      return NextResponse.json({ status: null, attendedAt: getTodayLocal() });
    }

    const { searchParams } = new URL(request.url);
    const attendedAt = searchParams.get('date') || getTodayLocal();
    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ status: null, attendedAt });
    }

    const query = resolved.adminSupabase
      .from('attendances')
      .select('status')
      .eq('user_id', resolved.profileId)
      .eq('attended_at', attendedAt)
      .eq('club_id', clubId);

    const { data, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch attendance status' }, { status: 500 });
    }

    const status = isAttendanceStatus(data?.status) ? data.status : null;
    return NextResponse.json({ status, attendedAt });
  } catch (error) {
    return NextResponse.json({ error: 'Unexpected attendance status error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const resolved = await resolveProfileId();
    if ('error' in resolved) return resolved.error;

    const body = await request.json().catch(() => null);
    const status = body?.status;
    const attendedAt = typeof body?.attendedAt === 'string' && body.attendedAt ? body.attendedAt : getTodayLocal();
    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: 'Club not selected' }, { status: 400 });
    }

    if (!isAttendanceStatus(status)) {
      return NextResponse.json({ error: 'Invalid attendance status' }, { status: 400 });
    }

    // 1. 기존 출석 상태 조회
    const lookupQuery = resolved.adminSupabase
      .from('attendances')
      .select('status')
      .eq('user_id', resolved.profileId)
      .eq('attended_at', attendedAt)
      .eq('club_id', clubId);

    const { data: prevAttendance, error: lookupError } = await lookupQuery.maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: 'Failed to lookup previous attendance status' }, { status: 500 });
    }

    const prevStatus = prevAttendance?.status || null;

    // 2. 출석 상태 업데이트 (upsert)
    const { error } = await resolved.adminSupabase
      .from('attendances')
      .upsert(
        {
          user_id: resolved.profileId,
          attended_at: attendedAt,
          status,
          club_id: clubId,
        },
        { onConflict: 'club_id,user_id,attended_at' }
      );

    if (error) {
      return NextResponse.json({ error: 'Failed to save attendance status' }, { status: 500 });
    }

    // 3. 코인 변동 적용
    const wasPresent = prevStatus === 'present' || prevStatus === 'lesson';
    const isNowPresent = status === 'present' || status === 'lesson';

    if (wasPresent !== isNowPresent) {
      const coinSettings = await readCoinSettings();
      const reward = coinSettings.attendanceReward ?? 10;

      if (coinSettings.isCoinEnabled && reward > 0) {
        // profiles 에서 guest 여부 파악
        const { data: profile } = await resolved.adminSupabase
          .from('profiles')
          .select('is_guest')
          .eq('id', resolved.profileId)
          .single();

        if (profile && clubId) {
          // club_members 에서 해당 클럽 코인 잔액 조회
          const { data: memberInfo } = await resolved.adminSupabase
            .from('club_members')
            .select('coin_balance')
            .eq('club_id', clubId)
            .eq('user_id', resolved.authUserId)
            .single();

          const currentBalance = memberInfo?.coin_balance ?? 0;
          let nextBalance = currentBalance;
          const profileReward = profile.is_guest 
            ? (coinSettings.guestAttendanceReward ?? 5) 
            : reward;

          if (isNowPresent) {
            nextBalance += profileReward;
          } else {
            nextBalance = Math.max(0, nextBalance - profileReward);
          }

          // club_members 테이블의 코인 잔액 업데이트
          await resolved.adminSupabase
            .from('club_members')
            .update({
              coin_balance: nextBalance,
            })
            .eq('club_id', clubId)
            .eq('user_id', resolved.authUserId);
        }
      }
    }

    return NextResponse.json({ status, attendedAt, ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Unexpected attendance save error' }, { status: 500 });
  }
}
