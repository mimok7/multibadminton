import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';
import { getActiveClubId } from '@/lib/club';

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

export async function GET() {
  try {
    const resolved = await resolveProfileId();
    if ('error' in resolved) return resolved.error;

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ isRegistered: false, partner: null, availablePartners: [] });
    }

    const today = getKoreaDate();

    // 1. 오늘 출석부 조회 (status가 present, lesson인 사용자 수집)
    const { data: attendancesData } = await resolved.adminSupabase
      .from('attendances')
      .select('user_id, status, partner_user_id')
      .eq('attended_at', today)
      .eq('club_id', clubId);

    const activeUserIds = new Set<string>();
    let myAttendance = null;

    if (attendancesData) {
      for (const att of attendancesData) {
        if (att.user_id === resolved.profileId) {
          myAttendance = att;
        }
        if (att.status === 'present' || att.status === 'lesson') {
          if (att.user_id !== resolved.profileId) {
            activeUserIds.add(att.user_id);
          }
        }
      }
    }

    // 2. 오늘 경기 일정 및 참가자(registered) 조회
    const { data: schedules } = await resolved.adminSupabase
      .from('match_schedules')
      .select('id')
      .eq('match_date', today)
      .eq('club_id', clubId);

    let matchParticipant = null;
    if (schedules && schedules.length > 0) {
      const scheduleIds = schedules.map(s => s.id);
      const { data: participantsData } = await resolved.adminSupabase
        .from('match_participants')
        .select('user_id, status, partner_user_id')
        .in('match_schedule_id', scheduleIds);

      if (participantsData) {
        for (const p of participantsData) {
          if (p.user_id === resolved.profileId) {
            matchParticipant = p;
          }
          if (p.status === 'registered' || p.status === 'waitlisted') {
            if (p.user_id !== resolved.profileId) {
              activeUserIds.add(p.user_id);
            }
          }
        }
      }
    }

    // 3. 오늘 출석/등록된 선수들의 프로필 조회 (현재 사용자 제외, 게스트 포함)
    let availablePartners: Array<{ id: string; name: string; skill_level: string; gender: string }> = [];
    if (activeUserIds.size > 0) {
      const idList = Array.from(activeUserIds);
      const [profilesById, profilesByUserId] = await Promise.all([
        resolved.adminSupabase
          .from('profiles')
          .select('id, username, full_name, skill_level, gender, is_guest, user_id')
          .in('id', idList),
        resolved.adminSupabase
          .from('profiles')
          .select('id, username, full_name, skill_level, gender, is_guest, user_id')
          .in('user_id', idList),
      ]);

      const allFetched = [...(profilesById.data || []), ...(profilesByUserId.data || [])];
      // Deduplicate by profile id
      const uniqueProfiles = Array.from(new Map(allFetched.map(p => [p.id, p])).values());

      availablePartners = uniqueProfiles
        .filter(p => p.id !== resolved.profileId && p.user_id !== resolved.authUserId)
        .map(p => ({
          id: p.id,
          name: p.full_name || p.username || '선수',
          skill_level: p.skill_level || 'E2',
          gender: p.gender || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }

    const partnerId = matchParticipant?.partner_user_id || myAttendance?.partner_user_id || null;
    const isRegistered =
      matchParticipant?.status === 'registered' ||
      myAttendance?.status === 'present' ||
      myAttendance?.status === 'lesson';

    let partnerProfile = null;
    if (partnerId) {
      partnerProfile = availablePartners.find(p => p.id === partnerId) || null;
      if (!partnerProfile) {
        const { data: pData } = await resolved.adminSupabase
          .from('profiles')
          .select('id, username, full_name, skill_level, gender')
          .eq('id', partnerId)
          .maybeSingle();
        if (pData) {
          partnerProfile = {
            id: pData.id,
            name: pData.full_name || pData.username || '선수',
            skill_level: pData.skill_level || 'E2',
            gender: pData.gender || '',
          };
          if (!availablePartners.some(p => p.id === partnerProfile!.id)) {
            availablePartners.push(partnerProfile);
          }
        }
      }
    }

    return NextResponse.json({
      isRegistered,
      partner: partnerProfile,
      availablePartners,
    });
  } catch (err) {
    console.error('❌ 대회 준비 GET 오류:', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const resolved = await resolveProfileId();
    if ('error' in resolved) return resolved.error;

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: '선택된 클럽이 없습니다.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const partnerId = typeof body.partnerId === 'string' && body.partnerId.trim() !== '' ? body.partnerId : null;

    if (partnerId === resolved.profileId) {
      return NextResponse.json({ error: '본인을 파트너로 지정할 수 없습니다.' }, { status: 400 });
    }

    const today = getKoreaDate();

    // 1. 출석부 업데이트 (없거나 absent인 경우 present로 등록하면서 파트너 지정)
    const { data: prevAttendance } = await resolved.adminSupabase
      .from('attendances')
      .select('status')
      .eq('user_id', resolved.profileId)
      .eq('attended_at', today)
      .maybeSingle();

    const newStatus = prevAttendance && prevAttendance.status !== 'absent' ? prevAttendance.status : 'present';

    const { error: attendanceError } = await resolved.adminSupabase
      .from('attendances')
      .upsert(
        {
          user_id: resolved.profileId,
          attended_at: today,
          status: newStatus,
          partner_user_id: partnerId,
          club_id: clubId,
        },
        { onConflict: 'user_id,attended_at' }
      );

    if (attendanceError) {
      console.error('❌ 출석부 파트너 업데이트 실패:', attendanceError);
      return NextResponse.json({ error: '출석부 업데이트 중 오류가 발생했습니다.' }, { status: 500 });
    }

    // 2. 오늘의 경기 일정에 대한 참가자 정보도 함께 업데이트 / 등록
    const { data: schedules } = await resolved.adminSupabase
      .from('match_schedules')
      .select('id, club_id')
      .eq('match_date', today)
      .eq('club_id', clubId);

    if (schedules && schedules.length > 0) {
      for (const sched of schedules) {
        const { data: existingPart } = await resolved.adminSupabase
          .from('match_participants')
          .select('id, status')
          .eq('match_schedule_id', sched.id)
          .eq('user_id', resolved.profileId)
          .maybeSingle();

        if (existingPart) {
          await resolved.adminSupabase
            .from('match_participants')
            .update({ partner_user_id: partnerId, status: 'registered' })
            .eq('id', existingPart.id);
        } else {
          await resolved.adminSupabase
            .from('match_participants')
            .insert({
              match_schedule_id: sched.id,
              user_id: resolved.profileId,
              status: 'registered',
              partner_user_id: partnerId,
              club_id: sched.club_id,
            });
        }
      }
    }

    return NextResponse.json({ success: true, partnerId });
  } catch (err) {
    console.error('❌ 대회 준비 POST 오류:', err);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
