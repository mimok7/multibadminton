import { NextResponse } from 'next/server';

import { getClubManagerContext } from '@/lib/manager-access';
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
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: context.error }, { status }) };
  }

  return { adminSupabase: context.adminSupabase, clubId: context.clubId };
}

async function syncAutoLinkedScheduleParticipants(params: {
  adminSupabase: any;
  clubId: string;
  attendedAt: string;
  userIds: string[];
  status: AttendanceStatus;
}) {
  const { adminSupabase, clubId, attendedAt, userIds, status } = params;

  const { data: baseSchedules, error: schedulesError } = await adminSupabase
    .from('match_schedules')
    .select('id')
    .eq('club_id', clubId)
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
    .eq('club_id', clubId)
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
    .eq('club_id', clubId)
    .eq('match_schedule_id', autoLinkedScheduleId)
    .in('status', ['registered', 'attended']);

  if (countError) {
    console.error('Admin attendance participant sync recount error:', countError);
    return { autoLinkedScheduleId };
  }

  const { error: scheduleUpdateError } = await adminSupabase
    .from('match_schedules')
    .update({ current_participants: count || 0 })
    .eq('club_id', clubId)
    .eq('id', autoLinkedScheduleId);

  if (scheduleUpdateError) {
    console.error('Admin attendance schedule count update error:', scheduleUpdateError);
  }

  return { autoLinkedScheduleId };
}

export async function GET(request: Request) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) {
      return adminContext.error;
    }

    const requestUrl = new URL(request.url);
    const requestedDate = requestUrl.searchParams.get('attendedAt') || getTodayLocal();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return NextResponse.json({ error: 'Invalid attendance date' }, { status: 400 });
    }

    const { data: attendanceRows, error: attendanceError } = await adminContext.adminSupabase
      .from('attendances')
      .select('user_id, status, partner_user_id')
      .eq('club_id', adminContext.clubId)
      .eq('attended_at', requestedDate)
      .order('created_at', { ascending: true });

    if (attendanceError) {
      console.error('Admin attendance list error:', attendanceError);
      return NextResponse.json({ error: 'Failed to load attendances' }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((attendanceRows || []).map((attendance) => attendance.user_id).filter(Boolean))
    );

    if (userIds.length === 0) {
      return NextResponse.json({ attendedAt: requestedDate, players: [] });
    }

    const [profilesByIdResult, profilesByAuthIdResult, levelInfoResult] = await Promise.all([
      adminContext.adminSupabase
        .from('profiles')
        .select('id, user_id, username, full_name, skill_level, gender')
        .in('id', userIds),
      adminContext.adminSupabase
        .from('profiles')
        .select('id, user_id, username, full_name, skill_level, gender')
        .in('user_id', userIds),
      adminContext.adminSupabase
        .from('level_info')
        .select('code, name, score'),
    ]);

    const profileError = profilesByIdResult.error || profilesByAuthIdResult.error || levelInfoResult.error;
    if (profileError) {
      console.error('Admin attendance profile list error:', profileError);
      return NextResponse.json({ error: 'Failed to load attendance profiles' }, { status: 500 });
    }

    const profilesByIdentity = new Map<string, (typeof profilesByIdResult.data)[number]>();
    [...(profilesByIdResult.data || []), ...(profilesByAuthIdResult.data || [])].forEach((profile) => {
      profilesByIdentity.set(profile.id, profile);
      if (profile.user_id) profilesByIdentity.set(profile.user_id, profile);
    });

    const levelByCode = new Map(
      (levelInfoResult.data || []).map((level) => [
        String(level.code || '').trim().toUpperCase(),
        {
          label: level.name || level.code,
          score: Number(level.score ?? 0),
        },
      ])
    );

    const players = (attendanceRows || []).map((attendance) => {
      const profile = profilesByIdentity.get(attendance.user_id);
      const skillLevel = String(profile?.skill_level || 'E2').trim().toUpperCase();
      const levelInfo = levelByCode.get(skillLevel);
      return {
        id: profile?.id || attendance.user_id,
        name:
          profile?.full_name ||
          profile?.username ||
          `선수-${String(attendance.user_id).slice(0, 8)}`,
        skill_level: skillLevel,
        skill_label: levelInfo?.label || skillLevel,
        score: levelInfo?.score ?? 0,
        gender: profile?.gender || '',
        status: isAttendanceStatus(attendance.status) ? attendance.status : 'absent',
        partner_user_id: attendance.partner_user_id || null,
      };
    });

    return NextResponse.json({ attendedAt: requestedDate, players });
  } catch (error) {
    console.error('Admin attendance GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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
    const requestedScheduleIds: string[] = Array.isArray(body?.scheduleIds)
      ? body.scheduleIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')
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
    const uniqueScheduleIds = Array.from(new Set(requestedScheduleIds));

    if (uniqueScheduleIds.length > 0) {
      const { data: requestedSchedules, error: schedulesError } = await adminContext.adminSupabase
        .from('match_schedules')
        .select('id')
        .eq('club_id', adminContext.clubId)
        .eq('match_date', attendedAt)
        .in('id', uniqueScheduleIds);

      if (schedulesError) {
        console.error('Admin attendance schedule validation error:', schedulesError);
        return NextResponse.json({ error: 'Failed to validate match schedules' }, { status: 500 });
      }

      if ((requestedSchedules || []).length !== uniqueScheduleIds.length) {
        return NextResponse.json(
          { error: 'Selected schedule does not belong to this club or date' },
          { status: 400 }
        );
      }

      const { data: requestedParticipants, error: participantsError } = await adminContext.adminSupabase
        .from('match_participants')
        .select('user_id')
        .eq('club_id', adminContext.clubId)
        .in('match_schedule_id', uniqueScheduleIds)
        .in('user_id', uniqueUserIds)
        .in('status', ['registered', 'attended']);

      if (participantsError) {
        console.error('Admin attendance participant validation error:', participantsError);
        return NextResponse.json({ error: 'Failed to validate match participants' }, { status: 500 });
      }

      const participantUserIds = new Set((requestedParticipants || []).map((participant) => participant.user_id));
      if (uniqueUserIds.some((userId) => !participantUserIds.has(userId))) {
        return NextResponse.json(
          { error: 'Selected user is not registered for this date' },
          { status: 400 }
        );
      }
    }

    const { data: activeMembers, error: membersError } = await adminContext.adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('club_id', adminContext.clubId)
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
      .select('id, user_id, status')
      .eq('club_id', adminContext.clubId)
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
      clubId: adminContext.clubId,
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

    const existingAttendanceIds = (prevAttendances || [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (existingAttendanceIds.length > 0) {
      const { error: updateError } = await adminContext.adminSupabase
        .from('attendances')
        .update({
          status,
          match_schedule_id: status === 'present' || status === 'lesson' ? autoLinkedScheduleId : null,
        })
        .in('id', existingAttendanceIds);

      if (updateError) {
        console.error('Admin attendance update error:', updateError);
        return NextResponse.json({ error: 'Failed to update attendance' }, { status: 500 });
      }
    }

    const existingUserIds = new Set((prevAttendances || []).map((row) => row.user_id));
    const rowsToInsert = rows.filter((row) => !existingUserIds.has(row.user_id));

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await adminContext.adminSupabase
        .from('attendances')
        .insert(rowsToInsert);

      if (insertError) {
        console.error('Admin attendance insert error:', insertError);
        return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 });
      }
    }

    if (uniqueScheduleIds.length > 0) {
      const participantStatus = status === 'present' || status === 'lesson' ? 'attended' : 'absent';
      const { error: participantStatusError } = await adminContext.adminSupabase
        .from('match_participants')
        .update({ status: participantStatus })
        .eq('club_id', adminContext.clubId)
        .in('match_schedule_id', uniqueScheduleIds)
        .in('user_id', uniqueUserIds)
        .in('status', ['registered', 'attended', 'absent']);

      if (participantStatusError) {
        console.error('Admin attendance participant status update error:', participantStatusError);
        return NextResponse.json(
          { error: 'Attendance was saved, but participant status update failed' },
          { status: 500 }
        );
      }
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
            .eq('club_id', adminContext.clubId)
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
                .eq('club_id', adminContext.clubId)
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
            .eq('club_id', adminContext.clubId)
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
                .eq('club_id', adminContext.clubId)
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
