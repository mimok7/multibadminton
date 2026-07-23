import { NextResponse } from 'next/server';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';
import { readCoinSettings } from '@/lib/coin-settings';

function normalizeClubCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

async function findClubByCode(clubCode: string) {
  if (!clubCode) return null;

  const admin = getUnfilteredGlobalAdminClient();
  const { data, error } = await admin
    .from('clubs')
    .select('id, name, code')
    .eq('code', clubCode)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function GET(request: Request) {
  try {
    const clubCode = normalizeClubCode(new URL(request.url).searchParams.get('club'));
    const club = await findClubByCode(clubCode);

    if (!club) {
      return NextResponse.json({ error: '클럽을 찾을 수 없습니다.' }, { status: 404 });
    }

    const admin = getUnfilteredGlobalAdminClient();
    const { data: schedules, error } = await admin
      .from('match_schedules')
      .select('id, match_date, start_time, end_time, location, description, max_participants, current_participants')
      .eq('club_id', club.id)
      .eq('status', 'scheduled')
      .gte('match_date', getKoreaDate())
      .order('match_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Guest registration schedules lookup error:', error);
      return NextResponse.json({ error: '경기 일정을 불러오지 못했습니다.' }, { status: 500 });
    }

    return NextResponse.json(
      { club: { name: club.name, code: club.code }, schedules: schedules || [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Guest registration info error:', error);
    return NextResponse.json({ error: '게스트 신청 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let createdAuthUserId: string | null = null;

  try {
    const body = await request.json().catch(() => ({}));
    const clubCode = normalizeClubCode(body?.clubCode);
    const scheduleId = typeof body?.scheduleId === 'string' ? body.scheduleId : '';
    const trimmedName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
    const trimmedLevel = typeof body?.skillLevel === 'string' && body.skillLevel.trim() ? body.skillLevel.trim() : 'N3';

    if (!clubCode || !scheduleId) {
      return NextResponse.json({ error: '클럽과 참가할 경기를 선택해주세요.' }, { status: 400 });
    }
    if (trimmedName.length < 2) {
      return NextResponse.json({ error: '이름을 두 글자 이상 입력해주세요.' }, { status: 400 });
    }

    const club = await findClubByCode(clubCode);
    if (!club) {
      return NextResponse.json({ error: '클럽을 찾을 수 없습니다.' }, { status: 404 });
    }

    const admin = getUnfilteredGlobalAdminClient();
    const { data: schedule, error: scheduleError } = await admin
      .from('match_schedules')
      .select('id, match_date, description, max_participants')
      .eq('id', scheduleId)
      .eq('club_id', club.id)
      .eq('status', 'scheduled')
      .gte('match_date', getKoreaDate())
      .maybeSingle();

    if (scheduleError) {
      console.error('Guest registration schedule validation error:', scheduleError);
      return NextResponse.json({ error: '경기 일정을 확인하지 못했습니다.' }, { status: 500 });
    }
    if (!schedule) {
      return NextResponse.json({ error: '선택한 클럽에서 신청 가능한 경기가 아닙니다.' }, { status: 400 });
    }

    const { count, error: countError } = await admin
      .from('match_participants')
      .select('*', { count: 'exact', head: true })
      .eq('match_schedule_id', schedule.id)
      .in('status', ['registered', 'attended']);
    if (countError) {
      return NextResponse.json({ error: '경기 정원을 확인하지 못했습니다.' }, { status: 500 });
    }
    if ((count || 0) >= (schedule.max_participants ?? 20)) {
      return NextResponse.json({ error: '선택한 경기는 정원이 마감되었습니다.' }, { status: 400 });
    }

    const tempId = `${Date.now()}${Math.random().toString().slice(2, 6)}`;
    const email = `guest_${tempId}@badminton.com`;
    const { data: userData, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password: 'bad123!',
      email_confirm: true,
      user_metadata: { full_name: trimmedName, is_guest: true },
    });
    if (createUserError || !userData.user) {
      console.error('Guest user creation error:', createUserError);
      return NextResponse.json({ error: '게스트 계정을 생성하지 못했습니다.' }, { status: 500 });
    }
    createdAuthUserId = userData.user.id;

    const coinSettings = await readCoinSettings();
    const username = `${trimmedName} (게스트_${tempId.slice(-6)})`;
    const { data: profile, error: profileError } = await (admin as any)
      .from('profiles')
      .upsert({
        id: createdAuthUserId,
        user_id: createdAuthUserId,
        email,
        username,
        full_name: trimmedName,
        role: 'member',
        is_guest: true,
        skill_level: trimmedLevel,
        coin_balance: coinSettings.guestInitialCoin ?? 5,
      }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (profileError || !profile) throw profileError || new Error('Guest profile was not created');

    const { error: memberError } = await admin
      .from('club_members')
      .upsert({
        club_id: club.id,
        user_id: profile.id,
        role: 'guest',
        status: 'active',
        coin_balance: coinSettings.guestInitialCoin ?? 5,
      } as any, { onConflict: 'club_id,user_id' });
    if (memberError) throw memberError;

    const { error: participantError } = await admin
      .from('match_participants')
      .insert({
        match_schedule_id: schedule.id,
        user_id: profile.id,
        club_id: club.id,
        status: 'registered',
        notes: '클럽 게스트 신청',
      } as any);
    if (participantError) throw participantError;

    await admin
      .from('match_schedules')
      .update({ current_participants: (count || 0) + 1 })
      .eq('id', schedule.id)
      .eq('club_id', club.id);

    return NextResponse.json({ success: true, clubName: club.name, matchDescription: schedule.description || `${schedule.match_date} 경기` });
  } catch (error) {
    console.error('Guest registration error:', error);
    if (createdAuthUserId) {
      const admin = getUnfilteredGlobalAdminClient();
      await admin.auth.admin.deleteUser(createdAuthUserId);
    }
    return NextResponse.json({ error: '게스트 신청 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
