import { getSupabaseClient } from '@/lib/supabase';
import { getKoreaDate } from '@/lib/date';

const supabase = getSupabaseClient();

export const debugAttendanceData = async (setDebugInfo: (info: string) => void) => {
  const today = getKoreaDate();

  let debugText = '=== 출석 데이터 디버깅 ===\n';
  debugText += `오늘 날짜: ${today}\n\n`;

  try {
    // 1. attendances 테이블에서 오늘 데이터 조회
    const { data: attendanceData } = await supabase
      .from('attendances')
      .select('*')
      .eq('attended_at', today);

    debugText += `attendances 테이블 데이터: ${attendanceData?.length || 0}개\n`;
    if (attendanceData) {
      attendanceData.forEach((a, i) => {
        debugText += `  ${i+1}. user_id: ${a.user_id}, status: ${a.status}, attended_at: ${a.attended_at}\n`;
      });
    }
    debugText += '\n';

    // 2. match_participants에서 오늘 참가자 조회
    const { data: schedules } = await supabase
      .from('match_schedules')
      .select('id')
      .eq('match_date', today);

    debugText += `오늘 경기 일정: ${schedules?.length || 0}개\n`;
    if (schedules) {
      schedules.forEach((s, i) => {
        debugText += `  ${i+1}. schedule_id: ${s.id}\n`;
      });
    }
    debugText += '\n';

    if (schedules && schedules.length > 0) {
      const scheduleIds = schedules.map(s => s.id);
      const { data: participants } = await supabase
        .from('match_participants')
        .select('*')
        .in('match_schedule_id', scheduleIds)
        .eq('status', 'registered');

      debugText += `참가자 데이터: ${participants?.length || 0}개\n`;
      if (participants) {
        participants.forEach((p, i) => {
          debugText += `  ${i+1}. user_id: ${p.user_id}, status: ${p.status}\n`;
        });
      }
      debugText += '\n';

      // 3. 교차 분석
      if (attendanceData && participants) {
        const attendanceUserIds = attendanceData.map(a => a.user_id);
        const participantUserIds = participants.map(p => p.user_id);

        const intersection = attendanceUserIds.filter(id => participantUserIds.includes(id));
        const onlyAttendance = attendanceUserIds.filter(id => !participantUserIds.includes(id));
        const onlyParticipants = participantUserIds.filter(id => !attendanceUserIds.includes(id));

        debugText += '=== 분석 결과 ===\n';
        debugText += `참가+출석: ${intersection.length}명\n`;
        debugText += `출석만: ${onlyAttendance.length}명\n`;
        debugText += `참가만: ${onlyParticipants.length}명\n\n`;

        debugText += '참가+출석 사용자:\n';
        intersection.forEach(id => debugText += `  - ${id}\n`);

        debugText += '\n출석만 사용자:\n';
        onlyAttendance.forEach(id => debugText += `  - ${id}\n`);

        debugText += '\n참가만 사용자:\n';
        onlyParticipants.forEach(id => debugText += `  - ${id}\n`);
      }
    }

    setDebugInfo(debugText);
    console.log(debugText);

  } catch (error) {
    const errorText = `디버깅 오류: ${error}`;
    setDebugInfo(errorText);
    console.error(errorText);
  }
};
