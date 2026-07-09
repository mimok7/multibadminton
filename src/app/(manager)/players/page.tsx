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
  fetchGeneratedMatchesBySession
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
  const [playerGameCounts, setPlayerGameCounts] = useState<Record<string, number>>({});
  const [perPlayerMinGames, setPerPlayerMinGames] = useState<number>(1);
  const [assignTarget, setAssignTarget] = useState<'attendees' | 'participants'>('attendees');
  
  // 배정 관련 상태
  const [matchSessions, setMatchSessions] = useState<MatchSession[]>([]);
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
      const { data: sessions, error } = await supabase
        .from('match_sessions')
        .select('*')
        .eq('session_date', base)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMatchSessions(sessions || []);
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

  // 경기 생성 핸들러들
  const handleAssignByLevel = async () => {
    if (!todayPlayers) return;
    
    setLoading(true);
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

  const handleDirectAssign = async () => {
    if (matches.length === 0) {
      alert('배정할 경기가 없습니다.');
      return;
    }

    setLoading(true);
    try {
      if (!selectedGenDate) {
        alert('배정할 경기 일정을 선택해주세요.');
        setLoading(false);
        return;
      }
      // 세션명 자동 생성: YYYY-MM-DD_모드_일련번호
      const mode = assignType === 'today' ? '오늘' : '예정';
      const { count } = await supabase
        .from('match_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('session_date', selectedGenDate);
      const n = (count ?? 0) + 1;
      const sessionName = `${selectedGenDate}_${mode}_${n}`;
      
      const activeClubId = typeof document !== 'undefined'
        ? document.cookie.match(/(?:^|;\s*)active_club_id=([^;]*)/)?.[1] || ''
        : '';

      // 경기 세션 생성
      const { data: sessionData, error: sessionError } = await supabase
        .from('match_sessions')
        .insert({
          session_name: sessionName,
          total_matches: matches.length,
          assigned_matches: assignType === 'today' ? matches.length : 0,
          session_date: selectedGenDate,
          club_id: activeClubId
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // 개별 경기 데이터 생성 (배정 순서 유지)
      const matchData = matches.map((match, index) => ({
        session_id: sessionData.id,
        match_number: index + 1, // 배정 순서 그대로 경기 번호 부여
        team1_player1_id: match.team1.player1.id,
        team1_player2_id: match.team1.player2.id,
        team2_player1_id: match.team2.player1.id,
        team2_player2_id: match.team2.player2.id,
        status: 'scheduled', // 초기 상태는 예정
        created_at: new Date().toISOString(),
        club_id: activeClubId
      }));

      const { error: matchError } = await supabase
        .from('generated_matches')
        .insert(matchData as any);

      if (matchError) throw matchError;

      alert(`✅ ${matches.length}개 경기가 ${assignType === 'today' ? '오늘 바로' : '예정으로'} 배정되었습니다!`);
      
      // 상태 초기화 및 새로고침
  setMatches([]);
  setPlayerGameCounts({});
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
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white">⚡ 경기 생성 관리</h1>
                <p className="text-blue-100 text-sm md:text-base mt-1">출석한 선수들로 균형잡힌 경기를 생성하세요</p>
              </div>
              <div className="mt-4 sm:mt-0 flex gap-2">
                <Link href="/match-results">
                  <Button variant="outline" className="bg-white text-blue-600 border-white hover:bg-blue-50">
                    📋 배정 결과 확인
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="outline" className="bg-white text-blue-600 border-white hover:bg-blue-50">
                    🏠 대시보드
                  </Button>
                </Link>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <AttendanceStatus todayPlayers={todayPlayers} />
            
            <MatchSessionStatus matchSessions={matchSessions} />

            {/* 일정 선택 및 참가자 선택 섹션 */}
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded">
              <h3 className="text-lg font-semibold mb-3 text-amber-800">📅 경기 일정 & 참가자 선택</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">배정할 경기 날짜</label>
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={selectedGenDate}
                    onChange={(e) => setSelectedGenDate(e.target.value)}
                  >
                    <option value="">날짜를 선택하세요</option>
                    {availableDates.map(d => (
                      <option key={d.date} value={d.date}>
                        {new Date(d.date).toLocaleDateString('ko-KR')} — 여유 {d.availableSlots}명, 장소 {d.location}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">선택된 날짜로 세션이 생성됩니다.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">참가 선수 선택(미선택 시 {selectedGenDate ? '해당 날짜 신청자' : '출석자'} 전체)</label>
                  <div className="max-h-44 overflow-auto border rounded">
                    <ul className="divide-y">
                      {(
                        selectedGenDate
                          ? (registeredPlayersForGen || [])
                          : (todayPlayers || []).filter(p => p.status === 'present')
                        ).map(p => {
                        const isChecked = selectedPlayerIdsForGen.has(p.id);
                        return (
                          <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedPlayerIdsForGen(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(p.id); else next.delete(p.id);
                                  return next;
                                });
                              }}
                            />
                            <span className="flex-1 truncate">{p.name}</span>
                            <span className="text-xs text-gray-500">{(p.skill_level || 'E2').toUpperCase()}</span>
                            <span className="text-xs text-gray-500">{(p.gender || '').toString()}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="mt-2 flex gap-2 text-xs">
                    <button
                      className="px-2 py-1 border rounded hover:bg-gray-50"
                      onClick={() => setSelectedPlayerIdsForGen(new Set((selectedGenDate ? (registeredPlayersForGen || []) : (todayPlayers || []).filter(p => p.status === 'present')).map(p => p.id)))}
                    >
                      모두 선택
                    </button>
                    <button
                      className="px-2 py-1 border rounded hover:bg-gray-50"
                      onClick={() => setSelectedPlayerIdsForGen(new Set())}
                    >
                      선택 해제
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <MatchGenerationControls
              todayPlayers={todayPlayers}
              perPlayerMinGames={perPlayerMinGames}
              setPerPlayerMinGames={setPerPlayerMinGames}
              assignTarget={assignTarget}
              setAssignTarget={setAssignTarget}
              onGenerateByLevel={handleAssignByLevel}
              onGenerateRandom={handleAssignRandom}
              onGenerateMixed={handleAssignMixed}
              onManualAssign={() => {}} // 수동 배정은 별도 컴포넌트에서 처리
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
              }}
              onAssignMatches={handleDirectAssign}
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
