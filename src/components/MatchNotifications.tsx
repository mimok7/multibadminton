'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';
import { formatKSTDateTime, getKoreaDate } from '@/lib/date';

interface MatchAssignmentNotification {
  id: string;
  created_at: string;
  message: string;
  type: 'match_assigned' | 'match_updated' | 'match_cancelled';
  is_read: boolean;
}

export default function MatchNotifications() {
  const { user, profile } = useUser();
  const { clubId } = useClub();
  const [notifications, setNotifications] = useState<MatchAssignmentNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    if (!user || !clubId) return;

    const checkForNewMatches = async () => {
      try {
        const today = getKoreaDate();
        // useUser 훅에서 캐시되어 제공받는 profile 정보를 재사용하여 30초마다 발생하는 DB 중복 조회를 방지합니다.
        const myProfile = profile;

        if (!myProfile?.id) {
          return;
        }
        
        const recentThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        const { data: recentSchedules, error: schedulesError } = await supabase
          .from('match_schedules')
          .select('id, created_at, status, generated_match_id')
          .eq('club_id', clubId)
          .eq('match_date', today)
          .eq('status', 'scheduled')
          .gte('created_at', recentThreshold)
          .not('generated_match_id', 'is', null);

        if (schedulesError || !recentSchedules || recentSchedules.length === 0) {
          if (schedulesError) {
            console.error('경기 일정 조회 오류:', schedulesError);
          }
          return;
        }

        const generatedMatchIds = recentSchedules
          .map((schedule) => schedule.generated_match_id)
          .filter((id): id is number => typeof id === 'number');

        if (generatedMatchIds.length === 0) {
          return;
        }

        const { data: generatedMatches, error: matchesError } = await supabase
          .from('generated_matches')
          .select('id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id')
          .in('id', generatedMatchIds);

        if (matchesError || !generatedMatches) {
          if (matchesError) {
            console.error('배정 경기 조회 오류:', matchesError);
          }
          return;
        }

        const matchMap = new Map(generatedMatches.map((match) => [match.id, match]));
        const todayMatches = recentSchedules.filter((schedule) => {
          const generatedMatch = typeof schedule.generated_match_id === 'number'
            ? matchMap.get(schedule.generated_match_id)
            : null;

          return Boolean(
            generatedMatch &&
              [
                generatedMatch.team1_player1_id,
                generatedMatch.team1_player2_id,
                generatedMatch.team2_player1_id,
                generatedMatch.team2_player2_id,
              ].includes(myProfile.id)
          );
        });

        if (todayMatches.length > 0) {
          // 새로운 경기 배정 알림 생성
          const newNotifications = todayMatches.map(match => ({
            id: `match_${match.id}`,
            created_at: match.created_at,
            message: '새로운 경기가 배정되었습니다! 대시보드에서 확인하세요.',
            type: 'match_assigned' as const,
            is_read: false
          }));

          setNotifications(prev => {
            const existingIds = new Set(prev.map(n => n.id));
            const uniqueNew = newNotifications.filter(n => !existingIds.has(n.id));
            return [...prev, ...uniqueNew];
          });

          if (newNotifications.length > 0) {
            setShowNotifications(true);
          }
        }
      } catch (error) {
        console.error('경기 알림 확인 오류:', error);
      }
    };

    // 초기 확인
    checkForNewMatches();

    // 30초마다 새 경기 확인
    const interval = setInterval(checkForNewMatches, 30000);

    return () => clearInterval(interval);
  }, [user, profile, clubId, supabase]);

  const markAsRead = (notificationId: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
    );
  };

  const dismissAll = () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setShowNotifications(false);
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (unreadCount === 0) {
    return null;
  }

  return (
    <>
      {/* 알림 버튼 */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative bg-yellow-500 hover:bg-yellow-600 text-white p-3 rounded-full shadow-lg transition-colors"
        >
          <span className="text-xl">🔔</span>
          {unreadCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* 알림 패널 */}
      {showNotifications && (
        <div className="fixed top-16 right-4 z-50 w-80 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-gray-900">📢 경기 알림</h3>
              <button
                onClick={dismissAll}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                모두 읽음
              </button>
            </div>
          </div>
          
          <div className="max-h-64 overflow-y-auto">
            {notifications
              .filter(n => !n.is_read)
              .map(notification => (
                <div
                  key={notification.id}
                  className="p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-xl">
                      {notification.type === 'match_assigned' ? '🏆' : '📋'}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {notification.message}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatKSTDateTime(notification.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
          
          {notifications.filter(n => !n.is_read).length === 0 && (
            <div className="p-4 text-center text-gray-500">
              새로운 알림이 없습니다.
            </div>
          )}
        </div>
      )}
    </>
  );
}
