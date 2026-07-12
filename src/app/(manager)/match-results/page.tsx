'use client';

import { useEffect, useState, useMemo, Fragment } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { DEFAULT_MATCH_WAGER, MAX_MATCH_WAGER } from '@/lib/coins';
import { getFriendlyErrorMessage } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeft, Trophy } from 'lucide-react';
import { getKoreaDate } from '@/lib/date';
import { fetchAdminMatchResults, fetchAdminMatchSessions } from './actions';

interface AssignedMatch {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  location: string;
  status: string;
  description: string;
  max_participants: number;
  current_participants: number;
  generated_match: {
    id: number;
    match_number: number;
    status?: string;
    completed_at?: string | null;
    match_result?: {
      winner?: 'team1' | 'team2';
      score?: string;
      team1_score?: number;
      team2_score?: number;
      completed_at?: string;
      recorded_by?: string;
    } | null;
    session: {
      session_name: string;
      session_date: string;
      id?: string;
    };
    team1_player1: {
      username: string;
      full_name: string;
      skill_level: string;
    };
    team1_player2: {
      username: string;
      full_name: string;
      skill_level: string;
    };
    team2_player1: {
      username: string;
      full_name: string;
      skill_level: string;
    };
    team2_player2: {
      username: string;
      full_name: string;
      skill_level: string;
    };
  };
}

interface MatchSession {
  id: string;
  session_name: string;
  session_date: string;
  total_matches: number;
  assigned_matches: number;
  created_at: string;
}

const formatSessionName = (session: { session_date: string, session_name: string } | null | undefined) => {
  if (!session) return '-';
  const dateStr = session.session_date ? session.session_date.split('T')[0] : '';
  if (dateStr && session.session_name.startsWith(dateStr)) {
    return session.session_name;
  }
  return dateStr ? `${dateStr}_${session.session_name}` : session.session_name;
};

function MatchResultsPage() {
  const [rawMatches, setRawMatches] = useState<AssignedMatch[]>([]);
  const sortField = 'default';
  const sortDirection = 'asc';
  const [matchSessions, setMatchSessions] = useState<MatchSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  
  const supabase = getSupabaseClient();

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    fetchCurrentUser();
    fetchAssignedMatches();
    fetchMatchSessions();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error) throw error;
      const user = session?.user ?? null;
      
      if (user) {
        let { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, full_name')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!profile && !profileError) {
          const { data: fallbackProfile, error: fallbackError } = await supabase
            .from('profiles')
            .select('id, username, full_name')
            .eq('id', user.id)
            .maybeSingle();
          profile = fallbackProfile;
          profileError = fallbackError;
        }
        
        if (profileError) throw profileError;
        setCurrentUser(profile);
      }
    } catch (error) {
      console.error('현재 사용자 조회 오류:', error);
    }
  };

  const fetchMatchSessions = async () => {
    try {
      const sessions = await fetchAdminMatchSessions();
      setMatchSessions(sessions);
    } catch (error) {
      console.error('경기 세션 조회 오류:', error);
    }
  };

  const fetchAssignedMatches = async () => {
    try {
      setLoading(true);
      const matchesWithDetails = await fetchAdminMatchResults({ dateFilter, statusFilter });

      // 세션 필터 적용
      const finalMatches = selectedSession === 'all' 
        ? matchesWithDetails
        : matchesWithDetails.filter(match => 
            match.generated_match?.session?.id === selectedSession
          );

      setRawMatches(finalMatches as AssignedMatch[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignedMatches();
  }, [selectedSession, dateFilter, statusFilter]);

  const getStatusBadge = (status: string) => {
    const statusMap = {
      'scheduled': { text: '예정됨', color: 'bg-blue-100 text-blue-800' },
      'in_progress': { text: '진행중', color: 'bg-yellow-100 text-yellow-800' },
      'completed': { text: '완료됨', color: 'bg-green-100 text-green-800' },
      'cancelled': { text: '취소됨', color: 'bg-red-100 text-red-800' }
    };
    
    const statusInfo = statusMap[status as keyof typeof statusMap] || { text: status, color: 'bg-gray-100 text-gray-800' };
    
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
        {statusInfo.text}
      </span>
    );
  };

  const getPlayerName = (player: any) => {
    return player?.username || player?.full_name || '미정';
  };

  const isCurrentUser = (player: any) => {
    if (!currentUser || !player) return false;
    return player.username === currentUser.username || player.full_name === currentUser.full_name;
  };

  const getPlayerNameWithHighlight = (player: any) => {
    const name = getPlayerName(player);
    const isMe = isCurrentUser(player);
    
    return (
      <span className={isMe ? "text-sm text-yellow-600 font-bold bg-yellow-100 px-2 py-1 rounded" : "text-sm text-gray-900"}>
        {name}
      </span>
    );
  };

  const assignedMatches = useMemo(() => {
    const matches = [...rawMatches];
    
    if (sortField === 'default') {
      return matches.sort((a, b) => {
        // Default: Session Date -> Session Name -> Match Number
        const dateA = a.generated_match?.session?.session_date || '';
        const dateB = b.generated_match?.session?.session_date || '';
        if (dateA !== dateB) {
          return dateA.localeCompare(dateB);
        }

        const nameA = a.generated_match?.session?.session_name || '';
        const nameB = b.generated_match?.session?.session_name || '';
        if (nameA !== nameB) {
          return nameA.localeCompare(nameB);
        }

        const numA = a.generated_match?.match_number ?? 9999;
        const numB = b.generated_match?.match_number ?? 9999;
        return numA - numB;
      });
    }

    const directionMultiplier = sortDirection === 'asc' ? 1 : -1;

    return matches.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'number': {
          const numA = a.generated_match?.match_number ?? 9999;
          const numB = b.generated_match?.match_number ?? 9999;
          comparison = numA - numB;
          break;
        }
        case 'session': {
          const nameA = a.generated_match?.session?.session_name || '';
          const nameB = b.generated_match?.session?.session_name || '';
          comparison = nameA.localeCompare(nameB);
          break;
        }
        case 'team1': {
          const pA = getPlayerName(a.generated_match?.team1_player1);
          const pB = getPlayerName(b.generated_match?.team1_player1);
          comparison = pA.localeCompare(pB);
          break;
        }
        case 'team2': {
          const pA = getPlayerName(a.generated_match?.team2_player1);
          const pB = getPlayerName(b.generated_match?.team2_player1);
          comparison = pA.localeCompare(pB);
          break;
        }
        case 'status': {
          const sA = a.status || '';
          const sB = b.status || '';
          comparison = sA.localeCompare(sB);
          break;
        }
        default:
          comparison = 0;
      }

      if (comparison === 0) {
        const numA = a.generated_match?.match_number ?? 9999;
        const numB = b.generated_match?.match_number ?? 9999;
        return numA - numB;
      }

      return comparison * directionMultiplier;
    });
  }, [rawMatches, sortField, sortDirection]);

  // 모바일 전용 결과 제출 카드 컴포넌트 (조회 전용)
  function MobileMatchResultCard({ match }: { match: AssignedMatch, onSaved: () => void }) {
    const gm = match.generated_match;
    if (!gm) return null;

    const t1Score = gm.match_result?.team1_score !== undefined && gm.match_result?.team1_score !== null ? gm.match_result.team1_score : '-';
    const t2Score = gm.match_result?.team2_score !== undefined && gm.match_result?.team2_score !== null ? gm.match_result.team2_score : '-';

    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800">게임 {gm.match_number}</span>
          {getStatusBadge(match.status)}
        </div>
        
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          {/* 왼쪽: 라켓팀 (선수 위아래 배치, 크기 축소) */}
          <div className="flex flex-col items-center justify-center bg-blue-50/40 border border-blue-100/50 rounded-lg py-1 px-1.5 min-h-[56px] text-center min-w-0">
            <div className="text-[8px] font-bold text-blue-600 mb-0.5 select-none">라켓팀</div>
            <div className="flex flex-col gap-0.5 w-full min-w-0">
              <div className="truncate text-xs font-semibold text-slate-800">{getPlayerName(gm.team1_player1)}</div>
              <div className="truncate text-xs font-semibold text-slate-800">{getPlayerName(gm.team1_player2)}</div>
            </div>
          </div>
          
          {/* 가운데: 점수 조회 (텍스트 노출) */}
          <div className="flex flex-col items-center justify-center px-2.5 shrink-0">
            <span className="text-[8px] font-bold text-slate-400 uppercase select-none mb-0.5">SCORE</span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-extrabold text-blue-600">{t1Score}</span>
              <span className="text-xs font-bold text-slate-400">:</span>
              <span className="text-sm font-extrabold text-red-600">{t2Score}</span>
            </div>
          </div>
          
          {/* 오른쪽: 셔틀팀 (선수 위아래 배치, 크기 축소) */}
          <div className="flex flex-col items-center justify-center bg-red-50/40 border border-red-100/50 rounded-lg py-1 px-1.5 min-h-[56px] text-center min-w-0">
            <div className="text-[8px] font-bold text-red-600 mb-0.5 select-none">셔틀팀</div>
            <div className="flex flex-col gap-0.5 w-full min-w-0">
              <div className="truncate text-xs font-semibold text-slate-800">{getPlayerName(gm.team2_player1)}</div>
              <div className="truncate text-xs font-semibold text-slate-800">{getPlayerName(gm.team2_player2)}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 결과 제출용 카드 컴포넌트
  function MatchResultGridCard({ match, onSaved }: { match: AssignedMatch, onSaved: () => void }) {
    const [team1Score, setTeam1Score] = useState<number>(match.generated_match?.match_result?.team1_score || 0);
    const [team2Score, setTeam2Score] = useState<number>(match.generated_match?.match_result?.team2_score || 0);
    const [submitting, setSubmitting] = useState(false);

    const submitResult = async () => {
      if (!match || !match.generated_match) return;

      if (team1Score === team2Score) {
        alert('무승부는 저장할 수 없습니다.');
        return;
      }

      setSubmitting(true);
      try {
        const payload = {
          match_id: match.generated_match.id,
          winner_team1: team1Score > team2Score,
          team1_score: team1Score,
          team2_score: team2Score
        };

        const res = await fetch('/api/match-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || '결과 저장 중 오류');

        alert(
          `결과 저장 완료\n기본 배팅 ${DEFAULT_MATCH_WAGER}코인, 최대 ${MAX_MATCH_WAGER}코인 규칙으로 정산되었습니다.`
        );

        onSaved();
      } catch (err) {
        console.error('결과 저장 오류:', err);
        alert(getFriendlyErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between h-full">
        <div>
          {/* 카드 헤더 */}
          <div className="flex justify-between items-center pb-2 border-b border-gray-100 mb-2.5">
            <span className="text-sm font-bold text-gray-800">
              경기 {match.generated_match?.match_number}
            </span>
            {getStatusBadge(match.status)}
          </div>

          {/* 세션 정보 */}
          {match.generated_match?.session && (
            <div className="text-[11px] text-gray-400 mb-3 truncate" title={formatSessionName(match.generated_match.session)}>
              📍 {formatSessionName(match.generated_match.session)}
            </div>
          )}

          {/* 좌우 선수, 가운데 점수 레이아웃 */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 mb-3">
            {/* 왼쪽: 라켓팀 */}
            <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-1.5 flex flex-col items-center justify-center min-h-[80px] text-center">
              <div className="text-[9px] font-bold text-blue-600 mb-1">라켓팀</div>
              <div className="flex flex-col gap-1 w-full">
                {getPlayerNameWithHighlight(match.generated_match?.team1_player1)}
                {getPlayerNameWithHighlight(match.generated_match?.team1_player2)}
              </div>
            </div>

            {/* 가운데: 점수 입력 및 VS */}
            <div className="flex flex-col items-center justify-center min-w-[65px] px-1">
              <span className="text-[9px] font-bold text-gray-300 uppercase mb-1">VS / SCORE</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={team1Score}
                  onChange={(e) => setTeam1Score(Number(e.target.value))}
                  className="w-10 px-1 py-0.5 border rounded text-center text-xs font-semibold focus:ring-1 focus:ring-blue-500 outline-none"
                />
                <span className="text-xs font-bold text-gray-400">:</span>
                <input
                  type="number"
                  value={team2Score}
                  onChange={(e) => setTeam2Score(Number(e.target.value))}
                  className="w-10 px-1 py-0.5 border rounded text-center text-xs font-semibold focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            {/* 오른쪽: 셔틀팀 */}
            <div className="bg-red-50/60 border border-red-100 rounded-lg p-1.5 flex flex-col items-center justify-center min-h-[80px] text-center">
              <div className="text-[9px] font-bold text-red-600 mb-1">셔틀팀</div>
              <div className="flex flex-col gap-1 w-full">
                {getPlayerNameWithHighlight(match.generated_match?.team2_player1)}
                {getPlayerNameWithHighlight(match.generated_match?.team2_player2)}
              </div>
            </div>
          </div>
        </div>

        {/* 결과 배지 및 버튼 */}
        <div className="pt-2 border-t border-gray-100 flex flex-col gap-2 mt-2">
          {match.generated_match?.match_result && (
            <div className="rounded bg-emerald-50 border border-emerald-100 px-2 py-1 text-[10px] text-emerald-800 text-center truncate" title={`${match.generated_match.match_result.winner === 'team1' ? '라켓팀' : '셔틀팀'} 승 (${match.generated_match.match_result.score || `${team1Score}:${team2Score}`})`}>
              결과: {match.generated_match.match_result.winner === 'team1' ? '라켓' : '셔틀'} 승 ({match.generated_match.match_result.score || `${team1Score}:${team2Score}`})
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-gray-400 shrink-0">
              {DEFAULT_MATCH_WAGER}~{MAX_MATCH_WAGER}코인
            </span>
            <Button onClick={submitResult} disabled={submitting} size="sm" className="h-7 px-2.5 text-xs font-semibold shrink-0">
              {submitting ? '저장중...' : match.generated_match?.match_result ? '결과 수정' : '결과 저장'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 결과 제출용 테이블 행 컴포넌트
  function MatchResultTableRow({ match, onSaved }: { match: AssignedMatch, onSaved: () => void }) {
    const [team1Score, setTeam1Score] = useState<number>(match.generated_match?.match_result?.team1_score || 0);
    const [team2Score, setTeam2Score] = useState<number>(match.generated_match?.match_result?.team2_score || 0);
    const [submitting, setSubmitting] = useState(false);

    const submitResult = async () => {
      if (!match || !match.generated_match) return;

      if (team1Score === team2Score) {
        alert('무승부는 저장할 수 없습니다.');
        return;
      }

      setSubmitting(true);
      try {
        const payload = {
          match_id: match.generated_match.id,
          winner_team1: team1Score > team2Score,
          team1_score: team1Score,
          team2_score: team2Score
        };

        const res = await fetch('/api/match-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || '결과 저장 중 오류');

        alert(
          `결과 저장 완료\n기본 배팅 ${DEFAULT_MATCH_WAGER}코인, 최대 ${MAX_MATCH_WAGER}코인 규칙으로 정산되었습니다.`
        );

        onSaved();
      } catch (err) {
        console.error('결과 저장 오류:', err);
        alert(getFriendlyErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <tr className="hover:bg-gray-50">
        {/* 1. 회차 */}
        <td className="px-3 py-3 whitespace-nowrap text-center text-sm font-medium text-gray-900">
          {match.generated_match?.match_number}
        </td>
        {/* 2. 경기 세션 */}
        <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500 max-w-[150px] truncate" title={formatSessionName(match.generated_match?.session)}>
          {formatSessionName(match.generated_match?.session)}
        </td>
        {/* 3. 라켓팀 */}
        <td className="px-4 py-3 whitespace-nowrap text-center">
          <div className="inline-flex items-center justify-center space-x-1.5 bg-blue-50/60 border border-blue-100 rounded-md px-2 py-1">
            {getPlayerNameWithHighlight(match.generated_match?.team1_player1)}
            <span className="text-gray-300 text-xs">/</span>
            {getPlayerNameWithHighlight(match.generated_match?.team1_player2)}
          </div>
        </td>
        {/* 4. 점수 입력 */}
        <td className="px-4 py-3 whitespace-nowrap text-center">
          <div className="flex items-center justify-center gap-1.5">
            <input
              type="number"
              value={team1Score}
              onChange={(e) => setTeam1Score(Number(e.target.value))}
              className="w-12 px-1 py-0.5 border rounded text-center text-xs font-semibold focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <span className="text-xs text-gray-400 font-bold">:</span>
            <input
              type="number"
              value={team2Score}
              onChange={(e) => setTeam2Score(Number(e.target.value))}
              className="w-12 px-1 py-0.5 border rounded text-center text-xs font-semibold focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </td>
        {/* 5. 셔틀팀 */}
        <td className="px-4 py-3 whitespace-nowrap text-center">
          <div className="inline-flex items-center justify-center space-x-1.5 bg-red-50/60 border border-red-100 rounded-md px-2 py-1">
            {getPlayerNameWithHighlight(match.generated_match?.team2_player1)}
            <span className="text-gray-300 text-xs">/</span>
            {getPlayerNameWithHighlight(match.generated_match?.team2_player2)}
          </div>
        </td>
        {/* 6. 상태 */}
        <td className="px-3 py-3 whitespace-nowrap text-center">
          {getStatusBadge(match.status)}
        </td>
        {/* 7. 결과 및 저장 */}
        <td className="px-4 py-3 whitespace-nowrap text-center">
          <div className="flex items-center justify-center gap-2">
            {match.generated_match?.match_result ? (
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded truncate max-w-[120px]" title={`${match.generated_match.match_result.winner === 'team1' ? '라켓' : '셔틀'} 승 · ${match.generated_match.match_result.score || `${team1Score}:${team2Score}`}`}>
                {match.generated_match.match_result.winner === 'team1' ? '라켓' : '셔틀'} 승 ({match.generated_match.match_result.score || `${team1Score}:${team2Score}`})
              </span>
            ) : null}
            <Button onClick={submitResult} disabled={submitting} size="sm" className="h-7 px-2.5 text-xs font-semibold">
              {submitting ? '중...' : match.generated_match?.match_result ? '수정' : '저장'}
            </Button>
          </div>
        </td>
      </tr>
    );
  }
  const todayDateStr = getKoreaDate();
  
  const todayMatches = useMemo(() => {
    return assignedMatches.filter(m => {
      const dateStr = m.match_date ? m.match_date.split('T')[0] : '';
      return dateStr === todayDateStr;
    });
  }, [assignedMatches, todayDateStr]);

  const todayLeaderboard = useMemo(() => {
    const completedTodayMatches = todayMatches.filter(m => m.status === 'completed');
    const playerStats: Record<string, { name: string; wins: number; matches: number }> = {};

    const addStat = (player: any, isWin: boolean) => {
      if (!player) return;
      const key = player.username || player.full_name || '미정';
      if (key === '미정') return;
      
      if (!playerStats[key]) {
        playerStats[key] = {
          name: player.full_name || player.username || '미정',
          wins: 0,
          matches: 0
        };
      }
      playerStats[key].matches += 1;
      if (isWin) {
        playerStats[key].wins += 1;
      }
    };

    completedTodayMatches.forEach(m => {
      const gm = m.generated_match;
      if (!gm || !gm.match_result) return;
      
      const winner = gm.match_result.winner;
      const t1p1 = gm.team1_player1;
      const t1p2 = gm.team1_player2;
      const t2p1 = gm.team2_player1;
      const t2p2 = gm.team2_player2;
      
      if (winner === 'team1') {
        addStat(t1p1, true);
        addStat(t1p2, true);
        addStat(t2p1, false);
        addStat(t2p2, false);
      } else if (winner === 'team2') {
        addStat(t1p1, false);
        addStat(t1p2, false);
        addStat(t2p1, true);
        addStat(t2p2, true);
      }
    });

    return Object.values(playerStats)
      .map(stat => {
        const winRate = stat.matches > 0 ? Math.round((stat.wins / stat.matches) * 100) : 0;
        return { ...stat, winRate };
      })
      .sort((a, b) => {
        if (b.winRate !== a.winRate) {
          return b.winRate - a.winRate;
        }
        if (b.wins !== a.wins) {
          return b.wins - a.wins;
        }
        return a.matches - b.matches;
      })
      .slice(0, 5);
  }, [todayMatches]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-3 sm:py-6">
        <div className="w-full px-2 sm:px-6 lg:px-8">
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-gray-600">로딩 중...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-3 sm:py-6">
      <div className="w-full px-2 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between px-1">
            <div className="space-y-0.5 pl-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
                <Trophy className="h-3.5 w-3.5" />
                경기결과
              </span>
              <h1 className="text-xl font-bold tracking-tight">오늘 참가자 승률 TOP 5</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">오늘 참가한 선수들의 승률 순위와 경기 결과를 확인합니다.</p>
            </div>
            <Link href="/manager">
              <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                홈
              </Button>
            </Link>
          </div>
        </section>

        {isMobile ? (
          <div className="space-y-4">
            {/* 하단 오늘 경기 결과 상세 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/60">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <h3 className="text-sm font-bold text-slate-900">오늘 경기 결과</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  총 {todayMatches.length}경기
                </span>
              </div>

              {todayMatches.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  오늘 배정된 경기가 없습니다.
                </div>
              ) : (
                <div className="space-y-3.5">
                  {todayMatches.map((match) => (
                    <MobileMatchResultCard
                      key={match.id}
                      match={match}
                      onSaved={() => fetchAssignedMatches()}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>

        {/* 필터 컨트롤 */}
        <div className="mb-4 rounded-lg bg-white p-3 shadow-sm sm:mb-6 sm:p-6">
          <h3 className="mb-3 text-base font-medium text-gray-900 sm:mb-4 sm:text-lg">🔍 필터 설정</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {/* 세션 필터 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">경기 세션</label>
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">전체 세션</option>
                {matchSessions.map(session => (
                  <option key={session.id} value={session.id}>
                    {formatSessionName(session)}
                  </option>
                ))}
              </select>
            </div>

            {/* 날짜 필터 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">날짜</label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">전체 날짜</option>
                <option value="today">오늘</option>
                <option value="upcoming">예정된 경기</option>
                <option value="past">지난 경기</option>
              </select>
            </div>

            {/* 상태 필터 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">상태</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">전체 상태</option>
                <option value="scheduled">예정됨</option>
                <option value="in_progress">진행중</option>
                <option value="completed">완료됨</option>
                <option value="cancelled">취소됨</option>
              </select>
            </div>

            {/* 새로고침 버튼 */}
            <div className="flex items-end">
              <Button
                onClick={fetchAssignedMatches}
                disabled={loading}
                className="w-full"
              >
                {loading ? '새로고침 중...' : '🔄 새로고침'}
              </Button>
            </div>
          </div>
        </div>

        {/* 통계 카드 */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:mb-6 sm:gap-6 md:grid-cols-4">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-3 sm:p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="text-2xl">📊</div>
                </div>
                <div className="ml-3 w-0 flex-1 sm:ml-5">
                  <dl>
                    <dt className="truncate text-xs font-medium text-gray-500 sm:text-sm">총 배정 경기</dt>
                    <dd className="text-sm font-medium text-gray-900 sm:text-lg">{assignedMatches.length}경기</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-3 sm:p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="text-2xl">⏰</div>
                </div>
                <div className="ml-3 w-0 flex-1 sm:ml-5">
                  <dl>
                    <dt className="truncate text-xs font-medium text-gray-500 sm:text-sm">예정된 경기</dt>
                    <dd className="text-sm font-medium text-gray-900 sm:text-lg">
                      {assignedMatches.filter(m => m.status === 'scheduled').length}경기
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-3 sm:p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="text-2xl">✅</div>
                </div>
                <div className="ml-3 w-0 flex-1 sm:ml-5">
                  <dl>
                    <dt className="truncate text-xs font-medium text-gray-500 sm:text-sm">완료된 경기</dt>
                    <dd className="text-sm font-medium text-gray-900 sm:text-lg">
                      {assignedMatches.filter(m => m.status === 'completed').length}경기
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-3 sm:p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="text-2xl">🏟️</div>
                </div>
                <div className="ml-3 w-0 flex-1 sm:ml-5">
                  <dl>
                    <dt className="truncate text-xs font-medium text-gray-500 sm:text-sm">총 세션</dt>
                    <dd className="text-sm font-medium text-gray-900 sm:text-lg">{matchSessions.length}개</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 승률 TOP 5 리더보드 */}
        <div className="rounded-lg bg-white shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4 bg-gray-50/50">
            <h3 className="text-base font-medium text-gray-900 sm:text-lg">🏆 참가자 승률 TOP 5</h3>
          </div>
          {todayLeaderboard.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              오늘 완료된 경기가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">순위</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">이름</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">승률</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">승/경기</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {todayLeaderboard.map((player, index) => (
                    <tr key={player.name} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          index === 0 ? 'bg-yellow-100 text-yellow-800' :
                          index === 1 ? 'bg-slate-200 text-slate-700' :
                          index === 2 ? 'bg-amber-100 text-amber-800' :
                          'bg-slate-50 text-slate-500'
                        }`}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {player.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-blue-600">
                        {player.winRate}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                        {player.wins}승 / {player.matches}전
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )}
  </div>
</div>
);
}

export default function ProtectedMatchResultsPage() {
  return (
      <MatchResultsPage />
  );
}
