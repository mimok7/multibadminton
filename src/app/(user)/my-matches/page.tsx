'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { useUser } from '@/hooks/useUser';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatNameWithCoins } from '@/lib/player-display';
import { fetchScheduledMatchesForDate, type ScheduledMatchView } from '@/lib/scheduled-matches';
import { getKoreaDate } from '@/lib/date';
import { CalendarDays, RefreshCw, ArrowLeft } from 'lucide-react';

export default function TodayMatches() {
  const { user, loading: userLoading } = useUser();
  const [matches, setMatches] = useState<ScheduledMatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  const fetchTodayMatches = async () => {
    try {
      setLoading(true);
      const today = getKoreaDate();
      
      // 오늘의 모든 배정된 경기 조회
      const todayMatches = await fetchScheduledMatchesForDate(supabase, today);
      setMatches(todayMatches);
    } catch (error) {
      console.error('데이터 조회 중 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userLoading) return;
    void fetchTodayMatches();
  }, [userLoading, supabase]);

  if (userLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb]">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
          <span className="text-slate-600 font-medium text-sm">불러오는 중...</span>
        </div>
      </div>
    );
  }

  const isPlayerInMatch = (match: ScheduledMatchView) => {
    return match.team1_player1 === user?.id || 
           match.team1_player2 === user?.id || 
           match.team2_player1 === user?.id || 
           match.team2_player2 === user?.id;
  };

  const getPlayerTeam = (match: ScheduledMatchView) => {
    if (match.team1_player1 === user?.id || match.team1_player2 === user?.id) {
      return 'team1';
    }
    if (match.team2_player1 === user?.id || match.team2_player2 === user?.id) {
      return 'team2';
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900 pb-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
        
        {/* ── 다크 그라디언트 헤더 ── */}
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between px-1">
            <div className="space-y-0.5 pl-2">
              <h1 className="text-xl font-bold tracking-tight">오늘의 경기 일정</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
                {new Date().toLocaleDateString('ko-KR', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric',
                  weekday: 'long'
                })}
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                홈
              </Button>
            </Link>
          </div>
        </section>

        {matches.length === 0 ? (
          <div className="rounded-[24px] bg-white border border-slate-200/80 p-10 text-center shadow-sm">
            <div className="text-slate-300 text-6xl mb-4">🏸</div>
            <h3 className="text-base font-bold text-slate-800 mb-2">오늘 배정된 경기가 없습니다.</h3>
            <p className="text-xs text-slate-500">관리자가 경기를 배정하면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            
            {/* 요약 카드 */}
            <div className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-indigo-600" />
                오늘 경기 요약
              </h3>
              <div className="grid grid-cols-3 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 font-medium">총 경기 수</span>
                  <span className="font-extrabold text-slate-900 text-sm">{matches.length}경기</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 font-medium">사용 코트</span>
                  <span className="font-extrabold text-slate-900 text-sm">
                    {Math.max(...matches.map(m => m.court_number || 0))}개
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-slate-500 font-medium">내 경기</span>
                  <span className="font-extrabold text-slate-900 text-sm">
                    {matches.filter(isPlayerInMatch).length}경기
                  </span>
                </div>
              </div>
            </div>

            {/* 경기 목록 */}
            <div className="flex flex-col gap-3">
              {matches.map((match, index) => (
                <div 
                  key={match.id} 
                  className={`rounded-[24px] border p-5 transition-all ${
                    isPlayerInMatch(match) 
                      ? 'border-amber-200 bg-amber-50/50 shadow-sm' 
                      : 'border-slate-200/80 bg-white/92 shadow-sm hover:border-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                        isPlayerInMatch(match) ? 'bg-amber-500' : 'bg-slate-400'
                      }`}>
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                          경기 #{index + 1}
                          {isPlayerInMatch(match) && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded-full font-bold">
                              내 경기
                            </span>
                          )}
                        </h3>
                        <div className="text-xs text-slate-500 flex items-center gap-4 mt-1">
                          <span>⏰ {match.match_time || '시간 미정'}</span>
                          <span>🏟️ 코트 {match.court_number || '미정'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className={`p-3.5 rounded-xl border ${
                      getPlayerTeam(match) === 'team1' 
                        ? 'bg-indigo-50/70 border-indigo-200' 
                        : 'bg-slate-50/60 border-slate-100'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-indigo-800">라켓팀 (팀 1)</span>
                        {getPlayerTeam(match) === 'team1' && (
                          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] rounded-full font-bold">
                            내 팀
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 text-xs text-slate-700">
                        <div className={`font-semibold ${
                          match.team1_player1 === user?.id ? 'text-indigo-950 font-bold underline decoration-indigo-400 decoration-2' : ''
                        }`}>
                          👤 {formatNameWithCoins(match.team1_player1_name, match.team1_player1_coin_balance)}
                        </div>
                        <div className={`font-semibold ${
                          match.team1_player2 === user?.id ? 'text-indigo-950 font-bold underline decoration-indigo-400 decoration-2' : ''
                        }`}>
                          👤 {formatNameWithCoins(match.team1_player2_name, match.team1_player2_coin_balance)}
                        </div>
                      </div>
                    </div>

                    <div className={`p-3.5 rounded-xl border ${
                      getPlayerTeam(match) === 'team2' 
                        ? 'bg-rose-50/70 border-rose-200' 
                        : 'bg-slate-50/60 border-slate-100'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-rose-800">셔틀팀 (팀 2)</span>
                        {getPlayerTeam(match) === 'team2' && (
                          <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-[9px] rounded-full font-bold">
                            내 팀
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 text-xs text-slate-700">
                        <div className={`font-semibold ${
                          match.team2_player1 === user?.id ? 'text-rose-950 font-bold underline decoration-rose-400 decoration-2' : ''
                        }`}>
                          👤 {formatNameWithCoins(match.team2_player1_name, match.team2_player1_coin_balance)}
                        </div>
                        <div className={`font-semibold ${
                          match.team2_player2 === user?.id ? 'text-rose-950 font-bold underline decoration-rose-400 decoration-2' : ''
                        }`}>
                          👤 {formatNameWithCoins(match.team2_player2_name, match.team2_player2_coin_balance)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
