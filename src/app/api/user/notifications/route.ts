import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const isSummaryRequest = searchParams.get('summary') === '1';
    const requestedLimit = Number(searchParams.get('limit') || '50');
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 50;
    const before = searchParams.get('before');
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

    const adminSupabase = await getFilteredAdminClient() as any;
    if (isSummaryRequest) {
      const { count, error } = await adminSupabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;
      return NextResponse.json({ unreadCount: count ?? 0 });
    }

    let notificationsQuery = adminSupabase
      .from('notifications')
      .select('id, title, message, type, is_read, created_at, read_at, survey_id, surveys(id, question, description, options, is_active, max_responses, option_limits)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (before) notificationsQuery = notificationsQuery.lt('created_at', before);

    const { data: notificationRows, error } = await notificationsQuery;

    if (error) throw error;
    const hasMore = (notificationRows?.length || 0) > limit;
    const notifications = (notificationRows || []).slice(0, limit);

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

    return NextResponse.json({
      notifications,
      hasMore,
      nextCursor: hasMore ? notifications.at(-1)?.created_at ?? null : null,
    });
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

    const adminSupabase = await getFilteredAdminClient() as any;

    let query = adminSupabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id);

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
