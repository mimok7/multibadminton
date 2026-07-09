import { NextResponse } from 'next/server';
import { getProfileByUserId, isAdminRole } from '@/lib/auth';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

async function requireAdmin() {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient() as any;
  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);
  if (!currentProfile || !isAdminRole(currentProfile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { adminSupabase };
}

export async function GET() {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;

  try {
    // 설문과 모든 응답 조회
    const { data: surveys, error: surveyError } = await adminSupabase
      .from('surveys')
      .select('*, survey_responses(selected_option, user_id)')
      .order('created_at', { ascending: false });

    if (surveyError) throw surveyError;

    // 설문 응답 통계 가공
    const surveysWithStats = (surveys || []).map((survey: any) => {
      const responses = survey.survey_responses || [];
      const stats: Record<string, number> = {};
      
      // 모든 옵션을 0으로 초기화
      const options = Array.isArray(survey.options) ? survey.options : [];
      options.forEach((opt: string) => {
        stats[opt] = 0;
      });

      // 실제 응답 카운팅
      responses.forEach((r: any) => {
        if (stats[r.selected_option] !== undefined) {
          stats[r.selected_option]++;
        } else {
          stats[r.selected_option] = 1;
        }
      });

      return {
        ...survey,
        response_count: responses.length,
        stats,
      };
    });

    return NextResponse.json({ surveys: surveysWithStats });
  } catch (err: any) {
    console.error('설문 조회 및 통계 오류:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;

  try {
    const body = await request.json().catch(() => null);
    const question = String(body?.question || '').trim();
    const description = String(body?.description || '').trim();
    const options = body?.options;
    const maxResponses = body?.max_responses !== undefined && body?.max_responses !== null ? Number(body.max_responses) : null;
    const optionLimits = body?.option_limits || null;

    if (!question || !options || !Array.isArray(options) || options.length === 0) {
      return NextResponse.json({ error: '질문과 선택 항목 목록이 필요합니다.' }, { status: 400 });
    }

    const { data, error } = await adminSupabase
      .from('surveys')
      .insert({
        question,
        description: description || null,
        options,
        is_active: true,
        max_responses: maxResponses,
        option_limits: optionLimits,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, survey: data });
  } catch (err: any) {
    console.error('설문 등록 오류:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
