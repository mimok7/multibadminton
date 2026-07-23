'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy, Medal, Award, TrendingUp } from 'lucide-react';

import { RequireAuth } from '@/components/AuthGuard';
import { useClub } from '@/hooks/useClub';
import { getSupabaseClient } from '@/lib/supabase';

interface RankingUser {
  user_id: string;
  coin_balance: number;
  coin_wins: number;
  coin_losses: number;
  profiles: {
    username: string | null;
    full_name: string | null;
    skill_level: string | null;
    avatar_url: string | null;
  } | null;
}

export default function RankingPage() {
  const { clubId, loading: clubLoading } = useClub();
  const supabase = getSupabaseClient();

  const [users, setUsers] = useState<RankingUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRankings() {
      if (clubLoading) return;
      
      if (!clubId) {
        setUsers([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('club_members')
          .select(`
            user_id,
            coin_balance,
            coin_wins,
            coin_losses,
            profiles (
              username,
              full_name,
              skill_level,
              avatar_url
            )
          `)
          .eq('club_id', clubId)
          .eq('status', 'active')
          .order('coin_balance', { ascending: false })
          .limit(100); // 상위 100명까지만

        if (error) {
          console.error('Error fetching rankings:', error);
          setUsers([]);
        } else {
          setUsers((data as unknown as RankingUser[]) || []);
        }
      } catch (err) {
        console.error('Failed to fetch rankings', err);
      } finally {
        setLoading(false);
      }
    }

    fetchRankings();
  }, [clubId, clubLoading, supabase]);

  const getRankIcon = (index: number) => {
    if (index === 0) return <Trophy className="size-6 text-yellow-500 fill-yellow-100" />;
    if (index === 1) return <Medal className="size-6 text-slate-400 fill-slate-100" />;
    if (index === 2) return <Medal className="size-6 text-amber-700 fill-amber-100/50" />;
    return <span className="text-slate-500 font-bold w-6 text-center">{index + 1}</span>;
  };

  return (
    <RequireAuth>
      <div className="min-h-screen bg-slate-50 pb-20">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="p-2 -ml-2 rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors">
                <ArrowLeft className="size-5 text-slate-700" />
              </Link>
              <h1 className="text-lg font-bold text-slate-900">클럽 랭킹</h1>
            </div>
            <Award className="size-5 text-indigo-500" />
          </div>
        </div>

        <div className="max-w-md mx-auto p-4 space-y-6">
          {/* Info Card */}
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg shadow-indigo-200">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold mb-1">코인 랭킹 TOP 100</h2>
                <p className="text-indigo-100 text-sm opacity-90 mt-1">
                  매치에서 승리하고 코인을 모아<br />상위권에 도전해 보세요!
                </p>
              </div>
              <TrendingUp className="size-10 text-white/20" />
            </div>
          </div>

          {/* Ranking List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs font-semibold text-slate-500">
              <div className="w-12 text-center">순위</div>
              <div className="flex-1 px-2">회원</div>
              <div className="w-24 text-right">보유 코인</div>
            </div>

            <div className="divide-y divide-slate-100">
              {loading ? (
                <div className="py-12 text-center text-sm text-slate-500">랭킹을 불러오는 중입니다...</div>
              ) : users.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">아직 랭킹 정보가 없습니다.</div>
              ) : (
                users.map((user, index) => {
                  const profile = user.profiles;
                  const displayName = profile?.full_name || profile?.username || '알 수 없음';
                  const levelCode = profile?.skill_level || '';
                  const totalMatches = user.coin_wins + user.coin_losses;
                  const winRate = totalMatches > 0 ? Math.round((user.coin_wins / totalMatches) * 100) : 0;
                  
                  // Top 3 gets special styling
                  const isTop3 = index < 3;

                  return (
                    <div 
                      key={user.user_id} 
                      className={`flex items-center p-4 transition-colors hover:bg-slate-50 ${isTop3 ? 'bg-indigo-50/30' : ''}`}
                    >
                      {/* Rank Icon / Number */}
                      <div className="w-12 flex justify-center shrink-0">
                        {getRankIcon(index)}
                      </div>

                      {/* User Info */}
                      <div className="flex-1 px-3 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 truncate text-sm">
                            {displayName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                          <span>{user.coin_wins}승 {user.coin_losses}패</span>
                          <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                          <span>승률 {winRate}%</span>
                        </div>
                      </div>

                      {/* Coin Balance */}
                      <div className="w-24 text-right shrink-0">
                        <span className={`font-bold ${isTop3 ? 'text-indigo-600 text-base' : 'text-slate-700 text-sm'}`}>
                          {user.coin_balance.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-500 ml-1">C</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
