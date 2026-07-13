'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarDays, Gift, LogOut, Shield, Swords, Target, Trophy, UserCircle2, Zap, Bell, BookOpen, MessageSquarePlus } from 'lucide-react';

import MatchNotifications from '@/components/MatchNotifications';
import { useLevelInfoMap } from '@/hooks/useLevelInfoMap';
import type { AppProfile } from '@/lib/auth';
import { getLevelNameFromCode } from '@/lib/level-info';
import { getSupabaseClient } from '@/lib/supabase';
import { getKoreaDate } from '@/lib/date';

type AttendanceStatus = 'present' | 'lesson' | 'absent' | null;



const quickLinks = [
  {
    href: '/notifications',
    title: '공지사항/알림',
    description: '새로운 공지와 내 알림을 확인합니다.',
    icon: Bell,
    hoverClass: 'hover:border-pink-400 hover:bg-pink-50/50',
    iconColor: 'text-pink-500',
  },
  {
    href: '/challenge',
    title: '게임 제안',
    description: '완료된 선수들과 다음 게임을 제안합니다.',
    icon: Zap,
    hoverClass: 'hover:border-indigo-400 hover:bg-indigo-50/50',
    iconColor: 'text-indigo-500',
  },
  {
    href: '/today-matches',
    title: '오늘 게임',
    description: '배정된 게임과 코트를 확인합니다.',
    icon: Swords,
    hoverClass: 'hover:border-blue-400 hover:bg-blue-50/50',
    iconColor: 'text-blue-500',
  },
  {
    href: '/match-registration',
    title: '참가 신청',
    description: '예정 경기 참가 여부를 등록합니다.',
    icon: Target,
    hoverClass: 'hover:border-green-400 hover:bg-green-50/50',
    iconColor: 'text-green-500',
  },
  {
    href: '/my-schedule',
    title: '내 게임',
    description: '내 일정과 게임 기록을 한 번에 봅니다.',
    icon: CalendarDays,
    hoverClass: 'hover:border-orange-400 hover:bg-orange-50/50',
    iconColor: 'text-orange-500',
  },
  {
    href: '/profile',
    title: '회원 목록',
    description: '회원 목록과 내 정보를 관리합니다.',
    icon: UserCircle2,
    hoverClass: 'hover:border-purple-400 hover:bg-purple-50/50',
    iconColor: 'text-purple-500',
  },

  {
    href: '/tournament-bracket',
    title: '대회 대진표',
    description: '대회 대진표를 확인합니다.',
    icon: Trophy,
    hoverClass: 'hover:border-amber-400 hover:bg-amber-50/50',
    iconColor: 'text-amber-500',
  },
  {
    href: '/products/exchange',
    title: '상품 교환',
    description: '코인을 사용하여 상품으로 교환합니다.',
    icon: Gift,
    hoverClass: 'hover:border-rose-400 hover:bg-rose-50/50',
    iconColor: 'text-rose-500',
  },
  {
    href: '/manual',
    title: '사용자 설명서',
    description: '시스템 기능 및 이용 안내 가이드를 확인합니다.',
    icon: BookOpen,
    hoverClass: 'hover:border-sky-400 hover:bg-sky-50/50',
    iconColor: 'text-sky-500',
  },
  {
    href: '/app-request',
    title: '앱 수정 요청',
    description: '기능 건의 및 버그 제보를 작성하여 전달합니다.',
    icon: MessageSquarePlus,
    hoverClass: 'hover:border-yellow-400 hover:bg-yellow-50/50',
    iconColor: 'text-yellow-600',
  },
];

function normalizeAttendanceStatus(value: string | null | undefined): AttendanceStatus {
  if (value === 'present' || value === 'lesson' || value === 'absent') {
    return value;
  }

  return null;
}



export default function ClientDashboard({
  userId,
  email,
  profile,
  userIsAdmin,
}: {
  userId: string;
  email: string;
  profile: AppProfile | null;
  userIsAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const levelInfoMap = useLevelInfoMap();

  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [myAttendanceStatus, setMyAttendanceStatus] = useState<AttendanceStatus>(null);
  const [isRegisteredToday, setIsRegisteredToday] = useState(false);
  const [todayRegistration, setTodayRegistration] = useState<any>(null);
  const [todaySchedules, setTodaySchedules] = useState<any[]>([]);
  const [statusSaving, setStatusSaving] = useState(false);
  const [isCoinEnabled, setIsCoinEnabled] = useState(true);
  const [isClubManager, setIsClubManager] = useState(false);
  const [activeClub, setActiveClub] = useState<{ id: string; name: string } | null>(null);
  const [clubMemberInfo, setClubMemberInfo] = useState<{
    role: string;
    coin_balance: number;
    coin_wins: number;
    coin_losses: number;
  } | null>(null);

  // ── 통합 초기 데이터 로딩 (한 번의 흐름으로 모든 히어로 카드 데이터 로딩) ──
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const loadDashboardData = async () => {
      try {
        setLoadingAttendance(true);
        const today = getKoreaDate();

        const response = await fetch('/api/user/dashboard-summary', { cache: 'no-store' });
        const payload = response.ok ? await response.json().catch(() => null) : null;
        if (cancelled) return;

        const schedulesList = Array.isArray(payload?.schedules) ? payload.schedules : [];
        const registration = payload?.registration ?? null;
        setActiveClub(payload?.club ?? null);
        setClubMemberInfo(payload?.member ?? null);
        setIsCoinEnabled(payload?.isCoinEnabled !== false);
        setIsClubManager(['owner', 'admin', 'manager'].includes(payload?.member?.role));
        setMyAttendanceStatus(normalizeAttendanceStatus(payload?.attendanceStatus));
        setTodaySchedules(schedulesList);
        setIsRegisteredToday(Boolean(registration));
        setTodayRegistration(registration);
      } catch (error) {
        console.error('대시보드 데이터 로딩 오류:', error);
      } finally {
        if (!cancelled) setLoadingAttendance(false);
      }
    };

    void loadDashboardData();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  /** 재조회용: 참가 신청 변경 후 다시 불러올 때 사용 */
  const fetchAttendanceAndRegistration = async () => {
    if (!userId) return;
    try {
      setLoadingAttendance(true);
      const today = getKoreaDate();

      // 1. 출석 상태
      const response = await fetch(`/api/attendance/status?date=${today}`);
      const payload = await response.json().catch(() => null);
      setMyAttendanceStatus(response.ok ? normalizeAttendanceStatus(payload?.status) : null);

      // 2. 오늘 일정: 활성 클럽 기준으로 서버에서 조회
      const schedulesResponse = await fetch(`/api/user/match-schedules?date=${today}`, {
        cache: 'no-store',
      });
      const schedulesPayload = schedulesResponse.ok
        ? await schedulesResponse.json().catch(() => null)
        : null;
      const schedulesList = Array.isArray(schedulesPayload?.schedules)
        ? schedulesPayload.schedules
        : [];
      setTodaySchedules(schedulesList);

      // 3. 참가 신청
      const userProfileId = profile?.id || userId;
      if (schedulesList.length > 0 && userProfileId) {
        const params = new URLSearchParams();
        schedulesList.forEach((item: any) => params.append('scheduleId', item.id));
        const participantsResponse = await fetch(`/api/user/match-participants?${params.toString()}`, {
          cache: 'no-store',
        });
        const participantsPayload = participantsResponse.ok
          ? await participantsResponse.json().catch(() => null)
          : null;
        const participantKeys = [userId, profile?.id].filter(Boolean);
        const participations = (participantsPayload?.participants || []).filter(
          (item: any) => participantKeys.includes(item.user_id) && ['registered', 'waitlisted', 'attended'].includes(item.status)
        );

        if (participations.length > 0) {
          setIsRegisteredToday(true);
          setTodayRegistration(participations[0]);
        } else {
          setIsRegisteredToday(false);
          setTodayRegistration(null);
        }
      } else {
        setIsRegisteredToday(false);
        setTodayRegistration(null);
      }
    } catch (error) {
      console.error('대시보드 상태 조회 오류:', error);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleToggleRegistration = async () => {
    if (statusSaving || loadingAttendance) return;

    const userProfileId = profile?.id || userId;
    if (!userProfileId) return;

    try {
      setStatusSaving(true);
      const today = getKoreaDate();

      if (isRegisteredToday && todayRegistration) {
        const hasConfirmed = await window.confirm('오늘 경기 참가신청이 취소됩니다. 정말 취소하시겠습니까?');
        if (!hasConfirmed) {
          setStatusSaving(false);
          return;
        }

        // Cancel registration (update status to 'cancelled')
        const { error } = await supabase
          .from('match_participants')
          .update({ status: 'cancelled' })
          .eq('id', todayRegistration.id);

        if (error) throw error;

        // Also clear attendance if any
        let deleteQuery = supabase
          .from('attendances')
          .delete()
          .eq('user_id', userProfileId)
          .eq('attended_at', today);
        if (activeClub?.id) {
          deleteQuery = deleteQuery.eq('club_id', activeClub.id);
        }
        const { error: deleteError } = await deleteQuery;

        if (deleteError) {
          console.error('출석 초기화 실패:', deleteError);
        }
        setMyAttendanceStatus(null);
        setIsRegisteredToday(false);
        setTodayRegistration(null);
        alert('참가 신청이 취소되었습니다.');
      } else {
        // Register for match
        if (todaySchedules.length === 0) {
          alert('오늘 예정된 경기 일정이 없습니다. 참가 신청을 할 수 없습니다.');
          return;
        }

        const scheduleId = todaySchedules[0].id;
        const max = todaySchedules[0].max_participants ?? 20;
        const current = todaySchedules[0].current_participants ?? 0;
        if (current >= max) {
          alert(`이미 정원(${max}명)이 가득 찬 경기 일정입니다. 참가 신청을 할 수 없습니다.`);
          return;
        }

        const { data: existing } = await supabase
          .from('match_participants')
          .select('id')
          .eq('match_schedule_id', scheduleId)
          .eq('user_id', userProfileId)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from('match_participants')
            .update({ status: 'registered', registered_at: new Date().toISOString() })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('match_participants')
            .insert({
              match_schedule_id: scheduleId,
              user_id: userProfileId,
              status: 'registered',
              registered_at: new Date().toISOString(),
            });
          if (error) throw error;
        }

        // Also delete attendance to revert to '참가' state
        let deleteQuery = supabase
          .from('attendances')
          .delete()
          .eq('user_id', userProfileId)
          .eq('attended_at', today);
        if (activeClub?.id) {
          deleteQuery = deleteQuery.eq('club_id', activeClub.id);
        }
        const { error: deleteError } = await deleteQuery;

        if (deleteError) {
          console.error('출석 초기화 실패:', deleteError);
        }
        setMyAttendanceStatus(null);
        alert('참가 신청이 완료되었습니다.');
      }
      void fetchAttendanceAndRegistration();
    } catch (e) {
      console.error('참가 신청 처리 중 오류:', e);
      alert('참가 신청 처리 중 오류가 발생했습니다.');
    } finally {
      setStatusSaving(false);
    }
  };

  const handleAttendanceStatusChange = async (nextStatus: Exclude<AttendanceStatus, null>) => {
    if (statusSaving || loadingAttendance) return;

    const userProfileId = profile?.id || userId;
    if (!userProfileId) return;

    const today = getKoreaDate();

    try {
      setStatusSaving(true);
      const isAlreadyActive = myAttendanceStatus === nextStatus;

      if (isAlreadyActive) {
        // Toggle off: delete attendance record
        let deleteQuery = supabase
          .from('attendances')
          .delete()
          .eq('user_id', userProfileId)
          .eq('attended_at', today);
        if (activeClub?.id) {
          deleteQuery = deleteQuery.eq('club_id', activeClub.id);
        }
        const { error } = await deleteQuery;

        if (error) throw error;
        setMyAttendanceStatus(null);
      } else {
        // Save attendance status
        const response = await fetch('/api/attendance/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: nextStatus,
            attendedAt: today,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to save attendance status');
        }

        setMyAttendanceStatus(nextStatus);
      }
    } catch (error) {
      console.error('출석 상태 저장 오류:', error);
      alert('상태 저장 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setStatusSaving(false);
    }
  };

  const rawDisplayName = profile?.full_name || profile?.username || email.split('@')[0];
  const displayName = rawDisplayName;
  const levelLabel = profile?.skill_level_name || getLevelNameFromCode(levelInfoMap, profile?.skill_level, profile?.skill_level || '미지정');
 
  const visibleQuickLinks = useMemo(() => {
    let filtered = quickLinks;
    if (!isCoinEnabled) {
      filtered = filtered.filter((link) => link.href !== '/products/exchange');
    }
    if (profile?.is_guest) {
      filtered = filtered.filter((link) => 
        ['/challenge', '/today-matches', '/my-schedule'].includes(link.href)
      );
    }
    return filtered;
  }, [isCoinEnabled, profile?.is_guest]);

  let activeStateLabel = '미참가';
  if (myAttendanceStatus === 'present') {
    activeStateLabel = '출석';
  } else if (myAttendanceStatus === 'lesson') {
    activeStateLabel = '레슨';
  } else if (myAttendanceStatus === 'absent') {
    activeStateLabel = '퇴근';
  } else {
    activeStateLabel = isRegisteredToday ? '참가' : '미참가';
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <MatchNotifications />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
        <section className="rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
          <div className="flex items-start justify-between gap-3 px-2">
            <div>

              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold leading-tight">{displayName}</h1>
                {profile?.is_guest && (
                  <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    게스트
                  </span>
                )}
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-100">
                  승 {clubMemberInfo?.coin_wins ?? 0}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-100">
                  패 {clubMemberInfo?.coin_losses ?? 0}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-100">레벨 {levelLabel}</span>
                {isCoinEnabled && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-100">
                    코인 {clubMemberInfo?.coin_balance ?? 0}
                  </span>
                )}
                {(userIsAdmin || isClubManager) && (
                  <Link
                    href="/manager"
                    className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-slate-100 transition hover:bg-white/20"
                  >
                    <Shield className="size-3.5" />
                    매니저 홈
                  </Link>
                )}
              </div>
              <div className="mt-2 text-[12px] text-slate-300">
                오늘 내 상태: <span className="font-medium text-white">{loadingAttendance ? '조회 중...' : activeStateLabel}</span>
                {!loadingAttendance && (
                  todaySchedules[0] ? (
                    (() => {
                      const max = todaySchedules[0].max_participants ?? 20;
                      const current = todaySchedules[0].current_participants ?? 0;
                      const remaining = Math.max(0, max - current);
                      return (
                        <span className="ml-1.5 font-semibold text-yellow-400">
                          {remaining <= 0 ? '(신청 마감)' : `(${remaining}/${max}명 신청 가능)`}
                        </span>
                      );
                    })()
                  ) : (
                    <span className="ml-1.5 font-semibold text-yellow-400">
                      (오늘 경기 일정 없음)
                    </span>
                  )
                )}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/15 border-0 focus:outline-none shrink-0"
              title="로그아웃"
            >
              <LogOut className="size-3.5" />
              로그아웃
            </button>
          </div>

          <div className="mt-3 rounded-[18px] bg-white/8 px-2.5 py-2.5">
            <div className="grid grid-cols-4 gap-1.5">
              {/* 1. 참가 버튼 */}
              <button
                type="button"
                disabled={statusSaving || loadingAttendance}
                onClick={handleToggleRegistration}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  isRegisteredToday && myAttendanceStatus === null
                    ? 'bg-white text-slate-900'
                    : 'bg-white/10 text-slate-100 hover:bg-white/20'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isRegisteredToday ? '참가' : '미참가'}
              </button>

              {/* 2. 출석 버튼 */}
              <button
                type="button"
                disabled={statusSaving || loadingAttendance || !isRegisteredToday}
                onClick={() => handleAttendanceStatusChange('present')}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  myAttendanceStatus === 'present'
                    ? 'bg-white text-slate-900'
                    : 'bg-white/10 text-slate-100 hover:bg-white/20'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                출석
              </button>

              {/* 3. 레슨 버튼 */}
              <button
                type="button"
                disabled={statusSaving || loadingAttendance || !isRegisteredToday}
                onClick={() => handleAttendanceStatusChange('lesson')}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  myAttendanceStatus === 'lesson'
                    ? 'bg-white text-slate-900'
                    : 'bg-white/10 text-slate-100 hover:bg-white/20'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                레슨
              </button>

              {/* 4. 퇴근 버튼 */}
              <button
                type="button"
                disabled={statusSaving || loadingAttendance || !isRegisteredToday}
                onClick={() => handleAttendanceStatusChange('absent')}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  myAttendanceStatus === 'absent'
                    ? 'bg-white text-slate-900'
                    : 'bg-white/10 text-slate-100 hover:bg-white/20'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                퇴근
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] bg-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            {visibleQuickLinks.map((item: any) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-[20px] border border-blue-200 bg-white px-2.5 py-3 transition-colors ${item.hoverClass} shadow-sm`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <Icon className={`mt-0.5 size-4 shrink-0 ${item.iconColor}`} />
                      <h3 className="break-keep text-sm font-semibold text-slate-900">{item.title}</h3>
                    </div>
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  </div>
                  <p className="mt-1 break-keep text-xs leading-5 text-slate-500">{item.description}</p>
                </Link>
              );
            })}
          </div>
        </section>


      </div>
    </div>
  );
}
