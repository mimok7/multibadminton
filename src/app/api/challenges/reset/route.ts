import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole } from '@/lib/auth';
import { getKoreaDate } from '@/lib/date';
import { getActiveClubId } from '@/lib/club';

export async function POST() {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userRole = await getUserRole(serverSupabase, user);
  if (!userRole || !['admin', 'manager'].includes(userRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const clubId = await getActiveClubId();
  if (!clubId) {
    return NextResponse.json({ error: '선택된 클럽이 없습니다.' }, { status: 400 });
  }

  try {
    const today = getKoreaDate();

    // Update all pending/accepted challenge requests for today to 'held'
    const { error: updateError } = await adminSupabase
      .from('challenge_requests')
      .update({
        status: 'held',
        partner_response: 'held',
        opponent1_response: 'held',
        opponent2_response: 'held',
        updated_at: new Date().toISOString()
      })
      .eq('challenge_date', today)
      .eq('club_id', clubId)
      .in('status', ['pending', 'accepted']);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Challenge reset error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '게임 제안 초기화 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
