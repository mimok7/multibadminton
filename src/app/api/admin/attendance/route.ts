import { NextResponse } from 'next/server';

import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole, isAdminRole } from '@/lib/auth';
import { getClubRole } from '@/lib/club-auth';
import { getActiveClubId } from '@/lib/club';
import { readCoinSettings } from '@/lib/coin-settings';

type AttendanceStatus = 'present' | 'lesson' | 'absent';

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === 'present' || value === 'lesson' || value === 'absent';
}

function getTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function requireAdmin() {
  const clubId = await getActiveClubId();
  if (!clubId) {
    return { error: NextResponse.json({ error: 'Club not selected' }, { status: 400 }) };
  }

  const supabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const [userRole, clubRole] = await Promise.all([
    getUserRole(supabase, user),
    getClubRole(adminSupabase, user.id, clubId),
  ]);
  const canManageClub = isAdminRole(userRole) || ['owner', 'admin', 'manager'].includes(clubRole || '');

  if (!canManageClub) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { adminSupabase, clubId };
}

async function syncAutoLinkedScheduleParticipants(params: {
  adminSupabase: any;
  attendedAt: string;
  userIds: string[];
  status: AttendanceStatus;
}) {
  const { adminSupabase, attendedAt, userIds, status } = params;

  const { data: baseSchedules, error: schedulesError } = await adminSupabase
    .from('match_schedules')
    .select('id')
    .eq('match_date', attendedAt)
    .is('generated_match_id', null)
    .order('start_time', { ascending: true });

  if (schedulesError) {
    console.error('Admin attendance schedule sync lookup error:', schedulesError);
    return { autoLinkedScheduleId: null as string | null };
  }

  if (!baseSchedules || baseSchedules.length !== 1) {
    return { autoLinkedScheduleId: null as string | null };
  }

  const autoLinkedScheduleId = baseSchedules[0].id;

  const { data: existingParticipants, error: existingParticipantsError } = await adminSupabase
    .from('match_participants')
    .select('id, user_id, status')
    .eq('match_schedule_id', autoLinkedScheduleId)
    .in('user_id', userIds);

  if (existingParticipantsError) {
    console.error('Admin attendance participant sync lookup error:', existingParticipantsError);
    return { autoLinkedScheduleId };
  }

  const existingByUserId = new Map((existingParticipants || []).map((participant: any) => [participant.user_id, participant]));

  if (status === 'present' || status === 'lesson') {
    const missingUserIds = userIds.filter((userId) => !existingByUserId.has(userId));

    if (missingUserIds.length > 0) {
      const { error: insertError } = await adminSupabase
        .from('match_participants')
        .insert(
          missingUserIds.map((userId) => ({
            match_schedule_id: autoLinkedScheduleId,
            user_id: userId,
            status: 'registered',
          }))
        );

      if (insertError) {
        console.error('Admin attendance participant sync insert error:', insertError);
      }
    }

    const reactivateParticipantIds = (existingParticipants || [])
      .filter((participant: any) => participant.status !== 'registered' && participant.status !== 'attended')
      .map((participant: any) => participant.id);

    if (reactivateParticipantIds.length > 0) {
      const { error: reactivateError } = await adminSupabase
        .from('match_participants')
        .update({
          status: 'registered',
          registered_at: new Date().toISOString(),
        })
        .in('id', reactivateParticipantIds);

      if (reactivateError) {
        console.error('Admin attendance participant sync reactivate error:', reactivateError);
      }
    }
  } else {
    const activeParticipantIds = (existingParticipants || [])
      .filter((participant: any) => participant.status === 'registered' || participant.status === 'attended')
      .map((participant: any) => participant.id);

    if (activeParticipantIds.length > 0) {
      const { error: cancelError } = await adminSupabase
        .from('match_participants')
        .update({ status: 'cancelled' })
        .in('id', activeParticipantIds);

      if (cancelError) {
        console.error('Admin attendance participant sync cancel error:', cancelError);
      }
    }
  }

  const { count, error: countError } = await adminSupabase
    .from('match_participants')
    .select('*', { count: 'exact', head: true })
    .eq('match_schedule_id', autoLinkedScheduleId)
    .in('status', ['registered', 'attended']);

  if (countError) {
    console.error('Admin attendance participant sync recount error:', countError);
    return { autoLinkedScheduleId };
  }

  const { error: scheduleUpdateError } = await adminSupabase
    .from('match_schedules')
    .update({ current_participants: count || 0 })
    .eq('id', autoLinkedScheduleId);

  if (scheduleUpdateError) {
    console.error('Admin attendance schedule count update error:', scheduleUpdateError);
  }

  return { autoLinkedScheduleId };
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) {
      return adminContext.error;
    }

    const body = await request.json().catch(() => null);
    const userIds: string[] = Array.isArray(body?.userIds)
      ? body.userIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    const status = body?.status;
    const attendedAt = typeof body?.attendedAt === 'string' && body.attendedAt ? body.attendedAt : getTodayLocal();

    if (!isAttendanceStatus(status)) {
      return NextResponse.json({ error: 'Invalid attendance status' }, { status: 400 });
    }

    if (userIds.length === 0) {
      return NextResponse.json({ error: 'User ids are required' }, { status: 400 });
    }

    const uniqueUserIds = Array.from(new Set(userIds));
    const { data: activeMembers, error: membersError } = await adminContext.adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('status', 'active')
      .in('user_id', uniqueUserIds);

    if (membersError) {
      console.error('Admin attendance membership validation error:', membersError);
      return NextResponse.json({ error: 'Failed to validate club members' }, { status: 500 });
    }

    const activeMemberIds = new Set((activeMembers || []).map((member) => member.user_id));
    const invalidUserIds = uniqueUserIds.filter((userId) => !activeMemberIds.has(userId));
    if (invalidUserIds.length > 0) {
      return NextResponse.json(
        { error: 'Selected user is not an active member of this club' },
        { status: 403 }
      );
    }

    // 1. 기존 출석 상태 목록 조회
    const { data: prevAttendances, error: lookupError } = await adminContext.adminSupabase
      .from('attendances')
      .select('user_id, status')
      .in('user_id', uniqueUserIds)
      .eq('attended_at', attendedAt);

    if (lookupError) {
      console.error('Admin attendance prev lookup error:', lookupError);
      return NextResponse.json({ error: 'Failed to lookup previous attendances' }, { status: 500 });
    }

    const prevStatusMap = new Map(
      (prevAttendances || []).map((row) => [row.user_id, row.status])
    );

    const { autoLinkedScheduleId } = await syncAutoLinkedScheduleParticipants({
      adminSupabase: adminContext.adminSupabase,
      attendedAt,
      userIds: uniqueUserIds,
      status,
    });

    const rows = uniqueUserIds.map((userId: string) => ({
      user_id: userId,
      attended_at: attendedAt,
      status,
      match_schedule_id: status === 'present' || status === 'lesson' ? autoLinkedScheduleId : null,
      club_id: adminContext.clubId,
    }));

    const { error } = await adminContext.adminSupabase
      .from('attendances')
      .upsert(rows, { onConflict: 'club_id,user_id,attended_at' });

    if (error) {
      console.error('Admin attendance save error:', error);
      return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 });
    }

    // 2. 코인 변동 적용
    const coinSettings = await readCoinSettings();
    const reward = coinSettings.attendanceReward ?? 10;

    if (coinSettings.isCoinEnabled && reward > 0) {
      const isNowPresent = status === 'present' || status === 'lesson';
      const rewardUserIds: string[] = [];
      const penaltyUserIds: string[] = [];

      uniqueUserIds.forEach((userId) => {
        const prevStatus = prevStatusMap.get(userId) || null;
        const wasPresent = prevStatus === 'present' || prevStatus === 'lesson';

        if (!wasPresent && isNowPresent) {
          rewardUserIds.push(userId);
        } else if (wasPresent && !isNowPresent) {
          penaltyUserIds.push(userId);
        }
      });

      if (rewardUserIds.length > 0) {
        const [{ data: rewardProfiles }, { data: rewardMembers }] = await Promise.all([
          adminContext.adminSupabase
            .from('profiles')
            .select('id, is_guest')
            .in('id', rewardUserIds),
          adminContext.adminSupabase
            .from('club_members')
            .select('user_id, coin_balance')
            .in('user_id', rewardUserIds),
        ]);

        if (rewardProfiles) {
          const balanceByUserId = new Map((rewardMembers || []).map((member) => [member.user_id, member.coin_balance]));
          await Promise.all(
            rewardProfiles.map((profile) => {
              const profileReward = profile.is_guest 
                ? (coinSettings.guestAttendanceReward ?? 5) 
                : reward;
              return adminContext.adminSupabase
                .from('club_members')
                .update({
                  coin_balance: (balanceByUserId.get(profile.id) ?? 0) + profileReward,
                })
                .eq('user_id', profile.id);
            })
          );
        }
      }

      if (penaltyUserIds.length > 0) {
        const [{ data: penaltyProfiles }, { data: penaltyMembers }] = await Promise.all([
          adminContext.adminSupabase
            .from('profiles')
            .select('id, is_guest')
            .in('id', penaltyUserIds),
          adminContext.adminSupabase
            .from('club_members')
            .select('user_id, coin_balance')
            .in('user_id', penaltyUserIds),
        ]);

        if (penaltyProfiles) {
          const balanceByUserId = new Map((penaltyMembers || []).map((member) => [member.user_id, member.coin_balance]));
          await Promise.all(
            penaltyProfiles.map((profile) => {
              const profilePenalty = profile.is_guest 
                ? (coinSettings.guestAttendanceReward ?? 5) 
                : reward;
              return adminContext.adminSupabase
                .from('club_members')
                .update({
                  coin_balance: Math.max(0, (balanceByUserId.get(profile.id) ?? 0) - profilePenalty),
                })
                .eq('user_id', profile.id);
            })
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      attendedAt,
      status,
      count: rows.length,
      autoLinkedScheduleId,
    });
  } catch (error) {
    console.error('Admin attendance POST unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
