import { NextResponse } from 'next/server';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';
import type { Database } from '@/types/supabase';
import { getClubManagerContext } from '@/lib/manager-access';
import { readMatchSettings } from '@/lib/match-settings';
import { ensureFiveMatches } from '@/lib/match-generator';

type GenerationResult = {
  created_matches: number;
  message: string;
  execution_time: string;
};

type GenerateRecurringMatchesPayload = {
  template_ids?: string[];
};

type RecurringTemplateRow = Pick<
  Database['public']['Tables']['recurring_match_templates']['Row'],
  | 'id'
  | 'club_id'
  | 'name'
  | 'description'
  | 'day_of_week'
  | 'start_time'
  | 'end_time'
  | 'location'
  | 'max_participants'
  | 'advance_days'
  | 'is_active'
>;

type AdminSupabaseClient = ReturnType<typeof getUnfilteredGlobalAdminClient>;

const DAY_LABELS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function toDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function findNextMatchingDate(base: Date, dayOfWeek: number) {
  const dayOffset = (dayOfWeek - base.getDay() + 7) % 7;
  return addDays(base, dayOffset);
}

async function hasExistingSchedule(
  supabase: AdminSupabaseClient,
  matchDate: string,
  template: Pick<RecurringTemplateRow, 'start_time' | 'end_time' | 'location' | 'club_id'>
) {
  const { data: existingSchedule, error } = await supabase
    .from('match_schedules')
    .select('id')
    .eq('club_id', template.club_id!)
    .eq('match_date', matchDate)
    .eq('start_time', template.start_time)
    .eq('end_time', template.end_time)
    .eq('location', template.location)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(existingSchedule);
}

async function createScheduleFromTemplate(
  supabase: AdminSupabaseClient,
  matchDate: string,
  template: Pick<
    RecurringTemplateRow,
    'club_id' | 'name' | 'description' | 'day_of_week' | 'start_time' | 'end_time' | 'location' | 'max_participants'
  >,
  executedBy?: string | null
): Promise<boolean> {
  const recurringSuffix = `정기모임 (${DAY_LABELS[template.day_of_week] || `${template.day_of_week}`})`;
  const description = [template.description?.trim() || template.name.trim(), recurringSuffix].join(' - ');

  const { error } = await supabase
    .from('match_schedules')
    .insert({
      club_id: template.club_id,
      match_date: matchDate,
      start_time: template.start_time,
      end_time: template.end_time,
      location: template.location,
      max_participants: template.max_participants ?? 20,
      current_participants: 0,
      status: 'scheduled',
      description,
      created_by: executedBy ?? null,
      updated_by: executedBy ?? null,
    });

  if (error) {
    const code = (error as { code?: string }).code || '';
    if (code === '23505') {
      return false;
    }
    throw error;
  }

  return true;
}

async function generateRecurringMatchesFallback(
  executedBy?: string | null,
  selectedTemplateIds?: string[],
  clubId?: string
): Promise<GenerationResult> {
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const executionTime = new Date().toISOString();
  const templateIds = selectedTemplateIds?.filter(Boolean) ?? [];
  const isManualSelectedGeneration = templateIds.length > 0;
  const supabase = getUnfilteredGlobalAdminClient();

  let query = supabase
    .from('recurring_match_templates')
    .select('id, club_id, name, description, day_of_week, start_time, end_time, location, max_participants, advance_days, is_active')
    .eq('is_active', true);

  if (clubId) {
    query = query.eq('club_id', clubId);
  }

  if (templateIds.length > 0) {
    query = query.in('id', templateIds);
  }

  const { data: templates, error: templatesError } = await query;

  if (templatesError) {
    throw templatesError;
  }

  let createdMatches = 0;

  for (const template of (templates || []) as RecurringTemplateRow[]) {
    if (
      template.day_of_week === null ||
      !template.start_time ||
      !template.end_time ||
      !template.location ||
      !template.name
    ) {
      continue;
    }

    const advanceDays = Math.max(0, template.advance_days ?? 7);

    for (let offset = 0; offset <= advanceDays; offset += 1) {
      const targetDate = addDays(todayDate, offset);

      if (targetDate.getDay() !== template.day_of_week) {
        continue;
      }

      const matchDate = toDateOnly(targetDate);
      const alreadyExists = await hasExistingSchedule(supabase, matchDate, template);

      if (alreadyExists) {
        continue;
      }

      const created = await createScheduleFromTemplate(supabase, matchDate, template, executedBy);
      if (created) {
        createdMatches += 1;
      }
    }
  }

  return {
    created_matches: createdMatches,
    message:
      createdMatches > 0
        ? `${
            isManualSelectedGeneration ? '선택한 템플릿 기준으로 ' : ''
          }${createdMatches}개의 정기모임 일정이 생성되었습니다.`
        : isManualSelectedGeneration
          ? '선택한 템플릿의 다음 일정이 이미 생성되어 있어 추가로 만들 일정이 없습니다.'
          : '생성 조건에 맞는 새로운 정기모임 일정이 없습니다.',
    execution_time: executionTime,
  };
}

async function runRecurringMatchGeneration(executedBy?: string | null, selectedTemplateIds?: string[], clubId?: string) {
  const templateIds = selectedTemplateIds?.filter(Boolean) ?? [];
  return generateRecurringMatchesFallback(executedBy, templateIds, clubId);
}

export async function GET(request: Request) {
  try {
    // 요청 헤더에서 인증 토큰 확인 (보안을 위해)
    const authHeader = request.headers.get('authorization');
    const secretToken = process.env.CRON_SECRET_TOKEN;

    if (!secretToken || authHeader !== `Bearer ${secretToken}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 정기모임 자동 생성 설정 확인
    const settings = await readMatchSettings();
    if (!settings.autoGenerateEnabled) {
      return NextResponse.json({
        success: true,
        message: '자동 경기 생성이 비활성화 상태입니다. (Auto-generate is OFF)',
        timestamp: new Date().toISOString()
      });
    }

    // 정기모임 자동 생성 실행 (항상 5경기 유지)
    const data = await ensureFiveMatches(null);

    console.log('정기모임 자동 생성 완료:', data);

    return NextResponse.json({
      success: true,
      result: {
        created_matches: data.created_count,
        message: `${data.created_count}개의 일정이 생성되었습니다.`,
        execution_time: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('API 실행 중 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST 메서드도 지원 (수동 실행용)
export async function POST(request: Request) {
  try {
    const context = await getClubManagerContext();
    if ('error' in context) {
      const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
      return NextResponse.json({ error: status === 401 ? 'Authentication required' : status === 400 ? 'Club not selected' : 'Manager access required' }, { status });
    }
    const body = (await request.json().catch(() => ({}))) as GenerateRecurringMatchesPayload;
    const selectedTemplateIds = Array.isArray(body.template_ids) ? body.template_ids : [];

    // 정기모임 자동 생성 실행
    const data = await runRecurringMatchGeneration(context.user.id, selectedTemplateIds, context.clubId);

    return NextResponse.json({
      success: true,
      result: data,
      timestamp: new Date().toISOString(),
      executed_by: context.user.id
    });

  } catch (error) {
    console.error('API 실행 중 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
