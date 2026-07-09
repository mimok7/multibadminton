import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function GET() {
  try {
    const serverSupabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await serverSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ notifications: [] });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ notifications: [] });
    }

    const adminSupabase = getSupabaseAdminClient() as any;
    const { data: notifications, error } = await adminSupabase
      .from('notifications')
      .select('id, title, message, type, is_read, created_at, read_at, survey_id, surveys(id, question, description, options, is_active, max_responses, option_limits)')
      .eq('user_id', user.id)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch user's responses to these surveys to show their selection and option counts
    const surveyNotifications = notifications?.filter((n: any) => n.survey_id) || [];
    if (surveyNotifications.length > 0) {
      const surveyIds = surveyNotifications.map((n: any) => n.survey_id);
      const { data: responses, error: respError } = await adminSupabase
        .from('survey_responses')
        .select('survey_id, selected_option, user_id')
        .in('survey_id', surveyIds);

      if (!respError && responses) {
        const statsMap = new Map<string, Record<string, number>>();
        const userResponseMap = new Map<string, string>();

        responses.forEach((r: any) => {
          if (r.user_id === user.id) {
            userResponseMap.set(r.survey_id, r.selected_option);
          }

          if (!statsMap.has(r.survey_id)) {
            statsMap.set(r.survey_id, {});
          }
          const stats = statsMap.get(r.survey_id)!;
          stats[r.selected_option] = (stats[r.selected_option] || 0) + 1;
        });

        notifications.forEach((n: any) => {
          if (n.surveys) {
            n.surveys.my_response = userResponseMap.get(n.survey_id) || null;
            n.surveys.stats = statsMap.get(n.survey_id) || {};
            
            // Calculate total response count
            const stats = n.surveys.stats;
            n.surveys.total_responses = Object.values(stats).reduce((a: any, b: any) => a + b, 0);
          }
        });
      }
    }

    return NextResponse.json({ notifications: notifications || [] });
  } catch (err: any) {
    console.error('알림 조회 실패:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const serverSupabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await serverSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ success: true });
    }

    const body = await request.json();
    const { ids, markAll } = body;

    const adminSupabase = getSupabaseAdminClient();

    let query = adminSupabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('club_id', clubId);

    if (!markAll && Array.isArray(ids) && ids.length > 0) {
      query = query.in('id', ids);
    } else {
      query = query.eq('is_read', false);
    }

    const { error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('알림 읽음 처리 실패:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
