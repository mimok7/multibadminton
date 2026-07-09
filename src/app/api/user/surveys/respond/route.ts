import { NextResponse } from 'next/server';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function POST(request: Request) {
  try {
    const serverSupabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await serverSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const surveyId = String(body?.survey_id || '');
    const selectedOption = String(body?.selected_option || '');

    if (!surveyId || !selectedOption) {
      return NextResponse.json({ error: '설문조사 ID와 선택 항목이 필요합니다.' }, { status: 400 });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ error: '클럽을 선택해주세요.' }, { status: 400 });
    }

    const adminSupabase = getSupabaseAdminClient() as any;

    // 1. 설문조사가 활성화되어 있는지 확인 (club_id 필터링)
    const { data: survey, error: surveyError } = await adminSupabase
      .from('surveys')
      .select('is_active, options, max_responses, option_limits')
      .eq('id', surveyId)
      .eq('club_id', clubId)
      .single();

    if (surveyError || !survey) {
      return NextResponse.json({ error: '존재하지 않는 설문조사입니다.' }, { status: 404 });
    }

    if (!survey.is_active) {
      return NextResponse.json({ error: '종료된 설문조사입니다.' }, { status: 400 });
    }

    // 옵션이 유효한지 확인
    const options = Array.isArray(survey.options) ? survey.options : [];
    if (!options.includes(selectedOption)) {
      return NextResponse.json({ error: '유효하지 않은 선택 항목입니다.' }, { status: 400 });
    }

    // 1.1 전체 선착순 제한 확인
    if (survey.max_responses !== null && survey.max_responses !== undefined) {
      const { count, error: countErr } = await adminSupabase
        .from('survey_responses')
        .select('id', { count: 'exact', head: true })
        .eq('survey_id', surveyId)
        .neq('user_id', user.id);

      if (countErr) throw countErr;
      if ((count || 0) >= Number(survey.max_responses)) {
        return NextResponse.json({ error: '설문 인원이 모두 마감되었습니다. (전체 선착순 마감)' }, { status: 400 });
      }
    }

    // 1.2 개별 항목 선착순 제한 확인
    const limits = survey.option_limits || {};
    const limitForOption = limits[selectedOption];
    if (limitForOption !== null && limitForOption !== undefined) {
      const { count, error: countErr } = await adminSupabase
        .from('survey_responses')
        .select('id', { count: 'exact', head: true })
        .eq('survey_id', surveyId)
        .eq('selected_option', selectedOption)
        .neq('user_id', user.id);

      if (countErr) throw countErr;
      if ((count || 0) >= Number(limitForOption)) {
        return NextResponse.json({ error: `"${selectedOption}" 항목은 선착순 마감되었습니다.` }, { status: 400 });
      }
    }

    // 2. 응답 등록 (upsert)
    const { error: upsertError } = await adminSupabase
      .from('survey_responses')
      .upsert({
        survey_id: surveyId,
        user_id: user.id,
        selected_option: selectedOption,
      }, { onConflict: 'survey_id,user_id' });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true, selected_option: selectedOption });
  } catch (err: any) {
    console.error('설문 응답 제출 실패:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
