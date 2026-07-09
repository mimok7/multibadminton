import { NextResponse } from 'next/server';
import { getFilteredAdminClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';
import { readCoinSettings } from '@/lib/coin-settings';

export async function POST(request: Request) {
  try {
    const { fullName, skillLevel } = await request.json().catch(() => ({ fullName: '', skillLevel: 'N3' }));
    const trimmedName = fullName?.trim();
    const trimmedLevel = skillLevel?.trim() || 'N3';

    if (!trimmedName) {
      return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 });
    }

    if (trimmedName.length < 2) {
      return NextResponse.json({ error: '이름을 두 글자 이상 입력해주세요.' }, { status: 400 });
    }

    const supabase = await getFilteredAdminClient();
    const todayStr = getKoreaDate();

    // 1. 오늘 열리는 경기 일정 중 정원이 남아 있는 일정을 가져온다.
    const { data: schedules, error: schedError } = await supabase
      .from('match_schedules')
      .select('id, current_participants, max_participants, description, start_time')
      .eq('match_date', todayStr)
      .eq('status', 'scheduled')
      .order('start_time', { ascending: true });

    if (schedError) {
      console.error('경기 일정 조회 실패:', schedError);
      return NextResponse.json({ error: '경기 일정을 확인하는 데 실패했습니다.' }, { status: 500 });
    }

    if (!schedules || schedules.length === 0) {
      return NextResponse.json(
        { error: '오늘 예정된 경기 일정이 없습니다.' },
        { status: 400 }
      );
    }

    // 정원 미달인 경기 찾기
    const availableSchedules = schedules.filter(
      (s) => (s.current_participants ?? 0) < (s.max_participants ?? 20)
    );

    if (availableSchedules.length === 0) {
      return NextResponse.json(
        { error: '오늘 경기 일정의 정원이 모두 마감되었습니다. 게스트 추가가 불가합니다.' },
        { status: 400 }
      );
    }

    // 첫 번째 참가 가능한 경기를 타겟으로 선정
    const targetSchedule = availableSchedules[0];

    // 2. 임시 게스트 계정 생성
    const tempId = Date.now() + Math.random().toString().slice(2, 6);
    const email = `guest_${tempId}@badminton.com`;
    const password = 'bad123!';

    const { data: userData, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: trimmedName,
        is_guest: true,
      }
    });

    if (createUserError || !userData.user) {
      console.error('게스트 사용자 생성 실패:', createUserError);
      return NextResponse.json({ error: '게스트 사용자 생성에 실패했습니다.' }, { status: 500 });
    }

    const userId = userData.user.id;

    // 3. profiles 테이블 업데이트
    const coinSettings = await readCoinSettings();
    const username = `${trimmedName} (게스트_${tempId})`;
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        username,
        full_name: trimmedName,
        is_guest: true,
        skill_level: trimmedLevel,
        coin_balance: coinSettings.guestInitialCoin ?? 5
      })
      .eq('id', userId);

    if (profileError) {
      console.error('게스트 프로필 업데이트 실패:', profileError);
      // 롤백
      await supabase.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: '게스트 프로필 생성에 실패했습니다.' }, { status: 500 });
    }

    // 4. 참가 신청 등록
    const { error: participateError } = await supabase
      .from('match_participants')
      .insert({
        match_schedule_id: targetSchedule.id,
        user_id: userId,
        status: 'registered',
        notes: '일일 게스트 신청'
      });

    if (participateError) {
      console.error('참가 신청 실패:', participateError);
      // 롤백
      await supabase.from('profiles').delete().eq('id', userId);
      await supabase.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: '참가 신청 처리에 실패했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      email,
      password,
      matchDescription: targetSchedule.description || '오늘 경기',
    });
  } catch (error) {
    console.error('register-guest error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
