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

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ club: null });
    }

    const adminSupabase = getSupabaseAdminClient();

    const { data, error } = await adminSupabase
      .from('clubs')
      .select('id, name, code')
      .eq('id', clubId)
      .single();

    if (error || !data) {
      return NextResponse.json({ club: null, clubRole: null });
    }

    // 클럽 내 사용자의 역할 및 스탯을 가져옴
    const { data: memberData } = await adminSupabase
      .from('club_members')
      .select('role, coin_balance, coin_wins, coin_losses')
      .eq('club_id', clubId)
      .eq('user_id', user.id)
      .single();

    return NextResponse.json({ 
      club: data, 
      clubRole: (memberData as any)?.role || null,
      member: memberData || null
    });

  } catch (error) {
    console.error('Error fetching active club:', error);
    return NextResponse.json({ club: null, clubRole: null, member: null }, { status: 500 });
  }
}
