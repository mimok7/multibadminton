import { cookies } from 'next/headers';
import { getSupabaseServerClient, getUnfilteredSupabaseServerClient, getSupabaseAdminClient } from './supabase-server';

export const CLUB_COOKIE_NAME = 'active_club_id';

// 서버사이드: 현재 선택된 클럽 ID 가져오기
export async function getActiveClubId(): Promise<string | null> {
  const cookieStore = await cookies();
  const clubId = cookieStore.get(CLUB_COOKIE_NAME)?.value;
  return clubId || null;
}

// 사용자에게 속한 클럽 목록 가져오기
export async function getUserClubs() {
  const supabase = await getUnfilteredSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return [];
  }

  const adminSupabase = getSupabaseAdminClient();

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
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error) {
    console.error('Error fetching user clubs:', error);
    return [];
  }

  return data;
}
