'use client';

import { useEffect, useState } from 'react';
import { RequireAdmin } from '@/components/AuthGuard';
import { Match } from '@/types';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getKoreaDate } from '@/lib/date';

import { 
  ExtendedPlayer, 
  MatchSession, 
  GeneratedMatch, 
  AvailableDate,
  LEVEL_LABELS 
} from './types';

import { 
  supabase,
  normalizeLevel,
  calculatePlayerGameCounts,
  fetchTodayPlayers,
  fetchAvailableScheduleDates,
  fetchGeneratedMatchesBySession,
  fetchRegisteredSchedules
} from './utils';

import AttendanceStatus from './components/AttendanceStatus';
import MatchSessionStatus from './components/MatchSessionStatus';
import MatchGenerationControls from './components/MatchGenerationControls';
import GeneratedMatchesList from './components/GeneratedMatchesList';
import MatchAssignmentManager from './components/MatchAssignmentManager';

function PlayersPage() {
  const [todayPlayers, setTodayPlayers] = useState<ExtendedPlayer[] | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isManualMode, setIsManualMode] = useState(false);
  const [playerGameCounts, setPlayerGameCounts] = useState<Record<string, number>>({});
  const [perPlayerMinGames, setPerPlayerMinGames] = useState<number>(1);
  const [assignTarget, setAssignTarget] = useState<'attendees' | 'participants'>('attendees');
  
  // 배정 관련 상태
  const [matchSessions, setMatchSessions] = useState<MatchSession[]>([]);
  const [registeredSchedules, setRegisteredSchedules] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [generatedMatches, setGeneratedMatches] = useState<GeneratedMatch[]>([]);
  const [selectedMatches, setSelectedMatches] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  // 경기 배정 타입 상태
  const [assignType, setAssignType] = useState<'today' | 'scheduled'>('today');
  // 세션명 자동 생성으로 전환 (입력 상태 제거)
  
  // 일정 관리를 위한 상태
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([]);
  const [selectedAssignDate, setSelectedAssignDate] = useState<string>('');
  // 생성 및 배정 대상 일정과 참가자 선택 상태
  const [selectedGenDate, setSelectedGenDate] = useState<string>('');
  const [selectedPlayerIdsForGen, setSelectedPlayerIdsForGen] = useState<Set<string>>(new Set());
  const [registeredPlayersForGen, setRegisteredPlayersForGen] = useState<ExtendedPlayer[] | null>(null);

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  useEffect(() => {
    async function initializeData() {
      try {
        // 현재 사용자 정보 가져오기
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        setCurrentUser(user);

        // 출석자 데이터 조회
        const players = await fetchTodayPlayers();
        setTodayPlayers(players);

        // 경기 세션 및 배정 가능한 일정 조회
  await fetchMatchSessions();
        await fetchAvailableDates();
      } catch (error) {
        console.error('❌ 초기 데이터 조회 중 오류:', error);
        alert('데이터 조회 중 오류가 발생했습니다. 다시 시도해주세요.');
        setTodayPlayers([]);
      }
    }
    
    initializeData();
  }, []);

  // 경기 세션 조회 함수
  const fetchMatchSessions = async (dateOverride?: string) => {
    try {
      const base = dateOverride || selectedGenDate || getKoreaDate();
      const [{ data: sessions, error }, schedules] = await Promise.all([
        supabase
          .from('match_sessions')
          .select('*')
          .eq('session_date', base)
          .order('created_at', { ascending: false }),
        fetchRegisteredSchedules(base)
      ]);

      if (error) throw error;
      setMatchSessions(sessions || []);
      setRegisteredSchedules(schedules);
    } catch (error) {
      console.error('경기 세션 조회 오류:', error);
    }
  };

  // 날짜 선택 시: 해당 날짜의 등록자 로드 + 세션도 해당 날짜로 필터링
  useEffect(() => {
    const loadByDate = async () => {
      if (!selectedGenDate) {
        setRegisteredPlayersForGen(null);
        fetchMatchSessions();
        return;
      }
      try {
        const { fetchRegisteredPlayersForDate } = await import('./utils');
        const players = await fetchRegisteredPlayersForDate(selectedGenDate);
        setRegisteredPlayersForGen(players);
        await fetchMatchSessions(selectedGenDate);
      } catch (e) {
        console.error('선택일 참가자/세션 로드 오류:', e);
        setRegisteredPlayersForGen([]);
      }
    };
    loadByDate();
  // 날짜 변경 시 기존 선택 초기화
  setSelectedPlayerIdsForGen(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenDate]);

  // 배정 가능한 일정 조회 함수
  const fetchAvailableDates = async () => {
    try {
      setAvailableDates(await fetchAvailableScheduleDates());
    } catch (error) {
      console.error('일정 조회 오류:', error);
      setAvailableDates([]);
    }
  };

  // 선택된 세션의 생성된 경기 조회
  const fetchGeneratedMatches = async (sessionId: string) => {
    try {
      setLoading(true);
      setGeneratedMatches(await fetchGeneratedMatchesBySession(sessionId));
    } catch (error) {
      console.error('생성된 경기 조회 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  // 선수의 출석 상태 업데이트 함수 (페이지/컴포넌트 리팩토링 후 누락된 기능 복원)
  const updatePlayerStatus = async (playerId: string, status: ExtendedPlayer['status']) => {
    if (!todayPlayers || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    
    try {
      // 로컬 즉시 업데이트
      const updatedPlayers = todayPlayers.map(player => 
        player.id === playerId ? { ...player, status } : player
      );
      setTodayPlayers(updatedPlayers);
      
      const today = getKoreaDate();
      const response = await fetch('/api/admin/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [playerId], attendedAt: today, status }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        console.error('상태 업데이트 오류:', result?.error || response.statusText);
        await fetchTodayPlayers().then(setTodayPlayers);
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const bulkUpdatePlayerStatus = async (playerIds: string[], status: ExtendedPlayer['status']) => {
    if (!todayPlayers || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    
    try {
      // 로컬 즉시 업데이트
      const updatedPlayers = todayPlayers.map(player => 
        playerIds.includes(player.id) ? { ...player, status } : player
      );
      setTodayPlayers(updatedPlayers);
      
      const today = getKoreaDate();
      const response = await fetch('/api/admin/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: playerIds, attendedAt: today, status }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        console.error('일괄 상태 업데이트 오류:', result?.error || response.statusText);
        await fetchTodayPlayers().then(setTodayPlayers);
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // 경기 생성 핸들러들
  const handleAssignByLevel = async () => {
    if (!todayPlayers) return;
    
    setLoading(true);
    setIsManualMode(false);
    try {
      const basePool = selectedGenDate && registeredPlayersForGen
        ? registeredPlayersForGen
        : (todayPlayers.filter(p => p.status === 'present'));
      const selectedPlayers = selectedPlayerIdsForGen.size > 0
        ? basePool.filter(p => selectedPlayerIdsForGen.has(p.id))
        : basePool;
      if (selectedPlayers.length < 4) {
        console.warn('경기를 생성하려면 최소 4명의 출석자가 필요합니다.');
        return;
      }

      const playersForMatch = selectedPlayers.map(player => ({
        ...player,
        skill_level: normalizeLevel(player.skill_level)
      }));

      // 경기 생성 로직 (from match-utils)
  const { createBalancedDoublesMatches } = await import('@/utils/match-utils');
  const generatedMatches = createBalancedDoublesMatches(playersForMatch, perPlayerMinGames);
      
      if (generatedMatches.length === 0) {
        alert('균형잡힌 경기를 생성할 수 없습니다.');
        return;
      }

      setMatches(generatedMatches);
      setPlayerGameCounts(calculatePlayerGameCounts(generatedMatches));
      
      console.log(`✅ 레벨별 경기 생성 완료: ${generatedMatches.length}경기`);
    } catch (error) {
      console.error('❌ 레벨별 경기 생성 중 오류:', error);
      alert(`레벨별 경기 생성 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRandom = async () => {
    if (!todayPlayers) return;

    setLoading(true);
    setIsManualMode(false);
    try {
      const basePool = selectedGenDate && registeredPlayersForGen
        ? registeredPlayersForGen
        : (todayPlayers.filter(p => p.status === 'present'));
      const selectedPlayers = selectedPlayerIdsForGen.size > 0
        ? basePool.filter(p => selectedPlayerIdsForGen.has(p.id))
        : basePool;
      if (selectedPlayers.length < 4) {
        alert('경기를 생성하려면 최소 4명의 출석자가 필요합니다.');
        return;
      }

  // 유틸: 팀은 랜덤으로 섞되, 상대팀은 실력 유사하게 페어링
  const { createRandomBalancedDoublesMatches } = await import('@/utils/match-utils');
  const generated = createRandomBalancedDoublesMatches(selectedPlayers, perPlayerMinGames);

  setMatches(generated);
  setPlayerGameCounts(calculatePlayerGameCounts(generated));
      
  console.log(`✅ 랜덤 경기 생성 완료: ${generated.length}경기`);
    } catch (error) {
      console.error('❌ 랜덤 경기 생성 중 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignMixed = async () => {
    if (!todayPlayers) return;

    setLoading(true);
    setIsManualMode(false);
    try {
      const basePool = selectedGenDate && registeredPlayersForGen
        ? registeredPlayersForGen
        : (todayPlayers.filter(p => p.status === 'present'));
      const selectedPlayers = selectedPlayerIdsForGen.size > 0
        ? basePool.filter(p => selectedPlayerIdsForGen.has(p.id))
        : basePool;
      if (selectedPlayers.length < 4) {
        alert('혼합복식 경기를 생성하려면 최소 4명의 출석자가 필요합니다.');
        return;
      }

      const playersForMatch = selectedPlayers.map(player => ({
        ...player,
        skill_level: normalizeLevel(player.skill_level)
      }));

      // 혼성+동성 조합 경기 생성 로직 (from match-utils)
  const { createMixedAndSameSexDoublesMatches } = await import('@/utils/match-utils');
  const generatedMatches = createMixedAndSameSexDoublesMatches(playersForMatch, perPlayerMinGames);
      
      if (generatedMatches.length === 0) {
        alert('혼합복식 경기를 생성할 수 없습니다. 남녀 선수 구성을 확인해주세요.');
        return;
      }

      setMatches(generatedMatches);
      setPlayerGameCounts(calculatePlayerGameCounts(generatedMatches));
      
      console.log(`✅ 혼복 경기 생성 완료: ${generatedMatches.length}경기`);
    } catch (error) {
      console.error('❌ 혼복 경기 생성 중 오류:', error);
      alert(`혼복 경기 생성 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAssign = () => {
    const presentPlayers = (todayPlayers || []).filter((player) => player.status === 'present');
    if (presentPlayers.length < 4) {
      alert('수동 배정을 하려면 출석 선수가 최소 4명 필요합니다.');
      return;
    }

    const matchCount = Math.max(1, Math.ceil((presentPlayers.length * perPlayerMinGames) / 4));
    const emptyMatches = Array.from({ length: matchCount }, (_, index) => ({
      id: `manual-${Date.now()}-${index}`,
      team1: { player1: null, player2: null },
      team2: { player1: null, player2: null },
    })) as unknown as Match[];

    setMatches(emptyMatches);
    setPlayerGameCounts({});
    setIsManualMode(true);
  };

  const handleDirectAssign = async () => {
    if (matches.length === 0) {
      alert('배정할 경기가 없습니다.');
      return;
    }

    setLoading(true);
    try {
      const assignmentDate = selectedGenDate || getKoreaDate();
      const mode = assignType === 'today' ? '오늘' : '예정';
      const response = await fetch('/api/admin/match-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matches,
          session_date: assignmentDate,
          mode,
        }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error || '경기 세션 저장에 실패했습니다.');
      }

      alert(`✅ ${matches.length}개 경기가 ${assignType === 'today' ? '오늘 바로' : '예정으로'} 배정되었습니다!`);
      
      // 상태 초기화 및 새로고침
  setMatches([]);
  setPlayerGameCounts({});
  setIsManualMode(false);
  setSelectedPlayerIdsForGen(new Set());
      await fetchMatchSessions();
      
    } catch (error) {
      console.error('경기 배정 오류:', error);
      alert(`경기 배정 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  // 일괄 배정 함수
  const handleBulkAssign = async () => {
    if (selectedMatches.size === 0 || !selectedSessionId) {
      alert('배정할 경기를 선택해주세요.');
      return;
    }

    if (!selectedAssignDate) {
      alert('배정할 날짜를 선택해주세요.');
      return;
    }

    const matchesToAssign = generatedMatches.filter(match => 
      selectedMatches.has(match.id) && !match.is_scheduled
    );

    if (matchesToAssign.length === 0) {
      alert('배정할 수 있는 경기가 없습니다.');
      return;
    }

    try {
      setLoading(true);

      // 선택된 날짜의 일정 정보 가져오기
      const selectedDateInfo = availableDates.find(d => d.date === selectedAssignDate);
      if (!selectedDateInfo) {
        alert('선택된 날짜의 일정 정보를 찾을 수 없습니다.');
        return;
      }

      // 여유 공간 확인
      if (selectedDateInfo.availableSlots < matchesToAssign.length * 4) {
        const confirmed = confirm(
          `선택된 날짜의 여유 공간(${selectedDateInfo.availableSlots}명)이 ` +
          `배정할 경기 참가자 수(${matchesToAssign.length * 4}명)보다 부족합니다.\n\n` +
          `그래도 배정하시겠습니까?`
        );
        if (!confirmed) return;
      }

      // 스케줄 데이터 생성
      const scheduleInserts = matchesToAssign.map((match, index) => ({
        generated_match_id: match.id,
        match_date: selectedAssignDate,
        start_time: `${9 + index}:00`,
        end_time: `${10 + index}:00`,
        location: selectedDateInfo.location,
        max_participants: 4,
        current_participants: 0,
        status: 'scheduled',
        description: `자동 배정된 경기 #${match.match_number}`,
        created_by: currentUser?.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('match_schedules')
        .insert(scheduleInserts as any);

      if (error) {
        console.error('일괄 배정 데이터베이스 오류:', error);
        throw error;
      }

      // 세션의 배정된 경기 수 업데이트
      const selectedSession = matchSessions.find(s => s.id === selectedSessionId);
      if (selectedSession) {
        const { error: updateError } = await supabase
          .from('match_sessions')
          .update({ assigned_matches: selectedSession.assigned_matches + scheduleInserts.length })
          .eq('id', selectedSessionId);

        if (updateError) throw updateError;
      }

      setSelectedMatches(new Set());
      await fetchGeneratedMatches(selectedSessionId);
      await fetchMatchSessions();
      await fetchAvailableDates();
      
      alert(
        `${scheduleInserts.length}개 경기가 ${new Date(selectedAssignDate).toLocaleDateString('ko-KR')} ` +
        `일정으로 성공적으로 배정되었습니다!`
      );
    } catch (error) {
      console.error('일괄 배정 오류:', error);
      alert('경기 배정 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 단순화된 메인 렌더링 - 복잡한 경기 생성 로직은 별도로 처리
  
  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="w-full">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">⚡ 경기 생성 관리</h1>
                <p className="text-gray-500 text-sm md:text-base mt-1">출석한 선수들로 균형잡힌 경기를 생성하세요</p>
              </div>
              <div className="mt-4 sm:mt-0 flex gap-2">
                <Link href="/match-results">
                  <Button variant="outline" className="text-blue-600 hover:bg-blue-50">
                    📋 배정 결과 확인
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="outline" className="text-blue-600 hover:bg-blue-50">
                    🏠 대시보드
                  </Button>
                </Link>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <AttendanceStatus 
              todayPlayers={todayPlayers} 
              onStatusChange={updatePlayerStatus}
              onBulkStatusChange={bulkUpdatePlayerStatus}
              disabled={isUpdatingStatus}
            />
            
            <MatchSessionStatus 
              matchSessions={matchSessions} 
              registeredSchedules={registeredSchedules}
            />

            <MatchGenerationControls
              todayPlayers={todayPlayers}
              perPlayerMinGames={perPlayerMinGames}
              setPerPlayerMinGames={setPerPlayerMinGames}
              assignTarget={assignTarget}
              setAssignTarget={setAssignTarget}
              onGenerateByLevel={handleAssignByLevel}
              onGenerateRandom={handleAssignRandom}
              onGenerateMixed={handleAssignMixed}
              onManualAssign={handleManualAssign}
            />
            
            <GeneratedMatchesList
              matches={matches}
              playerGameCounts={playerGameCounts}
              assignType={assignType}
              setAssignType={setAssignType}
              loading={loading}
              onClearMatches={() => {
                setMatches([]);
                setPlayerGameCounts({});
                setIsManualMode(false);
              }}
              onAssignMatches={handleDirectAssign}
              isManualMode={isManualMode}
              presentPlayers={(todayPlayers || []).filter((player) => player.status === 'present')}
              onManualMatchChange={(updatedMatches) => {
                setMatches(updatedMatches);
                const counts: Record<string, number> = {};
                updatedMatches.forEach((match) => {
                  [
                    match.team1?.player1,
                    match.team1?.player2,
                    match.team2?.player1,
                    match.team2?.player2,
                  ].forEach((player) => {
                    if (player?.id) counts[player.id] = (counts[player.id] || 0) + 1;
                  });
                });
                setPlayerGameCounts(counts);
              }}
            />
            
            <MatchAssignmentManager
              matchSessions={matchSessions}
              selectedSessionId={selectedSessionId}
              setSelectedSessionId={setSelectedSessionId}
              generatedMatches={generatedMatches}
              selectedMatches={selectedMatches}
              setSelectedMatches={setSelectedMatches}
              availableDates={availableDates}
              selectedAssignDate={selectedAssignDate}
              setSelectedAssignDate={setSelectedAssignDate}
              loading={loading}
              onFetchGeneratedMatches={fetchGeneratedMatches}
              onBulkAssign={handleBulkAssign}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// 인증 필요 래핑
export default function ProtectedPlayersPage() {
  return (
    <RequireAdmin>
      <PlayersPage />
    </RequireAdmin>
  );
}
