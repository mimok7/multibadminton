import { cookies } from 'next/headers';
import { getUnfilteredSupabaseServerClient, getUnfilteredGlobalAdminClient } from './supabase-server';
import { getProfileByUserId } from './auth';
import { normalizeClubId } from './club-scope';

export const CLUB_COOKIE_NAME = 'active_club_id';

export async function getActiveClubId(): Promise<string | null> {
  const cookieStore = await cookies();
  return normalizeClubId(cookieStore.get(CLUB_COOKIE_NAME)?.value);
}

// 사용자에게 속한 클럽 목록 가져오기
export async function getUserClubs() {
  const supabase = await getUnfilteredSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return [];
  }

  // 클럽 선택 화면에서는 현재 쿠키로 목록을 제한하면 다른 가입 클럽이 사라진다.
  // service role은 이 함수 내부의 인증된 사용자 ID 조건으로만 제한해서 사용한다.
  const adminSupabase = getUnfilteredGlobalAdminClient();
  const profile = await getProfileByUserId(adminSupabase, user.id);
  if (!profile) return [];

  const { data, error } = await adminSupabase
    .from('club_members')
    .select(`
      club_id,
      role,
      status,
      clubs (
        id,
        name,
        code
      )
    `)
    .eq('user_id', profile.id)
    .eq('status', 'active');

  if (error) {
    console.error('Error fetching user clubs:', error);
    return [];
  }

  return data;
}
