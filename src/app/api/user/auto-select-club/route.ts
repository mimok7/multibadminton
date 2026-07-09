import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getSupabaseAdminClient } from '@/lib/supabase-server';
import { cookies } from 'next/headers';
import { CLUB_COOKIE_NAME } from '@/lib/club';

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    let user = null;

    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data } = await supabase.auth.getUser(token);
      user = data.user;
    } else {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const adminSupabase = getSupabaseAdminClient();

    // 사용자의 활성 클럽 목록 조회 (실존하는 클럽만)
    const { data: userClubs, error } = await adminSupabase
      .from('club_members')
      .select('club_id, clubs!inner(id)')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (error) {
      console.error('Error fetching user clubs for auto select:', error);
      return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
    }

    const cookieStore = await cookies();

    if (userClubs && userClubs.length > 0) {
      // 첫 번째 활성 클럽을 쿠키에 설정
      const clubId = userClubs[0].club_id;
      if (clubId) {
        cookieStore.set(CLUB_COOKIE_NAME, clubId, {
          path: '/',
          maxAge: 2592000, // 30일
          sameSite: 'lax',
        });
      }
      return NextResponse.json({ success: true, clubId });
    }

    // 속한 클럽이 없다면 이전 유저의 클럽 쿠키를 삭제
    cookieStore.delete(CLUB_COOKIE_NAME);
    return NextResponse.json({ success: false, error: 'No active clubs found' }, { status: 404 });
  } catch (error) {
    console.error('Auto select club error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
