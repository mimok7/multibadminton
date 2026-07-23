import { NextResponse } from 'next/server';
import { getUnfilteredGlobalAdminClient, getUnfilteredSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';
import { isAdminRole } from '@/lib/auth';

export async function GET() {
  const startedAt = performance.now();
  const responseOptions = () => ({
    headers: {
      'Cache-Control': 'private, no-store',
      'Server-Timing': `app;dur=${(performance.now() - startedAt).toFixed(1)}`,
    },
  });

  try {
    const supabase = await getUnfilteredSupabaseServerClient();
    
    // 유저 인증 확인
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ club: null }, responseOptions());
    }

    const adminSupabase = getUnfilteredGlobalAdminClient();
    const [{ data: profile }, initialClubId] = await Promise.all([
      adminSupabase
        .from('profiles')
        .select('id, role')
        .or(`user_id.eq.${user.id},id.eq.${user.id}`)
        .limit(1)
        .maybeSingle(),
      getActiveClubId(),
    ]);

    if (!profile) {
      return NextResponse.json({ club: null, clubRole: null, member: null }, responseOptions());
    }

    const profileId = profile.id;
    let clubId = initialClubId;
    let isClubValid = false;
    let memberData = null;
    let clubData = null;

    if (clubId) {
      const [{ data: club }, { data: member }] = await Promise.all([
        adminSupabase
          .from('clubs')
          .select('id, name, code')
          .eq('id', clubId)
          .maybeSingle(),
        adminSupabase
          .from('club_members')
          .select('role, coin_balance, coin_wins, coin_losses, status')
          .eq('club_id', clubId)
          .eq('user_id', profileId)
          .maybeSingle(),
      ]);

      if (club) {
        clubData = club;
        if (member && member.status === 'active') {
          isClubValid = true;
          memberData = member;
        } else if (isAdminRole(profile.role)) {
          // 시스템 최고 관리자는 클럽 멤버가 아니어도 접근 가능
          isClubValid = true;
          memberData = {
            role: 'admin',
            coin_balance: 0,
            coin_wins: 0,
            coin_losses: 0,
          };
        }
      }
    }

    // Auto-heal: If no valid club cookie is found, auto-select the user's first active club
    if (!isClubValid) {
      const { data: userClubs } = await adminSupabase
        .from('club_members')
        .select('club_id, role, coin_balance, coin_wins, coin_losses, clubs!inner(id, name, code)')
        .eq('user_id', profileId)
        .eq('status', 'active');

      if (userClubs && userClubs.length > 0) {
        const firstClub = userClubs[0];
        clubId = firstClub.club_id || null;
        clubData = Array.isArray(firstClub.clubs) ? firstClub.clubs[0] : firstClub.clubs;
        memberData = {
          role: firstClub.role,
          coin_balance: firstClub.coin_balance,
          coin_wins: firstClub.coin_wins,
          coin_losses: firstClub.coin_losses,
        };

        // Set the new correct cookie
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        const { CLUB_COOKIE_NAME } = await import('@/lib/club');
        if (clubId) {
          cookieStore.set(CLUB_COOKIE_NAME, clubId, {
            path: '/',
            maxAge: 2592000,
            sameSite: 'lax',
          });
        }
      } else {
        // No active clubs found for this user at all
        return NextResponse.json({ club: null, clubRole: null, member: null }, responseOptions());
      }
    }

    return NextResponse.json({ 
      club: clubData, 
      clubRole: (memberData as any)?.role || null,
      member: memberData || null
    }, responseOptions());

  } catch (error) {
    console.error('Error fetching active club:', error);
    return NextResponse.json(
      { club: null, clubRole: null, member: null },
      { status: 500, ...responseOptions() }
    );
  }
}
