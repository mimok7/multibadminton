import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';

async function requireAdmin() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
}

export async function POST(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;

  try {
    const body = await request.json();
    const { payloads } = body;

    if (!payloads || !Array.isArray(payloads) || payloads.length === 0) {
      return NextResponse.json({ error: 'Invalid payloads' }, { status: 400 });
    }

    const { data, error } = await adminSupabase
      .from('notifications')
      .insert(payloads)
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, count: data?.length || 0 });
  } catch (err: any) {
    console.error('Failed to insert notifications:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const surveyId = searchParams.get('survey_id');

    if (surveyId) {
      // 1. Delete all notifications associated with this survey_id
      const { error: notifErr } = await adminSupabase
        .from('notifications')
        .delete()
        .eq('survey_id', surveyId);
      if (notifErr) throw notifErr;

      // 2. Delete the survey itself
      const { error: surveyErr } = await adminSupabase
        .from('surveys')
        .delete()
        .eq('id', surveyId);
      if (surveyErr) throw surveyErr;

      return NextResponse.json({ success: true, message: '설문조사와 관련 알림이 모두 삭제되었습니다.' });
    } else if (id) {
      // Delete a regular notification. We want to delete all matching notifications (same title, message, type)
      // to clear it for all users who received it.
      // First, get the notification details
      const { data: target, error: fetchErr } = await adminSupabase
        .from('notifications')
        .select('title, message, type, survey_id')
        .eq('id', id)
        .single();

      if (fetchErr || !target) {
        return NextResponse.json({ error: '알림을 찾을 수 없습니다.' }, { status: 404 });
      }

      if (target.survey_id) {
        // If it's actually linked to a survey, delete the survey & all related notifications
        const { error: notifErr } = await adminSupabase
          .from('notifications')
          .delete()
          .eq('survey_id', target.survey_id);
        if (notifErr) throw notifErr;

        const { error: surveyErr } = await adminSupabase
          .from('surveys')
          .delete()
          .eq('id', target.survey_id);
        if (surveyErr) throw surveyErr;

        return NextResponse.json({ success: true, message: '설문조사와 관련 알림이 모두 삭제되었습니다.' });
      } else {
        // General notification: delete all rows with the same title, message, and type
        const { error: delErr } = await adminSupabase
          .from('notifications')
          .delete()
          .eq('title', target.title)
          .eq('message', target.message)
          .eq('type', target.type);
        if (delErr) throw delErr;

        return NextResponse.json({ success: true, message: '알림이 전체 회원에게서 삭제되었습니다.' });
      }
    } else {
      return NextResponse.json({ error: 'ID 또는 Survey ID가 필요합니다.' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Failed to delete notifications/surveys:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
