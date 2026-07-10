'use server';

import { cookies } from 'next/headers';
import { CLUB_COOKIE_NAME } from '@/lib/club';
import { getUnfilteredGlobalAdminClient, getUnfilteredSupabaseServerClient } from '@/lib/supabase-server';
import { getClubRole } from '@/lib/club-auth';
import { getUserRole } from '@/lib/auth';

export async function setActiveClubAction(clubId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clubId)) {
    return { success: false, error: '올바르지 않은 클럽입니다.' };
  }

  const supabase = await getUnfilteredSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: '로그인이 필요합니다.' };

  const admin = getUnfilteredGlobalAdminClient();
  const [clubRole, systemRole] = await Promise.all([
    getClubRole(admin, user.id, clubId),
    getUserRole(admin, user),
  ]);

  if (!clubRole && systemRole !== 'admin') {
    return { success: false, error: '가입하지 않은 클럽은 선택할 수 없습니다.' };
  }

  const cookieStore = await cookies();
  
  // 쿠키를 30일간 유지하도록 설정
  cookieStore.set(CLUB_COOKIE_NAME, clubId, {
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });

  return { success: true };
}

export async function clearActiveClubAction() {
  const cookieStore = await cookies();
  cookieStore.delete(CLUB_COOKIE_NAME);
  return { success: true };
}
