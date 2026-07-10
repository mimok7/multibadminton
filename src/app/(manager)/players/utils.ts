export { supabase } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { getKoreaDate } from '@/lib/date';
import { AvailableDate, ExtendedPlayer, GeneratedMatch } from './types';
import type { Database } from '@/types/supabase';
import { getAdminLevelDisplay, getNormalizedSkillCode } from '@/lib/level-display';
import { fetchLevelInfoMap, getLevelScoreFromCode } from '@/lib/level-info';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type GeneratedMatchRow = Database['public']['Tables']['generated_matches']['Row'];
type MatchScheduleRow = Database['public']['Tables']['match_schedules']['Row'];
const normalizeAttendanceStatus = (value: string | null | undefined): ExtendedPlayer['status'] =>
  value === 'present' || value === 'lesson' || value === 'absent' ? value : 'absent';

export function normalizeLevel(skill_code: string | null | undefined, skill_level?: string | null | undefined): string {
  const normalized = getNormalizedSkillCode(skill_code || skill_level || undefined, 'E2');
  return normalized.toLowerCase();
}

// 대시보드에서 성공한 방식을 재사용한 프로필 조회 함수
export const fetchProfilesByUserIds = async (userIds: string[]) => {
  if (!userIds || userIds.length === 0) {
    return [];
  }

  try {
    // ID 중복 제거
    const uniqueIds = Array.from(new Set(userIds));

    // Supabase URL 길이 제한 방지를 위해 청크로 분할 (50개씩)
    const CHUNK_SIZE = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      chunks.push(uniqueIds.slice(i, i + CHUNK_SIZE));
    }

    const allProfiles: any[] = [];

    for (const chunk of chunks) {
      // id 또는 user_id로 필터링하여 필요한 프로필만 조회
      const [byId, byUserId] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, user_id, username, full_name, skill_level, gender, role')
          .in('id', chunk),
        supabase
          .from('profiles')
          .select('id, user_id, username, full_name, skill_level, gender, role')
          .in('user_id', chunk),
      ]);

      const merged = new Map<string, any>();
      (byId.data || []).forEach(p => merged.set(p.id, p));
      (byUserId.data || []).forEach(p => {
        if (!merged.has(p.id)) merged.set(p.id, p);
      });

      allProfiles.push(...merged.values());
    }

    // 요청된 사용자 ID들과 일치하는 프로필만 반환
    const idSet = new Set(uniqueIds);
    return allProfiles.filter(profile =>
      idSet.has(profile.id) || (profile.user_id ? idSet.has(profile.user_id) : false)
    );
  } catch (error) {
    return [];
  }
};

const getProfileName = (profile?: Pick<ProfileRow, 'username' | 'full_name'> | null, fallback = '선수') =>
  profile?.full_name || profile?.username || fallback;

export const fetchAvailableScheduleDates = async (): Promise<AvailableDate[]> => {
  const { data: schedules, error } = await supabase
    .from('match_schedules')
    .select('match_date, location, start_time, end_time, max_participants, current_participants, status')
    .gte('match_date', getKoreaDate())
    .eq('status', 'scheduled')
    .order('match_date', { ascending: true });

  if (error) {
    throw error;
  }

  const validSchedules = (schedules || []).filter(
    (schedule): schedule is Pick<
      MatchScheduleRow,
      'match_date' | 'location' | 'start_time' | 'end_time' | 'max_participants' | 'current_participants' | 'status'
    > & { match_date: string } => Boolean(schedule.match_date)
  );

  const dateGroups: Record<string, AvailableDate['schedules']> = {};

  validSchedules.forEach((schedule) => {
    const date = schedule.match_date;
    if (!dateGroups[date]) {
      dateGroups[date] = [];
    }
    dateGroups[date].push(schedule);
  });

  return Object.entries(dateGroups).map(([date, groupedSchedules]) => {
    const totalCapacity = groupedSchedules.reduce((sum, schedule) => sum + (schedule.max_participants || 0), 0);
    const currentParticipants = groupedSchedules.reduce((sum, schedule) => sum + (schedule.current_participants || 0), 0);

    return {
      date,
      schedules: groupedSchedules,
      totalCapacity,
      currentParticipants,
      availableSlots: totalCapacity - currentParticipants,
      location: groupedSchedules[0]?.location || '장소 미정',
      timeRange: `${groupedSchedules[0]?.start_time || '시간'} - ${groupedSchedules[groupedSchedules.length - 1]?.end_time || '미정'}`,
    };
  });
};

export const fetchRegisteredSchedules = async (date: string): Promise<any[]> => {
  const { data, error } = await supabase
    .from('match_schedules')
    .select('id, generated_match_id, schedule_source, match_date, start_time, end_time, scheduled_time, court_number, description, location, status, current_participants, max_participants')
    .eq('match_date', date)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('일정 상세 조회 오류:', error);
    return [];
  }
  return data || [];
};

export const fetchGeneratedMatchesBySession = async (sessionId: string): Promise<GeneratedMatch[]> => {
  const { data: matches, error } = await supabase
    .from('generated_matches')
    .select('id, session_id, match_number, status, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
    .eq('session_id', sessionId)
    .order('match_number', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (matches || []) as Pick<
    GeneratedMatchRow,
    'id' | 'session_id' | 'match_number' | 'status' | 'team1_player1_id' | 'team1_player2_id' | 'team2_player1_id' | 'team2_player2_id'
  >[];

  if (rows.length === 0) {
    return [];
  }

  const profileIds = Array.from(
    new Set(
      rows.flatMap((match) => [
        match.team1_player1_id,
        match.team1_player2_id,
        match.team2_player1_id,
        match.team2_player2_id,
      ]).filter((id): id is string => Boolean(id))
    )
  );

  const [profiles, levelInfoMap] = await Promise.all([
    fetchProfilesByUserIds(profileIds),
    fetchLevelInfoMap(supabase),
  ]);
  const profileMap = new Map<string, any>();
  (profiles || []).forEach((profile: any) => {
    if (profile.id) profileMap.set(profile.id, profile);
    if (profile.user_id) profileMap.set(profile.user_id, profile);
  });

  const { data: schedules, error: schedulesError } = await supabase
    .from('match_schedules')
    .select('generated_match_id')
    .in('generated_match_id', rows.map((match) => match.id));

  if (schedulesError) {
    throw schedulesError;
  }

  const scheduledIds = new Set(
    (schedules || [])
      .map((schedule) => schedule.generated_match_id)
      .filter((id): id is number => typeof id === 'number')
  );

  return rows.map((match) => ({
    id: match.id,
    session_id: match.session_id,
    match_number: match.match_number,
    status: (match.status as GeneratedMatch['status']) || 'scheduled',
    team1_player1: {
      name: getProfileName(profileMap.get(match.team1_player1_id || '') || null, '선수1'),
      skill_level: profileMap.get(match.team1_player1_id || '')?.skill_level || 'E2',
      score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team1_player1_id || '')?.skill_level, 0),
    },
    team1_player2: {
      name: getProfileName(profileMap.get(match.team1_player2_id || '') || null, '선수2'),
      skill_level: profileMap.get(match.team1_player2_id || '')?.skill_level || 'E2',
      score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team1_player2_id || '')?.skill_level, 0),
    },
    team2_player1: {
      name: getProfileName(profileMap.get(match.team2_player1_id || '') || null, '선수3'),
      skill_level: profileMap.get(match.team2_player1_id || '')?.skill_level || 'E2',
      score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team2_player1_id || '')?.skill_level, 0),
    },
    team2_player2: {
      name: getProfileName(profileMap.get(match.team2_player2_id || '') || null, '선수4'),
      skill_level: profileMap.get(match.team2_player2_id || '')?.skill_level || 'E2',
      score: getLevelScoreFromCode(levelInfoMap, profileMap.get(match.team2_player2_id || '')?.skill_level, 0),
    },
    is_scheduled: scheduledIds.has(match.id),
  }));
};


// 게임수 계산 함수
export const calculatePlayerGameCounts = (matches: any[]) => {
  const counts: Record<string, number> = {};
  
  matches.forEach(match => {
    // Player 객체에서 이름과 레벨 추출
    const extractPlayerInfo = (player: any) => {
      // player가 객체인 경우 name과 skill_level 속성 사용
      if (typeof player === 'object' && player !== null && player.name) {
        return `${player.name} (${player.skill_level || 'E2'})`;
      }
      return String(player || '선수');
    };
    
    const player1 = extractPlayerInfo(match.team1?.player1 || match.team1_player1);
    const player2 = extractPlayerInfo(match.team1?.player2 || match.team1_player2);
    const player3 = extractPlayerInfo(match.team2?.player1 || match.team2_player1);
    const player4 = extractPlayerInfo(match.team2?.player2 || match.team2_player2);
    
    counts[player1] = (counts[player1] || 0) + 1;
    counts[player2] = (counts[player2] || 0) + 1;
    counts[player3] = (counts[player3] || 0) + 1;
    counts[player4] = (counts[player4] || 0) + 1;
  });
  
  return counts;
};

// 오늘 출석자 데이터 조회 함수
export const fetchTodayPlayers = async (): Promise<ExtendedPlayer[]> => {
  try {
    const today = getKoreaDate();

    const response = await fetch(`/api/admin/attendance?attendedAt=${encodeURIComponent(today)}`, {
      method: 'GET',
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('❌ 출석자 조회 API 오류:', payload);
      return [];
    }

    const players: unknown[] = Array.isArray(payload?.players) ? payload.players : [];
    return players
      .filter((player: unknown): player is Record<string, unknown> => Boolean(player) && typeof player === 'object')
      .map((player) => {
        const id = typeof player.id === 'string' ? player.id : '';
        const normalizedLevel = normalizeLevel(
          '',
          typeof player.skill_level === 'string' ? player.skill_level : 'E2'
        );

        return {
          id,
          name:
            typeof player.name === 'string' && player.name.trim()
              ? player.name
              : `선수-${id.slice(0, 8)}`,
          skill_level: normalizedLevel,
          skill_label:
            typeof player.skill_label === 'string' && player.skill_label.trim()
              ? player.skill_label
              : getAdminLevelDisplay(normalizedLevel),
          score:
            typeof player.score === 'number' && Number.isFinite(player.score)
              ? player.score
              : undefined,
          gender: typeof player.gender === 'string' ? player.gender : '',
          skill_code: normalizedLevel,
          status: normalizeAttendanceStatus(
            typeof player.status === 'string' ? player.status : undefined
          ),
          partner_user_id:
            typeof player.partner_user_id === 'string' ? player.partner_user_id : null,
        };
      })
      .filter((player) => Boolean(player.id));
  } catch (fetchError) {
    console.error('❌ 데이터 조회 중 오류:', fetchError);
    return [];
  }
};

// 선택한 날짜의 신청자(registered)만 불러오는 함수
export const fetchRegisteredPlayersForDate = async (date: string): Promise<ExtendedPlayer[]> => {
  try {
    const target = date;
    console.log(`참가자 조회 시작: 날짜 ${target}`);

    // 서버 API를 호출하여 RLS를 우회하고 매니저 권한으로 모든 참가자 정보를 가져옴
    const response = await fetch(`/api/admin/match-schedules?date=${target}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error('❌ 일정 조회 API 오류:', await response.text());
      return [];
    }

    const payload = await response.json();
    const schedules = payload.schedules || [];

    if (schedules.length === 0) {
      console.log(`해당 날짜(${target})에 등록된 경기가 없습니다.`);
      return [];
    }

    console.log(`경기 일정 ${schedules.length}개 발견`);

    // 해당 스케줄들의 참가자 추출
    const allParticipants = schedules.flatMap((s: any) => s.participants || []);
    
    // 상태가 'registered' 또는 'attended' 인 참가자 필터링
    const registeredParticipants = allParticipants.filter((p: any) => p.status === 'registered' || p.status === 'attended');
    
    if (registeredParticipants.length === 0) {
      console.log(`해당 경기들에 등록된 참가자가 없습니다.`);
      return [];
    }
    
    // 중복 제거를 위해 Map 사용 (가장 최근 등록된 참가 정보 기준 등)
    const uniqueParticipants = new Map<string, any>();
    registeredParticipants.forEach((p: any) => {
      if (p.user_id) {
        uniqueParticipants.set(p.user_id, p);
      }
    });

    console.log(`참가자 ${uniqueParticipants.size}명 발견`);

    // 5) ExtendedPlayer 배열로 변환 (status는 absent로 초기화 - 실제 출석 데이터로 업데이트됨)
    const players: ExtendedPlayer[] = Array.from(uniqueParticipants.values()).map((p: any) => {
      const profile = p.profiles || {};
      const raw = (profile.skill_level || '').toString().toLowerCase();
      const normalized = normalizeLevel('', raw);
      const label = getAdminLevelDisplay(normalized);
      const name = profile.full_name || profile.username || `선수-${String(p.user_id || p.id).slice(0, 4)}`;
      return {
        id: p.user_id || p.id,
        name,
        skill_level: normalized,
        skill_label: label,
        status: 'absent',
        partner_user_id: p.partner_user_id || undefined,
        gender: profile.gender || '',
        skill_code: ''
      };
    });

    return players;
  } catch (err) {
    console.error('참가자 목록 조회 중 오류:', err);
    return [];
  }
};

