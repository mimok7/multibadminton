import { getFilteredAdminClient } from '@/lib/supabase-server';
import { getKoreaDate } from '@/lib/date';

export async function ensureFiveMatches(executedBy: string | null) {
  const adminSupabase = await getFilteredAdminClient();

  // 1. 활성화된 정기모임 템플릿 조회 (주말 토/일 제외)
  const { data: templates, error: templatesError } = await adminSupabase
    .from('recurring_match_templates')
    .select('id, name, description, day_of_week, start_time, end_time, location, max_participants, is_active, club_id')
    .eq('is_active', true)
    .neq('day_of_week', 0) // 일요일 제외
    .neq('day_of_week', 6); // 토요일 제외

  if (templatesError) {
    console.error('Failed to fetch recurring templates:', templatesError);
    throw new Error('정기모임 템플릿을 불러오지 못했습니다.');
  }

  if (!templates || templates.length === 0) {
    throw new Error('활성화된 정기모임 템플릿이 없습니다. [정기모임 생성] 메뉴에서 평일 템플릿을 등록해 주세요.');
  }

  const todayDate = getKoreaDate();
  const [y, m, d] = todayDate.split('-').map(Number);
  let current = new Date(y, m - 1, d);

  const DAY_LABELS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const toDateOnly = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayStr = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${dayStr}`;
  };

  const createdSchedules = [];
  const skippedSchedules = [];
  let verifiedSchedulesCount = 0;
  const targetLimit = 5; // 항상 5개의 일정을 확보
  let safetyLimit = 0;

  // 최대 90일 후까지 탐색하며 5개의 평일 경기 일정을 검증/생성함
  while (verifiedSchedulesCount < targetLimit && safetyLimit < 90) {
    safetyLimit++;
    const dayOfWeek = current.getDay();

    // 주말(토, 일) 제외
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    // 해당 요일에 매칭되는 템플릿들 필터링
    const matchingTemplates = templates.filter(t => t.day_of_week === dayOfWeek);
    const dateStr = toDateOnly(current);

    for (const template of matchingTemplates) {
      // 이미 해당 날짜에 동일한 조건의 일정이 있는지 확인
      const { data: existingSlot, error: existingSlotError } = await adminSupabase
        .from('match_schedules')
        .select('id')
        .eq('club_id', template.club_id!)
        .eq('match_date', dateStr)
        .eq('start_time', template.start_time)
        .eq('end_time', template.end_time)
        .eq('location', template.location)
        .limit(1)
        .maybeSingle();

      if (existingSlotError) {
        console.error(`Check duplicate error for date ${dateStr}:`, existingSlotError);
        continue;
      }

      if (existingSlot) {
        skippedSchedules.push(`${dateStr} (${template.name})`);
      } else {
        // 새 일정 생성
        const recurringSuffix = `정기모임 (${DAY_LABELS[template.day_of_week] || `${template.day_of_week}`})`;
        const description = [template.description?.trim() || template.name.trim(), recurringSuffix].join(' - ');

        const { data: newSlot, error: insertError } = await adminSupabase
          .from('match_schedules')
          .insert({
            match_date: dateStr,
            start_time: template.start_time,
            end_time: template.end_time,
            location: template.location,
            max_participants: template.max_participants ?? 20,
            current_participants: 0,
            status: 'scheduled',
            description,
            created_by: executedBy,
            updated_by: executedBy,
            club_id: template.club_id,
          })
          .select('*')
          .single();

        if (insertError) {
          console.error(`Insert error for date ${dateStr}:`, insertError);
        } else if (newSlot) {
          createdSchedules.push(newSlot);
        }
      }

      verifiedSchedulesCount++;
    }

    current.setDate(current.getDate() + 1);
  }

  return {
    created_count: createdSchedules.length,
    created_dates: createdSchedules.map(s => {
      const label = s.description?.split(' - ')[0] ?? '일정';
      return `${s.match_date} (${label})`;
    }),
    skipped_dates: skippedSchedules,
  };
}
