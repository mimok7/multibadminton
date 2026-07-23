import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';
import { readCoinSettings } from '@/lib/coin-settings';

export async function GET() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'forbidden' ? 403 : 400;
    return NextResponse.json({ error: '게스트 추가 권한이 없습니다.' }, { status });
  }

  const [levelResult, aliasResult] = await Promise.all([
    context.adminSupabase.from('level_info').select('code, description, name, score').order('score', { ascending: true }),
    (context.adminSupabase as any).from('club_level_aliases').select('level_code, alias').eq('club_id', context.clubId),
  ]);
  if (levelResult.error || aliasResult.error) {
    return NextResponse.json({ error: '레벨 정보를 불러오지 못했습니다.' }, { status: 500 });
  }

  const aliasByCode = new Map((aliasResult.data || []).map((row: any) => [row.level_code, row.alias]));
  const levels = (levelResult.data || []).map((level: any) => ({
    code: level.code,
    // 클럽 별칭이 없을 때도 표준 설명(예: 소갈비 2단계)을 우선 표시한다.
    label: aliasByCode.get(level.code) || level.description || level.name || level.code,
  }));
  return NextResponse.json({ levels });
}

export async function POST(request: Request) {
  try {
    const context = await getClubManagerContext();
    if ('error' in context) {
      const status = context.error === 'unauthorized' ? 401 : context.error === 'forbidden' ? 403 : 400;
      return NextResponse.json({ error: '게스트 추가 권한이 없습니다.' }, { status });
    }

    const body = await request.json().catch(() => ({}));
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
    const skillLevel = typeof body?.skillLevel === 'string' && body.skillLevel.trim() ? body.skillLevel.trim() : 'N3';
    const gender = ['M', 'F', 'O'].includes(body?.gender) ? body.gender : null;
    if (fullName.length < 2) return NextResponse.json({ error: '이름을 두 글자 이상 입력해주세요.' }, { status: 400 });

    const { adminSupabase, clubId } = context;
    const token = `${Date.now()}${Math.random().toString().slice(2, 6)}`;
    const coinSettings = await readCoinSettings();
    const initialPassword = `G!${crypto.randomUUID()}9a`;
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: `guest_${token}@badminton.com`,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName, is_guest: true, must_change_password: true },
    });
    if (authError || !authData.user) {
      console.error('Manager guest auth creation error:', authError);
      return NextResponse.json({ error: '게스트 로그인 계정을 생성하지 못했습니다.' }, { status: 500 });
    }

    const { data: profile, error: profileError } = await (adminSupabase as any).from('profiles').upsert({
      id: authData.user.id,
      user_id: authData.user.id,
      email: authData.user.email,
      username: `${fullName} (게스트_${token.slice(-6)})`,
      full_name: fullName,
      role: 'member',
      skill_level: skillLevel,
      gender,
      is_guest: true,
      coin_balance: coinSettings.guestInitialCoin ?? 5,
    }, { onConflict: 'user_id' }).select('id').single();
    if (profileError || !profile) {
      await adminSupabase.auth.admin.deleteUser(authData.user.id);
      throw profileError || new Error('Guest profile was not created');
    }

    const { error: membershipError } = await (adminSupabase as any).from('club_members').upsert({
      club_id: clubId, user_id: profile.id, role: 'guest', status: 'active', coin_balance: coinSettings.guestInitialCoin ?? 5,
    }, { onConflict: 'club_id,user_id' });
    if (membershipError) throw membershipError;

    return NextResponse.json({ success: true, guest: { id: profile.id, fullName, skillLevel, initialPassword } });
  } catch (error) {
    console.error('Manager guest creation error:', error);
    return NextResponse.json({ error: '게스트 추가에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
