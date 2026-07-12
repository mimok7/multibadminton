'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Users } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import { getKoreaDate } from '@/lib/date';
import { fetchAdminMembers } from './actions';
import {
  fetchLevelInfoMap,
  getLevelNameFromCode,
  getLevelScoreFromCode,
  type LevelInfoMap,
} from '@/lib/level-info';
import { getScheduleSourceLabel, inferScheduleSource, normalizeScheduleSource, type MatchScheduleSource } from '@/lib/match-schedule-source';

interface TeamAssignment {
  id: string;
  round_number: number; // 회차
  player_name: string;
  team_type: 'racket' | 'shuttle'; // 라켓팀 또는 셔틀팀
  created_at: string;
  assignment_date?: string;
  round_title?: string;
}

interface RoundSummary {
  round: number;
  racket_team: string[];
  shuttle_team: string[];
  team1?: string[];
  team2?: string[];
  team3?: string[];
  team4?: string[];
  pairs_data?: Record<string, string[]>;
  total_players: number;
  title?: string;
  assignment_date?: string;
  team_type?: string;
  pair_group_data?: Array<{
    groupName: string;
    pairNames: string[];
  }>;
}

type TeamConfigType = '2teams' | '3teams' | '4teams' | 'pairs' | 'custom';
type TeamName = 'racket' | 'shuttle' | 'team1' | 'team2' | 'team3' | 'team4' | string; // pairs는 pair1, pair2, ... 무제한

interface TeamConfig {
  type: TeamConfigType;
  numTeams?: number;
  playersPerTeam?: number;
  numLevelGroups?: number; // pairs 모드용: 2, 3, 4 그룹으로 분할
}

interface MemberOption {
  id: string;
  fullName: string;
  levelName: string;
  skillCode: string;
  gender: string;
  score: number;
  assignmentLabel: string;
}

interface AssignableProfile {
  id: string;
  user_id?: string | null;
  username: string | null;
  full_name: string | null;
  skill_level: string | null;
}

const TEAM_TYPES = new Set(['2teams', '3teams', '4teams', 'pairs']);

function normalizePlayerList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0);
  }

  if (typeof raw === 'string') {
    const value = raw.trim();
    return value ? [value] : [];
  }

  if (raw && typeof raw === 'object') {
    const maybePlayers = (raw as { players?: unknown }).players;
    if (Array.isArray(maybePlayers) || typeof maybePlayers === 'string') {
      return normalizePlayerList(maybePlayers);
    }

    return Object.values(raw as Record<string, unknown>)
      .flatMap((value) => normalizePlayerList(value));
  }

  return [];
}

function normalizePairsData(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string[]>>((acc, [key, value]) => {
    const players = normalizePlayerList(value);
    if (players.length > 0) {
      acc[key] = players;
    }
    return acc;
  }, {});
}

function normalizePairGroupData(raw: unknown): Array<{ groupName: string; pairNames: string[] }> {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const row = item as { groupName?: unknown; pairNames?: unknown };
        const groupName = String(row.groupName || '').trim();
        const pairNames = normalizePlayerList(row.pairNames)
          .map((name) => name.trim())
          .filter((name) => /^pair\d+$/i.test(name));

        if (!groupName || pairNames.length === 0) {
          return null;
        }

        return {
          groupName,
          pairNames: Array.from(new Set(pairNames)),
        };
      })
      .filter((item): item is { groupName: string; pairNames: string[] } => Boolean(item));
  }

  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([groupName, pairNamesRaw]) => {
        const pairNames = normalizePlayerList(pairNamesRaw)
          .map((name) => name.trim())
          .filter((name) => /^pair\d+$/i.test(name));

        if (!groupName || pairNames.length === 0) {
          return null;
        }

        return {
          groupName,
          pairNames: Array.from(new Set(pairNames)),
        };
      })
      .filter((item): item is { groupName: string; pairNames: string[] } => Boolean(item));
  }

  return [];
}

function parsePairsPayload(raw: unknown): {
  pairsData: Record<string, string[]>;
  pairGroupData: Array<{ groupName: string; pairNames: string[] }>;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      pairsData: normalizePairsData(raw),
      pairGroupData: [],
    };
  }

  const obj = raw as Record<string, unknown>;
  const hasStructuredPairs = typeof obj.pairs === 'object' && obj.pairs !== null;

  const pairsData = hasStructuredPairs
    ? normalizePairsData(obj.pairs)
    : normalizePairsData(obj);

  const pairGroupData = normalizePairGroupData(obj.groups);

  return { pairsData, pairGroupData };
}

function inferRoundTeamType(row: any, normalized: {
  racketTeam: string[];
  shuttleTeam: string[];
  team1: string[];
  team2: string[];
  team3: string[];
  team4: string[];
  pairsData: Record<string, string[]>;
}): TeamConfigType {
  const declared = String(row?.team_type || '').trim();
  if (TEAM_TYPES.has(declared)) {
    return declared as TeamConfigType;
  }

  if (Object.keys(normalized.pairsData).length > 0) {
    return 'pairs';
  }

  if (normalized.team4.length > 0) {
    return '4teams';
  }

  if (normalized.team3.length > 0) {
    return '3teams';
  }

  if (normalized.racketTeam.length > 0 || normalized.shuttleTeam.length > 0) {
    return '2teams';
  }

  if (normalized.team1.length > 0 || normalized.team2.length > 0) {
    return '2teams';
  }

  return '2teams';
}

export default function TeamManagementPage() {
  const supabase = getSupabaseClient();
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [todayPlayers, setTodayPlayers] = useState<string[]>([]);
  const [memberPlayers, setMemberPlayers] = useState<MemberOption[]>([]);
  const [levelInfoMap, setLevelInfoMap] = useState<LevelInfoMap>({});
  const [manualIncludedPlayers, setManualIncludedPlayers] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<Array<{
    id: string;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
    match_date: string | null;
    schedule_source?: MatchScheduleSource | null;
    description?: string | null;
    generated_match_id?: number | null;
  }>>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, TeamName>>({});
  const [loading, setLoading] = useState(true);
  const [teamConfig, setTeamConfig] = useState<TeamConfig>({ type: '2teams' });
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [selectedRoundForModal, setSelectedRoundForModal] = useState<RoundSummary | null>(null);
  const [pairGroups, setPairGroups] = useState<{groupName: string; players: string[]}[]>([]);
  const [selectedPairPlayer, setSelectedPairPlayer] = useState<string | null>(null);
  const [activePairGroupIndex, setActivePairGroupIndex] = useState<number | null>(null);
  const [selectedManualPlayer, setSelectedManualPlayer] = useState<string | null>(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const playerMetaByLabel = useMemo(
    () => new Map(memberPlayers.map((player) => [player.assignmentLabel, player])),
    [memberPlayers]
  );
  const playerPool = useMemo(
    () => Array.from(new Set(selectedScheduleId ? [...todayPlayers, ...manualIncludedPlayers] : todayPlayers)),
    [manualIncludedPlayers, selectedScheduleId, todayPlayers]
  );
  const availableMembersToAdd = useMemo(
    () => memberPlayers
      .filter((player) => !todayPlayers.includes(player.assignmentLabel) && !manualIncludedPlayers.includes(player.assignmentLabel))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ko-KR')),
    [manualIncludedPlayers, memberPlayers, todayPlayers]
  );

  // 레벨 표시는 level_info.code -> name 규칙을 따라야 한다.
  const formatAssignmentLabel = (profile: {
    id: string;
    username: string | null;
    full_name: string | null;
    skill_level: string | null;
  }) => {
    const playerName = profile.full_name || profile.username || `선수-${profile.id.substring(0, 4)}`;
    const levelCode = String(profile.skill_level || '').toUpperCase();
    return `${playerName}(${levelCode})`;
  };

  const normalizeGender = (value?: string | null): 'M' | 'F' | 'O' | '' => {
    const normalized = String(value || '').trim().toLowerCase();

    if (['m', 'male', 'man', '남', '남성'].includes(normalized)) {
      return 'M';
    }

    if (['f', 'female', 'woman', 'w', '여', '여성'].includes(normalized)) {
      return 'F';
    }

    if (['o', 'other'].includes(normalized)) {
      return 'O';
    }

    return '';
  };

  const getPlayerGender = (playerName: string): 'M' | 'F' | 'O' | '' => {
    return normalizeGender(playerMetaByLabel.get(playerName)?.gender);
  };

  const getCustomManualTeamNames = () => {
    const customTeamCount = Math.min(4, Math.max(2, teamConfig.numTeams || 2));
    return Array.from({ length: customTeamCount }, (_, index) => `team${index + 1}` as TeamName);
  };

  const getManualTeamType = (): TeamConfigType => {
    if (teamConfig.type !== 'custom') {
      return teamConfig.type;
    }

    const customTeamCount = Math.min(4, Math.max(2, teamConfig.numTeams || 2));
    return customTeamCount === 4 ? '4teams' : customTeamCount === 3 ? '3teams' : '2teams';
  };

  const getManualTeamOptions = () => {
    if (teamConfig.type === '4teams') {
      return [
        { key: 'team1' as TeamName, label: '팀 1', box: 'bg-blue-50 border-blue-200', text: 'text-blue-700', active: 'bg-blue-200 border-blue-400', button: 'bg-blue-600 hover:bg-blue-700' },
        { key: 'team2' as TeamName, label: '팀 2', box: 'bg-green-50 border-green-200', text: 'text-green-700', active: 'bg-green-200 border-green-400', button: 'bg-green-600 hover:bg-green-700' },
        { key: 'team3' as TeamName, label: '팀 3', box: 'bg-purple-50 border-purple-200', text: 'text-purple-700', active: 'bg-purple-200 border-purple-400', button: 'bg-purple-600 hover:bg-purple-700' },
        { key: 'team4' as TeamName, label: '팀 4', box: 'bg-orange-50 border-orange-200', text: 'text-orange-700', active: 'bg-orange-200 border-orange-400', button: 'bg-orange-600 hover:bg-orange-700' },
      ];
    }

    if (teamConfig.type === '3teams') {
      return [
        { key: 'team1' as TeamName, label: '팀 1', box: 'bg-blue-50 border-blue-200', text: 'text-blue-700', active: 'bg-blue-200 border-blue-400', button: 'bg-blue-600 hover:bg-blue-700' },
        { key: 'team2' as TeamName, label: '팀 2', box: 'bg-green-50 border-green-200', text: 'text-green-700', active: 'bg-green-200 border-green-400', button: 'bg-green-600 hover:bg-green-700' },
        { key: 'team3' as TeamName, label: '팀 3', box: 'bg-purple-50 border-purple-200', text: 'text-purple-700', active: 'bg-purple-200 border-purple-400', button: 'bg-purple-600 hover:bg-purple-700' },
      ];
    }

    if (teamConfig.type === 'custom') {
      return getCustomManualTeamNames().map((teamName, index) => {
        const palette = [
          { box: 'bg-blue-50 border-blue-200', text: 'text-blue-700', active: 'bg-blue-200 border-blue-400', button: 'bg-blue-600 hover:bg-blue-700' },
          { box: 'bg-green-50 border-green-200', text: 'text-green-700', active: 'bg-green-200 border-green-400', button: 'bg-green-600 hover:bg-green-700' },
          { box: 'bg-purple-50 border-purple-200', text: 'text-purple-700', active: 'bg-purple-200 border-purple-400', button: 'bg-purple-600 hover:bg-purple-700' },
          { box: 'bg-orange-50 border-orange-200', text: 'text-orange-700', active: 'bg-orange-200 border-orange-400', button: 'bg-orange-600 hover:bg-orange-700' },
        ][index];

        return {
          key: teamName,
          label: `팀 ${index + 1}`,
          ...palette,
        };
      });
    }

    return [
      { key: 'racket' as TeamName, label: '라켓팀', box: 'bg-blue-50 border-blue-200', text: 'text-blue-700', active: 'bg-blue-200 border-blue-400', button: 'bg-blue-600 hover:bg-blue-700' },
      { key: 'shuttle' as TeamName, label: '셔틀팀', box: 'bg-purple-50 border-purple-200', text: 'text-purple-700', active: 'bg-purple-200 border-purple-400', button: 'bg-purple-600 hover:bg-purple-700' },
    ];
  };

  const getTeamPlayerGridClassName = (type: TeamConfigType) => {
    if (type === '4teams') {
      return 'grid grid-cols-1 gap-2 sm:grid-cols-2';
    }

    if (type === '3teams') {
      return 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3';
    }

    return 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4';
  };

  const getPlayerCardClassName = (isSelected: boolean, isOtherTeam: boolean, activeClassName: string, idleClassName: string) =>
    `min-h-[40px] rounded border px-2 py-1.5 text-center text-sm leading-tight transition-colors ${
      isSelected
        ? `${activeClassName} font-semibold`
        : isOtherTeam
        ? 'bg-gray-100 border-gray-300 text-gray-400'
        : `${idleClassName} cursor-pointer`
    }`;

  const fetchMemberPlayers = async () => {
    try {
      const [profilesData, levelInfoResult] = await Promise.all([
        fetchAdminMembers(),
        fetchLevelInfoMap(supabase),
      ]);

      setLevelInfoMap(levelInfoResult);
      setMemberPlayers((profilesData || []).map((profile) => ({
        id: profile.id,
        fullName: profile.full_name || profile.username || `선수-${profile.id.substring(0, 4)}`,
        levelName: getLevelNameFromCode(levelInfoResult, profile.skill_level, '미지정') || '미지정',
        skillCode: String(profile.skill_level || '').toUpperCase(),
        gender: String(profile.gender || ''),
        score: getLevelScoreFromCode(levelInfoResult, profile.skill_level, getLegacyLevelScore(profile.skill_level || '')),
        assignmentLabel: formatAssignmentLabel(profile),
      })));
    } catch (error) {
      console.error('회원 목록 조회 실패:', error);
      setMemberPlayers([]);
    }
  };

  const fetchAssignmentLabelsByUserIds = async (userIds: string[]) => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

    if (uniqueUserIds.length === 0) {
      return [];
    }

    const profileMatchFilter = uniqueUserIds
      .map((userId) => `id.eq.${userId},user_id.eq.${userId}`)
      .join(',');

    const { data: profilesData, error: profileError } = await supabase
      .from('profiles')
      .select('id, user_id, username, full_name, skill_level')
      .or(profileMatchFilter);

    if (profileError) {
      throw profileError;
    }

    const profileMap = new Map<string, AssignableProfile>();

    (profilesData || []).forEach((profile) => {
      const normalizedProfile: AssignableProfile = {
        id: profile.id,
        user_id: profile.user_id,
        username: profile.username,
        full_name: profile.full_name,
        skill_level: profile.skill_level,
      };

      profileMap.set(profile.id, normalizedProfile);

      if (profile.user_id) {
        profileMap.set(profile.user_id, normalizedProfile);
      }
    });

    return uniqueUserIds
      .map((userId) => profileMap.get(userId))
      .filter((profile): profile is AssignableProfile => Boolean(profile))
      .map(formatAssignmentLabel);
  };

  // 오늘 출석한 선수들 조회
  const fetchTodayPlayers = async (scheduleId?: string | null, schedulesList?: any[]) => {
    const targetScheduleId = scheduleId !== undefined ? scheduleId : selectedScheduleId;
    const targetSchedules = schedulesList !== undefined ? schedulesList : schedules;

    try {
      // 우선: 선택된 스케줄이 있으면 해당 스케줄의 등록자만 사용
      if (targetScheduleId) {
        const sched = targetSchedules.find(s => s.id === targetScheduleId);
        if (sched && sched.participants) {
          const names = sched.participants.map((p: any) => {
            const profile = p.profiles || {};
            const playerName = profile.full_name || profile.username || `선수-${p.user_id.substring(0, 4)}`;
            const levelCode = String(profile.skill_level || '').toUpperCase() || 'N';
            return `${playerName}(${levelCode})`;
          });
          setTodayPlayers(names);
          return;
        }

        // 만약 schedules 리스트에 없거나 participants가 로드 안 된 경우 fallback 쿼리
        const { data: participants, error: participantsError } = await supabase
          .from('match_participants')
          .select('user_id, status')
          .eq('match_schedule_id', targetScheduleId)
          .in('status', ['registered', 'attended']);

        if (participantsError) {
          console.error('선택 경기 참가자 조회 오류:', participantsError);
          setTodayPlayers([]);
          return;
        }

        const userIds = Array.from(new Set((participants || []).map((row) => row.user_id).filter(Boolean)));

        if (userIds.length === 0) {
          setTodayPlayers([]);
          return;
        }

        let names: string[] = [];
        try {
          names = await fetchAssignmentLabelsByUserIds(userIds);
        } catch (profileError) {
          console.error('선택 경기 프로필 조회 오류:', profileError);
          setTodayPlayers([]);
          return;
        }

        setTodayPlayers(names);
        return;
      }

      // 선택된 스케줄이 없으면 기존 출석 데이터를 사용
      const today = getKoreaDate();
      const { data: attendanceData, error } = await supabase
        .from('attendances')
        .select('user_id, status')
        .eq('attended_at', today)
        .eq('status', 'present'); // 출석한 선수만

      if (error) {
        console.error('출석 데이터 조회 오류:', error);
        setTodayPlayers([]);
        return;
      }

      if (!attendanceData || attendanceData.length === 0) {
        console.log('오늘 출석한 선수가 없습니다.');
        setTodayPlayers([]);
        return;
      }

      const userIds = attendanceData.map(a => a.user_id);
      const { data: profilesData, error: profileError } = await supabase
        .from('profiles')
        .select('id, username, full_name, skill_level')
        .in('id', userIds);

      if (profileError) {
        console.error('프로필 조회 오류:', profileError);
        setTodayPlayers([]);
        return;
      }

      const playerNamesWithLevel = profilesData?.map(formatAssignmentLabel) || [];

      setTodayPlayers(playerNamesWithLevel);
    } catch (error) {
      console.error('선수 조회 중 오류:', error);
      setTodayPlayers([]);
    }
  };

  // 스케줄 목록을 불러와 선택할 수 있게 함
  const fetchSchedulesList = async () => {
    try {
      const today = getKoreaDate();
      const response = await fetch('/api/admin/match-schedules?from_date=today&status=scheduled&schedule_source=tournament', {
        method: 'GET',
        cache: 'no-store',
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          schedules?: Array<{
            id: string;
            match_date: string | null;
            start_time: string | null;
            end_time: string | null;
            location: string | null;
            schedule_source?: MatchScheduleSource | null;
            description?: string | null;
            generated_match_id?: number | null;
            participants?: any[];
          }>;
        };
        const nextSchedules = (payload.schedules || []).map((schedule) => ({
          ...schedule,
          schedule_source: normalizeScheduleSource(schedule.schedule_source),
        }));
        setSchedules(nextSchedules);
        if (nextSchedules.length === 0) {
          setSelectedScheduleId(null);
        } else if (!selectedScheduleId) {
          setSelectedScheduleId(nextSchedules[0].id);
        }
        return nextSchedules;
      }

      const payload = await response.json().catch(() => null);
      console.warn('team-management 일정 API fallback 실행:', payload);

      const { data, error } = await supabase
        .from('match_schedules')
        .select('id, match_date, start_time, end_time, location, description, generated_match_id')
        .gte('match_date', today)
        .order('match_date', { ascending: true });

      if (error) {
        console.error('일정 목록 조회 오류:', error);
        setSchedules([]);
        return [];
      }

      const nextSchedules = (data || []).map((schedule) => ({
        ...schedule,
        schedule_source: inferScheduleSource(schedule),
      }))
        .filter((schedule) => schedule.schedule_source === 'tournament');

      setSchedules(nextSchedules);
      if (nextSchedules.length === 0) {
        setSelectedScheduleId(null);
      } else if (!selectedScheduleId) {
        setSelectedScheduleId(nextSchedules[0].id);
      }
      return nextSchedules;
    } catch (e) {
      console.error('일정 조회 실패:', e);
      setSchedules([]);
      return [];
    }
  };

  // 기존 회차 데이터 조회
  const fetchRoundsData = async () => {
    try {
      // team_assignments 테이블에서 조회 (새로운 JSONB 구조)
      console.log('📋 회차 데이터 로드 시작...');
      
      const { data, error } = await supabase
        .from('team_assignments')
        .select('*')
        .order('assignment_date', { ascending: false })
        .order('round_number', { ascending: true });
        
      if (error) {
        console.error('❌ 회차 데이터 조회 오류:', error.message || error.code || '알 수 없는 오류');
        if (error.code === '42P01' || error.message?.includes('relation') || error.message?.includes('does not exist')) {
          console.log('team_assignments 테이블이 없습니다.');
          loadFromLocalStorage();
          return;
        }
        loadFromLocalStorage();
        return;
      }
      
      console.log('✅ 회차 데이터 로드 완료:', data);
      console.log('📊 로드된 회차 개수:', data?.length || 0);
      
      if (data && data.length > 0) {
        // 새로운 구조: 각 row가 하나의 회차
        const roundsArray: RoundSummary[] = data.map((row: any) => {
          const parsedPairsPayload = parsePairsPayload(row.pairs_data);

          const normalized = {
            racketTeam: normalizePlayerList(row.racket_team),
            shuttleTeam: normalizePlayerList(row.shuttle_team),
            team1: normalizePlayerList(row.team1),
            team2: normalizePlayerList(row.team2),
            team3: normalizePlayerList(row.team3),
            team4: normalizePlayerList(row.team4),
            pairsData: parsedPairsPayload.pairsData,
          };

          const normalizedType = inferRoundTeamType(row, normalized);
          const racketTeamForView = normalized.racketTeam.length > 0 ? normalized.racketTeam : normalized.team1;
          const shuttleTeamForView = normalized.shuttleTeam.length > 0 ? normalized.shuttleTeam : normalized.team2;

          const roundSummary: RoundSummary = {
            round: row.round_number,
            racket_team: racketTeamForView,
            shuttle_team: shuttleTeamForView,
            team1: normalized.team1,
            team2: normalized.team2,
            team3: normalized.team3,
            team4: normalized.team4,
            pairs_data: normalized.pairsData,
            pair_group_data: parsedPairsPayload.pairGroupData,
            total_players: 0,
            title: row.title,
            assignment_date: row.assignment_date,
            team_type: normalizedType
          };

          // 총 인원 계산
          const allPlayers = new Set<string>([
            ...roundSummary.racket_team,
            ...roundSummary.shuttle_team,
            ...(roundSummary.team1 || []),
            ...(roundSummary.team2 || []),
            ...(roundSummary.team3 || []),
            ...(roundSummary.team4 || []),
            ...Object.values(roundSummary.pairs_data || {}).flat(),
          ]);
          roundSummary.total_players = allPlayers.size;

          console.log(`🏆 회차 ${row.round_number}:`, {
            title: row.title,
            type: normalizedType,
            date: row.assignment_date,
            totalPlayers: roundSummary.total_players
          });

          return roundSummary;
        });
        
        setRounds(roundsArray);
        
        // 다음 회차 번호 설정
        const maxRound = Math.max(...roundsArray.map(r => r.round), 0);
        setCurrentRound(maxRound + 1);
        console.log(`✅ ${roundsArray.length}개 회차 로드 완료`);
      } else {
        console.log('⚠️ 회차 데이터가 없습니다.');
        loadFromLocalStorage();
      }
    } catch (error) {
      console.error('데이터 조회 중 오류:', error instanceof Error ? error.message : String(error));
      setRounds([]);
    } finally {
      setLoading(false);
    }
  };

  // 팀 배정 저장 (DB 우선, 실패 시 로컬 스토리지)
  const saveTeamAssignments = async () => {
    try {
      if (Object.keys(assignments).length === 0) {
        alert('팀 배정을 먼저 해주세요.');
        return;
      }
      
      // 날짜 결정
      let titleDate = getKoreaDate();
      if (selectedScheduleId) {
        const { data: schedule, error: scheduleError } = await supabase
          .from('match_schedules')
          .select('match_date')
          .eq('id', selectedScheduleId)
          .maybeSingle();
        if (scheduleError) {
          console.warn('⚠️ 일정 날짜 조회 실패, 오늘 날짜를 사용합니다:', scheduleError);
        }
        if (schedule?.match_date) titleDate = schedule.match_date;
      }

      const effectiveTeamType = getManualTeamType();

      // 팀 구성 방식 라벨 생성
      const getTeamTypeLabel = (type: string) => {
        switch(type) {
          case '2teams': return '2팀';
          case '3teams': return '3팀';
          case '4teams': return '4팀';
          case 'pairs': return '페어';
          case 'custom': return '사용자정의';
          default: return '2팀';
        }
      };

      const roundTitle = `대회 경기 ${titleDate} ${teamConfig.type === 'custom' ? `수동배정 ${getTeamTypeLabel(effectiveTeamType)}` : getTeamTypeLabel(teamConfig.type)}`;
      let dbSaveSucceeded = false;

      // 팀별로 분리
      let racketPlayers: string[] = [];
      let shuttlePlayers: string[] = [];
      let team1Players: string[] = [];
      let team2Players: string[] = [];
      let team3Players: string[] = [];
      let team4Players: string[] = [];
      let pairGroupDataForSave: Array<{ groupName: string; pairNames: string[] }> = [];

      if (effectiveTeamType === '3teams' || effectiveTeamType === '4teams') {
        // 3팀, 4팀 모드 - team1, team2, team3, team4 사용
        team1Players = Object.entries(assignments)
          .filter(([_, team]) => team === 'team1')
          .map(([name, _]) => name);
        team2Players = Object.entries(assignments)
          .filter(([_, team]) => team === 'team2')
          .map(([name, _]) => name);
        team3Players = Object.entries(assignments)
          .filter(([_, team]) => team === 'team3')
          .map(([name, _]) => name);
        
        if (effectiveTeamType === '4teams') {
          team4Players = Object.entries(assignments)
            .filter(([_, team]) => team === 'team4')
            .map(([name, _]) => name);
        }
      } else if (teamConfig.type === 'pairs') {
        // pairs 모드 - 동적으로 페어 저장 (team1~team4는 사용 안 함)
        // 전체 assignments를 JSON으로 저장
      } else {
        // 2팀 모드 (기본)
        racketPlayers = Object.entries(assignments)
          .filter(([_, team]) => team === 'racket')
          .map(([name, _]) => name);
        shuttlePlayers = Object.entries(assignments)
          .filter(([_, team]) => team === 'shuttle')
          .map(([name, _]) => name);
      }

      // DB에 저장 시도
      try {
        // 모든 필드를 명시적으로 설정 (null 대신 빈 배열 사용)
        const insertData: any = {
          assignment_date: titleDate,
          round_number: currentRound,
          title: roundTitle,
          team_type: effectiveTeamType,
          racket_team: [],
          shuttle_team: [],
          team1: [],
          team2: [],
          team3: [],
          team4: [],
          pairs_data: {}
        };

        // 팀 타입에 따라 적절한 필드에만 값 설정
        if (teamConfig.type === 'pairs') {
          // pairs 모드: 페어 데이터를 JSON으로 저장
          const pairsData: Record<string, string[]> = {};
          Object.entries(assignments).forEach(([player, team]) => {
            if (!pairsData[team]) pairsData[team] = [];
            pairsData[team].push(player);
          });

          pairGroupDataForSave = pairGroups
            .map((group) => {
              const pairNames = Object.entries(pairsData)
                .filter(([_, players]) => players.some((player) => group.players.includes(player)))
                .map(([pairName]) => pairName)
                .filter((pairName) => /^pair\d+$/i.test(pairName));

              if (pairNames.length === 0) {
                return null;
              }

              return {
                groupName: group.groupName,
                pairNames: Array.from(new Set(pairNames)),
              };
            })
            .filter((row): row is { groupName: string; pairNames: string[] } => Boolean(row));

          insertData.pairs_data = {
            pairs: pairsData,
            groups: pairGroupDataForSave,
          };
        } else if (effectiveTeamType === '3teams') {
          insertData.team1 = team1Players;
          insertData.team2 = team2Players;
          insertData.team3 = team3Players;
        } else if (effectiveTeamType === '4teams') {
          insertData.team1 = team1Players;
          insertData.team2 = team2Players;
          insertData.team3 = team3Players;
          insertData.team4 = team4Players;
        } else {
          // 2팀 모드 (기본)
          insertData.racket_team = racketPlayers;
          insertData.shuttle_team = shuttlePlayers;
        }

        console.log('📥 DB에 저장할 데이터:', insertData);
        
        const response = await fetch('/api/admin/team-assignments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(insertData),
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          console.error('❌ DB 저장 오류 - 상세:', errorPayload);
          throw new Error(errorPayload?.error || '팀 배정 저장에 실패했습니다.');
        }
        
        console.log('✅ DB에 저장 성공');
        dbSaveSucceeded = true;
        
        // 저장 확인을 위해 데이터 다시 조회
        const { data, error: selectError } = await supabase
          .from('team_assignments')
          .select()
          .eq('assignment_date', titleDate)
          .eq('round_number', currentRound);
        
        if (selectError) {
          console.warn('⚠️ 저장 확인 중 오류 (무시함):', selectError);
        } else {
          console.log('✅ 저장 확인 완료:', data);
        }
      } catch (dbError: any) {
        console.warn('⚠️ DB 저장 실패, 로컬 스토리지에 저장합니다:', {
          message: dbError?.message,
          code: dbError?.code,
          details: dbError?.details,
          hint: dbError?.hint,
          fullError: dbError
        });
        
        // 로컬 스토리지에 저장 (폴백)
        const assignmentData = Object.entries(assignments).map(([playerName, teamType]) => ({
          round_number: currentRound,
          player_name: playerName,
          team_type: teamType,
          created_at: new Date().toISOString(),
          round_title: roundTitle,
          assignment_date: titleDate
        }));
        
        const existingData = JSON.parse(localStorage.getItem('badminton_team_assignments') || '[]');
        const newData = [...existingData, ...assignmentData];
        localStorage.setItem('badminton_team_assignments', JSON.stringify(newData));
      }
      
      // 상태 업데이트
      const newRound: RoundSummary = {
        round: currentRound,
        racket_team: racketPlayers,
        shuttle_team: shuttlePlayers,
        team1: team1Players,
        team2: team2Players,
        team3: team3Players,
        team4: team4Players,
        total_players: Object.keys(assignments).length,
        title: roundTitle,
        assignment_date: titleDate,
        team_type: effectiveTeamType
      };
      
      // pairs 모드일 때 pairs_data 추가
      if (teamConfig.type === 'pairs') {
        const pairsData: Record<string, string[]> = {};
        Object.entries(assignments).forEach(([player, team]) => {
          if (!pairsData[team]) pairsData[team] = [];
          pairsData[team].push(player);
        });
        newRound.pairs_data = pairsData;
        newRound.pair_group_data = pairGroupDataForSave;
      }
      
      setRounds([...rounds, newRound]);
      setCurrentRound(currentRound + 1);
      setAssignments({});
      
      // 저장 후 데이터 다시 로드
      console.log('📊 저장 후 데이터 재로드...');
      if (dbSaveSucceeded) {
        await fetchRoundsData();
      } else {
        loadFromLocalStorage();
      }
      
      alert(`${roundTitle} 팀 배정이 저장되었습니다.`);
    } catch (error) {
      console.error('❌ 저장 중 오류:', error);
      alert('저장 중 오류가 발생했습니다.');
    }
  };

  // 팀 배정 삭제
  const deleteTeamAssignment = async (roundNumber: number, assignmentDate: string) => {
    if (!confirm(`${roundNumber}회차 팀 구성을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      console.log(`삭제 시도: round_number=${roundNumber}, assignment_date=${assignmentDate}`);
      
      // DB에서 삭제 시도
      const { error, data } = await supabase
        .from('team_assignments')
        .delete()
        .eq('round_number', roundNumber)
        .eq('assignment_date', assignmentDate)
        .select();

      if (error) {
        console.error('DB 삭제 오류:', error);
        throw error;
      }

      console.log('✅ DB에서 삭제 성공:', data);
      
      // 로컬 스토리지에서도 삭제
      try {
        const localData = JSON.parse(localStorage.getItem('badminton_team_assignments') || '[]');
        const filteredData = localData.filter((item: TeamAssignment) => 
          !(item.round_number === roundNumber && item.assignment_date === assignmentDate)
        );
        localStorage.setItem('badminton_team_assignments', JSON.stringify(filteredData));
        console.log('✅ 로컬 스토리지에서도 삭제 완료');
      } catch (localError) {
        console.warn('로컬 스토리지 삭제 실패:', localError);
      }
      
      // 로컬 상태 즉시 업데이트
      setRounds(prev => prev.filter(r => 
        !(r.round === roundNumber && r.assignment_date === assignmentDate)
      ));
      
      alert(`${roundNumber}회차가 삭제되었습니다.`);
      
      // 데이터 다시 불러오기 (DB와 동기화)
      await fetchRoundsData();
    } catch (dbError) {
      console.error('삭제 실패:', dbError);
      alert('삭제 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  };

  // 로컬 스토리지에서 데이터 불러오기
  const loadFromLocalStorage = () => {
    try {
      const data = JSON.parse(localStorage.getItem('badminton_team_assignments') || '[]');
      
      if (data.length === 0) {
        setRounds([]);
        return;
      }
      
      const roundsMap: Record<number, RoundSummary> = {};
      
      data.forEach((assignment: TeamAssignment) => {
        if (!roundsMap[assignment.round_number]) {
          roundsMap[assignment.round_number] = {
            round: assignment.round_number,
            racket_team: [],
            shuttle_team: [],
            team1: [],
            team2: [],
            team3: [],
            team4: [],
            pairs_data: {},
            total_players: 0
          };
        }

        const round = roundsMap[assignment.round_number];
        const teamKey = String(assignment.team_type || '').trim();

        if (teamKey === 'racket') {
          roundsMap[assignment.round_number].racket_team.push(assignment.player_name);
        } else if (teamKey === 'shuttle') {
          roundsMap[assignment.round_number].shuttle_team.push(assignment.player_name);
        } else if (teamKey === 'team1') {
          round.team1!.push(assignment.player_name);
        } else if (teamKey === 'team2') {
          round.team2!.push(assignment.player_name);
        } else if (teamKey === 'team3') {
          round.team3!.push(assignment.player_name);
        } else if (teamKey === 'team4') {
          round.team4!.push(assignment.player_name);
        } else if (teamKey.startsWith('pair')) {
          if (!round.pairs_data) {
            round.pairs_data = {};
          }
          if (!round.pairs_data[teamKey]) {
            round.pairs_data[teamKey] = [];
          }
          round.pairs_data[teamKey].push(assignment.player_name);
        }

        if (assignment.round_title) {
          round.title = assignment.round_title;
        }
        if (assignment.assignment_date) {
          round.assignment_date = assignment.assignment_date;
        }
      });

      const roundsArray = Object.values(roundsMap).map((round) => {
        const allPlayers = new Set<string>([
          ...round.racket_team,
          ...round.shuttle_team,
          ...(round.team1 || []),
          ...(round.team2 || []),
          ...(round.team3 || []),
          ...(round.team4 || []),
          ...Object.values(round.pairs_data || {}).flat(),
        ]);

        const hasPairs = Object.keys(round.pairs_data || {}).length > 0;
        const has4Teams = (round.team4?.length || 0) > 0;
        const has3Teams = (round.team3?.length || 0) > 0;

        if (!round.team_type) {
          if (hasPairs) {
            round.team_type = 'pairs';
          } else if (has4Teams) {
            round.team_type = '4teams';
          } else if (has3Teams) {
            round.team_type = '3teams';
          } else {
            round.team_type = '2teams';
          }
        }

        if ((round.racket_team.length === 0 && round.shuttle_team.length === 0) && ((round.team1?.length || 0) > 0 || (round.team2?.length || 0) > 0)) {
          round.racket_team = [...(round.team1 || [])];
          round.shuttle_team = [...(round.team2 || [])];
        }

        round.total_players = allPlayers.size;
        return round;
      });

      setRounds(roundsArray);
      
      const maxRound = Math.max(...roundsArray.map(r => r.round), 0);
      setCurrentRound(maxRound + 1);
    } catch (error) {
      console.error('로컬 데이터 불러오기 오류:', error);
      setRounds([]);
    }
  };

  // 자동 팀 배정 (설정된 타입에 따라)
  const autoAssignTeams = () => {
    if (playerPool.length === 0) {
      alert('출석한 선수가 없습니다.');
      return;
    }

    const shufflePlayers = (players: string[]) => {
      const shuffled = [...players];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const areAssignmentsEqual = (left: Record<string, TeamName>, right: Record<string, TeamName>) => {
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);

      if (leftKeys.length !== rightKeys.length) {
        return false;
      }

      return leftKeys.every((key) => left[key] === right[key]);
    };

    const distributeByWeight = (total: number, weights: number[]) => {
      if (weights.length === 0) {
        return [];
      }

      if (total <= 0) {
        return weights.map(() => 0);
      }

      const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      const rawValues = weights.map((weight) => (total * weight) / weightSum);
      const allocated = rawValues.map((value) => Math.floor(value));
      const remaining = total - allocated.reduce((sum, value) => sum + value, 0);

      const remainders = rawValues
        .map((value, index) => ({ index, remainder: value - allocated[index] }))
        .sort((a, b) => b.remainder - a.remainder);

      for (let i = 0; i < remaining; i++) {
        allocated[remainders[i % remainders.length].index] += 1;
      }

      return allocated;
    };

    const getConfiguredTeamNames = (): TeamName[] => {
      if (teamConfig.type === '4teams') {
        return ['team1', 'team2', 'team3', 'team4'];
      }

      if (teamConfig.type === '3teams') {
        return ['team1', 'team2', 'team3'];
      }

      return ['racket', 'shuttle'];
    };

    const buildBalancedAssignments = (teamNames: TeamName[]) => {
      const shuffledPlayerOrder = shufflePlayers(playerPool);
      const shuffledOrderMap = new Map(shuffledPlayerOrder.map((player, index) => [player, index]));

      const players = playerPool
        .map((player) => ({
          name: player,
          score: getPlayerScore(player),
          gender: getPlayerGender(player),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          return (shuffledOrderMap.get(a.name) || 0) - (shuffledOrderMap.get(b.name) || 0);
        });

      const playersWithTiers = players.map((player, index) => ({
        ...player,
        tier: Math.floor(index / Math.max(teamNames.length, 1)),
      }));

      const totalScore = playersWithTiers.reduce((sum, player) => sum + player.score, 0);
      const totalMale = playersWithTiers.filter((player) => player.gender === 'M').length;
      const totalFemale = playersWithTiers.filter((player) => player.gender === 'F').length;
      const totalUnknownGender = playersWithTiers.length - totalMale - totalFemale;
      const targetSizes = distributeByWeight(playersWithTiers.length, teamNames.map(() => 1));
      const targetMaleCounts = distributeByWeight(totalMale, targetSizes);
      const targetFemaleCounts = distributeByWeight(totalFemale, targetSizes);
      const targetUnknownCounts = distributeByWeight(totalUnknownGender, targetSizes);
      const averageScorePerPlayer = playersWithTiers.length > 0 ? totalScore / playersWithTiers.length : 0;
      const targetScores = targetSizes.map((size) => averageScorePerPlayer * size);

      type BalancedTeamState = {
        name: TeamName;
        players: string[];
        score: number;
        maleCount: number;
        femaleCount: number;
        unknownCount: number;
        targetSize: number;
        targetMale: number;
        targetFemale: number;
        targetUnknown: number;
        targetScore: number;
        tierCounts: Record<number, number>;
      };

      const teams: BalancedTeamState[] = teamNames.map((name, index) => ({
        name,
        players: [],
        score: 0,
        maleCount: 0,
        femaleCount: 0,
        unknownCount: 0,
        targetSize: targetSizes[index] || 0,
        targetMale: targetMaleCounts[index] || 0,
        targetFemale: targetFemaleCounts[index] || 0,
        targetUnknown: targetUnknownCounts[index] || 0,
        targetScore: targetScores[index] || 0,
        tierCounts: {},
      }));

      const evaluateTeams = (candidateTeams: BalancedTeamState[]) => {
        const scores = candidateTeams.map((team) => team.score);
        const sizes = candidateTeams.map((team) => team.players.length);
        const males = candidateTeams.map((team) => team.maleCount);
        const females = candidateTeams.map((team) => team.femaleCount);
        const unknowns = candidateTeams.map((team) => team.unknownCount);

        const scoreRange = scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : 0;
        const sizeRange = sizes.length > 0 ? Math.max(...sizes) - Math.min(...sizes) : 0;
        const maleRange = males.length > 0 ? Math.max(...males) - Math.min(...males) : 0;
        const femaleRange = females.length > 0 ? Math.max(...females) - Math.min(...females) : 0;
        const unknownRange = unknowns.length > 0 ? Math.max(...unknowns) - Math.min(...unknowns) : 0;

        return candidateTeams.reduce((sum, team) => {
          const scoreDiff = team.score - team.targetScore;
          const maleDiff = team.maleCount - team.targetMale;
          const femaleDiff = team.femaleCount - team.targetFemale;
          const unknownDiff = team.unknownCount - team.targetUnknown;
          const sizeDiff = team.players.length - team.targetSize;
          const tierPenalty = Object.values(team.tierCounts).reduce((tierSum, count) => {
            const overflow = Math.max(0, count - 1);
            return tierSum + (overflow * overflow * 18000);
          }, 0);

          return sum
            + (sizeDiff * sizeDiff * 300000)
            + (maleDiff * maleDiff * 30000)
            + (femaleDiff * femaleDiff * 30000)
            + (unknownDiff * unknownDiff * 8000)
            + (scoreDiff * scoreDiff * 40)
            + tierPenalty;
        }, 0)
          + (sizeRange * 500000)
          + (maleRange * 100000)
          + (femaleRange * 100000)
          + (unknownRange * 15000)
          + (scoreRange * scoreRange * 250);
      };

      const cloneTeams = (sourceTeams: BalancedTeamState[]) =>
        sourceTeams.map((team) => ({
          ...team,
          players: [...team.players],
          tierCounts: { ...team.tierCounts },
        }));

      const applyPlayerToTeam = (
        sourceTeams: BalancedTeamState[],
        teamIndex: number,
        player: { name: string; score: number; gender: 'M' | 'F' | 'O' | ''; tier: number }
      ) => {
        const nextTeams = cloneTeams(sourceTeams);
        const team = nextTeams[teamIndex];

        team.players.push(player.name);
        team.score += player.score;
        team.tierCounts[player.tier] = (team.tierCounts[player.tier] || 0) + 1;
        if (player.gender === 'M') {
          team.maleCount += 1;
        } else if (player.gender === 'F') {
          team.femaleCount += 1;
        } else {
          team.unknownCount += 1;
        }

        return nextTeams;
      };

      const removePlayerFromTeam = (
        sourceTeams: BalancedTeamState[],
        teamIndex: number,
        player: { name: string; score: number; gender: 'M' | 'F' | 'O' | ''; tier: number }
      ) => {
        const nextTeams = cloneTeams(sourceTeams);
        const team = nextTeams[teamIndex];

        team.players = team.players.filter((name) => name !== player.name);
        team.score -= player.score;
        const nextTierCount = (team.tierCounts[player.tier] || 0) - 1;
        if (nextTierCount > 0) {
          team.tierCounts[player.tier] = nextTierCount;
        } else {
          delete team.tierCounts[player.tier];
        }
        if (player.gender === 'M') {
          team.maleCount -= 1;
        } else if (player.gender === 'F') {
          team.femaleCount -= 1;
        } else {
          team.unknownCount -= 1;
        }

        return nextTeams;
      };

      const playerMap = new Map(playersWithTiers.map((player) => [player.name, player]));

      playersWithTiers.forEach((player) => {
        let bestTeamIndex = -1;
        let bestPenalty = Number.POSITIVE_INFINITY;

        teams.forEach((team, index) => {
          if (team.players.length >= team.targetSize) {
            return;
          }

          const nextTeams = applyPlayerToTeam(teams, index, player);
          const totalPenalty = evaluateTeams(nextTeams);

          if (totalPenalty < bestPenalty - 0.0001) {
            bestPenalty = totalPenalty;
            bestTeamIndex = index;
          }
        });

        if (bestTeamIndex < 0) {
          bestTeamIndex = teams.findIndex((team) => team.players.length < team.targetSize);
        }

        if (bestTeamIndex < 0) {
          bestTeamIndex = 0;
        }

        const targetTeam = teams[bestTeamIndex];
        targetTeam.players.push(player.name);
        targetTeam.score += player.score;
        if (player.gender === 'M') {
          targetTeam.maleCount += 1;
        } else if (player.gender === 'F') {
          targetTeam.femaleCount += 1;
        } else {
          targetTeam.unknownCount += 1;
        }
      });

      for (let iteration = 0; iteration < 8; iteration++) {
        const currentScore = evaluateTeams(teams);
        let bestChange:
          | {
              kind: 'move' | 'swap';
              fromTeamIndex: number;
              toTeamIndex: number;
              playerA: string;
              playerB?: string;
              score: number;
            }
          | null = null;

        for (let fromTeamIndex = 0; fromTeamIndex < teams.length; fromTeamIndex++) {
          const fromTeam = teams[fromTeamIndex];

          for (let toTeamIndex = 0; toTeamIndex < teams.length; toTeamIndex++) {
            if (fromTeamIndex === toTeamIndex) {
              continue;
            }

            const toTeam = teams[toTeamIndex];

            for (const playerAName of fromTeam.players) {
              const playerA = playerMap.get(playerAName);
              if (!playerA) {
                continue;
              }

              if (fromTeam.players.length > fromTeam.targetSize && toTeam.players.length < toTeam.targetSize) {
                const movedTeams = applyPlayerToTeam(
                  removePlayerFromTeam(teams, fromTeamIndex, playerA),
                  toTeamIndex,
                  playerA
                );
                const movedScore = evaluateTeams(movedTeams);
                if (movedScore + 0.0001 < currentScore && (!bestChange || movedScore < bestChange.score)) {
                  bestChange = {
                    kind: 'move',
                    fromTeamIndex,
                    toTeamIndex,
                    playerA: playerA.name,
                    score: movedScore,
                  };
                }
              }

              for (const playerBName of toTeam.players) {
                const playerB = playerMap.get(playerBName);
                if (!playerB) {
                  continue;
                }

                let swappedTeams = removePlayerFromTeam(teams, fromTeamIndex, playerA);
                swappedTeams = removePlayerFromTeam(swappedTeams, toTeamIndex, playerB);
                swappedTeams = applyPlayerToTeam(swappedTeams, fromTeamIndex, playerB);
                swappedTeams = applyPlayerToTeam(swappedTeams, toTeamIndex, playerA);

                const swappedScore = evaluateTeams(swappedTeams);
                if (swappedScore + 0.0001 < currentScore && (!bestChange || swappedScore < bestChange.score)) {
                  bestChange = {
                    kind: 'swap',
                    fromTeamIndex,
                    toTeamIndex,
                    playerA: playerA.name,
                    playerB: playerB.name,
                    score: swappedScore,
                  };
                }
              }
            }
          }
        }

        if (!bestChange) {
          break;
        }

        const playerA = playerMap.get(bestChange.playerA);
        if (!playerA) {
          break;
        }

        let optimizedTeams = removePlayerFromTeam(teams, bestChange.fromTeamIndex, playerA);

        if (bestChange.kind === 'swap' && bestChange.playerB) {
          const playerB = playerMap.get(bestChange.playerB);
          if (!playerB) {
            break;
          }
          optimizedTeams = removePlayerFromTeam(optimizedTeams, bestChange.toTeamIndex, playerB);
          optimizedTeams = applyPlayerToTeam(optimizedTeams, bestChange.fromTeamIndex, playerB);
          optimizedTeams = applyPlayerToTeam(optimizedTeams, bestChange.toTeamIndex, playerA);
        } else {
          optimizedTeams = applyPlayerToTeam(optimizedTeams, bestChange.toTeamIndex, playerA);
        }

        optimizedTeams.forEach((optimizedTeam, index) => {
          teams[index] = optimizedTeam;
        });
      }

      return teams;
    };

    const assignBalancedTeamNames = (teamNames: TeamName[]) => {
      const currentAssignmentsForPool = playerPool.reduce<Record<string, TeamName>>((acc, player) => {
        const currentTeam = assignments[player];
        if (currentTeam) {
          acc[player] = currentTeam;
        }
        return acc;
      }, {});

      let bestAssignments: Record<string, TeamName> | null = null;

      for (let attempt = 0; attempt < 12; attempt++) {
        const balancedTeams = buildBalancedAssignments(teamNames);
        const candidateAssignments: Record<string, TeamName> = {};

        balancedTeams.forEach((team) => {
          team.players.forEach((player) => {
            candidateAssignments[player] = team.name;
          });
        });

        if (!areAssignmentsEqual(candidateAssignments, currentAssignmentsForPool)) {
          return candidateAssignments;
        }

        if (!bestAssignments) {
          bestAssignments = candidateAssignments;
        }
      }

      return bestAssignments || {};
    };

    const forceDifferentAssignments = (source: Record<string, TeamName>) => {
      const next = { ...source };
      const players = Object.keys(next);

      if (players.length <= 1) {
        return next;
      }

      const teamBuckets = Object.entries(next).reduce<Record<string, string[]>>((acc, [player, team]) => {
        const key = String(team);
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(player);
        return acc;
      }, {});

      const configuredTeamNames = teamConfig.type === 'pairs'
        ? Object.keys(teamBuckets).sort((left, right) => {
            const leftNumber = Number(String(left).replace(/\D/g, '')) || 0;
            const rightNumber = Number(String(right).replace(/\D/g, '')) || 0;
            return leftNumber - rightNumber;
          })
        : getConfiguredTeamNames().filter((team) => Array.isArray(teamBuckets[String(team)]) && teamBuckets[String(team)].length > 0);

      if (teamConfig.type === 'pairs') {
        if (configuredTeamNames.length >= 2) {
          const rotatedPlayers = configuredTeamNames.map((teamName) => teamBuckets[teamName][0]).filter(Boolean);
          rotatedPlayers.forEach((player, index) => {
            next[player] = configuredTeamNames[(index + 1) % configuredTeamNames.length] as TeamName;
          });
          return next;
        }

        const onlyTeam = configuredTeamNames[0] || 'pair1';
        const onlyTeamNumber = Number(String(onlyTeam).replace(/\D/g, '')) || 1;
        const fallbackTeam = `pair${onlyTeamNumber + 1}` as TeamName;
        next[players[0]] = fallbackTeam;
        return next;
      }

      if (configuredTeamNames.length >= 2) {
        const rotatedPlayers = configuredTeamNames.map((teamName) => teamBuckets[String(teamName)][0]).filter(Boolean);
        rotatedPlayers.forEach((player, index) => {
          next[player] = configuredTeamNames[(index + 1) % configuredTeamNames.length] as TeamName;
        });
        return next;
      }

      const defaultTeams = getConfiguredTeamNames();
      const onlyTeam = configuredTeamNames[0] as TeamName | undefined;
      const nextTeam = defaultTeams.find((team) => team !== onlyTeam) || defaultTeams[0];
      next[players[0]] = nextTeam;
      return next;
    };
    
    const newAssignments: Record<string, TeamName> = {};
    
    switch (teamConfig.type) {
      case '2teams':
        Object.assign(newAssignments, assignBalancedTeamNames(['racket', 'shuttle']));
        break;
        
      case '3teams':
        Object.assign(newAssignments, assignBalancedTeamNames(['team1', 'team2', 'team3']));
        break;
        
      case '4teams':
        Object.assign(newAssignments, assignBalancedTeamNames(['team1', 'team2', 'team3', 'team4']));
        break;
        
      case 'pairs':
        // 1단계: 전체 선수를 점수 기준으로 정렬 (높은 점수부터)
        const sortedByScore = shufflePlayers(playerPool).sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
        
        // 2단계: 선택한 그룹 수에 따라 범위 분할 (각 그룹은 짝수 인원)
        const numGroups = teamConfig.numLevelGroups || 2;
        const totalPlayers = sortedByScore.length;
        const groups: string[][] = [];
        const groupNames: string[] = [];
        
        if (numGroups === 2) {
          // 2그룹: A(1~절반), B(절반+1~끝)
          let midPoint = Math.ceil(totalPlayers / 2);
          // A 그룹이 홀수면 하나 추가하여 짝수로
          if (midPoint % 2 !== 0 && midPoint < totalPlayers) {
            midPoint++;
          }
          groups.push(sortedByScore.slice(0, midPoint));           // A
          groups.push(sortedByScore.slice(midPoint));              // B
          groupNames.push('A 그룹', 'B 그룹');
          
        } else if (numGroups === 3) {
          // 3그룹: A(1~1/3), B(1/3+1~2/3), C(2/3+1~끝)
          let firstPoint = Math.ceil(totalPlayers / 3);
          let secondPoint = Math.ceil(totalPlayers * 2 / 3);
          
          // 각 그룹을 짝수로 조정
          if (firstPoint % 2 !== 0 && firstPoint < totalPlayers) {
            firstPoint++;
          }
          if ((secondPoint - firstPoint) % 2 !== 0 && secondPoint < totalPlayers) {
            secondPoint++;
          }
          
          groups.push(sortedByScore.slice(0, firstPoint));         // A
          groups.push(sortedByScore.slice(firstPoint, secondPoint)); // B
          groups.push(sortedByScore.slice(secondPoint));           // C
          groupNames.push('A 그룹', 'B 그룹', 'C' + ' 그룹');
          
        } else if (numGroups === 4) {
          // 4그룹: A(1~1/4), B(1/4+1~2/4), C(2/4+1~3/4), D(3/4+1~끝)
          let firstPoint = Math.ceil(totalPlayers / 4);
          let secondPoint = Math.ceil(totalPlayers * 2 / 4);
          let thirdPoint = Math.ceil(totalPlayers * 3 / 4);
          
          // 각 그룹을 짝수로 조정
          if (firstPoint % 2 !== 0 && firstPoint < totalPlayers) {
            firstPoint++;
          }
          if ((secondPoint - firstPoint) % 2 !== 0 && secondPoint < totalPlayers) {
            secondPoint++;
          }
          if ((thirdPoint - secondPoint) % 2 !== 0 && thirdPoint < totalPlayers) {
            thirdPoint++;
          }
          
          groups.push(sortedByScore.slice(0, firstPoint));         // A
          groups.push(sortedByScore.slice(firstPoint, secondPoint)); // B
          groups.push(sortedByScore.slice(secondPoint, thirdPoint)); // C
          groups.push(sortedByScore.slice(thirdPoint));            // D
          groupNames.push('A 그룹', 'B 그룹', 'C 그룹', 'D 그룹');
        }
        
        // 그룹 정보를 state에 저장
        const newPairGroups = groups.map((group, idx) => ({
          groupName: groupNames[idx],
          players: group
        }));
        setPairGroups(newPairGroups);
        
        // 3단계: 각 그룹 내에서 2명씩 페어 구성 (페어 간 점수 합계 균등화)
        let pairCounter = 1;
        groups.forEach((group, groupIdx) => {
          // 그룹 내에서 점수 정렬
          const sortedGroup = [...group].sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
          
          const players = sortedGroup.map(p => ({
            name: p,
            score: getPlayerScore(p)
          }));
          
          const pairs: string[][] = [];
          
          // 방식: 상위와 하위를 매칭하여 페어 합계를 균등하게
          // 1위+마지막, 2위+마지막-1 방식이지만 약간의 랜덤성 추가
          const totalPlayers = players.length;
          
          // 상위 절반과 하위 절반으로 나누기
          const halfPoint = Math.ceil(totalPlayers / 2);
          const topHalf = players.slice(0, halfPoint);
          const bottomHalf = players.slice(halfPoint).reverse(); // 역순으로
          
          // 상위와 하위를 1:1 정밀 밸런스(High-Low) 매칭하여 점수 편차 최소화
          const maxPairs = Math.max(topHalf.length, bottomHalf.length);
          for (let i = 0; i < maxPairs; i++) {
            const pair: string[] = [];
            let pairScore = 0;
            
            if (i < topHalf.length) {
              pair.push(topHalf[i].name);
              pairScore += topHalf[i].score;
            }
            if (i < bottomHalf.length) {
              pair.push(bottomHalf[i].name);
              pairScore += bottomHalf[i].score;
            }
            
            if (pair.length > 0) {
              pairs.push(pair);
              
              // 로그 출력
              if (pair.length === 2) {
                const score1 = i < topHalf.length ? topHalf[i].score : 0;
                const score2 = i < bottomHalf.length ? bottomHalf[i].score : 0;
                console.log(`  페어${pairCounter}: ${pair[0]}(${score1.toFixed(1)}) + ${pair[1]}(${score2.toFixed(1)}) = 합계 ${pairScore.toFixed(1)}`);
              } else {
                console.log(`  페어${pairCounter}: ${pair[0]}(${pairScore.toFixed(1)}) - 1명만 배정`);
              }
              
              // 페어에 배정
              pair.forEach(player => {
                newAssignments[player] = `pair${pairCounter}` as TeamName;
              });
              pairCounter++;
            }
          }
          
          // 그룹 통계 계산
          const pairScores = pairs
            .filter(p => p.length === 2)
            .map(p => {
              const p1Score = getPlayerScore(p[0]);
              const p2Score = getPlayerScore(p[1]);
              return p1Score + p2Score;
            });
          
          if (pairScores.length > 0) {
            const avgPairScore = (pairScores.reduce((a, b) => a + b, 0) / pairScores.length).toFixed(1);
            const maxPairScore = Math.max(...pairScores).toFixed(1);
            const minPairScore = Math.min(...pairScores).toFixed(1);
            const pairScoreRange = (Math.max(...pairScores) - Math.min(...pairScores)).toFixed(1);
            
            console.log(`그룹 ${groupIdx + 1} 총평: ${group.length}명 → ${pairs.length}개 페어`);
            console.log(`  페어 합계 - 평균: ${avgPairScore}, 범위: ${minPairScore}~${maxPairScore}, 편차: ${pairScoreRange}`);
          } else {
            console.log(`그룹 ${groupIdx + 1}: ${group.length}명 → ${pairs.length}개 페어`);
          }
        });
        
        console.log(`\n✅ ${numGroups}개 그룹으로 분할 후 총 ${pairCounter - 1}개 페어 구성 완료 (상위-하위 균등 매칭)`);
        break;
        
      case 'custom':
        // 사용자 정의 - 수동 편집 모드 활성화
        setShowCustomEditor(true);
        return;
        
      default:
        // 기본: 2팀 - 선수를 무작위로 섞어서 절반씩 배정
        const shuffled = [...playerPool].sort(() => Math.random() - 0.5);
        const defaultHalf = Math.ceil(shuffled.length / 2);
        shuffled.forEach((player, index) => {
          newAssignments[player] = index < defaultHalf ? 'racket' : 'shuttle';
        });
    }
    
    const resolvedAssignments = areAssignmentsEqual(newAssignments, assignments)
      ? forceDifferentAssignments(newAssignments)
      : newAssignments;

    setAssignments(resolvedAssignments);
    setShowCustomEditor(false);
    setSelectedPairPlayer(null);
    setActivePairGroupIndex(null);
  };

  // 특정 그룹 내의 페어를 점수차가 최소화되도록 재배정 (매 시도마다 파트너 변경 및 최소 편차 보장)
  const reassignPairGroup = (groupIdx: number) => {
    if (groupIdx < 0 || !pairGroups[groupIdx]) return;
    const group = pairGroups[groupIdx];
    const groupPlayers = [...group.players];
    if (groupPlayers.length === 0) return;

    // 1. 이 그룹에 속한 선수들이 사용 중이던 페어 ID 목록 수집
    const existingPairIds = new Set<string>();
    groupPlayers.forEach((player) => {
      const team = assignments[player];
      if (team && String(team).startsWith('pair')) {
        existingPairIds.add(String(team));
      }
    });

    const sortedPairIds = Array.from(existingPairIds).sort((a, b) => {
      const numA = parseInt(a.replace('pair', '')) || 0;
      const numB = parseInt(b.replace('pair', '')) || 0;
      return numA - numB;
    });

    // 2. 500번 몬테카를로/무작위 밸런싱 시뮬레이션 진행
    // 최대 점수와 최소 점수의 편차가 가장 작으면서 다채로운 파트너 조합 후보군을 탐색
    let bestDiff = Number.MAX_VALUE;
    let bestCandidates: Array<string[][]> = [];

    const shufflePlayers = (players: string[]) => {
      const shuffled = [...players];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    for (let sim = 0; sim < 500; sim++) {
      const shuffled = shufflePlayers(groupPlayers);
      const tempPairs: string[][] = [];
      const tempPairScores: number[] = [];

      for (let i = 0; i < shuffled.length; i += 2) {
        const p1 = shuffled[i];
        const p2 = shuffled[i + 1];
        if (p1 && p2) {
          tempPairs.push([p1, p2]);
          tempPairScores.push(getPlayerScore(p1) + getPlayerScore(p2));
        } else if (p1) {
          tempPairs.push([p1]);
        }
      }

      if (tempPairScores.length > 0) {
        const maxS = Math.max(...tempPairScores);
        const minS = Math.min(...tempPairScores);
        const diff = maxS - minS;

        if (diff < bestDiff - 0.001) {
          bestDiff = diff;
          bestCandidates = [tempPairs];
        } else if (Math.abs(diff - bestDiff) < 0.001) {
          bestCandidates.push(tempPairs);
        }
      } else {
        bestCandidates.push(tempPairs);
        bestDiff = 0;
        break;
      }
    }

    // 3. 최적의 밸런스 조합 중 무작위 하나 선택
    const selectedPairs = bestCandidates[Math.floor(Math.random() * bestCandidates.length)] || [];

    // 4. 새로운 배정 정보 적용
    const nextAssignments = { ...assignments };
    let pairIdIdx = 0;

    const getAllMaxPairNum = () => {
      let maxNum = 0;
      Object.values(assignments).forEach((team) => {
        if (team && String(team).startsWith('pair')) {
          const num = parseInt(String(team).replace('pair', '')) || 0;
          if (num > maxNum) maxNum = num;
        }
      });
      return maxNum;
    };
    let newPairCounter = getAllMaxPairNum() + 1;

    selectedPairs.forEach((pair) => {
      let pairId = sortedPairIds[pairIdIdx];
      if (!pairId) {
        pairId = `pair${newPairCounter}`;
        newPairCounter++;
      } else {
        pairIdIdx++;
      }

      pair.forEach((player) => {
        nextAssignments[player] = pairId as TeamName;
      });
    });

    setAssignments(nextAssignments);
    setSelectedPairPlayer(null);
    setActivePairGroupIndex(null);
  };

  // 팀 배정 변경
  const togglePlayerTeam = (playerName: string) => {
    if (teamConfig.type === '3teams') {
      // 3팀 모드: team1 → team2 → team3 → team1
      setAssignments(prev => {
        const current = prev[playerName];
        let next: TeamName;
        if (current === 'team1') next = 'team2';
        else if (current === 'team2') next = 'team3';
        else next = 'team1';
        return { ...prev, [playerName]: next };
      });
    } else if (teamConfig.type === '4teams') {
      // 4팀 모드: team1 → team2 → team3 → team4 → team1
      setAssignments(prev => {
        const current = prev[playerName];
        let next: TeamName;
        if (current === 'team1') next = 'team2';
        else if (current === 'team2') next = 'team3';
        else if (current === 'team3') next = 'team4';
        else next = 'team1';
        return { ...prev, [playerName]: next };
      });
    } else {
      // 2팀 모드: racket ↔ shuttle
      setAssignments(prev => ({
        ...prev,
        [playerName]: prev[playerName] === 'racket' ? 'shuttle' : 'racket'
      }));
    }
  };

  // 선수를 특정 팀으로 배정
  const assignPlayerToTeam = (playerName: string, team: TeamName) => {
    setAssignments(prev => ({
      ...prev,
      [playerName]: team
    }));
  };

  const resetCurrentAssignments = () => {
    setAssignments({});
    setSelectedPairPlayer(null);
    setActivePairGroupIndex(null);
    setSelectedManualPlayer(null);
    setShowCustomEditor(false);
  };

  const startCustomManualAssignment = (numTeams: number) => {
    setAssignments({});
    setSelectedPairPlayer(null);
    setActivePairGroupIndex(null);
    setSelectedManualPlayer(null);
    setPairGroups([]);
    setTeamConfig({ type: 'custom', numTeams });
    setShowCustomEditor(true);
  };

  const movePairPlayerToGroup = (playerName: string, targetGroupIndex: number) => {
    setPairGroups((prev) => {
      if (targetGroupIndex < 0 || targetGroupIndex >= prev.length) {
        return prev;
      }

      const movedPlayers = prev.map((group) => ({
        ...group,
        players: group.players.filter((player) => player !== playerName),
      }));

      movedPlayers[targetGroupIndex] = {
        ...movedPlayers[targetGroupIndex],
        players: sortPlayers(Array.from(new Set([
          ...movedPlayers[targetGroupIndex].players,
          playerName,
        ]))),
      };

      return movedPlayers;
    });
  };

  const getPairGroupIndexForPlayer = (playerName: string) => {
    return pairGroups.findIndex((group) => group.players.includes(playerName));
  };

  const handlePairManualAdjustment = (playerName: string) => {
    if (!showCustomEditor || teamConfig.type !== 'pairs') {
      return;
    }

    const playerGroupIndex = getPairGroupIndexForPlayer(playerName);

    if (activePairGroupIndex == null) {
      alert('먼저 조정할 그룹의 수동배정 버튼을 선택해주세요.');
      return;
    }

    if (playerGroupIndex !== activePairGroupIndex) {
      alert('현재 선택한 그룹 안에서만 수동 배정할 수 있습니다.');
      return;
    }

    if (!selectedPairPlayer) {
      setSelectedPairPlayer(playerName);
      return;
    }

    if (selectedPairPlayer === playerName) {
      setSelectedPairPlayer(null);
      return;
    }

    const selectedGroupIndex = getPairGroupIndexForPlayer(selectedPairPlayer);
    const targetGroupIndex = getPairGroupIndexForPlayer(playerName);

    if (
      selectedGroupIndex < 0 ||
      targetGroupIndex < 0 ||
      selectedGroupIndex !== targetGroupIndex ||
      selectedGroupIndex !== activePairGroupIndex
    ) {
      alert('페어 수동 조정은 같은 그룹 안에서만 가능합니다.');
      return;
    }

    setAssignments((prev) => {
      const sourcePair = prev[selectedPairPlayer];
      const targetPair = prev[playerName];

      if (!sourcePair || !targetPair || sourcePair === targetPair) {
        return prev;
      }

      return {
        ...prev,
        [selectedPairPlayer]: targetPair,
        [playerName]: sourcePair,
      };
    });

    setSelectedPairPlayer(null);
  };

  const handleTeamManualAdjustment = (playerName: string) => {
    if (!showCustomEditor || teamConfig.type === 'pairs') {
      return;
    }

    const currentTeam = assignments[playerName];
    if (!currentTeam) {
      return;
    }

    if (!selectedManualPlayer) {
      setSelectedManualPlayer(playerName);
      return;
    }

    if (selectedManualPlayer === playerName) {
      setSelectedManualPlayer(null);
      return;
    }

    const selectedPlayerTeam = assignments[selectedManualPlayer];
    const targetPlayerTeam = assignments[playerName];

    if (!selectedPlayerTeam || !targetPlayerTeam || selectedPlayerTeam === targetPlayerTeam) {
      return;
    }

    setAssignments((prev) => ({
      ...prev,
      [selectedManualPlayer]: targetPlayerTeam,
      [playerName]: selectedPlayerTeam,
    }));

    setSelectedManualPlayer(null);
  };

  const toggleManualPlayer = (playerName: string) => {
    setManualIncludedPlayers((prev) => {
      if (prev.includes(playerName)) {
        setAssignments((current) => {
          const next = { ...current };
          delete next[playerName];
          return next;
        });
        return prev.filter((player) => player !== playerName);
      }

      return [...prev, playerName];
    });
  };

  const toggleMemberSelection = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const toggleSelectAllMembers = () => {
    if (selectedMemberIds.length === availableMembersToAdd.length) {
      setSelectedMemberIds([]);
      return;
    }

    setSelectedMemberIds(availableMembersToAdd.map((member) => member.id));
  };

  const addSelectedMembersToPool = () => {
    if (selectedMemberIds.length === 0) {
      return;
    }

    const selectedLabels = availableMembersToAdd
      .filter((member) => selectedMemberIds.includes(member.id))
      .map((member) => member.assignmentLabel);

    if (selectedLabels.length > 0) {
      setManualIncludedPlayers((prev) => Array.from(new Set([...prev, ...selectedLabels])));
    }

    setSelectedMemberIds([]);
    setShowMemberModal(false);
  };

  const getLegacyLevelScore = (skillCode: string): number => {
    const normalized = String(skillCode || '').trim().toUpperCase();
    const match = normalized.match(/^([A-Z])(\d+)?$/);

    if (!match) {
      return 0;
    }

      const [, level, step] = match;
      const baseScores: Record<string, number> = {
        A: 92,
        B: 83,
        C: 74,
        D: 65,
        E: 56,
        N: 47,
      };

      const base = baseScores[level] ?? 0;
      const tier = Number(step || 2);
      const offset = tier === 1 ? -3 : tier === 3 ? 3 : 0;
      return base + offset;
    };

  // 선수 이름에서 레벨 점수 추출
  const getPlayerScore = (playerName: string): number => {
    const match = playerName.match(/\(([^)]+)\)/);
    if (!match) return 0;

    const levelCode = String(match[1] || '').trim();
    const mappedScore = getLevelScoreFromCode(levelInfoMap, levelCode, Number.NaN);

    if (!Number.isNaN(mappedScore)) {
      return mappedScore;
    }

    return getLegacyLevelScore(levelCode);
  };

  // 팀 점수 합계 계산
  const getTeamScore = (teamName: TeamName): number => {
    const teamPlayers = Object.entries(assignments)
      .filter(([_, team]) => team === teamName)
      .map(([player, _]) => player);
    
    return teamPlayers.reduce((sum, player) => sum + getPlayerScore(player), 0);
  };

  const getPlayersTotalScore = (players: string[] | undefined): number => {
    return (players || []).reduce((sum, player) => sum + getPlayerScore(player), 0);
  };

  const getTeamGenderSummary = (teamName: TeamName) => {
    const teamPlayers = Object.entries(assignments)
      .filter(([_, team]) => team === teamName)
      .map(([player]) => player);

    return teamPlayers.reduce(
      (summary, player) => {
        const gender = getPlayerGender(player);
        if (gender === 'M') {
          summary.male += 1;
        } else if (gender === 'F') {
          summary.female += 1;
        } else {
          summary.unknown += 1;
        }
        return summary;
      },
      { male: 0, female: 0, unknown: 0 }
    );
  };

  const getPairDisplayLabel = (pairName: string, groupName?: string): string => {
    const pairNumberMatch = String(pairName).match(/(\d+)/);
    const pairNumber = pairNumberMatch ? pairNumberMatch[1] : String(pairName);
    const normalizedGroupName = String(groupName || '').trim().toUpperCase();

    let groupPrefix = '';
    if (normalizedGroupName.includes('A') || normalizedGroupName.includes('상위')) {
      groupPrefix = 'A';
    } else if (normalizedGroupName.includes('B') || normalizedGroupName.includes('중상') || normalizedGroupName.includes('중위')) {
      groupPrefix = 'B';
    } else if (normalizedGroupName.includes('C') || normalizedGroupName.includes('중하') || normalizedGroupName.includes('하위')) {
      const hasD = pairGroups.some(g => g.groupName.includes('D') || g.groupName.includes('중상') || g.groupName.includes('중하'));
      if (normalizedGroupName.includes('하위') && hasD) {
        groupPrefix = 'D';
      } else {
        groupPrefix = 'C';
      }
    } else if (normalizedGroupName.includes('D')) {
      groupPrefix = 'D';
    } else if (normalizedGroupName.includes('기타')) {
      groupPrefix = '기타';
    }

    return groupPrefix ? `${groupPrefix}-페어-${pairNumber}` : `페어-${pairNumber}`;
  };

  // 선수 정렬 함수: 점수 높은 순 → 같으면 가나다순
  const sortPlayers = (players: string[]): string[] => {
    return [...players].sort((a, b) => {
      const scoreA = getPlayerScore(a);
      const scoreB = getPlayerScore(b);
      
      // 점수가 다르면 점수 높은 순
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      
      // 점수가 같으면 이름 가나다순
      return a.localeCompare(b, 'ko');
    });
  };

  // 참여자 모달 열기
  const openParticipantsModal = (round: RoundSummary) => {
    setSelectedRoundForModal(round);
  };

  // 참여자 모달 닫기
  const closeParticipantsModal = () => {
    setSelectedRoundForModal(null);
  };

  useEffect(() => {
    const initializeData = async () => {
      const loadedSchedules = await fetchSchedulesList();
      await fetchMemberPlayers();
      const initialScheduleId = loadedSchedules && loadedSchedules.length > 0 ? loadedSchedules[0].id : null;
      await fetchTodayPlayers(initialScheduleId, loadedSchedules);
      await fetchRoundsData();
    };
    
    initializeData();
  }, []);

  // 선택된 스케줄 변경 시 선수 목록 갱신
  useEffect(() => {
    fetchTodayPlayers();
  }, [selectedScheduleId]);

  useEffect(() => {
    setManualIncludedPlayers([]);
    setSelectedMemberIds([]);
    setShowMemberModal(false);
    setAssignments({});
    setPairGroups([]);
  }, [selectedScheduleId]);

  if (loading) {
    return (
      <div className="w-full px-2 py-2 sm:p-6">
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">데이터 로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-2 py-2 sm:p-6">
      <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between px-1">
          <div className="space-y-0.5 pl-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
              <Users className="h-3.5 w-3.5" />
              팀관리
            </span>
            <h1 className="text-xl font-bold tracking-tight">경기 팀 관리</h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">경기 일정에 맞춰 2팀, 3팀, 4팀 또는 페어별 팀 구성을 시뮬레이션하고 저장합니다.</p>
          </div>
          <Link href="/manager">
            <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              홈
            </Button>
          </Link>
        </div>
      </section>

      {/* 스케줄 선택 & 팀 구성 방식 - 한 행으로 배치 */}
      <div className="mb-4 rounded-lg bg-white p-3 shadow-md sm:mb-6 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[300px_1fr]">
          {/* 왼쪽: 스케줄 선택 */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-700">📅 경기 일정</label>
            <p className="mb-2 hidden text-xs text-gray-500 sm:block">대회 경기만 표시됩니다.</p>
            <select 
              value={selectedScheduleId || ''} 
              onChange={(e) => setSelectedScheduleId(e.target.value || null)}
              className="w-full border rounded-lg p-2 text-sm"
            >
              <option value="">(출석 기준)</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>
                  {s.match_date} {s.start_time} · {s.location} [{getScheduleSourceLabel(s.schedule_source)}]
                </option>
              ))}
            </select>
          </div>

          {/* 오른쪽: 팀 구성 방식 선택 */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-700">🎯 팀 구성 방식</label>
            {/* 모바일용 4열 컴팩트 버튼 */}
            <div className="grid grid-cols-4 gap-1.5 sm:hidden">
              <button
                onClick={() => {
                  setTeamConfig({ type: '2teams' });
                  setPairGroups([]);
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border py-1.5 text-center transition-all ${
                  teamConfig.type === '2teams'
                    ? 'border-blue-500 bg-blue-50/80 font-bold text-blue-600 shadow-sm'
                    : 'border-blue-200 bg-white text-gray-700'
                }`}
              >
                <div className="text-xs font-bold">2팀</div>
                <div className="text-[8px] text-gray-400 mt-0.5 truncate">라켓/셔틀</div>
              </button>

              <button
                onClick={() => {
                  setTeamConfig({ type: '3teams' });
                  setPairGroups([]);
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border py-1.5 text-center transition-all ${
                  teamConfig.type === '3teams'
                    ? 'border-teal-500 bg-teal-50/80 font-bold text-teal-600 shadow-sm'
                    : 'border-blue-200 bg-white text-gray-700'
                }`}
              >
                <div className="text-xs font-bold">3팀</div>
                <div className="text-[8px] text-gray-400 mt-0.5 truncate">3개 팀</div>
              </button>

              <button
                onClick={() => {
                  setTeamConfig({ type: '4teams' });
                  setPairGroups([]);
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border py-1.5 text-center transition-all ${
                  teamConfig.type === '4teams'
                    ? 'border-purple-500 bg-purple-50/80 font-bold text-purple-600 shadow-sm'
                    : 'border-blue-200 bg-white text-gray-700'
                }`}
              >
                <div className="text-xs font-bold">4팀</div>
                <div className="text-[8px] text-gray-400 mt-0.5 truncate">4개 팀</div>
              </button>

              <button
                onClick={() => {
                  setTeamConfig({ type: 'pairs', numLevelGroups: 2 });
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border py-1.5 text-center transition-all ${
                  teamConfig.type === 'pairs'
                    ? 'border-green-500 bg-green-50/80 font-bold text-green-600 shadow-sm'
                    : 'border-blue-200 bg-white text-gray-700'
                }`}
              >
                <div className="text-xs font-bold">2명 팀</div>
                <div className="text-[8px] text-gray-400 mt-0.5 truncate">레벨별</div>
              </button>
            </div>

            {/* 데스크톱용 기존 5열 그리드 */}
            <div className="hidden sm:grid sm:grid-cols-5 gap-3">
              <button
                onClick={() => {
                  setTeamConfig({ type: '2teams' });
                  setPairGroups([]);
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border-2 p-2 transition-all shrink-0 w-[105px] sm:w-auto text-center sm:p-3 ${
                  teamConfig.type === '2teams'
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-blue-300'
                }`}
              >
                <div className="text-xl mb-0.5 sm:text-2xl sm:mb-1">🏸⚡</div>
                <div className="font-semibold text-xs sm:text-sm">2팀</div>
                <div className="text-[10px] text-gray-500 sm:text-xs">라켓 vs 셔틀</div>
              </button>
              
              <button
                onClick={() => {
                  setTeamConfig({ type: '3teams' });
                  setPairGroups([]);
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border-2 p-2 transition-all shrink-0 w-[105px] sm:w-auto text-center sm:p-3 ${
                  teamConfig.type === '3teams'
                    ? 'border-teal-500 bg-teal-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-teal-300'
                }`}
              >
                <div className="text-xl mb-0.5 sm:text-2xl sm:mb-1">🏸🏸⚡</div>
                <div className="font-semibold text-xs sm:text-sm">3팀</div>
                <div className="text-[10px] text-gray-500 sm:text-xs">3개 팀</div>
              </button>
              
              <button
                onClick={() => {
                  setTeamConfig({ type: '4teams' });
                  setPairGroups([]);
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border-2 p-2 transition-all shrink-0 w-[105px] sm:w-auto text-center sm:p-3 ${
                  teamConfig.type === '4teams'
                    ? 'border-purple-500 bg-purple-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-purple-300'
                }`}
              >
                <div className="text-xl mb-0.5 sm:text-2xl sm:mb-1">🏸🏸⚡⚡</div>
                <div className="font-semibold text-xs sm:text-sm">4팀</div>
                <div className="text-[10px] text-gray-500 sm:text-xs">4개 팀</div>
              </button>
              
              <button
                onClick={() => {
                  setTeamConfig({ type: 'pairs', numLevelGroups: 2 });
                  setShowCustomEditor(false);
                }}
                className={`rounded-lg border-2 p-2 transition-all shrink-0 w-[105px] sm:w-auto text-center sm:p-3 ${
                  teamConfig.type === 'pairs'
                    ? 'border-green-500 bg-green-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-green-300'
                }`}
              >
                <div className="text-xl mb-0.5 sm:text-2xl sm:mb-1">👥</div>
                <div className="font-semibold text-xs sm:text-sm">2명 팀</div>
                <div className="text-[10px] text-gray-500 sm:text-xs">레벨별 페어</div>
              </button>
              
              <button
                onClick={() => {
                  startCustomManualAssignment(2);
                }}
                className={`rounded-lg border-2 p-2 transition-all shrink-0 w-[105px] sm:w-auto text-center sm:p-3 ${
                  teamConfig.type === 'custom'
                    ? 'border-orange-500 bg-orange-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-orange-300'
                }`}
              >
                <div className="text-xl mb-0.5 sm:text-2xl sm:mb-1">✏️</div>
                <div className="font-semibold text-xs sm:text-sm">사용자 정의</div>
                <div className="text-[10px] text-gray-500 sm:text-xs">직접 구성</div>
              </button>
            </div>
          </div>
        </div>

        {/* 2명 팀 모드일 때 그룹 수 선택 */}
        {teamConfig.type === 'pairs' && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 sm:mt-4 sm:p-4">
            <h3 className="text-sm sm:text-base font-semibold text-green-900 mb-2 sm:mb-3">📊 레벨 그룹 분할 선택</h3>
            <div className="grid grid-cols-3 gap-1.5 sm:flex sm:gap-3">
              {[2, 3, 4].map(num => {
                const isSelected = teamConfig.numLevelGroups === num;
                return (
                  <button
                    key={num}
                    onClick={() => {
                      setTeamConfig({ ...teamConfig, numLevelGroups: num });
                      // 그룹 수 변경 시 선수 목록 미리 표시 (각 그룹을 짝수로 조정)
                      if (playerPool.length > 0) {
                        const sortedByScore = [...playerPool]
                          .sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
                        const totalPlayers = sortedByScore.length;
                        const groups: string[][] = [];
                        const groupNames: string[] = [];
                        
                        if (num === 2) {
                          let midPoint = Math.ceil(totalPlayers / 2);
                          // A 그룹이 홀수면 하나 추가하여 짝수로
                          if (midPoint % 2 !== 0 && midPoint < totalPlayers) {
                            midPoint++;
                          }
                          groups.push(sortedByScore.slice(0, midPoint));
                          groups.push(sortedByScore.slice(midPoint));
                          groupNames.push('A 그룹', 'B 그룹');
                        } else if (num === 3) {
                          let firstPoint = Math.ceil(totalPlayers / 3);
                          let secondPoint = Math.ceil(totalPlayers * 2 / 3);
                          
                          // 각 그룹을 짝수로 조정
                          if (firstPoint % 2 !== 0 && firstPoint < totalPlayers) {
                            firstPoint++;
                          }
                          if ((secondPoint - firstPoint) % 2 !== 0 && secondPoint < totalPlayers) {
                            secondPoint++;
                          }
                          
                          groups.push(sortedByScore.slice(0, firstPoint));
                          groups.push(sortedByScore.slice(firstPoint, secondPoint));
                          groups.push(sortedByScore.slice(secondPoint));
                          groupNames.push('A 그룹', 'B 그룹', 'C 그룹');
                        } else if (num === 4) {
                          let firstPoint = Math.ceil(totalPlayers / 4);
                          let secondPoint = Math.ceil(totalPlayers * 2 / 4);
                          let thirdPoint = Math.ceil(totalPlayers * 3 / 4);
                          
                          // 각 그룹을 짝수로 조정
                          if (firstPoint % 2 !== 0 && firstPoint < totalPlayers) {
                            firstPoint++;
                          }
                          if ((secondPoint - firstPoint) % 2 !== 0 && secondPoint < totalPlayers) {
                            secondPoint++;
                          }
                          if ((thirdPoint - secondPoint) % 2 !== 0 && thirdPoint < totalPlayers) {
                            thirdPoint++;
                          }
                          
                          groups.push(sortedByScore.slice(0, firstPoint));
                          groups.push(sortedByScore.slice(firstPoint, secondPoint));
                          groups.push(sortedByScore.slice(secondPoint, thirdPoint));
                          groups.push(sortedByScore.slice(thirdPoint));
                          groupNames.push('A 그룹', 'B 그룹', 'C 그룹', 'D 그룹');
                        }
                        
                        const newPairGroups = groups.map((group, idx) => ({
                          groupName: groupNames[idx],
                          players: group
                        }));
                        setPairGroups(newPairGroups);
                      }
                    }}
                    className={`flex-1 py-1.5 px-1 rounded-lg font-semibold transition-all sm:py-3 sm:px-4 text-center ${
                      isSelected
                        ? 'bg-green-600 text-white shadow-sm'
                        : 'bg-white text-green-700 border border-green-300 hover:bg-green-50'
                    }`}
                  >
                    <div className="text-xs sm:text-lg">{num}개 그룹</div>
                    <div className="text-[8px] opacity-90 mt-0.5 sm:text-xs">
                      {num === 2 && '상위 / 하위'}
                      {num === 3 && '상위/중위/하위'}
                      {num === 4 && '상/중상/중하/하'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {teamConfig.type === 'custom' && (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 sm:mt-4 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-orange-900">✏️ 수동 배정 설정</h3>
                <p className="mt-1 text-sm text-orange-800">
                  배정 대상 회원 전체를 미배정 상태로 표시한 뒤, 처음부터 원하는 팀으로 직접 배정할 수 있습니다.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[2, 3, 4].map((numTeams) => {
                  const isSelected = (teamConfig.numTeams || 2) === numTeams;
                  return (
                    <button
                      key={numTeams}
                      type="button"
                      onClick={() => startCustomManualAssignment(numTeams)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        isSelected
                          ? 'bg-orange-600 text-white'
                          : 'border border-orange-300 bg-white text-orange-800 hover:bg-orange-100'
                      }`}
                    >
                      {numTeams}팀
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 현재 출석자 및 팀 배정 섹션 */}
      <div className="mb-6 rounded-lg bg-white p-3 shadow-md sm:mb-8 sm:p-6">
        <h2 className="text-base sm:text-xl font-semibold mb-3 sm:mb-4">
          {currentRound}회차 팀 배정 
          <span className="text-xs sm:text-sm text-gray-600 ml-1.5 sm:ml-2">
            (배정 대상: {playerPool.length}명)
          </span>
        </h2>
        
        {selectedScheduleId && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-2.5 sm:p-4">
            {/* 모바일용 컴팩트 일렬 바 */}
            <div className="flex items-center justify-between gap-2 sm:hidden">
              <div className="text-xs font-semibold text-amber-900">
                수동 배정용 추가 <span className="font-bold text-amber-600">({manualIncludedPlayers.length}명)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowMemberModal(true)}
                className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
              >
                + 회원추가
              </button>
            </div>

            {/* 데스크톱용 레이아웃 */}
            <div className="hidden sm:block">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-amber-900 sm:text-base">관리자 수동 배정용 회원 추가</h3>
                  <p className="text-sm text-amber-800">
                    선택한 대회 일정 신청자 외에 전체 회원 중 원하는 선수를 팀 배정 대상에 직접 추가할 수 있습니다.
                  </p>
                </div>
                <div className="text-xs text-amber-900 sm:text-sm">추가됨 {manualIncludedPlayers.length}명</div>
              </div>

              <div className="mt-2 flex flex-col gap-2 sm:mt-3 sm:gap-3 md:flex-row md:items-center">
                <button
                  type="button"
                  onClick={() => setShowMemberModal(true)}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 sm:px-4"
                >
                  회원추가
                </button>
                <span className="text-sm text-amber-800">모든 회원을 풀네임으로 보고 여러 명을 한 번에 추가할 수 있습니다.</span>
              </div>
            </div>

            {availableMembersToAdd.length === 0 && (
              <p className="mt-2 text-xs text-amber-700 sm:mt-3 sm:text-sm">추가 가능한 회원이 없습니다.</p>
            )}

            {manualIncludedPlayers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 sm:mt-3 sm:gap-2">
                {manualIncludedPlayers.map((player) => (
                  <button
                    key={player}
                    type="button"
                    onClick={() => toggleManualPlayer(player)}
                    className="rounded-full border border-amber-500 bg-amber-500 px-2 py-0.5 text-[11px] text-white transition-colors hover:bg-amber-600 sm:px-3 sm:py-1 sm:text-sm"
                  >
                    제거 · {player}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {playerPool.length === 0 ? (
          <p className="text-gray-500">선택된 일정에 참가자가 없습니다. 위에서 회원을 추가해 배정을 시작할 수 있습니다.</p>
        ) : (
          <>
            {/* 모바일 3열 그리드 및 데스크톱 flex 레이아웃 */}
            <div className="mb-4 grid grid-cols-3 gap-1.5 sm:flex sm:flex-row sm:gap-4">
              {teamConfig.type !== 'custom' && (
                <button
                  onClick={autoAssignTeams}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>🎲</span>
                  <span>자동 배정</span>
                </button>
              )}
              <button
                onClick={saveTeamAssignments}
                className="bg-green-500 hover:bg-green-600 text-white px-2.5 py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60"
                disabled={Object.keys(assignments).length === 0}
              >
                <span>💾</span>
                <span>배정 저장</span>
              </button>
              {Object.keys(assignments).length > 0 && (
                <button
                  onClick={resetCurrentAssignments}
                  title="현재 화면의 팀 배정 결과와 수동배정 선택 상태를 초기화합니다."
                  className="bg-gray-500 hover:bg-gray-600 text-white px-2.5 py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>🔄</span>
                  <span>초기화</span>
                </button>
              )}
              {teamConfig.type !== 'pairs' && (
                <button
                  onClick={() => {
                    setShowCustomEditor((prev) => {
                      const next = !prev;
                      if (!next) {
                        setSelectedPairPlayer(null);
                        setActivePairGroupIndex(null);
                        setSelectedManualPlayer(null);
                      }
                      return next;
                    });
                  }}
                  className={`${showCustomEditor ? 'bg-orange-600 hover:bg-orange-700' : 'bg-orange-500 hover:bg-orange-600'} text-white px-2.5 py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm col-span-3 sm:col-span-1`}
                >
                  <span>✏️</span>
                  <span>{showCustomEditor ? '수동배정 닫기' : '수동배정'}</span>
                </button>
              )}
            </div>

            {Object.keys(assignments).length > 0 && (
              <p className="mb-4 text-xs text-gray-500">
                `초기화`는 현재 화면의 팀 배정 결과를 모두 비우고, 수동배정 모드와 선택 중인 페어 조정 상태도 함께 닫습니다. 선수 목록과 팀 구성 방식은 유지됩니다.
              </p>
            )}
            
            {/* 수동 배정 모드 */}
            {showCustomEditor && teamConfig.type !== 'pairs' ? (
              (() => {
                const manualTeamOptions = getManualTeamOptions();
                const unassignedPlayers = sortPlayers(playerPool.filter((player) => !assignments[player]));
                const teamLayoutType = manualTeamOptions.length === 4 ? '4teams' : manualTeamOptions.length === 3 ? '3teams' : '2teams';

                return (
                  <div className="space-y-4">
                    {selectedManualPlayer && (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs text-orange-950 font-semibold shadow-sm flex items-center gap-1.5">
                        <span>📍 맞교환 선택 선수:</span>
                        <span className="bg-orange-200 px-1.5 py-0.5 rounded text-orange-900">{selectedManualPlayer}</span>
                      </div>
                    )}

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <h3 className="mb-3 text-lg font-semibold text-gray-700">미배정 선수 ({unassignedPlayers.length}명)</h3>
                      {unassignedPlayers.length === 0 ? (
                        <div className="rounded border border-dashed border-gray-300 bg-white p-3 text-center text-sm text-gray-500">
                          모든 선수가 팀에 배정되었습니다.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
                          {unassignedPlayers.map((player) => (
                            <div key={player} className="min-w-0 rounded-md border border-gray-200 bg-white p-2">
                              <div className="truncate text-center text-xs font-medium text-gray-900 sm:text-sm">{player}</div>
                              <div className="mt-1.5 grid grid-cols-2 gap-1">
                                {manualTeamOptions.map((teamOption, index) => (
                                  <button
                                    key={`${player}-${teamOption.key}`}
                                    type="button"
                                    onClick={() => assignPlayerToTeam(player, teamOption.key)}
                                    className={`rounded px-1 py-0.5 text-[10px] font-semibold text-white transition-colors ${teamOption.button} ${manualTeamOptions.length === 3 && index === 2 ? 'col-span-2' : ''}`}
                                  >
                                    {teamOption.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={`grid gap-2 sm:gap-4 ${
                      manualTeamOptions.length === 2 
                        ? 'grid-cols-2 lg:grid-cols-2' 
                        : manualTeamOptions.length === 3 
                        ? 'grid-cols-3 xl:grid-cols-3' 
                        : 'grid-cols-2 md:grid-cols-2 xl:grid-cols-4'
                    }`}>
                      {manualTeamOptions.map((teamOption) => {
                        const teamPlayers = sortPlayers(
                          Object.entries(assignments)
                            .filter(([, assignedTeam]) => assignedTeam === teamOption.key)
                            .map(([player]) => player)
                        );

                        return (
                          <div key={String(teamOption.key)} className={`rounded-lg border p-1.5 sm:p-4 ${teamOption.box}`}>
                            <h3 className={`mb-1.5 sm:mb-3 text-[10px] sm:text-base md:text-lg font-bold flex flex-col gap-0.5 sm:block ${teamOption.text}`}>
                              <span>{teamOption.label} ({teamPlayers.length}명)</span>
                              <span className="text-[9px] font-normal sm:ml-2">점수: {getTeamScore(teamOption.key).toFixed(1)}</span>
                              <span className="text-[8px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary(teamOption.key).male}/{getTeamGenderSummary(teamOption.key).female}</span>
                            </h3>
                            {teamPlayers.length === 0 ? (
                              <div className="rounded border border-dashed border-gray-300 bg-white/85 p-2 text-center text-xs text-gray-500">
                                배정 없음
                              </div>
                            ) : (
                              <div className={getTeamPlayerGridClassName(teamLayoutType)}>
                                {teamPlayers.map((player) => (
                                  <div
                                    key={player}
                                    className={`rounded border px-1 py-1 sm:px-2 sm:py-2 text-center text-xs sm:text-sm font-medium cursor-pointer transition-colors ${
                                      selectedManualPlayer === player
                                        ? 'border-orange-500 bg-orange-100 ring-1 ring-orange-300'
                                        : teamOption.active
                                    }`}
                                    onClick={() => handleTeamManualAdjustment(player)}
                                  >
                                    <div className="truncate">{player}</div>
                                    <div className="mt-0.5 text-[8px] sm:text-[10px] text-slate-600 truncate">
                                      {selectedManualPlayer === player ? '선택됨' : selectedManualPlayer ? '교환' : '선택'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : teamConfig.type === '3teams' ? (
              <div className="grid grid-cols-3 gap-1.5 md:gap-4">
                {/* 팀 1 */}
                <div className="border rounded-lg p-1.5 sm:p-4 bg-blue-50">
                  <h3 className="text-[10px] font-bold text-blue-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 1 ({Object.values(assignments).filter(t => t === 'team1').length}명)</span>
                    <span className="text-[9px] font-normal text-slate-700 sm:ml-2">점수: {getTeamScore('team1').toFixed(1)}</span>
                    <span className="text-[8px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team1').male}/{getTeamGenderSummary('team1').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('3teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team1',
                          Boolean(assignments[player] && assignments[player] !== 'team1'),
                          'bg-blue-200 border-blue-400',
                          'bg-white border-gray-200 hover:bg-blue-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team1')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* 팀 2 */}
                <div className="border rounded-lg p-1.5 sm:p-4 bg-green-50">
                  <h3 className="text-[10px] font-bold text-green-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 2 ({Object.values(assignments).filter(t => t === 'team2').length}명)</span>
                    <span className="text-[9px] font-normal text-slate-700 sm:ml-2">점수: {getTeamScore('team2').toFixed(1)}</span>
                    <span className="text-[8px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team2').male}/{getTeamGenderSummary('team2').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('3teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team2',
                          Boolean(assignments[player] && assignments[player] !== 'team2'),
                          'bg-green-200 border-green-400',
                          'bg-white border-gray-200 hover:bg-green-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team2')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* 팀 3 */}
                <div className="border rounded-lg p-1.5 sm:p-4 bg-purple-50">
                  <h3 className="text-[10px] font-bold text-purple-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 3 ({Object.values(assignments).filter(t => t === 'team3').length}명)</span>
                    <span className="text-[9px] font-normal text-slate-700 sm:ml-2">점수: {getTeamScore('team3').toFixed(1)}</span>
                    <span className="text-[8px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team3').male}/{getTeamGenderSummary('team3').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('3teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team3',
                          Boolean(assignments[player] && assignments[player] !== 'team3'),
                          'bg-purple-200 border-purple-400',
                          'bg-white border-gray-200 hover:bg-purple-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team3')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : teamConfig.type === 'pairs' ? (
              /* 2명 팀 모드 - 페어 구성 표시 */
              <div className="space-y-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-700 mb-2">
                    💡 <strong>2명 팀 모드:</strong> 2명씩 자동으로 페어를 구성합니다. 
                    (배정 대상 {playerPool.length}명 → {Math.ceil(playerPool.length / 2)}개 페어)
                  </p>
                </div>

                {showCustomEditor && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                    각 그룹의 `수동배정` 버튼을 눌러 그 그룹만 조정할 수 있습니다. 같은 그룹 안에서 선수 한 명을 먼저 선택한 뒤, 교환할 다른 선수를 누르면 두 선수의 페어가 서로 바뀝니다.
                    {activePairGroupIndex != null && pairGroups[activePairGroupIndex] && (
                      <span className="ml-2 font-semibold">현재 조정 그룹: {pairGroups[activePairGroupIndex].groupName}</span>
                    )}
                    {selectedPairPlayer && <span className="ml-2 font-semibold">선택 선수: {selectedPairPlayer}</span>}
                  </div>
                )}
                
                {/* 그룹별로 선수 표시 */}
                {pairGroups.length > 0 && (
                  <div className="space-y-4 mb-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm sm:text-lg font-semibold text-gray-800">📊 그룹별 참가자</h3>
                      <span className="text-xs sm:text-sm text-gray-500">항상 표시됨</span>
                    </div>
                    
                    <div className={`grid gap-2 sm:gap-4 ${
                      pairGroups.length === 2 
                        ? 'grid-cols-2 md:grid-cols-2' 
                        : pairGroups.length === 3 
                        ? 'grid-cols-3' 
                        : 'grid-cols-2 md:grid-cols-4'
                    }`}>
                      {pairGroups.map((group, idx) => {
                        const colorSchemes = [
                          { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-100', button: 'bg-red-200 hover:bg-red-300' },
                          { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', badge: 'bg-blue-100', button: 'bg-blue-200 hover:bg-blue-300' },
                          { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', badge: 'bg-green-100', button: 'bg-green-200 hover:bg-green-300' },
                          { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700', badge: 'bg-purple-100', button: 'bg-purple-200 hover:bg-purple-300' }
                        ];
                        const colors = colorSchemes[idx % colorSchemes.length];
                        
                        return (
                          <div key={group.groupName} className={`border-2 ${colors.border} rounded-lg p-1.5 sm:p-4 ${colors.bg}`}>
                            <h4 className={`font-bold mb-1.5 sm:mb-3 ${colors.text} text-xs sm:text-base flex items-center justify-between`}>
                              <span>{group.groupName}</span>
                              <span className="text-[10px] sm:text-xs font-normal">{group.players.length}명</span>
                            </h4>
                            <div className="space-y-2">
                              {group.players.length === 0 ? (
                                <div className="rounded border border-dashed border-gray-300 bg-white/70 p-2 text-center text-xs text-gray-500">
                                  참가자 없음
                                </div>
                              ) : (
                                sortPlayers(group.players).map((player, playerIdx) => (
                                  <div key={player} className={`rounded-lg border ${colors.border} ${colors.badge} p-1 sm:p-2`}>
                                    <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                                      <div className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                                        {playerIdx + 1}. {player}
                                      </div>
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {pairGroups
                                        .map((targetGroup, targetIdx) => ({ targetGroup, targetIdx }))
                                        .filter(({ targetIdx }) => targetIdx !== idx)
                                        .map(({ targetGroup, targetIdx }) => (
                                          <button
                                            key={targetGroup.groupName}
                                            type="button"
                                            onClick={() => movePairPlayerToGroup(player, targetIdx)}
                                            className={`rounded-full px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px] font-medium text-gray-800 transition-colors ${colors.button}`}
                                          >
                                            {targetGroup.groupName.replace(' 그룹', '')} 이동
                                          </button>
                                        ))}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {/* 그룹별로 페어 표시 */}
                {Object.keys(assignments).length > 0 && (() => {
                  // 페어별로 그룹화
                  const pairs: Record<string, string[]> = {};
                  Object.entries(assignments).forEach(([player, team]) => {
                    if (!pairs[team]) pairs[team] = [];
                    pairs[team].push(player);
                  });
                  
                  // 페어 번호로 정렬
                  const sortedPairs = Object.entries(pairs).sort((a, b) => {
                    const numA = parseInt(a[0].replace('pair', ''));
                    const numB = parseInt(b[0].replace('pair', ''));
                    return numA - numB;
                  });
                  
                  // 각 페어가 어느 그룹에 속하는지 확인
                  const getPairGroup = (players: string[]) => {
                    for (let i = 0; i < pairGroups.length; i++) {
                      if (players.some(p => pairGroups[i].players.includes(p))) {
                        return i;
                      }
                    }
                    return -1;
                  };
                  
                  // 그룹별로 페어 분류
                  const pairsByGroup: Record<number, Array<[string, string[]]>> = {};
                  sortedPairs.forEach(pair => {
                    const groupIdx = getPairGroup(pair[1]);
                    if (!pairsByGroup[groupIdx]) pairsByGroup[groupIdx] = [];
                    pairsByGroup[groupIdx].push(pair);
                  });
                  
                  return (
                    <div className="space-y-6">
                      <h3 className="text-sm sm:text-lg font-semibold text-gray-800">🤝 그룹별 페어 구성</h3>
                      {Object.entries(pairsByGroup).map(([groupIdxStr, groupPairs]) => {
                        const groupIdx = parseInt(groupIdxStr);
                        if (groupIdx < 0 || !pairGroups[groupIdx]) return null;
                        
                        const colorSchemes = [
                          { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', highlight: 'bg-red-100', title: 'bg-red-200' },
                          { bg: 'bg-blue-50', border: 'border-blue-400', text: 'text-blue-700', highlight: 'bg-blue-100', title: 'bg-blue-200' },
                          { bg: 'bg-green-50', border: 'border-green-400', text: 'text-green-700', highlight: 'bg-green-100', title: 'bg-green-200' },
                          { bg: 'bg-purple-50', border: 'border-purple-400', text: 'text-purple-700', highlight: 'bg-purple-100', title: 'bg-purple-200' }
                        ];
                        const colors = colorSchemes[groupIdx % colorSchemes.length];
                        
                        const pairScores = groupPairs
                          .filter(([_, players]) => players.length === 2)
                          .map(([_, players]) => players.reduce((sum, p) => sum + getPlayerScore(p), 0));

                        const avgScore = pairScores.length > 0 ? (pairScores.reduce((a, b) => a + b, 0) / pairScores.length) : 0;
                        const maxScore = pairScores.length > 0 ? Math.max(...pairScores) : 0;
                        const minScore = pairScores.length > 0 ? Math.min(...pairScores) : 0;

                        return (
                          <div key={groupIdx} className={`border-2 ${colors.border} rounded-lg p-2 sm:p-4 ${colors.bg}`}>
                            <div className="mb-2 sm:mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-slate-200 pb-2 sm:pb-3">
                              <div>
                                <h4 className={`font-bold ${colors.text} text-xs sm:text-base ${colors.title} p-1 sm:p-2 rounded inline-block`}>
                                  {pairGroups[groupIdx].groupName} - {groupPairs.length}개 페어
                                </h4>
                                
                                {pairScores.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-3 text-[10px] sm:text-xs text-slate-700 bg-white/70 px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-md border border-slate-100 shadow-sm">
                                    <span>📊 페어 점수:</span>
                                    <span>평균 <strong>{avgScore.toFixed(1)}점</strong></span>
                                    <span>최대 <strong>{maxScore.toFixed(1)}점</strong></span>
                                    <span>최소 <strong>{minScore.toFixed(1)}점</strong></span>
                                    <span>최대-최소 차이 <strong className="text-rose-600">{(maxScore - minScore).toFixed(1)}점</strong></span>
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-1.5 sm:gap-2">
                                <button
                                  type="button"
                                  onClick={() => reassignPairGroup(groupIdx)}
                                  className="rounded bg-teal-600 hover:bg-teal-700 px-1.5 py-1 text-[10px] sm:rounded-lg sm:px-3 sm:py-2 sm:text-xs font-bold text-white transition-colors"
                                >
                                  🔄 그룹별 재배정
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowCustomEditor((prev) => {
                                      const shouldOpen = activePairGroupIndex !== groupIdx || !prev;
                                      setSelectedPairPlayer(null);
                                      setActivePairGroupIndex(shouldOpen ? groupIdx : null);
                                      return shouldOpen;
                                    });
                                  }}
                                  className={`rounded px-1.5 py-1 text-[10px] sm:rounded-lg sm:px-3 sm:py-2 sm:text-xs font-bold text-white transition-colors ${
                                    showCustomEditor && activePairGroupIndex === groupIdx
                                      ? 'bg-orange-700 hover:bg-orange-800'
                                      : 'bg-orange-500 hover:bg-orange-600'
                                  }`}
                                >
                                  {showCustomEditor && activePairGroupIndex === groupIdx ? '수동배정 닫기' : '수동배정'}
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                              {groupPairs.map(([pairName, players]) => {
                                const pairScore = players.reduce((sum, player) => sum + getPlayerScore(player), 0);
                                
                                return (
                                  <div key={pairName} className={`border-2 ${colors.border} rounded-lg p-3 ${colors.highlight}`}>
                                    <h5 className={`text-sm font-semibold mb-2 ${colors.text}`}>
                                      👥 {getPairDisplayLabel(pairName, pairGroups[groupIdx].groupName)} ({players.length}명)
                                      <span className="ml-1 text-xs font-normal">점수: {pairScore.toFixed(1)}</span>
                                    </h5>
                                    <div className="space-y-1">
                                      {players.map((player, idx) => (
                                        <div 
                                          key={player}
                                          className={`p-2 rounded border font-medium text-xs ${
                                            showCustomEditor && activePairGroupIndex === groupIdx
                                              ? `cursor-pointer transition-colors hover:bg-white ${selectedPairPlayer === player ? 'border-orange-500 bg-orange-100 ring-1 ring-orange-300' : `${colors.border} bg-white`}`
                                              : `${colors.border} bg-white`
                                          }`}
                                          onClick={() => handlePairManualAdjustment(player)}
                                        >
                                          {idx + 1}. {player}
                                          {showCustomEditor && activePairGroupIndex === groupIdx && (
                                            <div className="mt-1 text-[10px] text-slate-500">
                                              {selectedPairPlayer === player ? '선택됨' : selectedPairPlayer ? '눌러서 교환' : '눌러서 선택'}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                      {players.length === 1 && (
                                        <div className="p-2 rounded border border-dashed border-gray-300 bg-gray-50 text-gray-400 text-xs text-center">
                                          1명만 배정됨
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                
                {/* 미배정 선수 목록 */}
                {playerPool.filter(p => !assignments[p]).length > 0 && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <h3 className="text-lg font-semibold mb-3 text-gray-700">
                      미배정 선수 ({playerPool.filter(p => !assignments[p]).length}명)
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                      {playerPool.filter(p => !assignments[p]).map(player => (
                        <div 
                          key={player}
                          className="p-2 rounded border bg-white text-sm text-center"
                        >
                          {player}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : teamConfig.type === '4teams' ? (
              /* 4팀 모드 */
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
                {/* 팀 1 */}
                <div className="border rounded-lg p-2 sm:p-4 bg-blue-50">
                  <h3 className="text-xs font-bold text-blue-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 1 ({Object.values(assignments).filter(t => t === 'team1').length}명)</span>
                    <span className="text-[10px] font-normal text-slate-750 sm:ml-2">점수: {getTeamScore('team1').toFixed(1)}</span>
                    <span className="text-[9px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team1').male}/{getTeamGenderSummary('team1').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('4teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team1',
                          Boolean(assignments[player] && assignments[player] !== 'team1'),
                          'bg-blue-200 border-blue-400',
                          'bg-white border-gray-200 hover:bg-blue-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team1')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* 팀 2 */}
                <div className="border rounded-lg p-2 sm:p-4 bg-green-50">
                  <h3 className="text-xs font-bold text-green-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 2 ({Object.values(assignments).filter(t => t === 'team2').length}명)</span>
                    <span className="text-[10px] font-normal text-slate-755 sm:ml-2">점수: {getTeamScore('team2').toFixed(1)}</span>
                    <span className="text-[9px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team2').male}/{getTeamGenderSummary('team2').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('4teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team2',
                          Boolean(assignments[player] && assignments[player] !== 'team2'),
                          'bg-green-200 border-green-400',
                          'bg-white border-gray-200 hover:bg-green-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team2')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* 팀 3 */}
                <div className="border rounded-lg p-2 sm:p-4 bg-purple-50">
                  <h3 className="text-xs font-bold text-purple-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 3 ({Object.values(assignments).filter(t => t === 'team3').length}명)</span>
                    <span className="text-[10px] font-normal text-slate-755 sm:ml-2">점수: {getTeamScore('team3').toFixed(1)}</span>
                    <span className="text-[9px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team3').male}/{getTeamGenderSummary('team3').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('4teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team3',
                          Boolean(assignments[player] && assignments[player] !== 'team3'),
                          'bg-purple-200 border-purple-400',
                          'bg-white border-gray-200 hover:bg-purple-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team3')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* 팀 4 */}
                <div className="border rounded-lg p-2 sm:p-4 bg-orange-50">
                  <h3 className="text-xs font-bold text-orange-700 mb-2 flex flex-col gap-0.5 sm:block sm:text-base md:text-lg">
                    <span>팀 4 ({Object.values(assignments).filter(t => t === 'team4').length}명)</span>
                    <span className="text-[10px] font-normal text-slate-755 sm:ml-2">점수: {getTeamScore('team4').toFixed(1)}</span>
                    <span className="text-[9px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남/여: {getTeamGenderSummary('team4').male}/{getTeamGenderSummary('team4').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('4teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'team4',
                          Boolean(assignments[player] && assignments[player] !== 'team4'),
                          'bg-orange-200 border-orange-400',
                          'bg-white border-gray-200 hover:bg-orange-100'
                        )}
                        onClick={() => assignPlayerToTeam(player, 'team4')}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* 2팀 모드 (기본) */
              <div className="grid grid-cols-2 gap-2 md:gap-6">
                {/* 라켓팀 */}
                <div className="border rounded-lg p-2 sm:p-4">
                  <h3 className="text-sm font-bold text-blue-600 mb-2 flex flex-col gap-0.5 sm:block sm:text-lg">
                    <span className="flex items-center gap-1">🏸 라켓팀 ({Object.values(assignments).filter(t => t === 'racket').length}명)</span>
                    <span className="text-xs font-normal text-slate-750 sm:ml-2">점수: {getTeamScore('racket').toFixed(1)}</span>
                    <span className="text-[10px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남 {getTeamGenderSummary('racket').male} · 여 {getTeamGenderSummary('racket').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('2teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'racket',
                          assignments[player] === 'shuttle',
                          'bg-blue-100 border-blue-300',
                          'bg-white border-gray-200 hover:bg-blue-50'
                        )}
                        onClick={() => togglePlayerTeam(player)}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* 셔틀팀 */}
                <div className="border rounded-lg p-2 sm:p-4">
                  <h3 className="text-sm font-bold text-purple-600 mb-2 flex flex-col gap-0.5 sm:block sm:text-lg">
                    <span className="flex items-center gap-1">🏃‍♂️ 셔틀팀 ({Object.values(assignments).filter(t => t === 'shuttle').length}명)</span>
                    <span className="text-xs font-normal text-slate-750 sm:ml-2">점수: {getTeamScore('shuttle').toFixed(1)}</span>
                    <span className="text-[10px] font-normal text-slate-500 sm:ml-2 block sm:inline-block">남 {getTeamGenderSummary('shuttle').male} · 여 {getTeamGenderSummary('shuttle').female}</span>
                  </h3>
                  <div className={getTeamPlayerGridClassName('2teams')}>
                    {sortPlayers(playerPool).map(player => (
                      <div 
                        key={player}
                        className={getPlayerCardClassName(
                          assignments[player] === 'shuttle',
                          assignments[player] === 'racket',
                          'bg-purple-100 border-purple-300',
                          'bg-white border-gray-200 hover:bg-purple-50'
                        )}
                        onClick={() => togglePlayerTeam(player)}
                      >
                        {player}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      
      {/* 회차별 히스토리 */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="px-3 py-2.5 sm:px-6 sm:py-4 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm sm:text-xl font-semibold">회차별 팀 구성 현황</h2>
          <button
            onClick={() => fetchRoundsData()}
            className="bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded-md text-xs sm:px-3 sm:py-1.5 sm:rounded-lg sm:text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2"
          >
            <span>🔄</span>
            <span>새로고침</span>
          </button>
        </div>
        
        {rounds.length === 0 ? (
          <div className="p-3 sm:p-6 text-center text-gray-500 bg-yellow-50 border border-yellow-200 m-3 sm:m-6 rounded-lg">
            <p className="text-xs sm:text-base font-semibold text-yellow-900 mb-1 sm:mb-2">⚠️ 아직 저장된 회차가 없습니다</p>
            <p className="text-[11px] sm:text-sm text-yellow-800">위의 "자동 배정" → "배정 저장" 버튼으로 회차를 생성하세요.</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {rounds.sort((a, b) => b.round - a.round).map((round) => {
              // 팀 타입에 따른 라벨
              const getTeamTypeLabel = (type?: string) => {
                switch(type) {
                  case '2teams': return '2팀 대결';
                  case '3teams': return '3팀 대결';
                  case '4teams': return '4팀 대결';
                  case 'pairs': return '2명 한팀';
                  default: return '2팀 대결';
                }
              };

              return (
                <div key={round.round} className="border rounded-lg p-5 hover:shadow-lg transition-shadow">
                  {/* 헤더 */}
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-900">
                          {round.title || `${round.round}회차`}
                        </h3>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                          {getTeamTypeLabel(round.team_type)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        총 {round.total_players}명 참여
                        {round.assignment_date && ` · ${round.assignment_date}`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openParticipantsModal(round)}
                        className="text-blue-600 hover:text-blue-900 hover:bg-blue-50 px-3 py-1 rounded transition-colors font-medium"
                        title="참여자 보기"
                      >
                        👥 참여자
                      </button>
                      <button
                        onClick={() => deleteTeamAssignment(round.round, round.assignment_date || getKoreaDate())}
                        className="text-red-600 hover:text-red-900 hover:bg-red-50 px-3 py-1 rounded transition-colors"
                        title="삭제"
                      >
                        🗑️ 삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showMemberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">회원 추가</h3>
                <p className="text-sm text-gray-600">추가할 회원을 여러 명 선택한 뒤 확인을 누르세요.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowMemberModal(false);
                  setSelectedMemberIds([]);
                }}
                className="text-2xl leading-none text-gray-400 hover:text-gray-700"
                aria-label="close"
              >
                ×
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {availableMembersToAdd.length === 0 ? (
                <p className="text-sm text-gray-500">추가 가능한 회원이 없습니다.</p>
              ) : (
                <div className="mb-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={toggleSelectAllMembers}
                    className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                  >
                    {selectedMemberIds.length === availableMembersToAdd.length ? '전체해제' : '전체선택'}
                  </button>
                  <div className="text-sm text-gray-500">
                    {selectedMemberIds.length} / {availableMembersToAdd.length}
                  </div>
                </div>
              )}

              {availableMembersToAdd.length > 0 && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {availableMembersToAdd.map((member) => {
                    const checked = selectedMemberIds.includes(member.id);
                    return (
                      <label
                        key={member.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                          checked ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMemberSelection(member.id)}
                          className="h-4 w-4"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate" title={member.fullName}>
                            {member.fullName}
                          </div>
                          <div className="text-xs text-gray-500">
                            {member.skillCode || 'N1'} · {member.score.toFixed(0)}점
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t px-6 py-4">
              <div className="text-sm text-gray-600">선택됨 {selectedMemberIds.length}명</div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowMemberModal(false);
                    setSelectedMemberIds([]);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={addSelectedMembersToPool}
                  disabled={selectedMemberIds.length === 0}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 참여자 모달 */}
      {selectedRoundForModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={closeParticipantsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {selectedRoundForModal.title || `${selectedRoundForModal.round}회차`}
                </h2>
                <div className="flex items-center gap-3 mt-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                    {(() => {
                      switch(selectedRoundForModal.team_type) {
                        case '2teams': return '2팀 대결';
                        case '3teams': return '3팀 대결';
                        case '4teams': return '4팀 대결';
                        case 'pairs': return '2명 한팀';
                        default: return '2팀 대결';
                      }
                    })()}
                  </span>
                  <span className="text-sm text-gray-500">
                    총 {selectedRoundForModal.total_players}명 참여
                  </span>
                  {selectedRoundForModal.assignment_date && (
                    <span className="text-sm text-gray-500">
                      · {selectedRoundForModal.assignment_date}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={closeParticipantsModal}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
              >
                ×
              </button>
            </div>

            {/* 모달 컨텐츠 */}
            <div className="p-6 space-y-4">
              {selectedRoundForModal.team_type === '2teams' && (
                <>
                  <div className="bg-blue-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-blue-900 mb-3 flex items-center gap-2 text-lg">
                      🏸 라켓팀 
                      <span className="text-sm font-normal">({selectedRoundForModal.racket_team?.length || 0}명)</span>
                      <span className="text-sm font-normal">· 총점 {getPlayersTotalScore(selectedRoundForModal.racket_team).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.racket_team?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-blue-200 text-blue-900 text-sm px-3 py-1.5 rounded-lg font-medium">
                          {player} · {getPlayerScore(player).toFixed(1)}점
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-purple-900 mb-3 flex items-center gap-2 text-lg">
                      🏃‍♂️ 셔틀팀 
                      <span className="text-sm font-normal">({selectedRoundForModal.shuttle_team?.length || 0}명)</span>
                      <span className="text-sm font-normal">· 총점 {getPlayersTotalScore(selectedRoundForModal.shuttle_team).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.shuttle_team?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-purple-200 text-purple-900 text-sm px-3 py-1.5 rounded-lg font-medium">
                          {player} · {getPlayerScore(player).toFixed(1)}점
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedRoundForModal.team_type === '3teams' && (
                <>
                  <div className="bg-blue-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-blue-900 mb-3 text-lg">
                      팀 1 ({selectedRoundForModal.team1?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team1).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team1?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-blue-200 text-blue-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-green-900 mb-3 text-lg">
                      팀 2 ({selectedRoundForModal.team2?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team2).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team2?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-green-200 text-green-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-purple-900 mb-3 text-lg">
                      팀 3 ({selectedRoundForModal.team3?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team3).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team3?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-purple-200 text-purple-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedRoundForModal.team_type === '4teams' && (
                <>
                  <div className="bg-blue-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-blue-900 mb-3 text-lg">
                      팀 1 ({selectedRoundForModal.team1?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team1).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team1?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-blue-200 text-blue-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-green-900 mb-3 text-lg">
                      팀 2 ({selectedRoundForModal.team2?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team2).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team2?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-green-200 text-green-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-purple-900 mb-3 text-lg">
                      팀 3 ({selectedRoundForModal.team3?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team3).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team3?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-purple-200 text-purple-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4 w-full">
                    <div className="font-semibold text-orange-900 mb-3 text-lg">
                      팀 4 ({selectedRoundForModal.team4?.length || 0}명)
                      <span className="ml-2 text-sm font-normal">총점 {getPlayersTotalScore(selectedRoundForModal.team4).toFixed(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRoundForModal.team4?.map((player, idx) => (
                        <span key={idx} className="inline-block bg-orange-200 text-orange-900 text-sm px-3 py-1.5 rounded-lg font-medium">{player} · {getPlayerScore(player).toFixed(1)}점</span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedRoundForModal.team_type === 'pairs' && selectedRoundForModal.pairs_data && (
                <>
                  {(() => {
                    const allPairs = Object.entries(selectedRoundForModal.pairs_data || {})
                      .filter(([pairName]) => /^pair\d+$/i.test(pairName))
                      .sort((a, b) => {
                        const aNum = Number(String(a[0]).replace(/\D/g, ''));
                        const bNum = Number(String(b[0]).replace(/\D/g, ''));
                        return aNum - bNum;
                      });

                    const groups = (selectedRoundForModal.pair_group_data || [])
                      .map((group) => ({
                        groupName: group.groupName,
                        pairs: group.pairNames
                          .map((pairName) => [pairName, selectedRoundForModal.pairs_data?.[pairName] || []] as [string, string[]])
                          .filter(([_, players]) => players.length > 0),
                      }))
                      .filter((group) => group.pairs.length > 0);

                    const groupedPairNames = new Set(groups.flatMap((group) => group.pairs.map(([pairName]) => pairName)));
                    const remainingPairs = allPairs.filter(([pairName]) => !groupedPairNames.has(pairName));

                    const displayGroups = [...groups];
                    if (remainingPairs.length > 0) {
                      displayGroups.push({
                        groupName: '기타 그룹',
                        pairs: remainingPairs as Array<[string, string[]]>,
                      });
                    }

                    if (displayGroups.length === 0) {
                      return (
                        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                          저장된 페어 데이터가 없습니다.
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-4">
                        {displayGroups.map((group) => (
                          <div key={group.groupName} className="rounded-lg border border-teal-200 bg-teal-50 p-4">
                            <div className="mb-3 text-base font-semibold text-teal-900">
                              {group.groupName} ({group.pairs.length}개 페어)
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {group.pairs.map(([pairName, players]) => (
                                <div key={pairName} className="rounded-lg border border-teal-300 bg-white p-3">
                                  <div className="mb-2 text-sm font-semibold text-teal-900">
                                    👥 {getPairDisplayLabel(pairName, group.groupName)} ({players?.length || 0}명)
                                    <span className="ml-2 text-xs font-normal">총점 {getPlayersTotalScore(players).toFixed(1)}</span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {players?.map((player: string, idx: number) => (
                                      <div key={`${pairName}-${idx}`} className="rounded bg-teal-100 px-2 py-1 text-xs font-medium text-teal-900">
                                        {player} · {getPlayerScore(player).toFixed(1)}점
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            {/* 모달 푸터 */}
            <div className="border-t px-6 py-4 bg-gray-50">
              <button
                onClick={closeParticipantsModal}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
