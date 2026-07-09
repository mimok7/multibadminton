import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getFilteredAdminClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const adminSupabase = await getFilteredAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ members: [] });
    }

    // RLS 우회를 위해 adminSupabase 사용
    const { data: memberRows, error: memberError } = await adminSupabase
      .from('club_members')
      .select('user_id')
      .eq('club_id', clubId);

    if (memberError) {
      console.error('Error fetching club members:', memberError);
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    if (!memberRows || memberRows.length === 0) {
      return NextResponse.json({ members: [] });
    }

    const userIds = memberRows.map((row: any) => row.user_id).filter(Boolean);

    const { data: profs, error: profsError } = await adminSupabase
      .from('profiles')
      .select('id, full_name, username, email, skill_level, gender, avatar_url')
      .in('id', userIds);

    if (profsError) {
      console.error('Error fetching profiles for club members:', profsError);
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 });
    }

    return NextResponse.json({ members: profs || [] });
  } catch (error) {
    console.error('Error in /api/user/club-members:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
