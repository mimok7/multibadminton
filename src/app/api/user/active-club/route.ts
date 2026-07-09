import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getSupabaseAdminClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    
    // 유저 인증 확인
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ club: null });
    }

    const adminSupabase = getSupabaseAdminClient();
    let clubId = await getActiveClubId();
    let isClubValid = false;
    let memberData = null;
    let clubData = null;

    if (clubId) {
      // 1. Check if the club exists
      const { data: club } = await adminSupabase
        .from('clubs')
        .select('id, name, code')
        .eq('id', clubId)
        .single();
      
      if (club) {
        clubData = club;
        // 2. Check if the user is a member of this club
        const { data: member } = await adminSupabase
          .from('club_members')
          .select('role, coin_balance, coin_wins, coin_losses, status')
          .eq('club_id', clubId)
          .eq('user_id', user.id)
          .single();

        if (member && member.status === 'active') {
          isClubValid = true;
          memberData = member;
        }
      }
    }

    // Auto-heal: If no valid club cookie is found, auto-select the user's first active club
    if (!isClubValid) {
      const { data: userClubs } = await adminSupabase
        .from('club_members')
        .select('club_id, role, coin_balance, coin_wins, coin_losses, clubs!inner(id, name, code)')
        .eq('user_id', user.id)
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
        return NextResponse.json({ club: null, clubRole: null, member: null });
      }
    }

    return NextResponse.json({ 
      club: clubData, 
      clubRole: (memberData as any)?.role || null,
      member: memberData || null
    });

  } catch (error) {
    console.error('Error fetching active club:', error);
    return NextResponse.json({ club: null, clubRole: null, member: null }, { status: 500 });
  }
}
