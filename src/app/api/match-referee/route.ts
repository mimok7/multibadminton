import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    const adminSupabase = await getFilteredAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).single();
    const claimerId = (profile as any)?.id || user.id;

    const body = await request.json().catch(() => ({}));
    const { schedule_id, action } = body as { schedule_id: string; action: 'claim' | 'release' };
    if (!schedule_id || !action) return NextResponse.json({ error: 'schedule_id and action required' }, { status: 400 });

    const { data: schedule, error: fetchError } = await adminSupabase
      .from('match_schedules').select('id, referee_id').eq('id', schedule_id).single();
    if (fetchError || !schedule) return NextResponse.json({ error: '경기를 찾을 수 없습니다.' }, { status: 404 });

    const s = schedule as any;

    if (action === 'claim') {
      if (s.referee_id && s.referee_id !== claimerId)
        return NextResponse.json({ error: 'already_claimed', referee_id: s.referee_id }, { status: 409 });
      const { error: updateError } = await adminSupabase
        .from('match_schedules').update({ referee_id: claimerId } as any).eq('id', schedule_id);
      if (updateError && !updateError.message?.includes('referee_id')) throw updateError;
      return NextResponse.json({ success: true, referee_id: claimerId });
    }
    if (action === 'release') {
      if (s.referee_id && s.referee_id !== claimerId)
        return NextResponse.json({ error: 'not_referee' }, { status: 403 });
      const { error: updateError } = await adminSupabase
        .from('match_schedules').update({ referee_id: null } as any).eq('id', schedule_id);
      if (updateError && !updateError.message?.includes('referee_id')) throw updateError;
      return NextResponse.json({ success: true, referee_id: null });
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Match referee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
